'use client'

/**
 * 시트형 페이지(매물 / 고객 / 업무일지) 공통 칼럼 헤더.
 *
 * 페이지마다 칼럼 종류와 이름은 다르지만 헤더의 *동작*은 동일해야 한다 —
 * 고정칼럼 자물쇠 표시, 클릭 시 옵션·이름변경·숨기기·삭제 메뉴, 옵션 추가/제거.
 * 세 페이지가 같은 컴포넌트를 import 해서 사용한다.
 */
import { useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, EyeOff, Lock, X } from 'lucide-react'
import { cn } from '@/lib/utils'

function useClickOutside(ref: React.RefObject<HTMLElement | null>, cb: () => void) {
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) cb()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [ref, cb])
}

export interface ColumnHeaderProps {
  label: string
  isFixed?: boolean
  isCustom?: boolean
  hasOptions?: boolean
  options?: string[]
  onSetOptions?: (opts: string[]) => void
  colType?: 'text' | 'select'
  onChangeType?: (type: 'text' | 'select') => void
  isMulti?: boolean
  onChangeMulti?: (multi: boolean) => void
  onHide?: () => void
  onRename?: (name: string) => void
  onDelete?: () => void
  /** 면적 칼럼 전용: 평/m² 단위 토글 (전체 매물 일괄). */
  areaUnit?: '평' | 'm²'
  onChangeAreaUnit?: (u: '평' | 'm²') => void
  /** 정렬: null=정렬 없음, 'asc'/'desc'=이 칼럼 기준 정렬 중 */
  sortDir?: 'asc' | 'desc' | null
  onSort?: () => void
}

