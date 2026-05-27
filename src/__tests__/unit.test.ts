import { describe, it, expect } from 'vitest'
import { formatPrice, maskAddress, formatDate } from '@/lib/utils'

// ── formatPrice ──────────────────────────────────────────────────────────────

describe('formatPrice', () => {
  it('null → 미정', () => expect(formatPrice(null)).toBe('미정'))
  it('undefined → 미정', () => expect(formatPrice(undefined)).toBe('미정'))
  it('0 → 0만', () => expect(formatPrice(0)).toBe('0만'))
  it('300 → 300만', () => expect(formatPrice(300)).toBe('300만'))
  it('5000 → 5,000만', () => expect(formatPrice(5000)).toBe('5,000만'))
  it('9999 → 9,999만', () => expect(formatPrice(9999)).toBe('9,999만'))
  it('10000 → 1억', () => expect(formatPrice(10000)).toBe('1억'))
  it('20000 → 2억', () => expect(formatPrice(20000)).toBe('2억'))
  it('15000 → 1억 5,000만', () => expect(formatPrice(15000)).toBe('1억 5,000만'))
  it('23500 → 2억 3,500만', () => expect(formatPrice(23500)).toBe('2억 3,500만'))
  it('100000 → 10억', () => expect(formatPrice(100000)).toBe('10억'))
})

// ── maskAddress ───────────────────────────────────────────────────────────────

describe('maskAddress', () => {
  it('null → 빈 문자열', () => expect(maskAddress(null)).toBe(''))
  it('undefined → 빈 문자열', () => expect(maskAddress(undefined)).toBe(''))
  it('빈 문자열 → 빈 문자열', () => expect(maskAddress('')).toBe(''))
  it('동 수준까지만', () =>
    expect(maskAddress('서울특별시 강남구 역삼동 123-4')).toBe('서울특별시 강남구 역삼동'))
  it('아파트 동·호수 제거', () =>
    expect(maskAddress('서울특별시 서초구 서초동 1234 래미안서초 101동 1001호')).toBe('서울특별시 서초구 서초동'))
  it('읍 수준', () =>
    expect(maskAddress('경기도 성남시 분당구 판교읍 1234')).toBe('경기도 성남시 분당구 판교읍'))
  it('면 수준', () =>
    expect(maskAddress('충청남도 공주시 유구면 1번지')).toBe('충청남도 공주시 유구면'))
  it('리 수준', () =>
    expect(maskAddress('전라북도 완주군 구이면 덕천리 100')).toBe('전라북도 완주군 구이면 덕천리'))
  it('가 수준 (서울 종로)', () =>
    expect(maskAddress('서울특별시 종로구 창신1가 123')).toBe('서울특별시 종로구 창신1가'))
  it('동/읍/면/리/가 없으면 첫 토큰', () =>
    expect(maskAddress('특수지역')).toBe('특수지역'))
})

// ── formatDate ────────────────────────────────────────────────────────────────

describe('formatDate', () => {
  const ago = (ms: number) => new Date(Date.now() - ms).toISOString()

  it('30초 전 → 방금 전', () => expect(formatDate(ago(30_000))).toBe('방금 전'))
  it('59초 전 → 방금 전', () => expect(formatDate(ago(59_000))).toBe('방금 전'))
  it('1분 전 → 1분 전', () => expect(formatDate(ago(60_000))).toBe('1분 전'))
  it('5분 전 → 5분 전', () => expect(formatDate(ago(5 * 60_000))).toBe('5분 전'))
  it('59분 전 → 59분 전', () => expect(formatDate(ago(59 * 60_000))).toBe('59분 전'))
  it('1시간 전 → 1시간 전', () => expect(formatDate(ago(3_600_000))).toBe('1시간 전'))
  it('3시간 전 → 3시간 전', () => expect(formatDate(ago(3 * 3_600_000))).toBe('3시간 전'))
  it('1일 전 → 1일 전', () => expect(formatDate(ago(86_400_000))).toBe('1일 전'))
  it('7일 전 → 7일 전', () => expect(formatDate(ago(7 * 86_400_000))).toBe('7일 전'))
})

// ── auto-fill 순수 함수 ───────────────────────────────────────────────────────
// 공통 모듈(src/lib/property-types.ts)의 mapPurposeToRoomType을 직접 import해서 테스트
import { mapPurposeToRoomType as mapRoomType } from '@/lib/property-types'

function parseFloor(flrGbCd: string, flrNoNm: string, flrNo: number): number | null {
  const nm = flrNoNm
  if (nm.includes('~')) return null
  if (flrGbCd === '10' || nm.includes('지하')) {
    const n = nm.replace(/[^0-9]/g, '')
    return n ? -Number(n) : (flrNo > 0 ? -flrNo : -1)
  }
  return Number(nm.replace(/[^0-9-]/g, '')) || null
}

