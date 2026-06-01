'use client'

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
