import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkRateLimit } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface ShortScript {
  id: string
  category: string
  title: string
  hook: string
  body: string
  cta: string
  voiceover: string
  b_roll_keywords: string[]
  hashtags: string[]
}

const CATEGORIES = [
  '전세사기',
  '원룸 화재·사고',
  '층간소음·이웃 분쟁',
  '계약서 함정',
  '임대인 갑질',
]

const PROMPT_TEMPLATE = (categories: string[]) => `당신은 한국 부동산 분야의 숏폼 영상 시나리오 작가입니다.
유튜브 쇼츠(15~30초) 시나리오 ${categories.length}개를 작성해주세요.

【필수 규칙】
1. 카테고리 순서대로 작성: ${categories.map((c, i) => `${i + 1}. ${c}`).join(' / ')}
2. 실제 특정 사건·실명·지명 인용 금지. 일반적·교육적 사례로 작성 (법적 안전).
3. 톤: 충격적, 클릭 유도, 그러나 사실 기반 일반론
4. 구조: 후킹(3초) → 사례·정보(15~20초) → 예방·CTA(5초)
5. 한국어. 음성 더빙용으로 자연스럽게 읽히는 문장.

【각 시나리오 필드】
- category: 카테고리명
- title: 유튜브 제목 (40자 이내, 클릭베이트 OK)
- hook: 첫 3초에 외칠 한 문장 (시청자가 멈추게 만드는 충격 멘트)
- body: 본문 내레이션 (15~20초 분량, 약 100~150자)
- cta: 마지막 멘트 (5초 이내, 구독·저장·공유 유도)
- voiceover: hook+body+cta를 자연스러운 흐름으로 합친 전체 더빙 스크립트
- b_roll_keywords: 자료화면 검색 키워드 5개 (한국어, 픽사베이/펙셀스용)
- hashtags: 유튜브 해시태그 7개 (#포함)

JSON만 출력. 다른 설명 금지.`

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    scripts: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          category: { type: 'STRING' },
          title: { type: 'STRING' },
          hook: { type: 'STRING' },
          body: { type: 'STRING' },
          cta: { type: 'STRING' },
          voiceover: { type: 'STRING' },
          b_roll_keywords: { type: 'ARRAY', items: { type: 'STRING' } },
          hashtags: { type: 'ARRAY', items: { type: 'STRING' } },
        },
        required: ['category', 'title', 'hook', 'body', 'cta', 'voiceover', 'b_roll_keywords', 'hashtags'],
      },
    },
  },
  required: ['scripts'],
}

