'use client'

import { X } from 'lucide-react'

/**
 * 검색 입력란 우측의 "검색어 한 번에 지우기" 버튼.
 * 부모가 `relative`여야 하고, input에 우측 여백(pr-8 이상)을 줘야 겹치지 않는다.
 * tone='dark'는 /admin 강제 다크 화면용 — admin layout은 html.dark 없이 어두운
 * 배경만 깔려 dark: variant가 안 먹으므로 명시적 다크 색을 쓴다.
 */
export function SearchClear({ onClick, tone = 'light' }: { onClick: () => void; tone?: 'light' | 'dark' }) {
  const color = tone === 'dark'
    ? 'text-gray-500 hover:bg-gray-700 hover:text-gray-200'
    : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-300'
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="검색어 지우기"
      className={`absolute right-2 top-1/2 -translate-y-1/2 flex h-5 w-5 items-center justify-center rounded-full ${color}`}
    >
      <X className="h-3.5 w-3.5" />
    </button>
  )
}
