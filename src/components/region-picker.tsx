'use client'

import { useEffect, useRef, useState } from 'react'
import { Search, X, MapPin, Check } from 'lucide-react'
import { useClickOutside } from '@/lib/use-click-outside'

export type RegionValue = {
  sido: string         // 충청남도
  sigungu: string      // 천안시 서북구
  dong: string | null  // 불당동 (NULL=시·군·구 전체)
}

type Hit = RegionValue & { label: string }

/**
 * 공통 행정구역 picker.
 *
 * - 입력란에 글자를 치면 디바운스 후 /api/regions/search 호출
 * - 결과 클릭으로 선택 → onPick(value)
 * - 단일 선택 모드(고객 요청 폼) / 다중 누적 모드(중개사 관심 지역) 둘 다 지원
 *   · single: value(현재 선택)·onPick·clear 버튼
 *   · multi: onAdd만 호출, 이미 선택된 지역은 옵션 자체에서 dim 처리
 */
export function RegionPicker({
  placeholder = '동·읍·면으로 검색 (예: 불당동, 강남, 영통구 영)',
  value,
  selectedKeys,
  onPick,
  onClear,
  autoFocus,
}: {
  placeholder?: string
  value?: RegionValue | null            // single 모드: 현재 선택값
  selectedKeys?: Set<string>            // multi 모드: 이미 선택된 key들 ("sido|sigungu|dong")
  onPick: (v: RegionValue) => void
  onClear?: () => void
  autoFocus?: boolean
}) {
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<Hit[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)
  useClickOutside(boxRef, () => setOpen(false))

  // 디바운스 검색
  useEffect(() => {
    if (!q.trim() || q.trim().length < 2) { setHits([]); return }
    const t = setTimeout(async () => {
      setLoading(true)
      try {
        const r = await fetch(`/api/regions/search?q=${encodeURIComponent(q.trim())}`)
        const j = await r.json()
        setHits(j.results ?? [])
      } catch {
        setHits([])
      }
      setLoading(false)
    }, 250)
    return () => clearTimeout(t)
  }, [q])

  // single 모드에서 값이 있을 때 칩 형태
  if (value && !selectedKeys) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2.5">
        <MapPin className="h-4 w-4 text-blue-600 flex-shrink-0" />
        <span className="flex-1 text-sm font-semibold text-blue-900">
          {value.sido} {value.sigungu}{value.dong ? ` ${value.dong}` : ''}
        </span>
        {onClear && (
          <button type="button" onClick={onClear} className="text-blue-600 hover:text-blue-800">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    )
  }

  return (
    <div ref={boxRef} className="relative">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <input
          type="text"
          value={q}
          autoFocus={autoFocus}
          onChange={e => { setQ(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          className="w-full rounded-xl border border-gray-200 bg-white py-2.5 pl-9 pr-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
        />
        {loading && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
          </div>
        )}
      </div>

      {open && q.trim().length >= 2 && (
        <div className="absolute left-0 right-0 top-full mt-1 z-50 max-h-72 overflow-y-auto rounded-xl border border-gray-200 bg-white shadow-lg">
          {hits.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-gray-400">
              {loading ? '검색 중...' : '결과가 없어요. 다른 단어로 검색해주세요'}
            </div>
          ) : (
            <ul className="py-1">
              {hits.map(h => {
                const key = `${h.sido}|${h.sigungu}|${h.dong}`
                const already = selectedKeys?.has(key)
                return (
                  <li key={key}>
                    <button
                      type="button"
                      disabled={already}
                      onClick={() => {
                        onPick({ sido: h.sido, sigungu: h.sigungu, dong: h.dong })
                        setQ('')
                        setHits([])
                        setOpen(false)
                      }}
                      className={`flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm transition-colors ${
                        already
                          ? 'text-gray-300 cursor-not-allowed'
                          : 'text-gray-800 hover:bg-blue-50 hover:text-blue-700'
                      }`}
                    >
                      <MapPin className="h-3.5 w-3.5 flex-shrink-0 text-gray-400" />
                      <span className="flex-1">{h.label}</span>
                      {already && <Check className="h-4 w-4 text-gray-300" />}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
