import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatPrice(price: number | null | undefined): string {
  if (price == null) return '미정'
  if (price >= 10000) {
    const eok = Math.floor(price / 10000)
    const remainder = price % 10000
    if (remainder === 0) return `${eok}억`
    return `${eok}억 ${remainder.toLocaleString()}만`
  }
  return `${price.toLocaleString()}만`
}

// 주소를 읍/면/동/리/가 수준까지만 표시 (지번·건물번호 숨김)
// - 숫자로 시작하는 토큰(101동, 102동 등 아파트 동번호)은 건물번호로 간주해 제외
// - 마지막 매칭 토큰 기준 — "구이면 덕천리 100" → "구이면 덕천리"
export function maskAddress(address: string | null | undefined): string {
  if (!address) return ''
  const tokens = address.trim().split(/\s+/)
  let stopIdx = -1
  for (let i = 0; i < tokens.length; i++) {
    if (/[읍면동리가]$/.test(tokens[i]) && !/^\d/.test(tokens[i])) stopIdx = i
  }
  if (stopIdx === -1) return tokens[0] ?? address
  return tokens.slice(0, stopIdx + 1).join(' ')
}

/**
 * 매물 유형별 주소 노출 정책
 * - 아파트/오피스텔/빌라·연립/상가/사무실/건물 전체:
 *   도로명·건물명까지 (동·호·층·지하·지상 토큰 제거)
 * - 그 외 (원룸·투룸·쓰리룸·단독/다가구·토지·창고/공장·숙박/여관):
 *   읍·면·동까지
 */
const ADDRESS_DETAILED = new Set([
  '아파트', '오피스텔', '빌라/연립', '빌라', '연립',
  '상가', '사무실', '건물 전체', '건물전체',
])

export function maskAddressByType(
  address: string | null | undefined,
  roomType: string | null | undefined,
): string {
  if (!address) return ''
  const rt = (roomType ?? '').trim()
  const tokens = address.trim().split(/\s+/)

  // 도로명·건물명까지 노출 (동·호·층·지하·지상 토큰 제거)
  if (ADDRESS_DETAILED.has(rt)) {
    const filtered = tokens.filter(t =>
      !/^\d+동$/.test(t) &&        // 105동, 307동 (아파트 동 번호)
      !/^\d+호$/.test(t) &&        // 501호, 2404호
      !/^[Bb]?\d+층$/.test(t) &&   // 5층, B1층
      !/^지하\d*$/.test(t) &&      // 지하, 지하1
      !/^지상\d*$/.test(t)         // 지상
    )
    return filtered.join(' ')
  }

  // 그 외: 읍·면·동까지
  return maskAddress(address)
}

export function formatDate(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diff = Math.floor((now.getTime() - date.getTime()) / 1000)

  if (diff < 60) return '방금 전'
  if (diff < 3600) return `${Math.floor(diff / 60)}분 전`
  if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`
  return `${Math.floor(diff / 86400)}일 전`
}
