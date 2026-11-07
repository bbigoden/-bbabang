'use client'

import { Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SearchClear } from './search-clear'

/**
 * 목록 화면 위쪽 조작칸 공용 틀(11-07 사장님 "묶어 둬").
 * 화면마다 높이를 손으로 적어 검색칸이 36·38·42, 드롭다운이 32~44 로 제각각이었다.
 * 새 화면은 이것만 쓴다. 기준은 매물목록:
 *  - 검색칸·드롭다운 42px (CONTROL_H)
 *  - 제목 줄 주 버튼 36px (layout/page-header 의 PRIMARY_BTN)
 *  - 위쪽 탭 38px
 * 글자는 폰에서 16px — 아이폰은 16px 보다 작은 입력칸을 누르면 화면을 확대해 버린다.
 */
export const CONTROL_H = 'h-[42px]'

/** 드롭다운(select) — 폭은 쓰는 곳이 정한다 */
export const SELECT_BOX = cn(
  CONTROL_H,
  'rounded-xl border border-gray-200 bg-white px-3 text-base sm:text-sm text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20',
  'dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300',
)

/** 검색칸 — 돋보기·지우기 버튼까지. 폭은 className 으로(기본 꽉 채움) */
export function SearchBox({ value, onChange, placeholder = '검색', label, className }: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  /** 화면 읽기 프로그램용 이름 — 없으면 placeholder */
  label?: string
  className?: string
}) {
  return (
    <div className={cn('relative min-w-0', className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
      <input type="text" value={value} onChange={e => onChange(e.target.value)}
        placeholder={placeholder} aria-label={label ?? placeholder}
        className={cn(
          CONTROL_H,
          'w-full rounded-xl border border-gray-200 bg-white pl-9 pr-8 text-base sm:text-sm text-gray-900 placeholder:text-gray-400',
          'focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20',
          'dark:border-gray-800 dark:bg-gray-900 dark:text-white',
        )} />
      {value && <SearchClear onClick={() => onChange('')} />}
    </div>
  )
}

/**
 * 위쪽 탭 — 밑줄형 하나로(11-07 사장님 "탭도 맞춰"). 밑줄형·알약형·상자형 세 가지가 섞여 있었다.
 * 묶음 높이 38px. 넘치면 탭 줄만 옆으로 민다. 쓰는 곳: <div className={TAB_BAR}> <button className={tabClass(on)}>
 */
export const TAB_BAR = 'mb-4 flex gap-1 overflow-x-auto border-b border-gray-200 dark:border-gray-800'
export const tabClass = (on: boolean) => cn(
  '-mb-px inline-flex flex-shrink-0 items-center justify-center gap-1.5 whitespace-nowrap border-b-2 px-4 py-2 text-sm font-semibold transition-colors',
  on ? 'border-blue-600 text-blue-600 dark:text-blue-400'
    : 'border-transparent text-gray-500 hover:text-gray-800 dark:text-gray-500 dark:hover:text-gray-200',
)
/** 탭 옆 건수 */
export const TAB_COUNT = 'rounded-full bg-gray-100 px-1.5 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-300'
