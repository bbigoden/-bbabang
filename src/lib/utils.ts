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

export function formatDate(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diff = Math.floor((now.getTime() - date.getTime()) / 1000)

  if (diff < 60) return '방금 전'
  if (diff < 3600) return `${Math.floor(diff / 60)}분 전`
  if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`
  return `${Math.floor(diff / 86400)}일 전`
}