export function ColumnHeader({
  label, isFixed, isCustom, hasOptions, options, onSetOptions,
  colType, onChangeType, isMulti, onChangeMulti, onHide, onRename, onDelete,
  areaUnit, onChangeAreaUnit, sortDir, onSort,
}: ColumnHeaderProps) {
  const [open, setOpen] = useState(false)
  const [style, setStyle] = useState<React.CSSProperties>({})
  const [newOpt, setNewOpt] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [renameVal, setRenameVal] = useState(label)
  const containerRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLDivElement>(null)
  useClickOutside(containerRef, () => { setOpen(false); setRenaming(false) })

  const canOpen = !isFixed || hasOptions || isCustom || !!onHide || !!onChangeAreaUnit

  const handleOpen = (e: React.MouseEvent) => {
    if (!canOpen) return
    e.stopPropagation()
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect()
      setStyle({
        position: 'fixed', zIndex: 9999, top: r.bottom + 2,
        left: Math.min(r.left, window.innerWidth - 230), minWidth: 210,
      })
    }
    setOpen(v => !v)
  }

  const addOpt = () => {
    const v = newOpt.trim()
    if (!v || !options || options.includes(v)) return
    onSetOptions?.([...options, v])
    setNewOpt('')
  }

  const commitRename = () => {
    const v = renameVal.trim()
    if (v && v !== label) onRename?.(v)
    setRenaming(false); setOpen(false)
  }

  return (
    <div ref={containerRef} className="relative flex items-center gap-1">
      <div ref={btnRef} onClick={handleOpen}
        className={cn('flex items-center gap-1 select-none flex-1 min-w-0', canOpen && 'cursor-pointer group')}>
        {isFixed && <Lock className="h-2.5 w-2.5 text-gray-300 flex-shrink-0" />}
        <span className="text-xs font-semibold text-gray-500 truncate min-w-0">{label}</span>
        {canOpen && !isFixed && <ChevronDown className="h-3 w-3 text-gray-300 opacity-50 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity flex-shrink-0" />}
      </div>
      {onSort && (
        <button
          onClick={(e) => { e.stopPropagation(); onSort() }}
          title={sortDir === 'asc' ? '오름차순 (다시 클릭하면 내림차순)' : sortDir === 'desc' ? '내림차순 (다시 클릭하면 해제)' : '정렬'}
          className={cn(
            'flex h-4 w-4 items-center justify-center rounded transition-colors flex-shrink-0',
            sortDir ? 'text-blue-600' : 'text-gray-300 hover:text-gray-500',
          )}
        >
          {sortDir === 'asc' ? <ArrowUp className="h-3 w-3" /> :
           sortDir === 'desc' ? <ArrowDown className="h-3 w-3" /> :
           <ArrowUpDown className="h-3 w-3" />}
        </button>
      )}

      {open && (
        <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-xl overflow-hidden min-w-[260px]" style={style}
          onClick={e => e.stopPropagation()}>
          <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-800 text-xs font-bold text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
            {isFixed && <Lock className="h-3 w-3 text-gray-500" />}
            {label}
          </div>

          {!isCustom && onHide && (
            <button onClick={() => { onHide?.(); setOpen(false) }}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-600 dark:text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 dark:bg-gray-950 transition-colors">
              <EyeOff className="h-3.5 w-3.5 text-gray-500" />이 칼럼 숨기기
            </button>
          )}

          {onChangeAreaUnit && (
            <div className="px-3 py-2 border-t border-gray-100 dark:border-gray-800">
              <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">면적 단위</div>
              <div className="flex gap-1">
                {(['평', 'm²'] as const).map(u => (
                  <button key={u} onClick={() => onChangeAreaUnit(u)}
                    className={`flex-1 rounded-lg px-2 py-1 text-xs font-medium transition-colors ${areaUnit === u ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-500 hover:bg-gray-200'}`}>
                    {u}
                  </button>
                ))}
              </div>
            </div>
          )}

          {isCustom && (
            <>
              {renaming ? (
                <div className="px-3 py-2 flex gap-1.5 border-b border-gray-100 dark:border-gray-800">
                  <input autoFocus value={renameVal} onChange={e => setRenameVal(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') commitRename()
                      if (e.key === 'Escape') { setRenaming(false); setRenameVal(label) }
                    }}
                    className="flex-1 rounded-lg border border-blue-400 px-2 py-1 text-xs outline-none min-w-0" />
                  <button onClick={commitRename}
                    className="rounded-lg bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-700">확인</button>
                </div>
              ) : (
                <button onClick={() => { setRenaming(true); setRenameVal(label) }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-600 dark:text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 dark:bg-gray-950 transition-colors">
                  <span className="text-gray-500">✏️</span>칼럼 이름 변경
                </button>
              )}
              {onChangeType && colType && (
                <div className="px-3 py-2 border-t border-gray-100 dark:border-gray-800">
                  <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">칼럼 유형</div>
                  <div className="flex gap-1">
                    <button onClick={() => onChangeType('text')}
                      className={`flex-1 rounded-lg px-2 py-1 text-xs font-medium transition-colors ${colType === 'text' ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-500 hover:bg-gray-200'}`}>
                      텍스트
                    </button>
                    <button onClick={() => onChangeType('select')}
                      className={`flex-1 rounded-lg px-2 py-1 text-xs font-medium transition-colors ${colType === 'select' ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-500 hover:bg-gray-200'}`}>
                      선택
                    </button>
                  </div>
                </div>
              )}
              <button onClick={() => { onDelete?.(); setOpen(false) }}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-red-600 hover:bg-red-50 transition-colors border-t border-gray-100 dark:border-gray-800">
                <X className="h-3.5 w-3.5" />칼럼 완전 삭제
              </button>
            </>
          )}

          {/* 고정칼럼 + colType (text/select 토글) — 고객/매물/일지 공통 */}
          {!isCustom && onChangeType && colType && (
            <div className="px-3 py-2 border-t border-gray-100 dark:border-gray-800">
              <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">칼럼 유형</div>
              <div className="flex gap-1">
                <button onClick={() => onChangeType('text')}
                  className={`flex-1 rounded-lg px-2 py-1 text-xs font-medium transition-colors ${colType === 'text' ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-500 hover:bg-gray-200'}`}>
                  텍스트
                </button>
                <button onClick={() => onChangeType('select')}
                  className={`flex-1 rounded-lg px-2 py-1 text-xs font-medium transition-colors ${colType === 'select' ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-500 hover:bg-gray-200'}`}>
                  선택
                </button>
              </div>
            </div>
          )}

          {hasOptions && onChangeMulti && (
            <div className="px-3 py-2 border-t border-gray-100 dark:border-gray-800">
              <label className="flex items-center justify-between gap-2 cursor-pointer select-none">
                <span className="text-xs font-medium text-gray-700 dark:text-gray-300">다중 선택</span>
                <button type="button"
                  onClick={() => onChangeMulti(!isMulti)}
                  role="switch" aria-checked={!!isMulti} aria-label="다중 선택"
                  className={`relative h-5 w-9 rounded-full transition-colors flex-shrink-0 ${isMulti ? 'bg-blue-600' : 'bg-gray-300'}`}>
                  <span className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white dark:bg-gray-900 shadow transition-transform ${isMulti ? 'translate-x-4' : 'translate-x-0'}`} />
                </button>
              </label>
            </div>
          )}

          {hasOptions && options && onSetOptions && (
            <>
              {(!isFixed || isCustom) && !onChangeMulti && <div className="border-t border-gray-100 dark:border-gray-800" />}
              <div className="px-3 pt-2 pb-0.5 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">선택 항목</div>
              <div className="px-2 pb-1 grid grid-cols-2 gap-1">
                {options.map(opt => (
                  <div key={opt} className="group/opt flex items-center gap-1 px-1.5 py-1 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 dark:bg-gray-950 min-w-0">
                    <span className="flex-1 text-xs text-gray-700 dark:text-gray-300 truncate">{opt}</span>
                    <button onClick={() => onSetOptions?.(options.filter(o => o !== opt))}
                      className="opacity-40 sm:opacity-0 sm:group-hover/opt:opacity-100 flex h-4 w-4 items-center justify-center rounded text-gray-300 hover:text-red-400 transition-all flex-shrink-0"
                      aria-label={`${opt} 옵션 제거`}>
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
              <div className="px-2 pb-2 pt-1 flex gap-1.5 border-t border-gray-100 dark:border-gray-800">
                <input value={newOpt} onChange={e => setNewOpt(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') addOpt() }}
                  placeholder="항목 추가..."
                  className="flex-1 rounded-lg border border-gray-200 dark:border-gray-800 px-2 py-1 text-xs outline-none focus:border-blue-400 min-w-0" />
                <button onClick={addOpt} className="rounded-lg bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-700 flex-shrink-0">추가</button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
