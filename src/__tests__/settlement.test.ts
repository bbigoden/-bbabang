/**
 * 정산 계산(src/lib/settlement.ts) — 돈 계산이라 회귀를 여기서 막는다.
 *
 * 정산 화면·대시보드·통계가 모두 calcSettlement 하나로 담당자수수료·실수령을 센다.
 * 분배 행(사무실 손익 분배)은 매출이 아니므로 사무실 수익 집계에서 빠져야 하고,
 * 정산비는 0~1 밖이면 담당자수수료가 공급가의 몇 배로 잡히므로 계산에서도 자른다.
 */
import { describe, it, expect } from 'vitest'
import {
  calcSettlement, calcWithhold, clampRate, csvCell, isDistributionRow, sumOfficeProfitByMonth, thisRecordMonth,
} from '@/lib/settlement'

describe('calcSettlement — 자동 VAT', () => {
  it('총 1,100,000 → 공급가 1,000,000 · VAT 100,000, 정산비 0.5 → 담당자 500,000 · 원천 16,500', () => {
    const c = calcSettlement({ seller_fee: 1_100_000, buyer_fee: 0, settlement_rate: 0.5 })
    expect(c).toEqual({
      total: 1_100_000, supply: 1_000_000, vat: 100_000,
      assignee: 500_000, withhold: 16_500, takeHome: 483_500,
    })
  })

  it('매도·매수 수수료를 더해 총수수료를 만든다', () => {
    const c = calcSettlement({ seller_fee: 550_000, buyer_fee: 550_000, settlement_rate: 0.5 })
    expect(c.total).toBe(1_100_000)
    expect(c.supply).toBe(1_000_000)
  })
})

describe('calcSettlement — 수동 VAT', () => {
  it('vat_override 0 (현금) → 공급가 = 총수수료', () => {
    const c = calcSettlement({ seller_fee: 500_000, buyer_fee: 300_000, settlement_rate: 0.6, vat_override: 0 })
    expect(c.total).toBe(800_000)
    expect(c.supply).toBe(800_000)
    expect(c.vat).toBe(0)
    expect(c.assignee).toBe(480_000)
    expect(c.withhold).toBe(14_400 + 1_440)
    expect(c.takeHome).toBe(480_000 - 15_840)
  })

  it('vat_override 값만큼 VAT, 나머지가 공급가', () => {
    const c = calcSettlement({ seller_fee: 1_100_000, buyer_fee: 0, settlement_rate: 0.5, vat_override: 50_000 })
    expect(c.vat).toBe(50_000)
    expect(c.supply).toBe(1_050_000)
  })

  it('음수 vat_override 는 0 으로 본다', () => {
    const c = calcSettlement({ seller_fee: 1_000_000, buyer_fee: 0, settlement_rate: 0.5, vat_override: -10 })
    expect(c.vat).toBe(0)
    expect(c.supply).toBe(1_000_000)
  })
})

describe('calcWithhold — 소득세 3% + 지방세 0.3%, 각각 10원 절사', () => {
  it('123,456 → 3,700 + 370', () => {
    expect(calcWithhold(123_456)).toBe(3_700 + 370)
  })
  it('0·음수는 공제 없음', () => {
    expect(calcWithhold(0)).toBe(0)
    expect(calcWithhold(-1_000_000)).toBe(0)
  })
  it('원천 면제(대표 본인 계약)는 실수령 = 담당자수수료', () => {
    const c = calcSettlement({ seller_fee: 1_100_000, buyer_fee: 0, settlement_rate: 1, withhold_exempt: true })
    expect(c.withhold).toBe(0)
    expect(c.takeHome).toBe(c.assignee)
  })
})

describe('분배 행 (매도칸 = 사무실 수익, 매수칸 = −경비, 정산비 = 동업자 비율, VAT 0)', () => {
  it('손실 달 — 총액 음수면 원천 0, 실수령도 음수', () => {
    const c = calcSettlement({
      seller_fee: 670_000, buyer_fee: -4_000_000, settlement_rate: 0.5, vat_override: 0,
    })
    expect(c.total).toBe(-3_330_000)
    expect(c.supply).toBe(-3_330_000)
    expect(c.vat).toBe(0)
    expect(c.assignee).toBe(-1_665_000)
    expect(c.withhold).toBe(0)
    expect(c.takeHome).toBe(-1_665_000)
  })

  it('이익 달 — 순손익 × 동업자 비율에서 3.3% 공제', () => {
    const c = calcSettlement({
      seller_fee: 10_000_000, buyer_fee: -4_000_000, settlement_rate: 0.5, vat_override: 0,
    })
    expect(c.supply).toBe(6_000_000)
    expect(c.assignee).toBe(3_000_000)
    expect(c.withhold).toBe(90_000 + 9_000)
    expect(c.takeHome).toBe(2_901_000)
  })
})

