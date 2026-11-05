/**
 * 예약 링크 페이지(/b/<slug>) 규칙 — 손님 화면과 접수 서버(/api/booking/<slug>)가 같이 쓴다.
 * 날짜·시각은 전부 한국 기준 문자열(YYYY-MM-DD, HH:MM)로 센다(AGENTS.md).
 */
import { todayKST, addDays } from '@/lib/date-kst'

export interface BookingProduct { name: string; price: number | null }
export interface BookingConfig {
  title: string
  intro: string | null
  products: BookingProduct[]
  open_time: string      // HH:MM(:SS)
  close_time: string
  slot_minutes: number
  closed_weekdays: number[]
  lead_hours: number
  max_days: number
}

/** 링크를 어디에 붙였나(?from=) → 일정의 '들어온 곳' */
export function sourceFromParam(from: string | null | undefined): 'insta_link' | 'kakao' | 'link' {
  if (from === 'insta') return 'insta_link'
  if (from === 'kakao') return 'kakao'
  return 'link'
}

const toMin = (hm: string) => { const [h, m] = hm.split(':').map(Number); return h * 60 + (m || 0) }
const toHM = (n: number) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`

export function weekdayOf(ymd: string): number {
  return new Date(`${ymd}T00:00:00Z`).getUTCDay()
}

/** 한국 시각 YYYY-MM-DD + HH:MM → 그 순간 */
export function kstInstant(ymd: string, hm: string): Date {
  return new Date(`${ymd}T${hm}:00+09:00`)
}

/** 고를 수 있는 날짜들(오늘부터 max_days 까지, 쉬는 요일 제외) */
export function bookableDays(c: BookingConfig, now = new Date()): string[] {
  const today = todayKST(now)
  const out: string[] = []
  for (let i = 0; i <= c.max_days; i++) {
    const d = addDays(today, i)
    if (c.closed_weekdays.includes(weekdayOf(d))) continue
    if (slotsFor(c, d, now).length) out.push(d)
  }
  return out
}

/** 그날 고를 수 있는 시각들 — 영업시간 안, slot 간격, 지금+lead_hours 이후 */
export function slotsFor(c: BookingConfig, ymd: string, now = new Date()): string[] {
  const start = toMin(c.open_time.slice(0, 5))
  const end = toMin(c.close_time.slice(0, 5))
  const earliest = now.getTime() + c.lead_hours * 3_600_000
  const out: string[] = []
  for (let t = start; t < end; t += c.slot_minutes) {
    const hm = toHM(t)
    if (kstInstant(ymd, hm).getTime() >= earliest) out.push(hm)
  }
  return out
}

/** 서버에서 받은 날짜·시각이 정말 고를 수 있는 것인가 */
export function isBookable(c: BookingConfig, ymd: string, hm: string, now = new Date()): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd) || !/^\d{2}:\d{2}$/.test(hm)) return false
  const today = todayKST(now)
  if (ymd < today || ymd > addDays(today, c.max_days)) return false
  if (c.closed_weekdays.includes(weekdayOf(ymd))) return false
  return slotsFor(c, ymd, now).includes(hm)
}

/** 010-1234-5678 꼴로 — 숫자만 9~11자리 */
export function normalizePhone(v: string): string | null {
  const d = v.replace(/\D/g, '')
  if (d.length < 9 || d.length > 11) return null
  if (d.length === 11) return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`
  if (d.length === 10) return d.startsWith('02') ? `${d.slice(0, 2)}-${d.slice(2, 6)}-${d.slice(6)}` : `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`
  return `${d.slice(0, 2)}-${d.slice(2, 5)}-${d.slice(5)}`
}
