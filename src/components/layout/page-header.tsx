import { cn } from '@/lib/utils'

/**
 * 페이지 최상단 헤더 — 제목 + 부제목 + (옵션) 아이콘 + (옵션) 우측 액션.
 *
 * 기존: 30+ 페이지에 산발 작성된 헤더 마크업이 각자 다른 폰트 weight·간격·색·아이콘 위치.
 *      "text-2xl font-bold" vs "text-2xl font-black", icon 옆 정렬, 부제목 색상(gray-500/600/700)
 *      모두 페이지마다 다름.
 * 신규: 한 컴포넌트로 통일. 변경 시 한 곳만 손대면 모든 페이지에 반영.
 *
 * 표준:
 *  - h1: text-2xl font-bold text-gray-900 dark:text-white
 *  - description: text-sm text-gray-600 dark:text-gray-400
 *  - 아이콘은 제목 좌측 (h-6 w-6, 색은 prop으로)
 *  - actions는 우측 정렬, flex-shrink-0
 *  - 컨테이너 mb-6 (페이지 본문과의 간격 표준)
 */
interface PageHeaderProps {
  /** 페이지 제목 */
  title: React.ReactNode
  /** 부제목/설명 — 한 줄 권장 */
  description?: React.ReactNode
  /** 제목 좌측에 표시할 Lucide 아이콘 */
  icon?: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>
  /** 아이콘 색상 클래스 (예: 'text-pink-500'). 기본은 brand 페트롤 네이비 톤. */
  iconColor?: string
  /** 우측 액션 영역 (버튼·메뉴 등). 모바일에서 자동 줄바꿈됨. */
  actions?: React.ReactNode
  className?: string
}

export function PageHeader({
  title,
  description,
  icon: Icon,
  iconColor = 'text-blue-600 dark:text-blue-400',
  actions,
  className,
}: PageHeaderProps) {
  return (
    <div className={cn('mb-6 flex items-start justify-between gap-4 flex-wrap', className)}>
      <div className="min-w-0 flex-1">
        <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900 dark:text-white">
          {Icon && (
            <span className={cn('flex-shrink-0', iconColor)}>
              <Icon className="h-6 w-6" aria-hidden />
            </span>
          )}
          <span className="min-w-0">{title}</span>
        </h1>
        {description && (
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">{description}</p>
        )}
      </div>
      {actions && <div className="flex-shrink-0">{actions}</div>}
    </div>
  )
}
