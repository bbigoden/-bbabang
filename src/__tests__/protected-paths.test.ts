/**
 * 로그인 전용 경로 — proxy 와 auth-context 가 같은 목록을 본다.
 *
 * 목록에서 빠지면 손님이 빈 화면·끝없는 스피너에 갇히고, 잘못 들어가면 공유 링크
 * (/request/<id>, /r/<id>, /e/<token>)를 연 손님까지 로그인 화면으로 튕긴다.
 * 앞부분 일치라 끝 '/' 하나에 /reviews·/review/, /broker·/brokers 가 갈린다.
 */
import { describe, it, expect } from 'vitest'
import { isProtectedPath } from '@/lib/protected-paths'

const UUID = '3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b'

describe('isProtectedPath — 로그인 전용', () => {
  it.each([
    '/dashboard', '/dashboard/user', '/dashboard/broker',
    '/admin', '/admin/users',
    '/profile',
    '/settings', '/settings/office', '/settings/notifications',
    '/chat', `/chat/${UUID}`,
    '/request/new',
    '/favorites', '/history', '/notifications', '/recommendations', '/saved-searches',
    '/my/requests', '/my/proposals',
    '/reviews',
    `/review/${UUID}`,
  ])('%s', p => {
    expect(isProtectedPath(p)).toBe(true)
  })

  it.each([
    // 예전 목록에서 빠져 손님이 빈 화면·막다른 안내·끝없는 스피너를 보던 곳
    '/broker/ads', '/broker/naver',
    '/broker/estimates', '/broker/estimates/settings', `/broker/estimates/${UUID}`,
    // 원래 막혀 있던 곳 — 앞부분 하나로 바꾼 뒤에도 그대로
    '/broker/properties', '/broker/properties/new', '/broker/diary', '/broker/register',
    '/broker/messenger', '/broker/jobs', '/broker/trash', '/broker/settings',
  ])('중개사 화면 %s', p => {
    expect(isProtectedPath(p)).toBe(true)
  })

  it('/request/<id>/edit 는 작성자 전용', () => {
    expect(isProtectedPath(`/request/${UUID}/edit`)).toBe(true)
    expect(isProtectedPath(`/request/${UUID}/edit/`)).toBe(true)
    expect(isProtectedPath('/request/abc/edit')).toBe(true)
  })
})

describe('isProtectedPath — 손님도 보는 공개 화면', () => {
  it.each([
    '/',
    '/auth/login', '/auth/signup', '/auth/mfa', '/auth/reset-password',
    '/explore', '/explore/requests',
    '/regions', '/regions/x',
    '/jobs', '/jobs/1',
    '/support', '/office-intro', '/terms', '/privacy',
    '/property/1',
    '/search',
    '/account-suspended',
    // 공유 링크 — 카톡 미리보기·메일로 손님이 연다
    '/e/abc', '/r/abc',
    `/request/${UUID}`,
  ])('%s', p => {
    expect(isProtectedPath(p)).toBe(false)
  })

  it('/request/<id> 는 공개, 그 아래 /edit 만 막는다', () => {
    expect(isProtectedPath(`/request/${UUID}`)).toBe(false)
    expect(isProtectedPath(`/request/${UUID}/edit`)).toBe(true)
    // 'edit' 로 시작하기만 하는 다른 이름은 막지 않는다
    expect(isProtectedPath(`/request/${UUID}/editor`)).toBe(false)
  })

  it('/broker 와 /brokers 는 /broker/ 에 걸리지 않는다', () => {
    expect(isProtectedPath('/broker')).toBe(false)
    expect(isProtectedPath('/brokers')).toBe(false)
    expect(isProtectedPath('/broker/ads')).toBe(true)
  })

  it('/reviews(내 리뷰)와 /review/<id>(리뷰 작성)는 따로 막는다', () => {
    expect(isProtectedPath('/reviews')).toBe(true)
    expect(isProtectedPath(`/review/${UUID}`)).toBe(true)
    expect(isProtectedPath('/review')).toBe(false)
  })

  it('/saved-searches 는 막고 /search 는 연다', () => {
    expect(isProtectedPath('/saved-searches')).toBe(true)
    expect(isProtectedPath('/search')).toBe(false)
  })

  it('/settings/office 는 막고 /office-intro 는 연다', () => {
    expect(isProtectedPath('/settings/office')).toBe(true)
    expect(isProtectedPath('/office-intro')).toBe(false)
  })

  it('/e·/r 같은 짧은 앞부분에 다른 공개 화면이 휩쓸리지 않는다', () => {
    for (const p of ['/explore', '/e/abc', '/regions', '/r/abc', `/request/${UUID}`]) {
      expect(isProtectedPath(p)).toBe(false)
    }
  })
})

describe('isProtectedPath — 퍼센트 인코딩', () => {
  // proxy 는 nextUrl.pathname 을 인코딩된 채로 받는다. 글자 하나만 %xx 로 바꿔도
  // 앞부분 일치를 비껴 가던 구멍.
  it.each([
    '/%62roker/ads',               // b
    '/broker/%61ds',               // a
    '/%64ashboard/user',           // d
    `/request/${UUID}/%65dit`,     // e
    '/request/abc/%65dit',
    '/request/%6Eew',              // n (대문자 16진수도)
    '/%72eview/abc',               // r — /review/
  ])('%s 는 풀어서도 본다', p => {
    expect(isProtectedPath(p)).toBe(true)
  })

  it('깨진 인코딩은 던지지 않고 받은 그대로만 본다', () => {
    expect(() => isProtectedPath('/%E0%A4%A')).not.toThrow()
    expect(isProtectedPath('/%E0%A4%A')).toBe(false)
    expect(isProtectedPath('/explore/%E0%A4%A')).toBe(false)
    // 앞부분이 이미 걸리면 뒤가 깨져 있어도 막는다
    expect(isProtectedPath('/broker/%E0%A4%A')).toBe(true)
  })

  it.each([
    '/explore/%EC%B2%9C%EC%95%88',   // 경로 속 한글(천안)
    '/regions/%EC%B2%9C%EC%95%88',
    `/request/${UUID}`,
    `/request/%33f2b8c1e`,            // /request/<id> 는 인코딩돼도 공개
    '/%62roker',                      // '/broker' 자체는 막지 않는다(끝 '/')
    '/%62rokers',
    '/%72eview',
  ])('공개 화면 %s 는 풀어도 공개', p => {
    expect(isProtectedPath(p)).toBe(false)
  })
})
