import { describe, it, expect } from 'vitest'
import { DOC_RGN, canEnter, dutyOk, fitsFields, latestOrd, parseMfrc, parseWon, shortRegion } from '@/lib/bid-notices'

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

describe('canEnter — 아산 업체', () => {
  const ours = '충청남도 아산시'
  it.each([
    [[], true],
    [['충청남도'], true],
    [['충청남도 아산시'], true],
    [['충청남도 천안시'], false],
    [['경상남도 합천군'], false],
    [['부산광역시', '충청남도'], true],
  ] as [string[], boolean][])('%j → %s', (r, v) => expect(canEnter(r, ours)).toBe(v))

  it('아직 안 받았으면 모른다(null), 소재지를 안 정했으면 다 된다', () => {
    expect(canEnter(null, ours)).toBeNull()
    expect(canEnter(['경상남도'], null)).toBe(true)
  })

  it('충청남도 아산시 를 충청남도 아산 으로 시작하는 다른 곳과 헷갈리지 않는다', () => {
    expect(canEnter(['충청남도 아산'], '충청남도 아산시')).toBe(false)
  })
})

describe('shortRegion', () => {
  it.each([['충청남도 아산시', '충남 아산시'], ['충청남도', '충남'], ['부산광역시', '부산'], ['서울특별시 강동구', '서울 강동구']])(
    '%s → %s', (a, b) => expect(shortRegion(a)).toBe(b))
})

describe('주력분야', () => {
  it('parseMfrc — 나라장터 표기에서 이름만', () => {
    expect(parseMfrc('[1^습식·방수공사]')).toEqual(['습식·방수공사'])
    expect(parseMfrc('[1^도장공사][2^석공사]')).toEqual(['도장공사', '석공사'])
    expect(parseMfrc('')).toEqual([])
  })

  const ours = ['도장공사', '습식·방수공사']
  it.each([
    [['석공사'], false],
    [['습식·방수공사'], true],
    [['도장공사', '석공사'], true],
    [[], true],
  ] as [string[], boolean][])('%j → %s', (f, v) => expect(fitsFields(f, ours)).toBe(v))

  it('아직 안 받았으면 모른다, 우리 주력분야가 없으면 다 된다', () => {
    expect(fitsFields(null, ours)).toBeNull()
    expect(fitsFields(['석공사'], [])).toBe(true)
  })
})

describe('canEnter — 지역이 공고서에만 있는 공고(서남병원 옥상 방수, R26BK01710029)', () => {
  const ours = '충청남도 아산시'
  it('현장이 다른 시도면 못 들어간다고 본다', () => {
    expect(canEnter([DOC_RGN], ours, '서울특별시 양천구')).toBe(false)
    expect(canEnter([DOC_RGN], ours, null)).toBe(false)
  })
  it('현장이 우리 시도면 원문을 봐야 안다(모름)', () => {
    expect(canEnter([DOC_RGN], ours, '충청남도 천안시')).toBeNull()
  })
})

describe('dutyOk — 지역의무공동도급', () => {
  const ours = '충청남도 아산시'
  it('의무 없으면 된다, 모르면 모른다', () => {
    expect(dutyOk(0, [], '경상북도 경산시', ours)).toBe(true)
    expect(dutyOk(null, null, '경상북도 경산시', ours)).toBeNull()
  })
  it('의무 지역이 비면 현장 시도 — 하양초(경북 49%)는 아산 업체 혼자 못 들어간다', () => {
    expect(dutyOk(49, [], '경상북도 경산시', ours)).toBe(false)
    expect(dutyOk(49, [], '충청남도 천안시', ours)).toBe(true)
  })
  it('의무 지역이 적혀 있으면 그것으로', () => {
    expect(dutyOk(30, ['충청남도'], '세종특별자치시', ours)).toBe(true)
    expect(dutyOk(30, ['충청남도 천안시'], '충청남도 천안시', ours)).toBe(false)
  })
})
