/**
 * 로그인 전용 경로 — proxy 와 auth-context 가 같은 목록을 본다.
 *
 * 목록에서 빠지면 손님이 빈 화면·끝없는 스피너에 갇히고, 잘못 들어가면 공개 화면을
 * 보던 손님까지 로그인 화면으로 튕긴다. 앞부분 일치라 끝 '/' 하나에 /broker·/brokers 가 갈린다.
 */
import { describe, it, expect } from 'vitest'
import { isProtectedPath } from '@/lib/protected-paths'

describe('isProtectedPath — 로그인 전용', () => {
  it.each([
    '/dashboard', '/dashboard/broker',
    '/admin', '/admin/users',
    '/settings', '/settings/office', '/settings/notifications',
    '/notifications',
  ])('%s', p => {
    expect(isProtectedPath(p)).toBe(true)
  })

  it.each([
    '/broker/ads', '/broker/naver',
    '/broker/properties', '/broker/properties/new', '/broker/diary', '/broker/register',
    '/broker/trash', '/broker/settings',
  ])('중개사 화면 %s', p => {
    expect(isProtectedPath(p)).toBe(true)
  })
})

describe('isProtectedPath — 손님도 보는 공개 화면', () => {
  it.each([
    '/',
    '/auth/login', '/auth/signup', '/auth/mfa', '/auth/reset-password',
    '/support', '/terms', '/privacy',
    '/account-suspended',
  ])('%s', p => {
    expect(isProtectedPath(p)).toBe(false)
  })

  it('/broker 와 /brokers 는 /broker/ 에 걸리지 않는다', () => {
    expect(isProtectedPath('/broker')).toBe(false)
    expect(isProtectedPath('/brokers')).toBe(false)
    expect(isProtectedPath('/broker/ads')).toBe(true)
  })
})

describe('isProtectedPath — 퍼센트 인코딩', () => {
  // proxy 는 nextUrl.pathname 을 인코딩된 채로 받는다. 글자 하나만 %xx 로 바꿔도
  // 앞부분 일치를 비껴 가던 구멍.
  it.each([
    '/%62roker/ads',               // b
    '/broker/%61ds',               // a
    '/%64ashboard/broker',         // d
    '/%73ettings/office',          // s (소문자)
    '/%41dmin'.replace('%41', '%61'), // a
  ])('%s 는 풀어서도 본다', p => {
    expect(isProtectedPath(p)).toBe(true)
  })

  it('깨진 인코딩은 던지지 않고 받은 그대로만 본다', () => {
    expect(() => isProtectedPath('/%E0%A4%A')).not.toThrow()
    expect(isProtectedPath('/%E0%A4%A')).toBe(false)
    // 앞부분이 이미 걸리면 뒤가 깨져 있어도 막는다
    expect(isProtectedPath('/broker/%E0%A4%A')).toBe(true)
  })

  it.each([
    '/%62roker',               // '/broker' 자체는 막지 않는다(끝 '/')
    '/%62rokers',
  ])('공개 화면 %s 는 풀어도 공개', p => {
    expect(isProtectedPath(p)).toBe(false)
  })
})
