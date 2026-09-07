import { cn } from '@/lib/utils'

/**
 * 고르고 끄는 알약 단추.
 *
 * **'고른 것' 은 한 가지 색이어야 한다.** 화면마다 따로 만들다 보니 켜진 색이 세
 * 가지가 됐다 — 매물수집은 페트롤 네이비(blue-600), 매물목록·요청필터는 밝은
 * 파랑(blue-500), 제안목록은 연한 파랑 배경. 같은 프로그램인데 어디서는 진하고
 * 어디서는 연해서, 눌린 것인지 아닌지 매번 다시 읽게 된다.
 *
 * 브랜드 기본색인 blue-600 하나로 맞춘다.
 */
export type ChipSize = 'sm' | 'xs'

const 크기: Record<ChipSize, string> = {
  sm: 'px-3 py-1 text-sm',
  xs: 'px-3 py-1 text-xs',
}

const 켜짐 = 'border-blue-600 bg-blue-600 text-white'
const 꺼짐 =
  'border-gray-200 bg-white text-gray-600 hover:bg-gray-50 ' +
  'dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400 dark:hover:bg-gray-800'

/**
 * 단추가 아닌 것(예: 링크)에 같은 모양을 입힐 때 쓴다.
 * 단추면 아래 `Chip` 을 쓰는 편이 낫다.
 */
export function chipClass(on: boolean, size: ChipSize = 'sm', extra?: string): string {
  return cn('rounded-full border font-medium transition-colors', 크기[size], on ? 켜짐 : 꺼짐, extra)
}

export function Chip({
  on, onClick, size = 'sm', title, className, children,
}: {
  on: boolean
  onClick: () => void
  size?: ChipSize
  title?: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <button type="button" onClick={onClick} title={title} className={chipClass(on, size, className)}>
      {children}
    </button>
  )
}
