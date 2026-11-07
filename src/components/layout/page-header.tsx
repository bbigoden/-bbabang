import { cn } from '@/lib/utils'

/**
 * 페이지 최상단 제목 줄 — 제목 + (옵션) 부제목 + (옵션) 오른쪽 버튼.
 *
 * 기준은 매물목록(11-06 사장님: "매물등록처럼 이쁘게 맞춰"). 화면마다 글자 크기·아이콘·버튼 높이가 달랐다.
 *  - h1: text-2xl font-bold, 아이콘 없음(매물·고객목록에 없고 나머지만 있어 들쭉날쭉했다)
 *  - 부제목: text-sm text-gray-500, 제목 바로 밑
 *  - 오른쪽 버튼은 제목 윗선에 맞추고 줄바꿈하지 않는다(폰에서 아랫줄로 떨어지지 않게)
 *  - 본문과 간격 mb-4
 * 등록 버튼은 PRIMARY_BTN 을 쓴다.
 */
interface PageHeaderProps {
  title: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
  className?: string
}

/** 제목 줄 오른쪽 주 버튼(매물 등록·고객 등록·미팅 등록…) */
export const PRIMARY_BTN = 'flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50'
/** 제목 줄 오른쪽 보조 버튼(흰 바탕 테두리) — 주 버튼과 같은 36px(11-07). 테두리 1px 씩이라 위아래 여백을 1px 줄인다 */
export const SECONDARY_BTN = 'flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl border border-gray-200 bg-white px-3 py-[7px] text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800'
/** 제목 줄 오른쪽 아이콘만 있는 버튼(새로 고침 등) — 36px 정사각 */
export const ICON_BTN = 'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-gray-200 text-gray-500 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-800'

export function PageHeader({ title, description, actions, className }: PageHeaderProps) {
  return (
    <div className={cn('mb-4 flex items-start justify-between gap-2', className)}>
      <div className="min-w-0">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{title}</h1>
        {description && <p className="mt-0.5 text-sm text-gray-500">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  )
}
