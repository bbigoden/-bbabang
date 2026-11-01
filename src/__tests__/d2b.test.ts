import { describe, expect, it } from 'vitest'
import { d2bAmountA, d2bCodes, d2bKeyOf, d2bNames, d2bNo, d2bOrd, d2bOthbcBid, d2bPrices, d2bSite, d2bTime, isD2b } from '@/lib/d2b'

describe('국방전자조달(D2B) 값 다듬기', () => {
  it('번호 — 제이비드와 같은 공고번호+공사번호, 나라장터 번호와 구분된다', () => {
    const no = d2bNo('MCS0155', '2026-17331')
    expect(no).toBe('MCS01552026-17331')
    expect(d2bOrd('1')).toBe('001')
    expect(isD2b(no)).toBe(true)
    expect(isD2b('R26BK01787197')).toBe(false)
    expect(d2bKeyOf(no, '001')).toEqual({ orntCode: 'MCS', pblancNo: 'MCS0155', cntrwkNo: '2026-17331', pblancOdr: '1' })
  })

  it('참가지역·면허 목록', () => {
    expect(d2bNames('[44000] 충청남도')).toEqual(['충청남도'])
    expect(d2bNames('[44000] 충청남도^[44200] 충청남도 아산시')).toEqual(['충청남도', '충청남도 아산시'])
    expect(d2bNames('')).toEqual([])
    expect(d2bCodes('[0002] 건축공사업^[0003] 토목건축공사업^[4990] 실내건축공사업')).toEqual(['0002', '0003', '4990'])
    expect(d2bCodes('[4992] 도장ㆍ습식ㆍ방수ㆍ석공사업')).toContain('4992')
  })

  it('현장 — 시도로 시작하게 맞춘다', () => {
    expect(d2bSite('경상북도 문경시 호계면 상무로 101', [])).toBe('경상북도 문경시 호계면 상무로 101')
    expect(d2bSite('전남 영암군', [])).toBe('전라남도 영암군')
    expect(d2bSite('부남리', ['충청남도'])).toBe('충청남도 부남리')
    expect(d2bSite('부남리', [])).toBe('부남리')
  })

  it('A값 — 제이비드 보험료 합계(A)와 같다 (계룡대 생활관)', () => {
    expect(d2bAmountA({ inanAmnt: '1336216', inheAmnt: '1011305', treaAmnt: '132885', safeAmnt: '1020578', retiDedu: '0', quasCost: '0' })).toBe(3_500_984)
  })

  it('시각은 한국시간', () => {
    expect(d2bTime('202611051030')).toBe('2026-11-05T01:30:00.000Z')
    expect(d2bTime('20261022')).toBe('2026-10-21T15:00:00.000Z')
    expect(d2bTime('')).toBeNull()
  })

  it('공개수의 참가업체 — 순위는 비고에서, 하한 미만은 0', () => {
    expect(d2bOthbcBid({ bznsRgnb: '5928100342', mfkrName: 'A', tnegnAmnt: '54363830', negnRate: '89.873', negnNote: '1순위' }, 'x', '001').rank).toBe(1)
    expect(d2bOthbcBid({ bznsRgnb: '1', negnNote: '10순위' }, 'x', '001').rank).toBe(10)
    expect(d2bOthbcBid({ bznsRgnb: '1', negnNote: '낙찰하한가미만' }, 'x', '001').rank).toBe(0)
  })

  it('예정가격 — 뽑힌 4개 평균(원 미만 버림)', () => {
    const items = [100, 101, 102, 103, 104].map((p, i) => ({ epprRank: String(i + 1), planPrce: String(p), choiYsno: i < 4 ? 'Y' : 'N' }))
    const r = d2bPrices(items)
    expect(r.plnprc).toBe(101)
    expect(r.prices.filter(p => p.drawn)).toHaveLength(4)
  })
})
