import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createSrvClient } from '@supabase/supabase-js'
import { checkRateLimit } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Vercel Hobby 함수 최대 60초. 30초 영상은 보통 그 안에 완성됨.
export const maxDuration = 60

// b-roll/route.ts와 동일한 매핑 (재사용 위해 lib으로 빼는 게 좋지만 일단 인라인)
const KO_TO_EN: Record<string, string> = {
  '아파트': 'apartment building', '아파트 외관': 'apartment building exterior',
  '원룸': 'small apartment room', '원룸 복도': 'apartment corridor',
  '복도': 'apartment corridor', '좁은 복도': 'narrow corridor',
  '계약서': 'contract paper', '임대차계약서': 'rental contract',
  '도장': 'stamp seal document', '등기부등본': 'real estate document',
  '벽지': 'wallpaper home', '벽지 손상': 'damaged wall',
  '비상계단': 'emergency stairs', '비상구': 'emergency exit sign',
  '소화기': 'fire extinguisher', '완강기': 'fire escape',
  '화재 연기': 'smoke fire', '검은 연기': 'black smoke',
  '열쇠': 'house keys', '빈 지갑': 'empty wallet',
  '잠긴 문': 'locked door', '경찰서': 'police station',
  '법전': 'law book', '주택임대차보호법': 'law book document',
  '휴대폰 문자': 'phone message', '문자메시지': 'phone text message',
  '형광펜': 'yellow highlighter', '빨간 형광펜': 'red highlighter',
  '경고등': 'red warning light', '빨간 경고등': 'red alert light',
  '음파 그래프': 'sound wave graphic', '잠 못 자는 사람': 'insomnia person bed',
  '시끄러운 발소리': 'footsteps floor', '시끄러운 소음 파형': 'sound wave',
  '소음측정기': 'measurement device', '소음측정 장비': 'measurement device',
  '전화기': 'telephone call', '이웃분쟁': 'argument people',
  '집주인 화난 표정': 'angry person face', '특약사항': 'contract paper detail',
  '돋보기': 'magnifying glass paper', '아파트 천장': 'apartment ceiling',
  '도시 야경': 'city night', '서울 아파트': 'seoul apartment',
}
const FALLBACK_QUERIES = ['city building korea', 'apartment seoul', 'real estate', 'modern apartment']

interface PexelsVideoFile {
  link: string; file_type: string; width: number; height: number; quality: string
}
interface PexelsVideo {
  id: number; width: number; height: number; duration: number; image: string;
  video_files: PexelsVideoFile[]
}

async function searchPexels(apiKey: string, query: string, perPage = 1): Promise<PexelsVideo[]> {
  const url = `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&per_page=${perPage}&orientation=portrait&size=medium`
  const res = await fetch(url, { headers: { Authorization: apiKey }, cache: 'no-store' })
  if (!res.ok) return []
  const data = await res.json().catch(() => ({})) as { videos?: PexelsVideo[] }
  return data.videos ?? []
}

function pickBestFile(files: PexelsVideoFile[]): PexelsVideoFile | null {
  const mp4 = files.filter(f => f.file_type === 'video/mp4')
  if (mp4.length === 0) return null
  const portrait = mp4.filter(f => f.height > f.width)
  const pool = portrait.length > 0 ? portrait : mp4
  const reasonable = pool.filter(f => f.width <= 1280)
  const candidates = reasonable.length > 0 ? reasonable : pool
  return candidates.sort((a, b) => {
    const aS = a.height >= 720 ? 1 : 0
    const bS = b.height >= 720 ? 1 : 0
    if (aS !== bS) return bS - aS
    return a.width - b.width
  })[0]
}

interface CreatomateRender {
  id: string
  status: 'planned' | 'waiting' | 'transcribing' | 'rendering' | 'succeeded' | 'failed'
  url?: string
  snapshot_url?: string
  error_message?: string
}

async function callCreatomate(apiKey: string, source: Record<string, unknown>): Promise<CreatomateRender[]> {
  const res = await fetch('https://api.creatomate.com/v1/renders', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ source }),
    cache: 'no-store',
  })
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(`Creatomate ${res.status}: ${t.slice(0, 300)}`)
  }
  return await res.json() as CreatomateRender[]
}

