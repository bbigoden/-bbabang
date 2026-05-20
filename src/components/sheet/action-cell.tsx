/**
 * 시트형 페이지(매물·고객·일지) 공통 액션 컬럼.
 *
 * - 우측 sticky + 그림자 패턴을 한 곳에서 관리
 * - 헤더(SheetActionHeader): "+ ..." 버튼 placeholder (children으로 받음)
 * - 본문 셀(SheetActionCell): 복사·삭제 버튼
 *
 * 세 페이지가 같은 컴포넌트를 import → 디자인 변경 시 한 파일만 수정하면 자동 전파.
 */
import { Copy, Trash2 } from 'lucide-react'

const HEADER_CLASS = 'px-2 py-2.5 bg-gray-50 sticky right-0 z-10 shadow-[-4px_0_8px_-4px_rgba(0,0,0,0.08)]'
const CELL_CLASS = 'px-2 py-1.5 bg-white sticky right-0 z-10 shadow-[-4px_0_8px_-4px_rgba(0,0,0,0.06)]'
const DEFAULT_WIDTH = 64

export function SheetActionHeader({ children, width = DEFAULT_WIDTH }: {
  children: React.ReactNode
  width?: number
}) {
  return (
    <th className={HEADER_CLASS} style={{ width, minWidth: width }}>
      <div className="flex items-center justify-end gap-0.5">
        {children}
      </div>
    </th>
  )
}

export function SheetActionCell({ canEdit = true, onCopy, onDelete }: {
  canEdit?: boolean
  onCopy?: () => void
  onDelete?: () => void
}) {
  return (
    <td className={CELL_CLASS}>
      <div className="flex items-center justify-center gap-1.5">
        {canEdit && onCopy && (
          <button onClick={onCopy} title="복사"
            className="flex h-6 w-6 items-center justify-center rounded text-gray-300 hover:bg-blue-50 hover:text-blue-400 transition-colors">
            <Copy className="h-3.5 w-3.5" />
          </button>
        )}
        {canEdit && onDelete && (
          <button onClick={onDelete} title="삭제"
            className="flex h-6 w-6 items-center justify-center rounded text-gray-300 hover:bg-red-50 hover:text-red-400 transition-colors">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </td>
  )
}
