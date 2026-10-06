/**
 * 견적서 엑셀 내보내기.
 * 거래처가 "엑셀로 달라"고 하는 경우가 흔하다. PDF와 같은 셈(normalizeItems·calcTotals)을 쓰고,
 * 원가(cost_price)는 내부용이므로 절대 넣지 않는다.
 */

import { NextResponse } from 'next/server'
import * as XLSX from 'xlsx'
import { createClient } from '@/lib/supabase/server'
import { calcTotals, docMeta, isSplitPricing, koreanAmount, normalizeItems, validUntil } from '@/lib/estimate'
import { loadEstimate, pdfFileName } from '../shared'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다' }, { status: 401 })

  const loaded = await loadEstimate(supabase, id)
  if (!loaded) return NextResponse.json({ error: '견적서를 찾을 수 없습니다' }, { status: 404 })

  const { estimate: given, company } = loaded
  const { items } = normalizeItems(loaded.items)
  const t = calcTotals(items, {
    overhead_rate: given.overhead_rate, discount: given.discount, vat_mode: given.vat_mode,
  })
  const rows = items.filter(it => it.is_header || it.name || it.amount)
  const split = isSplitPricing(rows)

  const aoa: (string | number)[][] = []
  const push = (...r: (string | number)[]) => aoa.push(r)

  const dm = docMeta(given.doc_type)
  push(dm.title)
  push()
  push(dm.label === '견적서' ? '견적번호' : '문서번호', given.estimate_no, '', '발행일', given.issue_date)
  push(dm.toLabel.replace(/ /g, ''), `${given.client_name || ''} ${dm.honorific}`)
  if (given.client_contact) push('담당자', given.client_contact)
  if (given.client_phone) push('연락처', given.client_phone)
  if (given.site_address) push('현장', given.site_address)
  if (given.project_name) push(dm.nameLabel, given.project_name)
  if (given.period) push(dm.periodLabel, given.period)
  push()
  push(dm.fromLabel.replace(/ /g, ''), company?.name ?? '')
  if (company?.biz_no) push('사업자등록번호', company.biz_no)
  if (company?.ceo) push('대표자', company.ceo)
  if (company?.address) push('소재지', company.address)
  if (company?.phone) push('연락처', company.phone)
  if (company?.email) push('이메일', company.email)
  push()
  push(dm.totalLabel, koreanAmount(t.total), '', '', t.total)
  push()

  const head = split
    ? ['No', '구분', '품명', '규격', '단위', '수량', '재료비 단가', '인건비 단가', '단가', '금액', '비고']
    : ['No', '구분', '품명', '규격', '단위', '수량', '단가', '금액', '비고']
  push(...head)

  let no = 0
  for (const it of rows) {
    if (it.is_header) { push('', it.name ?? ''); continue }
    no++
    push(...(split
      ? [no, it.category ?? '', it.name ?? '', it.spec ?? '', it.unit ?? '', it.qty,
         it.material_price || '', it.labor_price || '', it.unit_price, it.amount, it.remark ?? '']
      : [no, it.category ?? '', it.name ?? '', it.spec ?? '', it.unit ?? '', it.qty,
         it.unit_price, it.amount, it.remark ?? '']))
  }

  const amountCol = split ? 9 : 7
  const sumRow = (label: string, v: number) => {
    const r: (string | number)[] = new Array(amountCol + 1).fill('')
    r[amountCol - 1] = label
    r[amountCol] = v
    aoa.push(r)
  }
  push()
  sumRow('소계', t.subtotal)
  if (t.overhead_amount) sumRow(`경비 (${(given.overhead_rate * 100).toFixed(1)}%)`, t.overhead_amount)
  if (given.discount > 0) sumRow('할인', -given.discount)
  sumRow('공급가액', t.supply_amount)
  sumRow('부가세', t.vat)
  sumRow('합계', t.total)

  push()
  if (dm.hasValidity) push('유효기간', `${given.issue_date} ~ ${validUntil(given.issue_date, given.valid_days)}`)
  if (given.payment_terms) push('결제조건', given.payment_terms)
  if (company?.bank_account) push('입금계좌', company.bank_account)
  if (given.notes) push('특기사항', given.notes)

  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = split
    ? [{ wch: 5 }, { wch: 10 }, { wch: 28 }, { wch: 14 }, { wch: 6 }, { wch: 8 }, { wch: 13 }, { wch: 13 }, { wch: 13 }, { wch: 15 }, { wch: 18 }]
    : [{ wch: 5 }, { wch: 10 }, { wch: 28 }, { wch: 14 }, { wch: 6 }, { wch: 8 }, { wch: 13 }, { wch: 15 }, { wch: 18 }]

  // 금액 칸은 천 단위 쉼표로 보이게 한다
  for (const addr of Object.keys(ws)) {
    if (addr.startsWith('!')) continue
    const cell = ws[addr]
    if (typeof cell.v === 'number') cell.z = '#,##0'
  }

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '견적서')
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer

  const name = pdfFileName(given).replace(/\.pdf$/, '.xlsx')
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
      'Cache-Control': 'no-store',
    },
  })
}
