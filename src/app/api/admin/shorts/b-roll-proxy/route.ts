import type { NextRequest } from 'next/server'

export const runtime = 'edge'
export const dynamic = 'force-dynamic'

// 클라이언트(브라우저)에서 videos.pexels.com 직접 fetch 시 CORS 차단 가능 →
// 동일 origin 프록시로 우회. URL 화이트리스트로 임의 SSRF 차단.
const ALLOWED_HOST = 'videos.pexels.com'

export async function GET(req: NextRequest) {
  const target = new URL(req.url).searchParams.get('url')
  if (!target) {
    return new Response('missing url', { status: 400 })
  }
  let parsed: URL
  try {
    parsed = new URL(target)
  } catch {
    return new Response('invalid url', { status: 400 })
  }
  if (parsed.protocol !== 'https:' || parsed.hostname !== ALLOWED_HOST) {
    return new Response('forbidden host', { status: 403 })
  }

  // Range 헤더 전달 (큰 비디오 분할 다운로드 호환)
  const upstreamHeaders: HeadersInit = {}
  const range = req.headers.get('range')
  if (range) upstreamHeaders.Range = range

  const upstream = await fetch(parsed.toString(), { headers: upstreamHeaders, cache: 'no-store' })
  if (!upstream.ok && upstream.status !== 206) {
    return new Response(`upstream ${upstream.status}`, { status: 502 })
  }

  const headers = new Headers()
  const ct = upstream.headers.get('content-type')
  if (ct) headers.set('Content-Type', ct)
  const cl = upstream.headers.get('content-length')
  if (cl) headers.set('Content-Length', cl)
  const cr = upstream.headers.get('content-range')
  if (cr) headers.set('Content-Range', cr)
  const ar = upstream.headers.get('accept-ranges')
  if (ar) headers.set('Accept-Ranges', ar)
  headers.set('Cache-Control', 'public, max-age=3600')

  return new Response(upstream.body, { status: upstream.status, headers })
}
