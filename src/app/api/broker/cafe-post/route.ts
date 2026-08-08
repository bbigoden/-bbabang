import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase/server'
import { checkRateLimit } from '@/lib/rate-limit'
import { CAFE_POST_SYSTEM_PROMPT } from '@/lib/cafe-post-prompt'

/**
 * 부동산뱅크·네이버부동산 매물 원문 → 네이버 카페 게시용 글 변환.
 *
 * POST { source: "매물 원문 텍스트", listingNo?: "10자리 매물번호" }
 *  → text/plain 스트리밍 응답 (변환된 카페글 마크다운)
 *
 * 인증된 중개사(broker_profiles 보유)만 호출 가능.
 * env: ANTHROPIC_API_KEY
 */

// Claude 응답 생성이 수 분까지 걸릴 수 있어 함수 실행 시간 연장
export const maxDuration = 300

const MAX_SOURCE_LENGTH = 20000

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'config_missing_anthropic_key' }, { status: 500 })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { data: broker } = await supabase
    .from('broker_profiles')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!broker) return NextResponse.json({ error: 'not_broker' }, { status: 403 })

  // Rate limit: 사용자당 시간당 30회 (API 비용 보호)
  const allowed = await checkRateLimit(`user:${user.id}:cafe-post`, 30, 3600)
  if (!allowed) return NextResponse.json({ error: 'rate_limited' }, { status: 429 })

  let body: { source?: string; listingNo?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid_request' }, { status: 400 }) }

  const source = (body.source ?? '').trim()
  if (!source) return NextResponse.json({ error: 'empty_source' }, { status: 400 })
  if (source.length > MAX_SOURCE_LENGTH) {
    return NextResponse.json({ error: 'source_too_long', max: MAX_SOURCE_LENGTH }, { status: 400 })
  }

  const listingNo = (body.listingNo ?? '').replace(/[^0-9]/g, '')

  const userContent = listingNo
    ? `매물번호: ${listingNo}\n\n[매물 원문]\n${source}`
    : `매물번호: 없음 (XXXXXXXXXX로 표기)\n\n[매물 원문]\n${source}`

  const client = new Anthropic({ apiKey })

  const stream = client.messages.stream({
    model: 'claude-opus-5',
    max_tokens: 16000,
    // 시스템 프롬프트는 고정이므로 프롬프트 캐싱으로 반복 호출 비용 절감
    system: [{ type: 'text', text: CAFE_POST_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: userContent }],
  })

  const encoder = new TextEncoder()
  const readable = new ReadableStream<Uint8Array>({
    start(controller) {
      stream.on('text', (delta) => controller.enqueue(encoder.encode(delta)))
      stream.on('error', (err) => {
        console.error('[cafe-post] stream error', err)
        try { controller.error(err) } catch { /* already closed */ }
      })
      stream.on('end', () => {
        try { controller.close() } catch { /* already closed */ }
      })
    },
    cancel() {
      stream.abort()
    },
  })

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}
