/**
 * 낙찰가 분석 — 실제 나라장터 공고 한 건(R26BK01782483, 정선군 임시주차장 조성 공사)으로 맞춰 본다.
 * 기초금액 75,650,000 · 예정가격 74,606,050 · 하한율 89.745% · A값 2,575,029 · 29개사 참여.
 * 1순위 (주)다음건설 67,314,900원.
 */
import { describe, it, expect } from 'vitest'
import { normalize, winCurve, bestPoint, amountFor, rateStats, rangeOf } from '@/lib/bid-analysis'
import { kstToIso, toBsisPatch, toPrepar } from '@/lib/g2b'

const AMOUNTS = [
  67314900, 67344850, 67371533, 67473750, 67544380, 67725795, 67786700, 67834489, 67842820, 67861380,
  67959410, 67965090, 67986000, 67995260, 67996616, 68113050, 68260780, 68279556, 68339000, 68481027,
  68520810, 68542600, 68639100, 68656799, 68807859, 68810500, 68956500, 69018400, 69177124,
]
const REAL = { bssamt: 75650000, plnprc: 74606050, lwlt_rate: 89.745, a_amount: 2575029, amounts: AMOUNTS }

describe('normalize', () => {
  it('하한선을 넘은 가장 낮은 업체가 1순위 업체와 같다', () => {
    const h = normalize(REAL)!
    // 하한선 = (예정가격-A)×하한율+A = 67,219,269 원 → 1순위 67,314,900 원이 바로 위
    const floor = (REAL.plnprc - REAL.a_amount) * 0.89745 + REAL.a_amount
    expect(Math.round(floor)).toBe(67219269)
    expect(amountFor(h.r, REAL.bssamt, REAL.lwlt_rate, REAL.a_amount)).toBeGreaterThanOrEqual(Math.floor(floor))
    expect(Math.round(amountFor(h.minAbove, REAL.bssamt, REAL.lwlt_rate, REAL.a_amount))).toBeCloseTo(67314900, -1)
  })

  it('A값이 없으면 r 은 예정가격 ÷ 기초금액', () => {
    const h = normalize({ ...REAL, a_amount: null })!
    expect(h.r).toBeCloseTo(74606050 / 75650000, 10)
  })

  it('금액이 비면 버린다', () => {
    expect(normalize({ ...REAL, plnprc: 0 })).toBeNull()
    expect(normalize({ ...REAL, lwlt_rate: 0 })).toBeNull()
  })
})

describe('winCurve', () => {
  it('하한선과 1순위 사이에 넣었으면 땄고, 1순위와 같거나 높으면 졌다', () => {
    const h = normalize(REAL)!
    const curve = winCurve([h])
    const at = (y: number) => curve.find(p => Math.abs(p.y - y) < 1e-9)!
    const mid = Math.round(((h.r + h.minAbove) / 2) * 10000) / 10000
    expect(at(mid).wins).toBe(1)
    expect(at(Math.ceil(h.minAbove * 10000) / 10000).wins).toBe(0)
    expect(at(Math.floor(h.r * 10000) / 10000 - 0.0001).wins).toBe(0)
  })

  it('여러 공고를 겹쳐 세고, 가장 많이 겹친 자리를 고른다', () => {
    const hist = [
      { r: 0.990, minAbove: 0.995, n: 10 },
      { r: 0.992, minAbove: 0.996, n: 10 },
      { r: 0.993, minAbove: 0.994, n: 10 },
      { r: 1.010, minAbove: 1.020, n: 10 },
    ]
    const best = bestPoint(winCurve(hist), 0)
    expect(best.wins).toBe(3)
    expect(best.y).toBeGreaterThanOrEqual(0.993)
    expect(best.y).toBeLessThan(0.994)
  })

  it('경쟁사가 다 하한선 밑이면 하한선 위 어디든 땄다', () => {
    const curve = winCurve([{ r: 1.0, minAbove: Infinity, n: 3 }])
    expect(curve[curve.length - 1].wins).toBe(1)
  })
})

describe('rateStats / rangeOf', () => {
  it('사정률은 백분율로', () => {
    const s = rateStats([{ r: 0.99, minAbove: 1, n: 1 }, { r: 1.01, minAbove: 1.02, n: 1 }])
    expect(s.count).toBe(2)
    expect(s.min).toBeCloseTo(99)
    expect(s.max).toBeCloseTo(101)
  })

  it('예가 15개 퍼짐으로 ±2·±3 을 짐작한다', () => {
    expect(rangeOf(100, [{ price: 98.5 }, { price: 101.9 }])).toBe(2)
    expect(rangeOf(100, [{ price: 97.2 }, { price: 102.8 }])).toBe(3)
  })
})

describe('g2b 변환', () => {
  it('한국시간 문자열을 그대로 그 순간으로', () => {
    expect(kstToIso('2026-10-27 08:04:20')).toBe('2026-10-26T23:04:20.000Z')
    expect(kstToIso('2026-11-02 18:00')).toBe('2026-11-02T09:00:00.000Z')
    expect(kstToIso('')).toBeNull()
  })

  it('A값 = 국민연금+건강보험+노인장기요양+퇴직공제+안전관리비(+품질관리비)', () => {
    const p = toBsisPatch({
      bidNtceNo: 'R26BK01782483', bidNtceOrd: '000', bssamt: '75650000',
      rsrvtnPrceRngBgnRate: '-3', rsrvtnPrceRngEndRate: '+3', bidPrceCalclAYn: 'Y',
      npnInsrprm: '601519', mrfnHealthInsrprm: '455255', odsnLngtrmrcprInsrprm: '59820',
      rtrfundNon: '291262', sftyMngcst: '1167173', sftyChckMngcst: '0', qltyMngcst: '0', qltyMngcstAObjYn: 'Y',
      bssamtOpenDt: '2026-10-21 10:37:57',
    })
    expect(p.a_amount).toBe(2575029)
    expect(p.rng_bgn).toBe(-3)
    expect(p.rng_end).toBe(3)
  })

  it('A값 미적용 공고는 0', () => {
    expect(toBsisPatch({ bidNtceNo: 'x', bidPrceCalclAYn: 'N', npnInsrprm: '100' }).a_amount).toBe(0)
  })

  it('예가 상세 — 추첨된 4개 평균이 예정가격', () => {
    const rows = [
      [1, 77800000, 'N', 4], [2, 76100200, 'N', 3], [3, 73570400, 'Y', 6], [4, 75029700, 'Y', 5],
      [5, 74429100, 'N', 3], [6, 75737000, 'Y', 7], [7, 75401900, 'N', 5], [8, 77224300, 'N', 5],
      [9, 77312800, 'N', 0], [10, 74087100, 'Y', 6], [11, 76439800, 'N', 3], [12, 76820400, 'N', 3],
      [13, 73826100, 'N', 2], [14, 75195400, 'N', 4], [15, 74555400, 'N', 2],
    ].map(([sno, p, d, n]) => ({
      compnoRsrvtnPrceSno: String(sno), bsisPlnprc: String(p), drwtYn: String(d), drwtNum: String(n),
      bssamt: '75650000', plnprc: '74606050',
    }))
    const r = toPrepar(rows)!
    const drawn = r.prices.filter(p => p.drawn)
    expect(drawn).toHaveLength(4)
    expect(drawn.reduce((s, p) => s + p.price, 0) / 4).toBe(r.plnprc)
    expect(rangeOf(r.bssamt!, r.prices)).toBe(3)
  })
})
