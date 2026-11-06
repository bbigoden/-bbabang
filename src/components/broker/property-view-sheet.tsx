'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, ListPlus, MapPin, X } from 'lucide-react'

/** 폰에서 매물 하나를 펼쳐 보는 창에 필요한 칸만 */
export interface PropertyView {
  seq_no: number | null
  address: string
  deal_type: string
  room_type: string
  status: 'available' | 'contracted' | 'hidden'
  price: number
  monthly_rent: number | null
  management_fee: number | null
  premium: number | null
  size_pyeong: string | null
  area_unit?: string | null
  area_supplied: number | null
  floor: number | null
  total_floors: string | null
  move_in_date: string | null
  rooms_bathrooms: string | null
  approval_date: string | null
  parking: string | null
  direction: string | null
  brief_memo: string | null
  memo: string | null
  assignee: string | null
  received_date: string | null
  images: string[]
}

// 0 은 '아직 안 적음'(새 줄 기본값)이다 — '0만 / —' 처럼 0원으로 읽혔다(10-30 재점검)
const 만 = (n: number | null | undefined) => (n ? `${n.toLocaleString('ko-KR')}만` : null)
const STATUS_LABEL = { available: '거래가능', contracted: '계약완료', hidden: '숨김' } as const

/**
 * 폰에서 매물 한 건을 위아래로 읽는 창.
 *
 * 매물목록은 12칸 넘는 표라 375px 폰에서는 3칸만 보이고, 칸을 누르면 편집칸이 열린다 —
 * 매물 하나의 정보를 보려면 표를 옆으로 훑어야 했다(10-30 점검 모바일 사용자). 읽기만 하는 창이다.
 */
