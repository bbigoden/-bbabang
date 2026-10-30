/** 입찰 실험실 — 되돌려 보기 판정과 '개찰 전 낙찰만' 자르기 */
import { describe, it, expect } from 'vitest'
import { verdictOf, priorOf, fixedSweep, predictN, chanceAtLeast, STRATEGIES, type LabRow } from '@/lib/bid-lab'

const row = (openg_at: string, sajeong: number, win_y: number | null): LabRow =>
  ({ openg_at, sajeong, win_y, dminstt_cd: 'X', dminstt_nm: '충청남도 아산시', bssamt: 1e8, rng: 3, prtcpt_cnum: 10 })

describe('verdictOf', () => {
  it('사정률보다 낮으면 미달, 1순위보다 낮으면 낙찰, 같거나 높으면 밀림', () => {
    const r = { sajeong: 0.995, win_y: 1.001 }
    expect(verdictOf(0.9949, r)).toBe('below')
    expect(verdictOf(0.995, r)).toBe('win')
    expect(verdictOf(1.001, r)).toBe('pass')
    expect(verdictOf(1.05, { sajeong: 0.995, win_y: null })).toBe('win')  // 하한 넘은 업체가 없던 공고
  })
})

describe('priorOf', () => {
  it('그 공고보다 먼저 개찰한 것만 — 같은 시각은 뺀다', () => {
    const sorted = [row('2026-01-01', 1, 1), row('2026-01-02', 1, 1), row('2026-01-03', 1, 1)]
    expect(priorOf(sorted, '2026-01-02')).toHaveLength(1)
    expect(priorOf(sorted, '2026-01-04')).toHaveLength(3)
    expect(priorOf(sorted, '2025-12-31')).toHaveLength(0)
  })
})

describe('전략', () => {
  it('비교할 낙찰이 모자라면 자리를 정하지 않는다', () => {
    const t = row('2026-02-01', 1, 1.01)
    for (const s of STRATEGIES) expect(s.pick([row('2026-01-01', 1, 1.01)], t)).toBeNull()
  })
  it('통과 70% 자리는 과거 사정률의 70% 지점', () => {
    const prior = Array.from({ length: 10 }, (_, i) => row('2026-01-01', 0.99 + i * 0.002, null))
    expect(STRATEGIES.find(s => s.id === 'pass70')!.pick(prior, row('2026-02-01', 1, 1))).toBeCloseTo(0.99 + 7 * 0.002)
  })
})

describe('fixedSweep', () => {
  it('y 칸마다 낙찰·밀림·미달을 센다', () => {
    const s = fixedSweep([{ sajeong: 1, win_y: 1.005 }], 0.995, 1.01, 0.005)
    expect(s.map(p => [p.y, p.win, p.pass, p.below])).toEqual([[0.995, 0, 0, 1], [1, 1, 0, 0], [1.005, 0, 1, 0], [1.01, 0, 1, 0]])
  })
})

describe('predictN — 참여 업체 수 미리 짐작', () => {
  const r = (cd: string, nm: string, n: number, bssamt = 1e8): LabRow =>
    ({ ...row('2026-01-01', 1, 1), dminstt_cd: cd, dminstt_nm: nm, prtcpt_cnum: n, bssamt })
  const t = { ...row('2026-02-01', 1, 1), dminstt_cd: 'A', dminstt_nm: '충청남도 아산시' }
  it('같은 발주기관 3건 이상이면 그 가운데 값', () => {
    expect(predictN([r('A', '충청남도 아산시', 10), r('A', '충청남도 아산시', 20), r('A', '충청남도 아산시', 90)], t)).toEqual({ n: 20, by: 'instt' })
  })
  it('모자라면 같은 시도·비슷한 금액대, 금액이 3배 넘게 다르면 뺀다', () => {
    const prior = [...[30, 40, 50, 60, 70].map(n => r('B', '충청남도 천안시', n)), r('C', '충청남도 공주시', 999, 1e10)]
    expect(predictN(prior, t)).toEqual({ n: 50, by: 'region' })
  })
  it('입찰자 1곳 공고는 경쟁 짐작에 안 쓴다', () => {
    expect(predictN([1, 1, 1, 1, 1].map(n => r('A', '충청남도 아산시', n)), t)).toBeNull()
  })
})

describe('chanceAtLeast — 버전 1 낙찰률로 이만큼 딸 확률', () => {
  it('기대만큼이면 흔하고, 훨씬 많으면 드물다', () => {
    expect(chanceAtLeast(0, 100, 0.03)).toBe(1)
    expect(chanceAtLeast(3, 100, 0.03)).toBeGreaterThan(0.5)
    expect(chanceAtLeast(10, 100, 0.03)).toBeLessThan(0.01)
    expect(chanceAtLeast(1, 1, 0.5)).toBeCloseTo(0.5)
  })
})
