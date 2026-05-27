import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkRateLimit } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// 한국어 부동산 키워드 → Pexels(영어) 검색어 매핑.
// 매핑 없으면 fallback 키워드로 검색.
const KO_TO_EN: Record<string, string> = {
  '아파트': 'apartment building',
  '아파트 외관': 'apartment building exterior',
  '원룸': 'small apartment room',
  '원룸 복도': 'apartment corridor',
  '복도': 'apartment corridor',
  '좁은 복도': 'narrow corridor',
  '계약서': 'contract paper',
  '임대차계약서': 'rental contract',
  '도장': 'stamp seal document',
  '등기부등본': 'real estate document',
  '벽지': 'wallpaper home',
  '벽지 손상': 'damaged wall',
  '비상계단': 'emergency stairs',
  '비상구': 'emergency exit sign',
  '소화기': 'fire extinguisher',
  '완강기': 'fire escape',
  '화재 연기': 'smoke fire',
  '검은 연기': 'black smoke',
  '열쇠': 'house keys',
  '빈 지갑': 'empty wallet',
  '잠긴 문': 'locked door',
  '경찰서': 'police station',
  '법전': 'law book',
  '주택임대차보호법': 'law book document',
  '휴대폰 문자': 'phone message',
  '문자메시지': 'phone text message',
  '형광펜': 'yellow highlighter',
  '빨간 형광펜': 'red highlighter',
  '경고등': 'red warning light',
  '빨간 경고등': 'red alert light',
  '음파 그래프': 'sound wave graphic',
  '잠 못 자는 사람': 'insomnia person bed',
  '시끄러운 발소리': 'footsteps floor',
  '시끄러운 소음 파형': 'sound wave',
  '소음측정기': 'measurement device',
  '소음측정 장비': 'measurement device',
  '전화기': 'telephone call',
  '이웃분쟁': 'argument people',
  '집주인 화난 표정': 'angry person face',
  '특약사항': 'contract paper detail',
  '돋보기': 'magnifying glass paper',
  '아파트 천장': 'apartment ceiling',
  '도시 야경': 'city night',
  '서울 아파트': 'seoul apartment',
}

const FALLBACK_QUERIES = ['city building korea', 'apartment seoul', 'real estate', 'modern apartment']

interface PexelsVideoFile {
  link: string
  file_type: string
  width: number
  height: number
  quality: string
}
interface PexelsVideo {
  id: number
  width: number
  height: number
  duration: number
  image: string
  video_files: PexelsVideoFile[]
}
interface PexelsSearchResponse {
  videos?: PexelsVideo[]
}

interface BRollResult {
  keyword: string
  englishQuery: string
  clips: Array<{
    id: number
    duration: number
    poster: string
    downloadUrl: string
    width: number
    height: number
  }>
}

async function searchPexels(apiKey: string, query: string, perPage = 2): Promise<PexelsVideo[]> {
  const url = `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&per_page=${perPage}&orientation=portrait&size=medium`
  const res = await fetch(url, {
    headers: { Authorization: apiKey },
    cache: 'no-store',
  })
  if (!res.ok) {
    console.error('[b-roll] pexels search failed', res.status, query)
    return []
  }
  const data = (await res.json().catch(() => ({}))) as PexelsSearchResponse
  return data.videos ?? []
}

function pickBestFile(files: PexelsVideoFile[]): PexelsVideoFile | null {
  // 세로(portrait) + HD 우선, 없으면 SD 첫 번째
  const mp4 = files.filter(f => f.file_type === 'video/mp4')
  if (mp4.length === 0) return null
  // 세로 비율 우선
  const portrait = mp4.filter(f => f.height > f.width)
  const pool = portrait.length > 0 ? portrait : mp4
  // 너무 큰 4K 제외 (다운로드 시간/메모리)
  const reasonable = pool.filter(f => f.width <= 1280)
  const candidates = reasonable.length > 0 ? reasonable : pool
  // HD(720p ~ 1080p) 우선
  return candidates.sort((a, b) => {
    const aScore = a.height >= 720 ? 1 : 0
    const bScore = b.height >= 720 ? 1 : 0
    if (aScore !== bScore) return bScore - aScore
    return a.width - b.width
  })[0]
}

export async function POST(req: NextRequest) {
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

  const allowed = await checkRateLimit(`admin:${user.id}:shorts-broll`, 60, 3600)
  if (!allowed) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 })
  }

  const apiKey = (process.env.PEXELS_API_KEY ?? '').trim()
  if (!apiKey) {
    return NextResponse.json({
      error: 'no_api_key',
      message: 'PEXELS_API_KEY 미설정. https://www.pexels.com/api/ 에서 발급 후 Vercel 환경변수에 추가하세요.',
    }, { status: 503 })
  }

  let body: { keywords?: string[] }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  }

  const keywords = (body.keywords ?? []).filter(k => typeof k === 'string' && k.trim()).slice(0, 8)
  if (keywords.length === 0) {
    return NextResponse.json({ error: 'keywords 필요' }, { status: 400 })
  }

  const results: BRollResult[] = []
  for (const kw of keywords) {
    const en = KO_TO_EN[kw.trim()] ?? KO_TO_EN[kw.trim().toLowerCase()] ?? kw.trim()
    let videos = await searchPexels(apiKey, en, 2)
    // 결과 없으면 fallback
    if (videos.length === 0) {
      for (const fb of FALLBACK_QUERIES) {
        videos = await searchPexels(apiKey, fb, 1)
        if (videos.length > 0) break
      }
    }
    const clips = videos
      .map(v => {
        const file = pickBestFile(v.video_files)
        if (!file) return null
        return {
          id: v.id,
          duration: v.duration,
          poster: v.image,
          downloadUrl: file.link,
          width: file.width,
          height: file.height,
        }
      })
      .filter((c): c is NonNullable<typeof c> => c !== null)
    results.push({ keyword: kw, englishQuery: en, clips })
  }

  return NextResponse.json({ results })
}