const DEMO_SCRIPTS: ShortScript[] = [
  {
    id: 'demo-1',
    category: '전세사기',
    title: '전세 계약 전 이거 안 보면 평생 후회합니다',
    hook: '잠깐, 계약서 쓰기 전에 이거 꼭 확인하세요.',
    body: '등기부등본을 안 떼고 계약하는 사람이 아직도 있습니다. 근저당이 매매가의 60%를 넘으면 위험합니다. 집주인 신분증과 등기부상 소유자 이름이 일치하는지 반드시 확인하세요.',
    cta: '전세 들어가시는 분 꼭 저장하세요. 다음 영상에서 더 알려드립니다.',
    voiceover: '잠깐, 계약서 쓰기 전에 이거 꼭 확인하세요. 등기부등본을 안 떼고 계약하는 사람이 아직도 있습니다. 근저당이 매매가의 60%를 넘으면 위험합니다. 집주인 신분증과 등기부상 소유자 이름이 일치하는지 반드시 확인하세요. 전세 들어가시는 분 꼭 저장하세요.',
    b_roll_keywords: ['아파트 외관', '등기부등본', '계약서', '도장', '열쇠'],
    hashtags: ['#전세사기', '#부동산', '#전세', '#계약', '#등기부등본', '#부동산팁', '#내집마련'],
  },
  {
    id: 'demo-2',
    category: '원룸 화재·사고',
    title: '이런 원룸 들어가면 화재 시 못 빠져나옵니다',
    hook: '이런 원룸은 절대 들어가지 마세요.',
    body: '복도가 좁고 비상구가 1개뿐인 원룸은 화재 시 매우 위험합니다. 특히 4층 이상에 완강기가 없으면 탈출이 불가능합니다. 입주 전 비상구와 소화기 위치를 반드시 확인하세요.',
    cta: '이사 준비 중이시면 댓글로 지역 알려주세요.',
    voiceover: '이런 원룸은 절대 들어가지 마세요. 복도가 좁고 비상구가 1개뿐인 원룸은 화재 시 매우 위험합니다. 특히 4층 이상에 완강기가 없으면 탈출이 불가능합니다. 입주 전 비상구와 소화기 위치를 반드시 확인하세요. 이사 준비 중이시면 댓글 남겨주세요.',
    b_roll_keywords: ['원룸 복도', '소화기', '비상구', '완강기', '화재 연기'],
    hashtags: ['#원룸', '#화재예방', '#안전', '#자취방', '#부동산', '#원룸구하기', '#안전점검'],
  },
  {
    id: 'demo-3',
    category: '층간소음·이웃 분쟁',
    title: '윗집 층간소음 100% 해결하는 법',
    hook: '윗집 발소리에 잠 못 자는 분들 주목하세요.',
    body: '관리실에 전화하지 마세요. 효과 없습니다. 환경부 층간소음 이웃사이센터에 신고하면 무료 측정과 중재까지 받을 수 있습니다. 측정 결과는 법적 증거가 됩니다.',
    cta: '저장해두시면 분쟁 시 도움됩니다.',
    voiceover: '윗집 발소리에 잠 못 자는 분들 주목하세요. 관리실에 전화하지 마세요. 효과 없습니다. 환경부 층간소음 이웃사이센터에 신고하면 무료 측정과 중재까지 받을 수 있습니다. 측정 결과는 법적 증거가 됩니다. 저장해두시면 분쟁 시 도움됩니다.',
    b_roll_keywords: ['아파트 천장', '시끄러운 발소리', '잠 못 자는 사람', '소음측정기', '이웃분쟁'],
    hashtags: ['#층간소음', '#이웃사이센터', '#아파트', '#소음분쟁', '#환경부', '#생활팁', '#부동산'],
  },
  {
    id: 'demo-4',
    category: '계약서 함정',
    title: '이 한 줄 때문에 보증금 1억 날렸습니다',
    hook: '계약서 특약사항에 이런 문구 있으면 절대 도장 찍지 마세요.',
    body: "'원상복구 책임 임차인 전부 부담' 이라는 한 줄로 보증금에서 수백만원이 빠져나간 사례가 많습니다. 자연 마모와 임차인 과실은 법적으로 다릅니다. 모호한 특약은 반드시 삭제 요청하세요.",
    cta: '계약서 검토 받고 싶으시면 댓글 주세요.',
    voiceover: "계약서 특약사항에 이런 문구 있으면 절대 도장 찍지 마세요. 원상복구 책임 임차인 전부 부담 이라는 한 줄로 보증금에서 수백만원이 빠져나간 사례가 많습니다. 자연 마모와 임차인 과실은 법적으로 다릅니다. 모호한 특약은 반드시 삭제 요청하세요. 계약서 검토 받고 싶으시면 댓글 주세요.",
    b_roll_keywords: ['계약서', '도장', '돋보기', '특약사항', '벽지 손상'],
    hashtags: ['#임대차계약', '#보증금', '#특약사항', '#원상복구', '#부동산팁', '#임차인', '#계약서'],
  },
  {
    id: 'demo-5',
    category: '임대인 갑질',
    title: '집주인이 이렇게 말하면 100% 갑질입니다',
    hook: '"내 집인데 내 마음대로 못해?" 이런 말 듣는 분 계신가요?',
    body: '임대인이 동의 없이 집에 들어오거나, 계약 만료 전 일방적으로 나가라고 하는 건 명백한 불법입니다. 주택임대차보호법 위반으로 신고 가능합니다. 카톡·문자 증거를 반드시 보관하세요.',
    cta: '비슷한 경험 있으면 댓글로 공유해주세요.',
    voiceover: '내 집인데 내 마음대로 못해? 이런 말 듣는 분 계신가요? 임대인이 동의 없이 집에 들어오거나, 계약 만료 전 일방적으로 나가라고 하는 건 명백한 불법입니다. 주택임대차보호법 위반으로 신고 가능합니다. 카톡 문자 증거를 반드시 보관하세요. 비슷한 경험 있으면 댓글로 공유해주세요.',
    b_roll_keywords: ['집주인 화난 표정', '임대차계약서', '문자메시지', '주택임대차보호법', '경찰서'],
    hashtags: ['#임대인갑질', '#주택임대차보호법', '#임차인권리', '#부동산', '#임대차', '#세입자', '#법률상식'],
  },
]

async function callGemini(apiKey: string): Promise<ShortScript[]> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${apiKey}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: PROMPT_TEMPLATE(CATEGORIES) }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
        temperature: 0.9,
      },
    }),
    cache: 'no-store',
  })
  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`Gemini API ${res.status}: ${errText.slice(0, 200)}`)
  }
  const json = await res.json()
  const text = json?.candidates?.[0]?.content?.parts?.[0]?.text
  if (!text) throw new Error('Gemini 응답에 텍스트가 없습니다')
  const parsed = JSON.parse(text)
  const scripts = parsed?.scripts
  if (!Array.isArray(scripts)) throw new Error('scripts 배열이 없습니다')
  return scripts.map((s: Omit<ShortScript, 'id'>, i: number) => ({ ...s, id: `${Date.now()}-${i}` }))
}

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  if (profile?.role !== 'admin') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const allowed = await checkRateLimit(`admin:${user.id}:shorts-generate`, 30, 3600)
  if (!allowed) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 })
  }

  const apiKey = (process.env.GEMINI_API_KEY ?? '').trim()
  if (!apiKey) {
    return NextResponse.json({
      scripts: DEMO_SCRIPTS,
      demo: true,
      message: 'GEMINI_API_KEY 미설정 — 데모 대본을 반환합니다. 실제 AI 생성을 원하시면 환경변수를 설정하세요.',
    })
  }

  try {
    const scripts = await callGemini(apiKey)
    return NextResponse.json({ scripts, demo: false })
  } catch (err) {
    console.error('[shorts/generate] error', err)
    return NextResponse.json({
      scripts: DEMO_SCRIPTS,
      demo: true,
      message: `AI 생성 실패 → 데모 대본 반환 (${err instanceof Error ? err.message : 'unknown'})`,
    }, { status: 200 })
  }
}
