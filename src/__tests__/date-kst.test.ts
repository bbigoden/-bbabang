/**
 * 날짜는 언제나 한국(Asia/Seoul) 기준.
 *
 * 서버(Vercel)도 Supabase 도 UTC 로 돌기 때문에, UTC 로 날짜를 뽑으면
 * 한국시간 0~9시 사이에 하루가 밀린다. 사장님은 아침 일찍 일한다.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { todayKST, ymdKST, hmKST, addDays } from '@/lib/date-kst'

describe('todayKST', () => {
  afterEach(() => vi.useRealTimers())

  const at = (utc: string) => { vi.useFakeTimers(); vi.setSystemTime(new Date(utc)) }

  it('한국 아침 8시 — UTC 로는 전날 밤이지만 오늘을 준다', () => {
    at('2026-09-04T23:00:00Z')          // 한국 2026-09-05 08:00
    expect(todayKST()).toBe('2026-09-05')
    expect(new Date().toISOString().slice(0, 10)).toBe('2026-09-04')  // 예전 방식
  })

  it('한국 자정 직후', () => {
    at('2026-09-04T15:01:00Z')          // 한국 2026-09-05 00:01
    expect(todayKST()).toBe('2026-09-05')
  })

  it('한국 밤 11시', () => {
    at('2026-09-05T14:00:00Z')          // 한국 2026-09-05 23:00
    expect(todayKST()).toBe('2026-09-05')
  })

  it('해가 넘어갈 때', () => {
    at('2026-12-31T16:00:00Z')          // 한국 2027-01-01 01:00
    expect(todayKST()).toBe('2027-01-01')
  })
})

describe('ymdKST — 저장된 시각을 한국 날짜로 읽는다', () => {
  it('UTC 밤은 한국 다음날 아침', () => {
    expect(ymdKST('2026-09-04T23:30:00Z')).toBe('2026-09-05')
  })
  it('UTC 낮은 한국 같은 날', () => {
    expect(ymdKST('2026-09-05T03:00:00Z')).toBe('2026-09-05')
  })
  it('말이 안 되는 값은 빈 문자열', () => {
    expect(ymdKST('아무거나')).toBe('')
  })
})

describe('hmKST — 시:분도 한국 기준', () => {
  it('UTC 07:00 은 한국 16:00', () => {
    // 채팅 일정 기본값이 오후 4시여야 하는데 07:00 으로 떴던 자리
    expect(hmKST('2026-09-05T07:00:00Z')).toBe('16:00')
  })
  it('한국 자정은 00:00', () => {
    expect(hmKST('2026-09-04T15:00:00Z')).toBe('00:00')
  })
})

describe('addDays — 보는 곳과 무관하게 같은 답', () => {
  it('더하기', () => expect(addDays('2026-09-05', 30)).toBe('2026-10-05'))
  it('빼기', () => expect(addDays('2026-09-05', -1)).toBe('2026-09-04'))
  it('달을 넘김', () => expect(addDays('2026-01-31', 1)).toBe('2026-02-01'))
  it('윤년', () => expect(addDays('2028-02-28', 1)).toBe('2028-02-29'))
  it('해를 넘김', () => expect(addDays('2026-12-31', 1)).toBe('2027-01-01'))
  it('0일', () => expect(addDays('2026-09-05', 0)).toBe('2026-09-05'))
  it('말이 안 되는 값', () => expect(addDays('', 1)).toBe(''))
})
