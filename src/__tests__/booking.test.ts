import { describe, it, expect } from 'vitest'
import { slotsFor, isBookable, bookableDays, normalizePhone, bookingSource, fullSlots, type BookingConfig } from '@/lib/booking'

const cfg: BookingConfig = {
  title: 't', intro: null, products: [], open_time: '10:00:00', close_time: '12:00:00',
  slot_minutes: 30, closed_weekdays: [0], lead_hours: 2, max_days: 7,
}
// 2026-11-05(목) 한국 08:30 = UTC 23:30 전날 — 아침에 날짜가 밀리지 않는지 본다
const morning = new Date('2026-11-04T23:30:00Z')

describe('booking', () => {
  it('영업시간 안에서 간격대로, 지금+lead 이후만', () => {
    expect(slotsFor(cfg, '2026-11-05', morning)).toEqual(['10:30', '11:00', '11:30'])
    expect(slotsFor(cfg, '2026-11-06', morning)).toEqual(['10:00', '10:30', '11:00', '11:30'])
  })
  it('쉬는 요일·범위 밖·지난 시각은 안 된다', () => {
    expect(isBookable(cfg, '2026-11-08', '10:00', morning)).toBe(false)   // 일요일
    expect(isBookable(cfg, '2026-11-13', '10:00', morning)).toBe(false)   // 8일 뒤
    expect(isBookable(cfg, '2026-11-05', '10:00', morning)).toBe(false)   // 2시간 안
    expect(isBookable(cfg, '2026-11-05', '10:30', morning)).toBe(true)
    expect(isBookable(cfg, '2026-11-06', '10:15', morning)).toBe(false)   // 간격 밖
  })
  it('고를 수 있는 날짜는 한국 오늘부터', () => {
    const days = bookableDays(cfg, morning)
    expect(days[0]).toBe('2026-11-05')
    expect(days).not.toContain('2026-11-08')
  })
  it('막은 날짜·꽉 찬 시각은 못 고른다', () => {
    const c = { ...cfg, closed_dates: ['2026-11-06'] }
    expect(bookableDays(c, morning)).not.toContain('2026-11-06')
    expect(isBookable(c, '2026-11-06', '10:00', morning)).toBe(false)
    // 한국 11-07 10:00 = UTC 01:00 — 두 건이면 정원 2에 꽉 참
    const full = fullSlots(2, ['2026-11-07T01:00:00+00:00', '2026-11-07T01:00:00Z', '2026-11-07T01:30:00Z'])
    expect(full).toEqual(['2026-11-07 10:00'])
    const f = { ...cfg, full }
    expect(slotsFor(f, '2026-11-07', morning)).toEqual(['10:30', '11:00', '11:30'])
    expect(isBookable(f, '2026-11-07', '10:00', morning)).toBe(false)
    expect(fullSlots(null, ['2026-11-07T01:00:00Z'])).toEqual([])
  })
  it('연락처·들어온 곳', () => {
    expect(normalizePhone('01012345678')).toBe('010-1234-5678')
    expect(normalizePhone('02-123-4567')).toBe('02-123-4567')
    expect(normalizePhone('123')).toBeNull()
    expect(bookingSource('Mozilla/5.0 (iPhone) Instagram 300.0', 'kakao')).toBe('insta_link')
    expect(bookingSource('Mozilla/5.0 (Linux; Android) KAKAOTALK 10.4.0', null)).toBe('kakao')
    expect(bookingSource('Mozilla/5.0 (iPhone) Safari', 'insta')).toBe('insta_link')
    expect(bookingSource('Mozilla/5.0 (iPhone) Safari', 'kakao')).toBe('kakao')
    expect(bookingSource('Mozilla/5.0 (iPhone) Safari', null)).toBe('link')
  })
})
