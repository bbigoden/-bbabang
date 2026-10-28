import { describe, it, expect } from 'vitest'
import { latestOrd, parseWon } from '@/lib/bid-notices'

const row = (no: string, ord: string, name: string, bssamt: number | null = null) =>
  ({ bid_ntce_no: no, bid_ntce_ord: ord, name, bid_close_at: '2026-10-30T01:00:00Z', bssamt, a_amount: null, rng_end: null })

describe('latestOrd', () => {
  it('정정 차수는 마지막 것만 남긴다', () => {
    const out = latestOrd([row('A', '000', '신기교'), row('A', '001', '신기교'), row('A', '002', '신기교', 63400000), row('B', '000', '다른 공고')])
    expect(out.map(r => `${r.bid_ntce_no}-${r.bid_ntce_ord}`).sort()).toEqual(['A-002', 'B-000'])
  })

  it('마지막 차수가 취소공고면 공고째 뺀다', () => {
    expect(latestOrd([row('C', '000', '개명1구 사면 정비'), row('C', '001', '개명1구 사면 정비(취소공고)')])).toEqual([])
  })

  it('기초금액이 앞 차수에만 있으면 넘겨 받는다', () => {
    const [r] = latestOrd([row('D', '000', '공고', 34000000), row('D', '001', '공고')])
    expect(r.bid_ntce_ord).toBe('001')
    expect(r.bssamt).toBe(34000000)
  })
})

describe('parseWon', () => {
  it.each([
    ['63500000', 63500000], ['63,500,000', 63500000], ['6400만', 64000000], ['2억3600만', 236000000],
    ['2.36억', 236000000], ['2억 3,600만원', 236000000], ['1억5000', 100005000],
  ])('%s → %d', (s, v) => expect(parseWon(s)).toBe(v))

  it('못 읽으면 null', () => {
    expect(parseWon('')).toBeNull()
    expect(parseWon('abc')).toBeNull()
    expect(parseWon('만')).toBeNull()
    expect(parseWon('25240000.5')).toBeNull()
    expect(parseWon('-100')).toBeNull()
    expect(parseWon('1e10')).toBeNull()
    expect(parseWon('0')).toBeNull()
    expect(parseWon('9'.repeat(5000))).toBeNull()
  })
})
