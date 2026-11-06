import { describe, expect, it } from 'vitest'
import { companyFlds, licFldsOf, licKey, licKeysFor } from '@/lib/bid-notices'

describe('입찰 법인 둘 — 면허로 공고·낙찰 가르기', () => {
  const 한결 = ['4992']
  const 아천 = ['4989', '4995', '4996', '5652']

  it('면허 칸이 생기기 전 공고는 4992 하나로 본다', () => {
    expect(licFldsOf({ lic_flds: null, mfrc_flds: ['석공사'] })).toEqual({ '4992': ['석공사'] })
    expect(licFldsOf({ lic_flds: null, mfrc_flds: null })).toEqual({ '4992': null })
  })

  it('법인 면허가 없는 공고는 그 법인 공고가 아니다', () => {
    expect(companyFlds({ '5652': [] }, 한결)).toBeUndefined()
    expect(companyFlds({ '4992': ['도장공사'] }, 아천)).toBeUndefined()
  })

  it('면허 줄 하나라도 지정 없음이면 누구나, 모르면 null, 아니면 주력분야를 모은다', () => {
    expect(companyFlds({ '4989': ['보링·그라우팅·파일공사'], '4996': [] }, 아천)).toEqual([])
    expect(companyFlds({ '4989': null }, 아천)).toBeNull()
    expect(companyFlds({ '4989': ['토공사'], '4995': ['구조물해체·비계공사'] }, 아천)).toEqual(['토공사', '구조물해체·비계공사'])
    // 4992 줄(석공)은 아천 주력분야 판단에 안 섞인다
    expect(companyFlds({ '4992': ['석공사'], '4989': ['포장공사'] }, 아천)).toEqual(['포장공사'])
  })

  it('낙찰 lic_key — 정렬해 잇고, 법인 면허가 든 조합을 다 고른다', () => {
    expect(licKey(['4996', '4989', '4989'])).toBe('4989,4996')
    const 한결키 = licKeysFor(한결)
    expect(한결키).toContain('4992')
    expect(한결키).toContain('4989,4992')
    expect(한결키).not.toContain('4989')
    expect(한결키).toHaveLength(16)
    expect(licKeysFor(아천)).toContain('5652')
    expect(licKeysFor(아천)).not.toContain('4992')
    expect(licKeysFor(아천)).toHaveLength(30)
  })
})
