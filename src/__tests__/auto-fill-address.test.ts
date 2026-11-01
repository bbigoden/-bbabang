import { describe, it, expect } from 'vitest'
import { extractHos, splitAddressForAutoFill } from '@/lib/auto-fill-address'

describe('자동채움 호수 뽑기', () => {
  // 11-01: '호\b' 로 찾다가 한글 뒤라 '203호' 를 하나도 못 찾았다
  it('주소 끝의 N호', () => {
    expect(extractHos('불당동 962 신화팰리스 203호')).toEqual({ addr: '불당동 962 신화팰리스', hos: ['203'] })
    expect(extractHos('불당동 1638 404호 ').hos).toEqual(['404'])
  })
  it('동·층이 같이 있어도', () => {
    expect(extractHos('불당동 1426 풍림아이원 103동 508호')).toEqual({ addr: '불당동 1426 풍림아이원 103동', hos: ['508'] })
    expect(splitAddressForAutoFill('부대동 1075 1층 103호')).toEqual({ addr: '부대동 1075', hos: ['103'] })
  })
  it('여러 호·범위', () => {
    expect(extractHos('불당동 728 301,302호').hos).toEqual(['301', '302'])
    expect(extractHos('장재리 1720 234~236호').hos).toEqual(['234', '235', '236'])
  })
  it('동-호 표기', () => {
    expect(extractHos('불당동 1492 302-2401')).toEqual({ addr: '불당동 1492 302동', hos: ['2401'] })
  })
  it('호 뒤에 글자가 붙으면 호수가 아니다', () => {
    expect(extractHos('불당동 100 3호선').hos).toEqual([])
  })
})
