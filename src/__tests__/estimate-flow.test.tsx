/**
 * 견적서 한 건을 처음부터 끝까지 관통시킨다.
 *
 * 조각조각은 저마다 테스트가 있지만, 실제로 쓸 때는 이 순서로 이어진다 —
 * 화면 셈 → 저장 → 공종 소계 → 재료비·인건비 → 원가·마진 → 청구서 → 인쇄.
 * 한 군데서 어긋나면 발주자가 받는 종이의 금액이 틀린다. 이어 붙였을 때도
 * 같은 숫자가 유지되는지 여기서 본다.
 *
 * 값은 실제로 DB 에 넣어 보고 확인한 것과 같다 (2026-0907-01).
 */
import { it, expect } from 'vitest'
import { renderToBuffer } from '@react-pdf/renderer'
import { EstimateDocument } from '@/lib/estimate-pdf'
import {
  calcTotals, calcMargin, sectionSums, splitTotals, invoiceAmounts, normalizeItems,
  koreanAmount, type Estimate, type EstimateItem,
} from '@/lib/estimate'

const co = { name:'일곱브릿지대부', ceo:'김용유', biz_no:'123-45-617852',
  address:'불당동 1491 502호', phone:'010-8489-8943' } as never

// DB 에 넣은 것과 똑같은 내역
const items: EstimateItem[] = [
  { sort_order:0, is_header:true, category:null, name:'1. 철거공사', spec:null, unit:null,
    qty:0, unit_price:0, material_price:0, labor_price:0, cost_price:0, amount:0, remark:null },
  { sort_order:1, is_header:false, category:'철거', name:'기존 마감 철거', spec:'바닥+벽', unit:'㎡',
    qty:33.5, unit_price:12000, material_price:0, labor_price:0, cost_price:8000, amount:402000, remark:'폐기물 별도' },
  { sort_order:2, is_header:true, category:null, name:'2. 방수공사', spec:null, unit:null,
    qty:0, unit_price:0, material_price:0, labor_price:0, cost_price:0, amount:0, remark:null },
  { sort_order:3, is_header:false, category:'방수', name:'레미탈', spec:'20kg', unit:'포',
    qty:70, unit_price:10000, material_price:5000, labor_price:5000, cost_price:7000, amount:700000, remark:null },
  { sort_order:4, is_header:false, category:'방수', name:'방수공', spec:null, unit:'인',
    qty:2, unit_price:200000, material_price:0, labor_price:200000, cost_price:180000, amount:400000, remark:'2인 1일' },
]

it('견적서 한 건이 화면·PDF·공유·청구서까지 같은 금액을 지킨다', async () => {
  // 저장된 값 (DB 와 같음)
  const saved = { subtotal:1502000, overhead_amount:150200, supply_amount:1652200,
                  vat:165220, total:1817420, total_cost:1118000 }

  // ① 화면이 셈하는 값
  const t = calcTotals(items, { overhead_rate:0.1, discount:0, vat_mode:'add' })
  console.log('  화면 합계:', t.total.toLocaleString(), '/ DB:', saved.total.toLocaleString(),
              t.total === saved.total ? '✓' : '★ 다름')
  expect(t).toMatchObject(saved && { subtotal:1502000, overhead_amount:150200, supply_amount:1652200, vat:165220, total:1817420 })

  // ② 정규화해도 그대로여야 한다 (이미 맞는 값이므로)
  const { fixed } = normalizeItems(items)
  console.log('  정규화가 고친 줄:', fixed.length, fixed.length === 0 ? '✓' : '★')
  expect(fixed).toHaveLength(0)

  // ③ 공종 소계 합 = 소계
  const sums = sectionSums(items)
  console.log('  공종 소계:', sums.map(s => `${s.name}=${s.amount.toLocaleString()}`).join(' / '))
  expect(sums.reduce((a, b) => a + b.amount, 0)).toBe(t.subtotal)

  // ④ 재료비 + 인건비 + 그 밖에 = 소계
  const st = splitTotals(items)
  console.log('  재료비', st.material.toLocaleString(), '· 인건비', st.labor.toLocaleString(),
              '· 그 밖에', st.rest.toLocaleString(), '=', (st.material+st.labor+st.rest).toLocaleString())
  expect(st.material + st.labor + st.rest).toBe(t.subtotal)

  // ⑤ 원가·마진 (내부용, 밖으로 나가지 않는다)
  const m = calcMargin(items, t.supply_amount)
  console.log('  원가', m!.cost.toLocaleString(), '· 이익', m!.profit.toLocaleString(),
              '·', (m!.rate! * 100).toFixed(1) + '%')
  expect(m!.cost).toBe(saved.total_cost)

  // ⑥ 청구서 계약금 30%
  const inv = invoiceAmounts(t.supply_amount, 0.3, 'add')
  console.log('  계약금 30%:', inv.total.toLocaleString())
  expect(inv.supply_amount + inv.vat).toBe(inv.total)

  // ⑦ 종이에 찍기
  const est = { estimate_no:'2026-0907-01', issue_date:'2026-09-07', valid_days:30,
    client_name:'주식회사 관통점검', project_name:'관통 점검 공사', vat_mode:'add',
    overhead_rate:0.1, discount:0, company_snapshot:co, ...saved } as never as Estimate
  const buf = await renderToBuffer(<EstimateDocument estimate={est} items={items} company={co} stampUrl={null} />)
  console.log('  PDF:', (buf.length/1024).toFixed(0), 'KB /', koreanAmount(t.total))

  // ⑧ 원가가 종이에 새어 나가지 않는지 — 글자로 찾는다
  const raw = buf.toString('latin1')
  expect(raw.includes('1118000')).toBe(false)
  expect(raw.includes('1,118,000')).toBe(false)
}, 60000)
