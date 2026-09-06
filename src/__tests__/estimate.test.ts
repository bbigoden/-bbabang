/**
 * 견적서 계산·금액 한글표기·PDF 렌더 회귀 테스트.
 *
 * PDF는 서버에서 한글 TTF를 파일로 읽어 렌더하므로, 폰트 경로가 깨지거나
 * react-pdf 업그레이드로 레이아웃 API가 바뀌면 여기서 먼저 잡힌다.
 */

import { describe, it, expect } from 'vitest'
import {
  calcTotals, koreanAmount, numberToKorean, lineAmount, validUntil,
  fillTemplate, isExpired, calcStats, sectionSums,
  isSplitPricing, effectiveUnitPrice, splitTotals, DEFAULT_PRESETS,
  type EstimateItem, type EstimateStatus,
} from '@/lib/estimate'

const item = (amount: number, is_header = false): EstimateItem => ({
  sort_order: 0, is_header, category: null, name: null, spec: null,
  unit: null, qty: 0, unit_price: 0, amount, remark: null,
})

describe('견적 금액 계산', () => {
  it('공종 구분줄은 소계에서 빠진다', () => {
    const t = calcTotals([item(1000), item(0, true), item(2000)], {})
    expect(t.subtotal).toBe(3000)
  })

  it('경비 → 할인 → 부가세 순으로 계산한다', () => {
    const t = calcTotals([item(1_000_000)], { overhead_rate: 0.05, discount: 50_000, vat_mode: 'add' })
    expect(t.overhead_amount).toBe(50_000)   // 100만 × 5%
    expect(t.supply_amount).toBe(1_000_000)  // 100만 + 5만 - 5만
    expect(t.vat).toBe(100_000)
    expect(t.total).toBe(1_100_000)
  })

  it('부가세 없음이면 공급가액이 곧 합계다', () => {
    const t = calcTotals([item(500_000)], { vat_mode: 'none' })
    expect(t.vat).toBe(0)
    expect(t.total).toBe(500_000)
  })

  it('줄 금액은 수량 × 단가를 반올림한다', () => {
    expect(lineAmount(3.5, 65_000)).toBe(227_500)
    expect(lineAmount(0.5, 1_001)).toBe(501)  // 500.5 → 501
  })
})

describe('금액 한글 표기', () => {
  it.each([
    [0, '영'],
    [10, '일십'],
    [15, '일십오'],
    [100, '일백'],
    [1_000, '일천'],
    [10_000, '일만'],
    [55_000_000, '오천오백만'],
    [123_456_789, '일억이천삼백사십오만육천칠백팔십구'],
    [1_100_000, '일백일십만'],
  ])('%i → %s', (n, expected) => {
    expect(numberToKorean(n)).toBe(expected)
  })

  it('견적서 표기 형식으로 감싼다', () => {
    expect(koreanAmount(55_000_000)).toBe('일금 오천오백만원정')
  })
})

describe('유효기간·템플릿', () => {
  it('발행일 + 유효일수로 만료일을 낸다', () => {
    expect(validUntil('2026-09-04', 30)).toBe('2026-10-04')
  })

  it('본문 변수를 치환하고, 값이 없는 변수는 그대로 둔다', () => {
    expect(fillTemplate('{거래처명} {없는값}', { 거래처명: '○○상사' })).toBe('○○상사 {없는값}')
  })
})

describe('유효기간 만료 판정', () => {
  const today = new Date('2026-10-10T09:00:00+09:00')
  const base = { issue_date: '2026-09-04', valid_days: 30 }  // 만료일 2026-10-04

  it('만료일이 지나면 만료다', () => {
    expect(isExpired({ ...base, status: 'sent' }, today)).toBe(true)
  })

  it('만료일 당일은 아직 유효하다', () => {
    expect(isExpired({ ...base, status: 'sent' }, new Date('2026-10-04T23:00:00+09:00'))).toBe(false)
  })

  it('수주·실주로 결론난 건은 만료를 따지지 않는다', () => {
    expect(isExpired({ ...base, status: 'won' }, today)).toBe(false)
    expect(isExpired({ ...base, status: 'lost' }, today)).toBe(false)
  })
})

describe('실적 집계', () => {
  const row = (status: EstimateStatus, total: number) => ({ status, total })

  it('수주율은 결론난 건(수주+실주)만으로 낸다', () => {
    const s = calcStats([
      row('won', 1_000), row('won', 2_000),
      row('lost', 5_000),
      row('draft', 9_000), row('sent', 9_000),   // 진행중은 수주율에서 빠짐
    ])
    expect(s.count).toBe(5)
    expect(s.amount).toBe(26_000)
    expect(s.wonCount).toBe(2)
    expect(s.wonAmount).toBe(3_000)
    expect(s.openCount).toBe(2)
    expect(s.winRate).toBeCloseTo(2 / 3)
  })

  it('결론난 건이 없으면 수주율은 null이다 (0%로 표시하면 오해)', () => {
    expect(calcStats([row('draft', 1_000)]).winRate).toBeNull()
    expect(calcStats([]).winRate).toBeNull()
  })
})

