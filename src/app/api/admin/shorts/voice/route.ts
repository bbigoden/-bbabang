import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkRateLimit } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ElevenLabs 기본 다국어 보이스 — 한국어 발화 가능
// Adam: 남성, 깊고 진지 (사건·사고 다큐 톤에 적합)
const DEFAULT_VOICE_ID = 'pNInz6obpgDQGcFmaJgB'
const ELEVENLABS_MODEL = 'eleven_multilingual_v2'

interface VoiceBody {
  text?: string
  voiceId?: string
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

  // strict=true → DB 오류 시 차단. 외부 유료 API(ElevenLabs) 호출이라 안전 우선.
  const allowed = await checkRateLimit(`admin:${user.id}:shorts-voice`, 20, 3600, true)
  if (!allowed) {
    return NextResponse.json({ error: 'rate_limited', message: '시간당 20회 호출 제한' }, { status: 429 })
  }

  const apiKey = (process.env.ELEVENLABS_API_KEY ?? '').trim()
  if (!apiKey) {
    return NextResponse.json({
      error: 'no_api_key',
      message: 'ELEVENLABS_API_KEY 미설정. Vercel 환경변수에 키를 추가하세요.',
      guide: 'https://elevenlabs.io/app/settings/api-keys',
    }, { status: 503 })
  }

  let body: VoiceBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
  }

  const text = (body.text ?? '').trim()
  if (!text) {
    return NextResponse.json({ error: 'missing_fields' }, { status: 400 })
  }
  if (text.length > 1000) {
    return NextResponse.json({ error: 'text_too_long', max: 1000 }, { status: 400 })
  }

  const voiceId = body.voiceId?.trim() || (process.env.ELEVENLABS_VOICE_ID?.trim() ?? DEFAULT_VOICE_ID)

  try {
    const elRes = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id: ELEVENLABS_MODEL,
        voice_settings: {
          stability: 0.45,
          similarity_boost: 0.75,
          style: 0.35,
          use_speaker_boost: true,
        },
      }),
      cache: 'no-store',
    })

    if (!elRes.ok) {
      const errText = await elRes.text().catch(() => '')
      console.error('[shorts/voice] ElevenLabs error', elRes.status, errText.slice(0, 300))
      const userMsg = elRes.status === 401
        ? 'ElevenLabs API 키가 잘못되었습니다'
        : elRes.status === 429
          ? 'ElevenLabs 무료 한도 초과 또는 호출 제한'
          : `ElevenLabs 오류 (${elRes.status})`
      return NextResponse.json({ error: 'elevenlabs_failed', message: userMsg }, { status: 502 })
    }

    const audioBuffer = await elRes.arrayBuffer()
    return new NextResponse(audioBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Length': String(audioBuffer.byteLength),
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    console.error('[shorts/voice] unexpected', err)
    return NextResponse.json({ error: 'unexpected', message: err instanceof Error ? err.message : 'unknown' }, { status: 500 })
  }
}
