/**
 * 견적서 PDF 생성.
 * - ?inline=1 : 작성 화면 iframe 미리보기용 (브라우저 내장 뷰어로 표시)
 * - 기본       : 다운로드
 *
 * 접근 제어는 RLS가 담당한다. 남의 견적서 id로 요청하면 조회 자체가 비어 404가 된다.
 */

import { NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import { createClient } from '@/lib/supabase/server'
import { EstimateDocument } from '@/lib/estimate-pdf'
import { loadEstimate, pdfFileName } from '../shared'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다' }, { status: 401 })

  const loaded = await loadEstimate(supabase, id)
  if (!loaded) return NextResponse.json({ error: '견적서를 찾을 수 없습니다' }, { status: 404 })

  const { estimate, items, company } = loaded
  const buffer = await renderToBuffer(
    <EstimateDocument estimate={estimate} items={items} company={company} />
  )

  const inline = new URL(req.url).searchParams.get('inline') === '1'
  const name = pdfFileName(estimate)

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      // 한글 파일명은 filename* (RFC 5987) 로만 안전하게 전달된다
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(name)}`,
      'Cache-Control': 'no-store',
    },
  })
}
