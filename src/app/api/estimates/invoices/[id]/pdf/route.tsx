/**
 * 청구서 PDF.
 * 견적서 PDF 와 같은 규칙 — 접근 제어는 RLS 가 담당하고, 직인은 렌더 직전에
 * 짧은 서명 URL 을 만들어 넘긴다.
 */

import { NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import { createClient } from '@/lib/supabase/server'
import { InvoiceDocument } from '@/lib/estimate-pdf'
import type { EstimateCompany, EstimateInvoice } from '@/lib/estimate'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const STAMP_BUCKET = 'estimate-stamps'

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다' }, { status: 401 })

  const { data: invoice } = await supabase
    .from('estimate_invoices').select('*').eq('id', id).maybeSingle()
  if (!invoice) return NextResponse.json({ error: '청구서를 찾을 수 없습니다' }, { status: 404 })

  const company = (invoice.company_snapshot ?? null) as Partial<EstimateCompany> | null

  let stampUrl: string | null = null
  if (company?.stamp_path) {
    const { data } = await supabase.storage.from(STAMP_BUCKET).createSignedUrl(company.stamp_path, 120)
    stampUrl = data?.signedUrl ?? null
  }

  const buffer = await renderToBuffer(
    <InvoiceDocument invoice={invoice as EstimateInvoice} company={company} stampUrl={stampUrl} />
  )

  const inline = new URL(req.url).searchParams.get('inline') === '1'
  const client = (invoice.client_name || '거래처').replace(/[\\/:*?"<>|]/g, '')
  const name = `청구서_${invoice.invoice_no}_${client}.pdf`

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(name)}`,
      'Cache-Control': 'no-store',
    },
  })
}