describe('기본 프리셋', () => {
  it('3종이 모두 있고 각 줄 금액이 수량×단가와 맞는다', () => {
    expect(DEFAULT_PRESETS.map(p => p.name)).toEqual(['원룸 올수리', '상가 인테리어', '사무실 부분수리'])
    for (const p of DEFAULT_PRESETS) {
      for (const it of p.items.filter(i => !i.is_header)) {
        expect(it.amount).toBe(lineAmount(it.qty, it.unit_price))
      }
    }
  })
})

describe('PDF 렌더', () => {
  it('한글이 든 견적서를 실제 PDF 바이트로 만든다', async () => {
    const { renderToBuffer } = await import('@react-pdf/renderer')
    const { EstimateDocument } = await import('@/lib/estimate-pdf')
    const React = (await import('react')).default

    const totals = calcTotals(DEFAULT_PRESETS[0].items, { overhead_rate: 0.05, vat_mode: 'add' })
    const buf = await renderToBuffer(
      React.createElement(EstimateDocument, {
        estimate: {
          id: 'test', company_id: null, client_id: null,
          estimate_no: '2026-0904-01', issue_date: '2026-09-04',
          company_snapshot: null,
          client_name: '○○종합상사', client_contact: '김과장',
          client_phone: '010-0000-0000', client_email: null,
          site_address: '천안시 서북구 불당동 000-0',
          project_name: '불당동 상가 1층 인테리어 공사',
          period: '착공일로부터 30일', valid_days: 30,
          payment_terms: '계약금 30% / 중도금 40% / 잔금 30%',
          notes: '- 상기 금액은 부가세 별도입니다.\n- 자재 변경 시 단가가 조정될 수 있습니다.',
          overhead_rate: 0.05, discount: 0, vat_mode: 'add',
          ...totals,
          status: 'draft', sent_at: null,
        },
        items: DEFAULT_PRESETS[0].items,
        company: {
          name: '테스트건설', biz_no: '000-00-00000', ceo: '홍길동',
          address: '천안시 서북구', biz_type: '건설업', biz_item: '실내건축공사',
          phone: '041-000-0000', bank_account: '국민 000000-00-000000',
        },
      })
    )

    expect(buf.length).toBeGreaterThan(10_000)
    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-')
  }, 60_000)
})

describe('음수 금액 — 숫자와 한글이 어긋나지 않는다', () => {
  it('합계가 마이너스면 한글에도 마이너스가 나온다', () => {
    // 할인에 0을 하나 더 치면 나는 상황.
    // 예전에는 숫자 -110,000 / 한글 '일금 일십일만원정' 으로 갈렸다.
    const t = calcTotals([{ is_header: false, amount: 100000 }] as EstimateItem[],
      { discount: 200000, vat_mode: 'add' })
    expect(t.total).toBe(-110000)
    expect(koreanAmount(t.total)).toBe('일금 마이너스 일십일만원정')
  })

  it('0원과 양수는 그대로', () => {
    expect(koreanAmount(0)).toBe('일금 영원정')
    expect(koreanAmount(110000)).toBe('일금 일십일만원정')
  })
})

