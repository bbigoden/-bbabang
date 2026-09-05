/**
 * 견적서·청구서 PDF 를 실제로 렌더해 본다.
 *
 * 화면으로는 한 장짜리 견적서만 봤는데, 실제로 찍어 보니 두 가지가 깨져 있었다.
 * 눈으로 보기 전에는 알 수 없는 것들이라 여기서 붙잡아 둔다.
 *  - 비고가 넉 자만 넘어도 글자가 세로로 한 줄에 하나씩 떨어졌다 (열이 좁아서)
 *  - 소재지가 두 줄이 되면 직인이 주소와 이메일을 덮었다 (도장을 글자 위에 얹어서)
 */
import { describe, it, expect } from 'vitest'
import { renderToBuffer } from '@react-pdf/renderer'
import { EstimateDocument, InvoiceDocument, W } from '@/lib/estimate-pdf'
import {
  calcTotals, invoiceAmounts,
  type Estimate, type EstimateInvoice, type EstimateItem,
} from '@/lib/estimate'

const company = {
  name: '가나다건설', biz_no: '123-45-67890', ceo: '홍길동',
  address: '충남 천안시 서북구 불당동 123-4 5층', phone: '041-000-0000',
  email: 'test@example.com', manager_name: '김담당', manager_phone: '010-0000-0000',
  bank_account: '농협 301-0000-0000-00 (예금주: 가나다건설)',
} as never

/** 도장 대신 쓰는 46x46 짜리 그림 한 장 (내용은 상관없다) */
const STAMP = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

/** PDF 안의 쪽수를 센다 */
function pageCount(buf: Buffer): number {
  return (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length
}

function makeItems(n: number, remark?: string): EstimateItem[] {
  return Array.from({ length: n }, (_, i) => ({
    sort_order: i, is_header: i % 10 === 0,
    category: '내장', name: `실크벽지 시공 및 부속 마감 작업 ${i}`,
    spec: '광폭 합지 / 초배 포함', unit: '평',
    qty: 12.5, unit_price: 13000, cost_price: 9000, amount: 162500,
    remark: remark ?? null,
  }) as EstimateItem)
}

function makeEstimate(items: EstimateItem[], extra: Partial<Estimate> = {}): Estimate {
  const totals = calcTotals(items, { overhead_rate: 0.1, vat_mode: 'add' })
  return {
    estimate_no: '2026-0905-01', issue_date: '2026-09-05', valid_days: 30,
    client_name: '주식회사 대한상사', project_name: '희망빌딩 3층 인테리어 공사',
    period: '2026-10-01 ~ 2026-10-31', vat_mode: 'add',
    company_snapshot: company, ...totals, ...extra,
  } as never as Estimate
}

describe('견적서 PDF', () => {
  it('품목이 없어도 한 장은 나온다', async () => {
    const buf = await renderToBuffer(
      <EstimateDocument estimate={makeEstimate([])} items={[]} company={company} stampUrl={null} />)
    expect(pageCount(buf)).toBe(1)
  }, 60000)

  it('품목이 많으면 여러 장으로 넘어간다', async () => {
    const items = makeItems(60)
    const buf = await renderToBuffer(
      <EstimateDocument estimate={makeEstimate(items)} items={items} company={company} stampUrl={null} />)
    expect(pageCount(buf)).toBeGreaterThan(1)
  }, 60000)

  it('비고 열이 한 글자씩 세로로 떨어질 만큼 좁지 않다', async () => {
    // 이건 렌더 결과로는 잡히지 않는다 — 비고를 길게 쓰면 표가 커지는 건 정상이라
    // 쪽수만 봐서는 "줄바꿈"과 "한 글자씩 세로로 떨어짐"을 가릴 수 없다.
    // 그래서 열 폭 자체를 지킨다. 비고는 7pt 로 그리고 좌우 여백이 4씩 있으니
    // 한 줄에 최소 여섯 자는 들어가야 세로로 늘어지지 않는다.
    const usable = W.remark - 8
    expect(usable / 7).toBeGreaterThanOrEqual(6)

    // 열 폭 합계는 A4 에서 좌우 여백을 뺀 531 을 넘으면 안 된다 (넘으면 표가 잘린다)
    const total = Object.values(W).reduce((a, b) => a + b, 0)
    expect(total).toBeLessThanOrEqual(531)
  })

  it('긴 비고가 있어도 렌더된다', async () => {
    const items = makeItems(30, '현장 여건에 따라 조정될 수 있으며 폐기물 처리비는 별도입니다')
    const buf = await renderToBuffer(
      <EstimateDocument estimate={makeEstimate(items)} items={items} company={company} stampUrl={null} />)
    expect(pageCount(buf)).toBeGreaterThan(0)
  }, 60000)

  it('소재지가 길고 직인이 있어도 렌더된다', async () => {
    const long = {
      ...(company as Record<string, unknown>),
      address: '충청남도 천안시 서북구 불당대로 123번길 45-67 스마트타워 제2동 지하1층 105호',
      email: 'very.long.email.address@some-company-domain.co.kr',
    } as never
    const items = makeItems(3)
    const buf = await renderToBuffer(
      <EstimateDocument estimate={makeEstimate(items)} items={items} company={long} stampUrl={STAMP} />)
    expect(pageCount(buf)).toBe(1)
  }, 60000)

  it('직인을 넘기면 실제로 문서에 들어간다', async () => {
    const items = makeItems(3)
    const est = makeEstimate(items)
    const [withStamp, without] = await Promise.all([
      renderToBuffer(<EstimateDocument estimate={est} items={items} company={company} stampUrl={STAMP} />),
      renderToBuffer(<EstimateDocument estimate={est} items={items} company={company} stampUrl={null} />),
    ])
    expect(withStamp.length).toBeGreaterThan(without.length)
  }, 60000)
})

describe('청구서 PDF', () => {
  it('계약금 30% 청구서가 나온다', async () => {
    const amt = invoiceAmounts(9652500, 0.3, 'add')
    expect(amt).toEqual({ supply_amount: 2895750, vat: 289575, total: 3185325 })
    const inv = {
      invoice_no: 'C2026-0905-01', issue_date: '2026-09-05', kind: 'deposit', ratio: 0.3,
      client_name: '주식회사 대한상사', project_name: '희망빌딩 3층 인테리어 공사',
      due_date: '2026-09-12', vat_mode: 'add', company_snapshot: company, ...amt,
    } as never as EstimateInvoice
    const buf = await renderToBuffer(<InvoiceDocument invoice={inv} company={company} stampUrl={STAMP} />)
    expect(pageCount(buf)).toBe(1)
  }, 60000)
})
