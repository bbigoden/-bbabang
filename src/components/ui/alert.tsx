import { cn } from '@/lib/utils'
import { AlertCircle, CheckCircle2, Info } from 'lucide-react'

/**
 * 인라인 알림 배너(에러·성공·안내) 공용 컴포넌트.
 *
 * 같은 모양의 빨간 박스가 페이지마다 조금씩 다른 클래스로 복붙돼 있었다
 * (bg-red-50 px-4 py-3 / px-3 py-2 / 아이콘 유무 제각각). 여기로 모은다.
 *
 * 다크 표면 주의: /admin/**는 layout이 항상 bg-gray-950인데 html.dark 클래스가
 * 없어서 `dark:` variant가 먹지 않는다. 그래서 라이트/다크를 variant가 아니라
 * `surface` prop으로 명시적으로 고른다.
 *
 * 접근성: 에러는 role="alert"로 즉시 읽히게 한다(폼 제출 실패를 놓치지 않도록).
 */
type Tone = 'error' | 'success' | 'info'

const ICONS: Record<Tone, typeof AlertCircle> = {
  error: AlertCircle,
  success: CheckCircle2,
  info: Info,
}

const LIGHT: Record<Tone, string> = {
  error: 'bg-red-50 text-red-700 border-red-100',
  success: 'bg-green-50 text-green-700 border-green-100',
  info: 'bg-blue-50 text-blue-700 border-blue-100',
}

// 항상-어두운 표면(admin) 전용 — 대비 4.5:1을 넘기려면 -300/-400대가 필요하다
const DARK: Record<Tone, string> = {
  error: 'bg-red-500/10 text-red-300 border-red-500/30',
  success: 'bg-green-500/10 text-green-300 border-green-500/30',
  info: 'bg-blue-500/10 text-blue-300 border-blue-500/30',
}

export function Alert({
  tone = 'error',
  surface = 'light',
  icon = true,
  compact = false,
  children,
  className,
}: {
  tone?: Tone
  /** dark: /admin 처럼 항상 어두운 배경 위 */
  surface?: 'light' | 'dark'
  icon?: boolean
  compact?: boolean
  children: React.ReactNode
  className?: string
}) {
  const Icon = ICONS[tone]
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn(
        'flex items-start gap-2 rounded-xl border text-sm',
        compact ? 'px-3 py-2' : 'px-4 py-3',
        surface === 'dark' ? DARK[tone] : LIGHT[tone],
        className
      )}
    >
      {icon && <Icon className="h-4 w-4 flex-shrink-0 mt-0.5" aria-hidden="true" />}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}
