'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * 시트 머리줄 끝의 [+] — 칸 이름과 종류(텍스트·선택)를 받아 새 칸을 만든다.
 * 고객·업무일지·매물 세 화면에 거의 같은 것이 따로 있던 것을 하나로 모았다(2026-11-06).
 * 창은 body 에 띄운다 — 매물표처럼 넘침을 자르는 칸 안에 있어도 잘리지 않게.
 */
export function AddColBtn({ onAdd }: { onAdd: (name: string, type: 'text' | 'select') => void }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [type, setType] = useState<'text' | 'select'>('text')
  const btnRef = useRef<HTMLButtonElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const popupRef = useRef<HTMLDivElement>(null)
  const [popStyle, setPopStyle] = useState<React.CSSProperties>({})

  const close = () => { setOpen(false); setName(''); setType('text') }

  useEffect(() => {
    if (!open) return
    inputRef.current?.focus()
    const h = (e: MouseEvent) => {
      if (!btnRef.current?.contains(e.target as Node) && !popupRef.current?.contains(e.target as Node)) close()
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  const handleOpen = () => {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect()
      setPopStyle({ position: 'fixed', top: r.bottom + 4, left: Math.max(8, r.right - 210), zIndex: 9999 })
    }
    setOpen(v => !v)
  }
  const add = () => {
    if (name.trim()) { onAdd(name.trim(), type); close() }
  }

  return (
    <div className="relative">
      <button ref={btnRef} onClick={handleOpen}
        className="flex h-5 w-5 items-center justify-center rounded text-gray-300 hover:bg-blue-50 hover:text-blue-500 cursor-pointer transition-colors text-sm font-bold leading-none">
        +
      </button>
      {open && createPortal(
        <div ref={popupRef} className="flex flex-col gap-2 rounded-xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-xl p-2.5" style={popStyle}>
          <input ref={inputRef} value={name} onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') add(); if (e.key === 'Escape') close() }}
            placeholder="칼럼 이름 입력"
            className="rounded-lg border border-gray-200 dark:border-gray-800 px-2 py-1 text-xs outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400/20 w-44" />
          <div className="flex gap-1">
            <button onClick={() => setType('text')}
              className={`flex-1 rounded-lg px-2 py-1 text-xs font-medium transition-colors ${type === 'text' ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-500 hover:bg-gray-200'}`}>
              텍스트
            </button>
            <button onClick={() => setType('select')}
              className={`flex-1 rounded-lg px-2 py-1 text-xs font-medium transition-colors ${type === 'select' ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-500 hover:bg-gray-200'}`}>
              선택
            </button>
          </div>
          <button onClick={add} disabled={!name.trim()}
            className="rounded-lg bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-40">추가</button>
        </div>,
        document.body,
      )}
    </div>
  )
}