describe('공종별 소계', () => {
  const I = (is_header: boolean, name: string, amount = 0) =>
    ({ is_header, name, amount }) as EstimateItem

  it('공종마다 그 끝에 소계를 낸다', () => {
    const sums = sectionSums([
      I(true, '1. 철거공사'),
      I(false, '기존 마감 철거', 402000),
      I(false, '폐기물 처리', 298000),
      I(true, '2. 내장공사'),
      I(false, '실크벽지', 435500),
      I(false, '강마루', 1842500),
    ])
    expect(sums).toEqual([
      { afterIndex: 2, name: '1. 철거공사', amount: 700000 },
      { afterIndex: 5, name: '2. 내장공사', amount: 2278000 },
    ])
  })

  it('구분이 하나뿐이면 내지 않는다 — 전체 합계와 같다', () => {
    expect(sectionSums([
      I(true, '철거공사'),
      I(false, '철거', 100000),
    ])).toEqual([])
  })

  it('구분이 아예 없으면 내지 않는다', () => {
    expect(sectionSums([I(false, '철거', 100000), I(false, '방수', 200000)])).toEqual([])
  })

  it('내역이 없는 구분은 건너뛴다', () => {
    const sums = sectionSums([
      I(true, '비어 있는 공종'),
      I(true, '철거공사'),
      I(false, '철거', 100000),
      I(true, '내장공사'),
      I(false, '벽지', 200000),
    ])
    expect(sums.map(s => s.name)).toEqual(['철거공사', '내장공사'])
  })

  it('구분 밖에 놓인 줄이 있으면 아예 내지 않는다', () => {
    // 첫 구분보다 앞에 적힌 50,000 은 어느 구간에도 안 들어간다.
    // 그대로 두면 소계를 더해도 총액과 맞지 않아 "왜 다르냐"는 물음만 생긴다.
    const items = [
      I(false, '구분 없이 적은 줄', 50000),
      I(true, '철거공사'),
      I(false, '철거', 100000),
      I(true, '내장공사'),
      I(false, '벽지', 200000),
    ]
    expect(sectionSums(items)).toEqual([])

    // 그 줄을 구분 안으로 옮기면 다시 나온다
    const fixed = [
      I(true, '철거공사'),
      I(false, '구분 없이 적은 줄', 50000),
      I(false, '철거', 100000),
      I(true, '내장공사'),
      I(false, '벽지', 200000),
    ]
    expect(sectionSums(fixed)).toEqual([
      { afterIndex: 2, name: '철거공사', amount: 150000 },
      { afterIndex: 4, name: '내장공사', amount: 200000 },
    ])
  })

  it('소계를 다 더하면 언제나 전체 내역 합과 같다', () => {
    const items = [
      I(true, '철거'), I(false, 'a', 100000), I(false, 'b', 200000),
      I(true, '방수'), I(false, 'c', 300000),
      I(true, '빈 공종'),
      I(true, '내장'), I(false, 'd', 400000),
    ]
    const sums = sectionSums(items)
    const total = items.reduce((s, i) => i.is_header ? s : s + i.amount, 0)
    expect(sums.reduce((s, x) => s + x.amount, 0)).toBe(total)
  })
})

describe('재료비·인건비 나누기', () => {
  const R = (o: Partial<EstimateItem>) => ({
    sort_order: 0, is_header: false, category: null, name: null, spec: null, unit: null,
    qty: 0, unit_price: 0, material_price: 0, labor_price: 0, cost_price: 0,
    amount: 0, remark: null, ...o,
  }) as EstimateItem

  it('한 줄이라도 나눠 적었으면 나눈 것으로 본다', () => {
    expect(isSplitPricing([R({ unit_price: 10000 })])).toBe(false)
    expect(isSplitPricing([R({ material_price: 5000 })])).toBe(true)
    expect(isSplitPricing([R({ labor_price: 5000 })])).toBe(true)
    // 머리줄은 세지 않는다
    expect(isSplitPricing([R({ is_header: true, material_price: 5000 })])).toBe(false)
  })

  it('나눠 적었으면 둘의 합이 단가다', () => {
    expect(effectiveUnitPrice(R({ material_price: 5000, labor_price: 5000 }))).toBe(10000)
    expect(effectiveUnitPrice(R({ labor_price: 60000 }))).toBe(60000)        // 인건비만
    expect(effectiveUnitPrice(R({ material_price: 26000 }))).toBe(26000)     // 재료비만
  })

  it('안 나눴으면 원래 단가를 그대로 쓴다', () => {
    expect(effectiveUnitPrice(R({ unit_price: 13000 }))).toBe(13000)
  })

  it('재료비 합 + 인건비 합 = 전체 소계', () => {
    const items = [
      R({ is_header: true, name: '방수' }),
      R({ name: '레미탈', qty: 70, material_price: 5000, labor_price: 5000, unit_price: 10000, amount: 700000 }),
      R({ name: '방수공', qty: 2, labor_price: 200000, unit_price: 200000, amount: 400000 }),
      R({ name: '드라이픽스', qty: 14, material_price: 26000, unit_price: 26000, amount: 364000 }),
    ]
    const st = splitTotals(items)
    expect(st.material).toBe(70 * 5000 + 14 * 26000)   // 714,000
    expect(st.labor).toBe(70 * 5000 + 2 * 200000)      // 750,000
    expect(st.material + st.labor).toBe(calcTotals(items, { vat_mode: 'add' }).subtotal)
  })

  it('소수 수량도 원 단위로 맞아떨어진다', () => {
    const items = [R({ name: '타일', qty: 28.74, labor_price: 60000, unit_price: 60000, amount: 1724400 })]
    const st = splitTotals(items)
    expect(st.material + st.labor).toBe(calcTotals(items, { vat_mode: 'add' }).subtotal)
  })
})
