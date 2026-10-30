'use client'

import { useEffect } from 'react'
import { X } from 'lucide-react'

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
export function PropertyViewSheet({ p, memoVisible, onClose }: { p: PropertyView; memoVisible: boolean; onClose: () => void }) {
  // Esc 로 닫기 — 열린 채로는 표의 다른 버튼이 안 눌려 갇힌 느낌이었다
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const price = p.deal_type === '월세'
    ? (만(p.price) || 만(p.monthly_rent) ? `${만(p.price) ?? '—'} / ${만(p.monthly_rent) ?? '—'}` : null)
    : 만(p.price)
  const area = [p.size_pyeong ? `전용 ${p.size_pyeong}` : null, p.area_supplied ? `공급 ${p.area_supplied}` : null].filter(Boolean).join(' · ')
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
            {p.images.map(src => <img key={src} src={src} alt="매물 사진" loading="lazy" className="h-24 w-32 shrink-0 rounded-lg object-cover" />)}
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
        <p className="mt-4 text-xs text-gray-400">고치려면 창을 닫고 표의 칸을 누르세요.</p>
      </div>
    </div>
  )
}