describe('isDistributionRow', () => {
  it('"YYYY-MM 사무실 손익 분배" 만 분배 행', () => {
    expect(isDistributionRow({ contract_address: '2026-07 사무실 손익 분배' })).toBe(true)
    expect(isDistributionRow({ contract_address: '천안시 서북구 불당동 사무실' })).toBe(false)
    expect(isDistributionRow({ contract_address: null })).toBe(false)
    expect(isDistributionRow({})).toBe(false)
  })
})

describe('sumOfficeProfitByMonth — 사무실 수익(공급가 − 담당자), 분배 행 제외', () => {
  const rows = [
    // 2026-07: 500,000 + 440,000
    { record_month: '2026-07', contract_address: '불당동 상가', seller_fee: 1_100_000, buyer_fee: 0, settlement_rate: 0.5 },
    { record_month: '2026-07', contract_address: '쌍용동 사무실', seller_fee: 550_000, buyer_fee: 550_000, settlement_rate: 0.6, vat_override: 0 },
    // 분배 행 — 넣으면 분배에 분배가 섞여 돈다
    { record_month: '2026-07', contract_address: '2026-07 사무실 손익 분배', seller_fee: 940_000, buyer_fee: -4_000_000, settlement_rate: 0.5, vat_override: 0 },
    // 2026-08: 2,000,000 − 1,400,000
    { record_month: '2026-08', contract_address: '성정동 공장', seller_fee: 2_200_000, buyer_fee: 0, settlement_rate: 0.7 },
    // 기록월 없음은 '' 칸
    { record_month: null, contract_address: null, seller_fee: 110_000, buyer_fee: 0, settlement_rate: 0.5 },
  ]

  it('월별로 더하고 분배 행은 뺀다', () => {
    const m = sumOfficeProfitByMonth(rows)
    expect(m.get('2026-07')).toBe(940_000)
    expect(m.get('2026-08')).toBe(600_000)
    expect(m.get('')).toBe(50_000)
    expect(m.size).toBe(3)
  })

  it('분배 행만 있는 달은 수익이 잡히지 않는다', () => {
    const m = sumOfficeProfitByMonth([rows[2]])
    expect(m.get('2026-07')).toBeUndefined()
  })
})

describe('정산비 0~1 클램프', () => {
  it('clampRate', () => {
    expect(clampRate(0.55)).toBe(0.55)
    expect(clampRate('0.6')).toBe(0.6)
    expect(clampRate(9.999)).toBe(1)
    expect(clampRate(50)).toBe(1)
    expect(clampRate(-0.5)).toBe(0)
    expect(clampRate(null)).toBe(0)
    expect(clampRate(undefined)).toBe(0)
    expect(clampRate(NaN)).toBe(0)
  })

  it('정산비 9.999 가 들어와도 담당자수수료는 공급가를 넘지 않는다', () => {
    const c = calcSettlement({ seller_fee: 1_100_000, buyer_fee: 0, settlement_rate: 9.999 })
    expect(c.assignee).toBe(1_000_000)
  })

  it('음수 정산비는 0', () => {
    const c = calcSettlement({ seller_fee: 1_100_000, buyer_fee: 0, settlement_rate: -1 })
    expect(c.assignee).toBe(0)
    expect(c.takeHome).toBe(0)
  })
})

describe('thisRecordMonth — 이번 달은 한국 날짜로', () => {
  it('매월 1일 한국 0시 30분 (UTC 로는 전날) → 이번 달', () => {
    expect(thisRecordMonth(new Date('2026-09-30T15:30:00Z'))).toBe('2026-10')
  })
  it('말일 한국 23:59 → 아직 이번 달', () => {
    expect(thisRecordMonth(new Date('2026-10-31T14:59:59Z'))).toBe('2026-10')
  })
  it('해 넘김', () => {
    expect(thisRecordMonth(new Date('2026-12-31T15:00:00Z'))).toBe('2027-01')
  })
})

describe('csvCell — 엑셀 수식 주입 막기', () => {
  it('= + - @ 탭 CR 로 시작하면 앞에 \' 를 붙인다', () => {
    expect(csvCell('=HYPERLINK("http://x","y")')).toBe('"\'=HYPERLINK(""http://x"",""y"")"')
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)")
    expect(csvCell('+82 10')).toBe("'+82 10")
    expect(csvCell('-1')).toBe("'-1")
    expect(csvCell('@cmd')).toBe("'@cmd")
    expect(csvCell('\tx')).toBe("'\tx")
    expect(csvCell('\rx')).toBe('"\'\rx"')
  })

  it('쉼표·따옴표·줄바꿈은 따옴표로 감싼다', () => {
    expect(csvCell('천안시, 서북구')).toBe('"천안시, 서북구"')
    expect(csvCell('그 "상가"')).toBe('"그 ""상가"""')
    expect(csvCell('1층\n2층')).toBe('"1층\n2층"')
  })

  it('평범한 글자·빈 값은 그대로', () => {
    expect(csvCell('불당동 1234-5')).toBe('불당동 1234-5')
    expect(csvCell('2026-07 사무실 손익 분배')).toBe('2026-07 사무실 손익 분배')
    expect(csvCell(null)).toBe('')
    expect(csvCell(undefined)).toBe('')
  })
})
