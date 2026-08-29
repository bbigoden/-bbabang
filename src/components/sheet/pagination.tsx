'use client'

import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

/**
 * 세 표 페이지(고객목록·매물목록·일지) 공통 페이지네이션.
 *
 * UI: [<] [1] [2] … [N] [>] · 페이지당 [10][20][50][100] | 총 N개
 *
 * - totalPages ≤ 1 이면 이전/다음·페이지번호 버튼은 숨김 (페이지당·총개수만 표시)
 * - hidden 으로 전체 숨김 가능 (매물장 지도 뷰 등)
 * - 페이지번호는 1, 마지막, 현재±2 만 노출, 사이는 …
 */

const DEFAULT_PAGE_SIZES = [10, 20, 50, 100]

/**
 * 고른 페이지당 개수를 기억한다. 화면마다 다른 key 를 준다.
 *
 * 100개로 보다가 새로고침하면 20개로 돌아가는 게 매일 걸린다. 서버에 둘 만한
 * 값은 아니고(이 브라우저에서만 의미 있다), 저장이 막힌 환경도 있으므로
 * 실패하면 조용히 기본값으로 간다.
 *
 * 첫 렌더는 서버와 같은 기본값으로 그린 뒤 저장값을 적용한다 —
 * 서버에서 읽을 수 없는 값이라 처음부터 넣으면 hydration 이 어긋난다.
 */
export function usePageSize(key: string, fallback = 20, allowed = DEFAULT_PAGE_SIZES) {
  const [pageSize, setPageSize] = useState(fallback)
  const allowedKey = allowed.join(',')

  useEffect(() => {
    try {
      const saved = Number(localStorage.getItem(`pageSize:${key}`))
      // 버튼에 없는 값이 남아 있으면(선택지를 바꾼 뒤 등) 무시하고 기본값으로 간다
      if (allowedKey.split(',').map(Number).includes(saved)) setPageSize(saved)
    } catch { /* 시크릿 모드 등 저장이 막힌 환경 */ }
  }, [key, allowedKey])

  const choose = (n: number) => {
    setPageSize(n)
    try { localStorage.setItem(`pageSize:${key}`, String(n)) } catch { /* 위와 같음 */ }
  }

  return [pageSize, choose] as const
}

const NAV_BUTTON_BASE =
  'flex h-9 w-9 items-center justify-center rounded-xl border border-gray-200 dark:border-gray-800 ' +
  'bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-500 ' +
  'hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-40 transition-colors'

const PAGE_BUTTON_INACTIVE =
  'h-9 w-9 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 ' +
  'text-gray-600 dark:text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 ' +
  'text-sm font-semibold transition-colors'

const PAGE_BUTTON_ACTIVE =
  'h-9 w-9 rounded-xl border border-blue-600 bg-blue-600 text-white text-sm font-semibold transition-colors'

const SIZE_BUTTON_INACTIVE =
  'h-8 px-2.5 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 ' +
  'text-gray-600 dark:text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 ' +
  'text-xs font-semibold transition-colors'

const SIZE_BUTTON_ACTIVE =
  'h-8 px-2.5 rounded-lg border border-blue-600 bg-blue-600 text-white text-xs font-semibold transition-colors'

export interface PaginationProps {
  page: number
  totalPages: number
  pageSize: number
  totalCount: number
  onPageChange: (page: number) => void
  onPageSizeChange: (size: number) => void
  pageSizes?: number[]
  hidden?: boolean
}

export function Pagination({
  page, totalPages, pageSize, totalCount,
  onPageChange, onPageSizeChange,
  pageSizes = DEFAULT_PAGE_SIZES,
  hidden = false,
}: PaginationProps) {
  if (hidden) return null

  const pageNumbers = Array.from({ length: totalPages }, (_, i) => i + 1)
    .filter(n => n === 1 || n === totalPages || Math.abs(n - page) <= 2)
    .reduce<(number | '...')[]>((acc, n, i, arr) => {
      if (i > 0 && (n as number) - (arr[i - 1] as number) > 1) acc.push('...')
      acc.push(n)
      return acc
    }, [])

  return (
    <div className="mt-5 flex items-center justify-center gap-2 flex-wrap">
      {totalPages > 1 && (
        <>
          <button
            onClick={() => onPageChange(Math.max(1, page - 1))}
            disabled={page === 1}
            aria-label="이전 페이지"
            className={NAV_BUTTON_BASE}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          {pageNumbers.map((n, i) =>
            n === '...' ? (
              <span key={`e${i}`} className="px-1 text-gray-500">…</span>
            ) : (
              <button
                key={n}
                onClick={() => onPageChange(n)}
                className={page === n ? PAGE_BUTTON_ACTIVE : PAGE_BUTTON_INACTIVE}
              >
                {n}
              </button>
            ),
          )}
          <button
            onClick={() => onPageChange(Math.min(totalPages, page + 1))}
            disabled={page === totalPages}
            aria-label="다음 페이지"
            className={NAV_BUTTON_BASE}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </>
      )}
      <div className="flex items-center gap-1 ml-3">
        <span className="text-sm text-gray-500">페이지당</span>
        {pageSizes.map(n => (
          <button
            key={n}
            onClick={() => onPageSizeChange(n)}
            className={pageSize === n ? SIZE_BUTTON_ACTIVE : SIZE_BUTTON_INACTIVE}
          >
            {n}개
          </button>
        ))}
        <span className="text-sm text-gray-500 ml-1">| 총 {totalCount}개</span>
      </div>
    </div>
  )
}
