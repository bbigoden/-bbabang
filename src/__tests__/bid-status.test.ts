import { describe, expect, it } from 'vitest'
import { explainStop } from '@/lib/bid-status'
import { fieldsPass } from '@/lib/bid-notices'

describe('수집 멈춤 설명', () => {
  it('잘 받았으면 아무것도 안 띄운다', () => {
    expect(explainStop('나라장터', { stoppedBy: 'time' })).toBeNull()
    expect(explainStop('나라장터', null)).toBeNull()
  })
  it('나라장터 점검 — 옛 문구(200)도 점검으로 읽는다', () => {
    expect(explainStop('나라장터', { stoppedBy: 'error', error: '응답을 읽지 못했습니다 (200)' })?.why).toMatch(/점검/)
    expect(explainStop('국방', { stoppedBy: 'error', error: '국방전자조달 시스템 점검 중' })?.plan).toMatch(/자동/)
  })
  it('키 문제는 사장님 확인이 필요하다', () => {
    expect(explainStop('국방', { stoppedBy: 'error', error: '등록되지 않은 서비스키' })?.needsYou).toBe(true)
  })
  it('한도', () => {
    expect(explainStop('나라장터', { stoppedBy: 'limit' })?.plan).toMatch(/자정/)
  })
})

describe('주력분야 거르기', () => {
  it('국방 공고는 주력분야를 몰라도 통과, 나라장터는 모르면 뺀다', () => {
    expect(fieldsPass('MCS01552026-17331', null, ['도장공사'])).toBe(true)
    expect(fieldsPass('R26BK01787197', null, ['도장공사'])).toBe(false)
    expect(fieldsPass('R26BK01787197', ['석공사'], ['도장공사'])).toBe(false)
    expect(fieldsPass('R26BK01787197', ['도장공사'], ['도장공사'])).toBe(true)
  })
})