function formatDateSeum(s: unknown): string | null {
  const str = String(s ?? '')
  if (str.length !== 8) return null
  return `${str.slice(0, 4)}-${str.slice(4, 6)}-${str.slice(6, 8)}`
}

const m2ToPyeong = (m2: number) => +(m2 / 3.305785).toFixed(2)
const pad4 = (s: string) => String(s || '0').padStart(4, '0')

describe('mapRoomType (19종)', () => {
  // 주거 7종
  it('아파트', () => expect(mapRoomType('공동주택(아파트)')).toBe('아파트'))
  it('오피스텔', () => expect(mapRoomType('업무시설(오피스텔)')).toBe('오피스텔'))
  it('빌라/연립', () => expect(mapRoomType('다세대주택')).toBe('빌라/연립'))
  it('단독/다가구 - 단독', () => expect(mapRoomType('단독주택')).toBe('단독/다가구'))
  it('단독/다가구 - 다가구', () => expect(mapRoomType('다가구주택')).toBe('단독/다가구'))
  // 비주거 12종
  it('사무실', () => expect(mapRoomType('업무시설')).toBe('사무실'))
  it('상가 - 근린생활', () => expect(mapRoomType('제1종근린생활시설')).toBe('상가'))
  it('교육시설', () => expect(mapRoomType('교육연구시설')).toBe('교육시설'))
  it('창고/공장 - 공장', () => expect(mapRoomType('공장')).toBe('창고/공장'))
  it('창고/공장 - 위험물', () => expect(mapRoomType('위험물 저장 및 처리 시설')).toBe('창고/공장'))
  it('숙박', () => expect(mapRoomType('숙박시설')).toBe('숙박'))
  it('의료시설', () => expect(mapRoomType('의료시설')).toBe('의료시설'))
  it('의료시설 - 노유자', () => expect(mapRoomType('노유자시설')).toBe('의료시설'))
  it('위락시설', () => expect(mapRoomType('위락시설')).toBe('위락시설'))
  it('운동시설', () => expect(mapRoomType('운동시설')).toBe('운동시설'))
  it('자동차시설', () => expect(mapRoomType('자동차 관련 시설')).toBe('자동차시설'))
  it('농업/축사', () => expect(mapRoomType('동물 및 식물 관련 시설')).toBe('농업/축사'))
  // 매핑 안 되는 것 → '기타'
  it('기타 - 종교', () => expect(mapRoomType('종교시설')).toBe('기타'))
  it('기타 - 묘지', () => expect(mapRoomType('묘지 관련 시설')).toBe('기타'))
  it('빈 문자열 → null', () => expect(mapRoomType('')).toBeNull())
})

describe('parseFloor', () => {
  it('지상 5층', () => expect(parseFloor('20', '5층', 5)).toBe(5))
  it('지상 10층', () => expect(parseFloor('20', '10층', 10)).toBe(10))
  it('지하 1층 (flrGbCd=10)', () => expect(parseFloor('10', '지하1층', 0)).toBe(-1))
  it('지하 2층 (nm에 지하 포함)', () => expect(parseFloor('20', '지하2층', 0)).toBe(-2))
  it('층범위 표기 → null', () => expect(parseFloor('20', '지하1층~지상8층', 0)).toBeNull())
  it('숫자 없는 지하 → -1', () => expect(parseFloor('10', '지하층', 0)).toBe(-1))
})

describe('formatDateSeum', () => {
  it('정상 날짜', () => expect(formatDateSeum('20230515')).toBe('2023-05-15'))
  it('길이 부족 → null', () => expect(formatDateSeum('2023051')).toBeNull())
  it('빈 문자열 → null', () => expect(formatDateSeum('')).toBeNull())
  it('null → null', () => expect(formatDateSeum(null)).toBeNull())
})

describe('m2ToPyeong', () => {
  it('33.06m² → 10평', () => expect(m2ToPyeong(33.0579)).toBeCloseTo(10, 0))
  it('66.12m² → 20평', () => expect(m2ToPyeong(66.1157)).toBeCloseTo(20, 0))
  it('0 → 0', () => expect(m2ToPyeong(0)).toBe(0))
})

describe('pad4', () => {
  it('1 → 0001', () => expect(pad4('1')).toBe('0001'))
  it('123 → 0123', () => expect(pad4('123')).toBe('0123'))
  it('1234 → 1234', () => expect(pad4('1234')).toBe('1234'))
  it('빈 문자열 → 0000', () => expect(pad4('')).toBe('0000'))
})
