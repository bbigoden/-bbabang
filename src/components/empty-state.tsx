import Link from 'next/link'
import { cn } from '@/lib/utils'

/**
 * 빈 상태 (Empty State) 공통 컴포넌트.
 *
 * 기존: 26+곳에 산발적으로 작성된 빈 상태 메시지가 각자 다른 스타일.
 *      "조건에 맞는 X가 없어요", "아직 발행한 X가 없어요", "X가 없습니다" 등 마크업도 색도 제각각.
 * 신규: 변형(variant)별 표준 + 메시지·아이콘·CTA만 prop으로 받음.
 *
 * 변형:
 *  - 'full'    : 큰 박스 (py-20). 페이지 전체 빈 상태용. 아이콘 + 메시지 + (선택) CTA
 *  - 'inline'  : 작은 인라인 (py-8). 카드/섹션 내부 빈 상태용. 메시지만
 *  - 'card'    : 보더 박스 + 작은 패딩 (py-4). 인포 카드 빈 상태용
 *
 * 테이블 빈 행은 EmptyTableRow를 사용 (별도 컴포넌트).
 */

interface EmptyStateProps {
  /** 변형 — full(큰 박스, 기본 py-20), medium(py-10), inline(작은 인라인 py-8), card(보더 박스 py-4) */
  variant?: 'full' | 'medium' | 'inline' | 'card'
  /** Lucide 아이콘 컴포넌트 (full/medium에서 사용) */
  icon?: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>
  /** 메시지 */
  message: string
  /** 보조 설명 (선택) */
  description?: string
  /** CTA — Link href 또는 button onClick 둘 다 지원 */
  cta?: { label: string; href: string } | { label: string; onClick: () => void }
  className?: string
  /** dark 모드용 별도 배경 (관리자 페이지의 bg-gray-900 등) */
  darkBg?: boolean
}

export function EmptyState({
  variant = 'full',
  icon: Icon,
  message,
  description,
  cta,
  className,
  darkBg,
}: EmptyStateProps) {
  if (variant === 'inline') {
    return (
      <p className={cn(
        'py-8 text-center text-sm',
        // darkBg=true는 admin 등 강제 다크 컨테이너용 — light mode에서도 gray-400 유지
        darkBg ? 'text-gray-400' : 'text-gray-600 dark:text-gray-400',
        className,
      )}>{message}</p>
    )
  }

  if (variant === 'card') {
    return (
      <p
        className={cn(
          'rounded-xl border py-4 text-center text-xs',
          // darkBg=true는 admin 등 강제 다크 컨테이너용 — light mode 영향 안 받음
          darkBg
            ? 'border-gray-800 bg-gray-800/40 text-gray-400'
            : 'border-gray-200 bg-gray-50 text-gray-600 dark:bg-gray-900 dark:border-gray-800 dark:text-gray-400',
          className,
        )}
      >
        {message}
      </p>
    )
  }

  // full or medium
  const isMedium = variant === 'medium'
  const padding = isMedium ? 'py-10' : 'py-20'
  const iconSize = isMedium ? 'h-10 w-10' : 'h-12 w-12'
  const textSize = isMedium ? 'text-sm' : ''

  // CTA: href면 Link, onClick이면 button
  const ctaEl = cta && (
    'href' in cta ? (
      <Link
        href={cta.href}
        className="mt-4 inline-flex items-center rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
      >
        {cta.label}
      </Link>
    ) : (
      <button
        type="button"
        onClick={cta.onClick}
        className="mt-4 inline-flex items-center rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
      >
        {cta.label}
      </button>
    )
  )

  return (
    <div
      className={cn(
        'rounded-2xl border text-center',
        padding,
        // darkBg=true는 admin 등 강제 다크 컨테이너용 — light mode 영향 안 받음
        darkBg ? 'border-gray-800 bg-gray-900' : 'border-gray-200 bg-white',
        className,
      )}
    >
      {Icon && (
        <Icon
          className={cn('mx-auto mb-3', iconSize, darkBg ? 'text-gray-600' : 'text-gray-400 dark:text-gray-600')}
          aria-hidden
        />
      )}
      <p className={cn('font-semibold', textSize, darkBg ? 'text-gray-300' : 'text-gray-700 dark:text-gray-300')}>
        {message}
      </p>
      {description && (
        <p className={cn('mt-1 text-sm', darkBg ? 'text-gray-400' : 'text-gray-600 dark:text-gray-400')}>
          {description}
        </p>
      )}
      {ctaEl}
    </div>
  )
}

/**
 * 테이블 빈 행. <tbody> 안에서 사용.
 */
export function EmptyTableRow({
  colSpan,
  message,
  className,
}: {
  colSpan: number
  message: string
  className?: string
}) {
  return (
    <tr>
      <td
        colSpan={colSpan}
        className={cn('px-3 sm:px-5 py-8 text-center text-sm text-gray-600 dark:text-gray-400', className)}
      >
        {message}
      </td>
    </tr>
  )
}
