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

export function formatDate(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diff = Math.floor((now.getTime() - date.getTime()) / 1000)

  if (diff < 60) return '방금 전'
  if (diff < 3600) return `${Math.floor(diff / 60)}분 전`
  if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`
  return `${Math.floor(diff / 86400)}일 전`
}

// 표가 아직 DB 에 없을 때(마이그레이션 전) 나는 오류인지 — 그 기능만 조용히 빼고 화면은 띄운다
export const isMissingTable = (e: { code?: string } | null) => e?.code === '42P01' || e?.code === 'PGRST205'