async function checkRender(apiKey: string, id: string): Promise<CreatomateRender> {
  const res = await fetch(`https://api.creatomate.com/v1/renders/${id}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`Creatomate status ${res.status}`)
  return await res.json() as CreatomateRender
}

// ── POST: 영상 합성 시작 (가능하면 완성까지 대기) ──────────────────
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin') return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const ok = await checkRateLimit(`admin:${user.id}:shorts-render`, 20, 3600, true)
  if (!ok) return NextResponse.json({ error: 'rate_limited' }, { status: 429 })

  const apiKey = (process.env.CREATOMATE_API_KEY ?? '').trim()
  const pexelsKey = (process.env.PEXELS_API_KEY ?? '').trim()
  if (!apiKey) return NextResponse.json({ error: 'no_creatomate_key' }, { status: 503 })
  if (!pexelsKey) return NextResponse.json({ error: 'no_pexels_key' }, { status: 503 })

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
  }
  const audioFile = form.get('audio')
  const voiceoverText = String(form.get('voiceoverText') ?? '').trim()
  const bRollKeywordsJson = String(form.get('bRollKeywords') ?? '[]')
  const audioDurationStr = String(form.get('audioDuration') ?? '30')
  const audioDuration = Math.max(5, Math.min(90, Number(audioDurationStr) || 30))

  if (!(audioFile instanceof File) || !voiceoverText) {
    return NextResponse.json({ error: 'missing_fields' }, { status: 400 })
  }
  let bRollKeywords: string[]
  try {
    const parsed = JSON.parse(bRollKeywordsJson)
    if (!Array.isArray(parsed)) throw new Error()
    bRollKeywords = parsed.filter(k => typeof k === 'string')
  } catch {
    return NextResponse.json({ error: 'invalid_keywords' }, { status: 400 })
  }

  // 1) Supabase Storage 업로드 (Creatomate가 fetch할 public URL 필요)
  const srvUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const srvKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  if (!srvUrl || !srvKey) return NextResponse.json({ error: 'storage_misconfig' }, { status: 500 })
  const srv = createSrvClient(srvUrl, srvKey)

  const filename = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp3`
  const audioBuf = new Uint8Array(await audioFile.arrayBuffer())
  const { error: upErr } = await srv.storage.from('shorts-temp').upload(filename, audioBuf, {
    contentType: 'audio/mpeg',
    cacheControl: '3600',
    upsert: false,
  })
  if (upErr) {
    console.error('[render] storage upload', upErr)
    return NextResponse.json({ error: 'storage_upload_failed', message: upErr.message }, { status: 500 })
  }
  const { data: { publicUrl: audioUrl } } = srv.storage.from('shorts-temp').getPublicUrl(filename)

  // 2) Pexels 자료화면 검색 (키워드별 1개씩, 최대 6개)
  const clipUrls: string[] = []
  for (const kw of bRollKeywords.slice(0, 6)) {
    const en = KO_TO_EN[kw.trim()] ?? KO_TO_EN[kw.trim().toLowerCase()] ?? kw.trim()
    const videos = await searchPexels(pexelsKey, en, 1)
    for (const v of videos) {
      const file = pickBestFile(v.video_files)
      if (file) clipUrls.push(file.link)
    }
  }
  if (clipUrls.length < 2) {
    for (const fb of FALLBACK_QUERIES) {
      const videos = await searchPexels(pexelsKey, fb, 2)
      for (const v of videos) {
        const file = pickBestFile(v.video_files)
        if (file) clipUrls.push(file.link)
      }
      if (clipUrls.length >= 3) break
    }
  }
  if (clipUrls.length === 0) {
    return NextResponse.json({ error: 'no_broll' }, { status: 502 })
  }

  // 3) Creatomate source 구성 (9:16 1080x1920)
  const numClips = Math.min(clipUrls.length, 5)
  const clipDuration = audioDuration / numClips
  const elements: Record<string, unknown>[] = []
  let t = 0
  for (let i = 0; i < numClips; i++) {
    elements.push({
      type: 'video',
      source: clipUrls[i],
      track: 1,
      time: t,
      duration: clipDuration,
      fit: 'cover',
      audio: false,
    })
    t += clipDuration
  }
  elements.push({
    type: 'audio',
    source: audioUrl,
    track: 2,
    time: 0,
  })
  elements.push({
    type: 'text',
    track: 3,
    time: 0,
    duration: audioDuration,
    text: voiceoverText,
    y: '80%',
    x: '50%',
    width: '90%',
    x_alignment: '50%',
    y_alignment: '50%',
    font_family: 'Noto Sans KR',
    font_weight: '700',
    font_size: '4.5 vh',
    color: '#ffffff',
    background_color: 'rgba(0,0,0,0.65)',
    background_x_padding: '20%',
    background_y_padding: '40%',
    background_border_radius: '10%',
    line_height: '125%',
  })
  const source = {
    output_format: 'mp4',
    width: 1080,
    height: 1920,
    frame_rate: 30,
    duration: audioDuration,
    elements,
  }

  // 4) Creatomate API 호출
  let renders: CreatomateRender[]
  try {
    renders = await callCreatomate(apiKey, source)
  } catch (e) {
    console.error('[render] creatomate', e)
    return NextResponse.json({
      error: 'creatomate_failed',
      message: e instanceof Error ? e.message : 'unknown',
    }, { status: 502 })
  }
  const r = renders[0]
  if (!r) return NextResponse.json({ error: 'no_render' }, { status: 502 })

  // 5) Polling — 함수 timeout 직전까지 (max ~45초)
  let final = r
  const start = Date.now()
  while (final.status !== 'succeeded' && final.status !== 'failed') {
    if (Date.now() - start > 45000) break
    await new Promise(res => setTimeout(res, 3000))
    try {
      final = await checkRender(apiKey, final.id)
    } catch {
      break
    }
  }

  if (final.status === 'succeeded' && final.url) {
    return NextResponse.json({
      status: 'succeeded',
      url: final.url,
      renderId: final.id,
      audioUrl,
    })
  }
  if (final.status === 'failed') {
    return NextResponse.json({
      status: 'failed',
      renderId: final.id,
      error: 'render_failed',
      message: final.error_message ?? 'Creatomate render 실패',
    }, { status: 502 })
  }
  // 아직 처리 중 — 클라이언트에서 GET polling
  return NextResponse.json({
    status: final.status,
    renderId: final.id,
    audioUrl,
  }, { status: 202 })
}

// ── GET ?id=...: render 상태 polling용 ──────────────────
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin') return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'missing_id' }, { status: 400 })

  const apiKey = (process.env.CREATOMATE_API_KEY ?? '').trim()
  if (!apiKey) return NextResponse.json({ error: 'no_creatomate_key' }, { status: 503 })

  try {
    const r = await checkRender(apiKey, id)
    return NextResponse.json(r)
  } catch (e) {
    return NextResponse.json({
      error: 'check_failed',
      message: e instanceof Error ? e.message : 'unknown',
    }, { status: 502 })
  }
}
