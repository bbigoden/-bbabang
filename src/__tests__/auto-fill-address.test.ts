import { describe, it, expect } from 'vitest'
import { extractHos, splitAddressForAutoFill } from '@/lib/auto-fill-address'
import { propertyKey } from '@/lib/dup-check'

describe('매물 중복 키', () => {
  // 11-02: 글자 그대로 비교해 '충남'/'충청남도'만 달라도 다른 매물로 봤다
  it('시·도 표기·번지·도로명 괄호가 달라도 같은 매물', () => {
    expect(propertyKey('충남 천안시 동남구 신부동 466-11')).toBe(propertyKey('충청남도 천안시 동남구 신부동 466-11'))
    expect(propertyKey('충남 천안시 서북구 불당동 1828 104호')).toBe(propertyKey('충청남도 천안시 서북구 불당동 1828번지 104호'))
    expect(propertyKey('충남 천안시 서북구 불당동 1846 116호 (충청남도 천안시 서북구 불당25로 8)')).toBe(propertyKey('천안시 서북구 불당동 1846 116호'))
  })
  it('호수·건물 동·지번이 다르면 다른 매물', () => {
    expect(propertyKey('불당동 1828 104호')).not.toBe(propertyKey('불당동 1828 204호'))
    expect(propertyKey('불당동 1492 302동 2401호')).not.toBe(propertyKey('불당동 1492 301동 2401호'))
    expect(propertyKey('불당동 1542 205호')).not.toBe(propertyKey('불당동 1542-1 205호'))
    expect(propertyKey('불당동 728 301,302호')).toBe(propertyKey('불당동 728 302, 301호'))
  })
})

describe('자동채움 호수 뽑기', () => {
  // 11-01: '호\b' 로 찾다가 한글 뒤라 '203호' 를 하나도 못 찾았다
  it('주소 끝의 N호', () => {
    expect(extractHos('불당동 962 신화팰리스 203호')).toEqual({ addr: '불당동 962 신화팰리스', hos: ['203'] })
    expect(extractHos('불당동 1638 404호 ').hos).toEqual(['404'])
  })
  it('동·층이 같이 있어도', () => {
    expect(extractHos('불당동 1426 풍림아이원 103동 508호')).toEqual({ addr: '불당동 1426 풍림아이원 103동', hos: ['508'] })
    expect(splitAddressForAutoFill('부대동 1075 1층 103호')).toEqual({ addr: '부대동 1075', hos: ['103'], floor: 1 })
  })
  it('층은 떼어서 따로 — 일반건축물은 그 층 면적을 고른다', () => {
    expect(splitAddressForAutoFill('쌍용동 1491 4층전체')).toEqual({ addr: '쌍용동 1491', hos: [], floor: 4 })
    expect(splitAddressForAutoFill('신부동 455-8 지하1층')).toEqual({ addr: '신부동 455-8', hos: [], floor: -1 })
    expect(splitAddressForAutoFill('불당동 1621 5층 전체').floor).toBe(5)
    expect(splitAddressForAutoFill('유량동 401-11').floor).toBeNull()
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
