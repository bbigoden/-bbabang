import { describe, expect, it } from 'vitest'
import { bidFloor, trimBids } from '@/lib/bid-trim'

const mk = (n: number, winAt?: number) =>
  Array.from({ length: n }, (_, i) => ({ rank: i === winAt ? 1 : 0, amount: 1000 + i, bizno: String(i) }))

describe('bidFloor', () => {
  it('(예정가격 − A) × 하한율 + A 를 올림', () => {
    expect(bidFloor(100_000_000, 87.745, 5_000_000)).toBe(Math.ceil(95_000_000 * 0.87745 + 5_000_000))
  })
  it('하한율·예정가격이 없으면 null', () => {
    expect(bidFloor(null, 87.745, 0)).toBeNull()
    expect(bidFloor(100, null, 0)).toBeNull()
    expect(bidFloor(100, '0', 0)).toBeNull()
  })
})

describe('trimBids', () => {
  it('적으면 그대로', () => {
    const b = mk(21, 3)
    expect(trimBids(b, null, 10)).toBe(b)
  })
  it('1순위 앞뒤 keep 곳만 남긴다', () => {
    const out = trimBids(mk(200, 100), null, 10)
    expect(out).toHaveLength(21)
    expect(out[0].amount).toBe(1090)
    expect(out.at(-1)!.amount).toBe(1110)
    expect(out.some(b => b.rank === 1)).toBe(true)
  })
  it('1순위가 맨 앞이면 뒤로만', () => {
    const out = trimBids(mk(200, 0), null, 10)
    expect(out).toHaveLength(11)
    expect(out[0].rank).toBe(1)
  })
  it('1순위가 없으면 하한선 위 첫 업체 기준', () => {
    const out = trimBids(mk(200), 1150, 10)
    expect(out.map(b => b.amount)).toEqual(Array.from({ length: 21 }, (_, i) => 1140 + i))
  })
  it('기준을 못 잡으면 자르지 않는다', () => {
    const b = mk(200)
    expect(trimBids(b, null, 10)).toBe(b)
  })
  it('금액 없는 업체는 맨 뒤로', () => {
    const b = [...mk(50, 25), { rank: 0, amount: null, bizno: 'x' }]
    expect(trimBids(b, null, 10).some(x => x.bizno === 'x')).toBe(false)
  })
})