export function PropertyViewSheet({ p, memoVisible, onClose, onLocation, onAddToList }: {
  p: PropertyView; memoVisible: boolean; onClose: () => void
  /** [입지 보기] — 표의 액션 칸이 폰에선 오른쪽 끝이라 이 창에도 둔다 */
  onLocation?: () => void
  /** [리스트에 담기] — 폰에선 번호 칸에 [보기]·[담기] 둘이면 줄이 높아져 담기는 이 창에만 둔다(11-06) */
  onAddToList?: () => void
}) {
  // 사진을 누르면 화면 가득 크게 — 작은 썸네일로는 안이 안 보였다(11-05)
  const [zoom, setZoom] = useState<number | null>(null)
  const n = p.images?.length ?? 0
  const step = useCallback((d: number) => setZoom(z => (z == null ? z : (z + d + n) % n)), [n])
  // Esc 로 닫기 — 열린 채로는 표의 다른 버튼이 안 눌려 갇힌 느낌이었다. 사진이 열려 있으면 사진만 닫는다.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { if (zoom != null) setZoom(null); else onClose() }
      else if (zoom != null && e.key === 'ArrowLeft') step(-1)
      else if (zoom != null && e.key === 'ArrowRight') step(1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, zoom, step])
  const touchX = useRef<number | null>(null)
  const price = p.deal_type === '월세'
    ? (만(p.price) || 만(p.monthly_rent) ? `${만(p.price) ?? '—'} / ${만(p.monthly_rent) ?? '—'}` : null)
    : 만(p.price)
  // 단위가 없어 평인지 ㎡인지 몰랐다(11-06 점검) — 저장된 단위(지금은 전부 평)를 붙인다
  const unit = p.area_unit || '평'
  const area = [p.size_pyeong ? `전용 ${p.size_pyeong}${unit}` : null, p.area_supplied ? `공급 ${p.area_supplied}${unit}` : null].filter(Boolean).join(' · ')
  const floor = [p.floor != null ? `${p.floor}층` : null, p.total_floors ? `총 ${p.total_floors}층` : null].filter(Boolean).join(' / ')
  const rows: [string, string | null][] = [
    ['거래형태', p.deal_type || null],
    ['가격', price],
    ['권리금', 만(p.premium)],
    ['관리비', 만(p.management_fee)],
    ['종류', p.room_type || null],
    ['면적', area || null],
    ['층', floor || null],
    ['입주가능일', p.move_in_date],
    ['방수/욕실수', p.rooms_bathrooms],
    ['사용승인일', p.approval_date],
    ['주차', p.parking],
    ['방향', p.direction],
    ['담당자', p.assignee],
    ['접수일자', p.received_date],
  ]
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 sm:items-center" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="매물 보기" onClick={e => e.stopPropagation()}
        className="max-h-[85vh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:max-w-md sm:rounded-2xl dark:bg-gray-900">
        <div className="mb-3 flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-xs text-gray-500">#{p.seq_no ?? ''} · {STATUS_LABEL[p.status]}</p>
            <h3 className="break-words text-base font-bold text-gray-900 dark:text-white">{p.address || '소재지 없음'}</h3>
          </div>
          <button type="button" onClick={onClose} aria-label="닫기" className="-m-2 rounded-lg p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800">
            <X className="h-5 w-5" />
          </button>
        </div>
        {p.images?.length > 0 && (
          <div className="mb-3 flex gap-2 overflow-x-auto">
            {p.images.map((src, i) => (
              <button key={src} type="button" onClick={() => setZoom(i)} aria-label={`사진 ${i + 1} 크게 보기`} className="shrink-0 select-none">
                <img src={src} alt="매물 사진" loading="lazy" className="h-24 w-32 rounded-lg object-cover" />
              </button>
            ))}
          </div>
        )}
        {zoom != null && n > 0 && (
          <div className="fixed inset-0 z-[60] flex select-none items-center justify-center bg-black/95" onClick={() => setZoom(null)}
            onTouchStart={e => { touchX.current = e.touches[0].clientX }}
            onTouchEnd={e => {
              const s = touchX.current; touchX.current = null
              if (s == null || n < 2) return
              const dx = e.changedTouches[0].clientX - s
              if (Math.abs(dx) > 40) step(dx < 0 ? 1 : -1)
            }}>
            <img src={p.images[zoom]} alt={`매물 사진 ${zoom + 1}`} onClick={e => e.stopPropagation()} className="max-h-full max-w-full object-contain" />
            <button type="button" onClick={() => setZoom(null)} aria-label="사진 닫기" className="absolute right-3 top-3 rounded-full bg-black/50 p-2 text-white">
              <X className="h-6 w-6" />
            </button>
            {n > 1 && (
              <>
                <button type="button" onClick={e => { e.stopPropagation(); step(-1) }} aria-label="이전 사진" className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white">
                  <ChevronLeft className="h-6 w-6" />
                </button>
                <button type="button" onClick={e => { e.stopPropagation(); step(1) }} aria-label="다음 사진" className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white">
                  <ChevronRight className="h-6 w-6" />
                </button>
                <p className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/50 px-3 py-1 text-sm text-white">{zoom + 1} / {n}</p>
              </>
            )}
          </div>
        )}
        <dl className="grid grid-cols-[6.5rem_1fr] gap-x-3 gap-y-2 text-sm">
          {rows.filter(([, v]) => v).map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-gray-500">{k}</dt>
              <dd className="break-words text-gray-900 dark:text-gray-100">{v}</dd>
            </div>
          ))}
        </dl>
        {p.brief_memo && (
          <div className="mt-4">
            <p className="mb-1 text-xs font-semibold text-gray-500">매물설명</p>
            <p className="whitespace-pre-wrap break-words text-sm text-gray-800 dark:text-gray-200">{p.brief_memo}</p>
          </div>
        )}
        {memoVisible && p.memo && (
          <div className="mt-4">
            <p className="mb-1 text-xs font-semibold text-gray-500">중개사메모 (나에게만 보임)</p>
            <p className="whitespace-pre-wrap break-words text-sm text-gray-800 dark:text-gray-200">{p.memo}</p>
          </div>
        )}
        {onLocation && (
          <button type="button" onClick={onLocation}
            className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-lg border border-gray-200 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800">
            <MapPin className="h-4 w-4" />입지 보기 (용도지역·토지·IC 거리)
          </button>
        )}
        {onAddToList && (
          <button type="button" onClick={onAddToList}
            className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg bg-blue-600 py-2 text-sm font-semibold text-white hover:bg-blue-700">
            <ListPlus className="h-4 w-4" />리스트에 담기
          </button>
        )}
        <p className="mt-4 text-xs text-gray-400">고치려면 창을 닫고 표의 칸을 누르세요.</p>
      </div>
    </div>
  )
}
