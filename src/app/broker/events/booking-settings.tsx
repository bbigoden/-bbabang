'use client'

/**
 * 예약 링크 페이지 설정 — 링크 복사(인스타용·카톡용) + 상품·영업시간·쉬는 날 고치기.
 * 직원은 자기 페이지, 대표는 사무소의 페이지(시험 중엔 이예리 꽃집 하나)를 연다.
 */
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/components/toast'
import { Copy, Check, ExternalLink } from 'lucide-react'

interface PageRow {
  id: string; owner_broker_id: string; slug: string; title: string; intro: string | null
  products: { name: string; price: number | null }[]
  open_time: string; close_time: string; slot_minutes: number; closed_weekdays: number[]
  lead_hours: number; max_days: number; active: boolean
}
const WEEK = ['일', '월', '화', '수', '목', '금', '토']
const inp = 'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-white'

/** "꽃다발, 30000" 줄들 ↔ 상품 목록 */
const productsToText = (ps: PageRow['products']) => ps.map(p => (p.price != null ? `${p.name}, ${p.price}` : p.name)).join('\n')
function textToProducts(t: string): PageRow['products'] {
  return t.split('\n').map(l => l.trim()).filter(Boolean).slice(0, 30).map(l => {
    const m = l.match(/^(.*?)[,\s]+([\d,]+)\s*원?$/)
    if (m) return { name: m[1].trim().slice(0, 60), price: Number(m[2].replace(/,/g, '')) }
    return { name: l.slice(0, 60), price: null }
  })
}

export function BookingSettings({ officeId, myId, isOwner }: { officeId: string; myId: string; isOwner: boolean }) {
  const supabase = createClient()
  const toast = useToast()
  const [row, setRow] = useState<PageRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [copied, setCopied] = useState('')
  const [productText, setProductText] = useState('')

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.from('office_booking_pages').select('*').eq('office_broker_id', officeId)
      if (error) toast.error(`불러오기 실패: ${error.message}`)
      const list = (data ?? []) as PageRow[]
      const mine = list.find(p => p.owner_broker_id === myId) ?? (isOwner ? list[0] : undefined) ?? null
      setRow(mine)
      setProductText(mine ? productsToText(mine.products) : '')
      setLoading(false)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [officeId, myId])

  if (loading) return <p className="py-8 text-center text-sm text-gray-500">불러오는 중...</p>
  if (!row) return <p className="py-8 text-center text-sm text-gray-500">아직 예약 페이지가 없어요.</p>

  const base = `${window.location.origin}/b/${row.slug}`
  const links = [
    { key: 'insta', label: '인스타 프로필용', url: `${base}?from=insta` },
    { key: 'kakao', label: '카톡 채널용', url: `${base}?from=kakao` },
    { key: 'link', label: '그 밖(문자 등)', url: base },
  ]
  const copy = async (key: string, url: string) => {
    try { await navigator.clipboard.writeText(url) } catch { prompt('길게 눌러 복사하세요', url); return }
    setCopied(key); setTimeout(() => setCopied(c => (c === key ? '' : c)), 2000)
  }

  const save = async () => {
    if (!row.title.trim()) { toast.error('제목을 적어 주세요'); return }
    if (row.open_time.slice(0, 5) >= row.close_time.slice(0, 5)) { toast.error('마감 시간이 시작보다 늦어야 해요'); return }
    setSaving(true)
    const { error } = await supabase.from('office_booking_pages').update({
      title: row.title.trim(), intro: row.intro?.trim() || null, products: textToProducts(productText),
      open_time: row.open_time, close_time: row.close_time, slot_minutes: row.slot_minutes,
      closed_weekdays: row.closed_weekdays, lead_hours: row.lead_hours, max_days: row.max_days, active: row.active,
    }).eq('id', row.id)
    setSaving(false)
    if (error) { toast.error(`저장 실패: ${error.message}`); return }
    toast.success('예약 페이지를 고쳤어요')
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <p className="text-xs font-semibold text-gray-600 dark:text-gray-400">링크 — 붙인 곳에 따라 ‘들어온 곳’이 따로 잡혀요</p>
        {links.map(l => (
          <div key={l.key} className="flex items-center gap-2 rounded-lg border border-gray-200 p-2 dark:border-gray-700">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-gray-700 dark:text-gray-300">{l.label}</p>
              <p className="truncate text-xs text-gray-500">{l.url}</p>
            </div>
            <button onClick={() => copy(l.key, l.url)} className="flex shrink-0 items-center gap-1 rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs font-semibold text-gray-700 dark:border-gray-600 dark:text-gray-300">
              {copied === l.key ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}복사
            </button>
          </div>
        ))}
        <a href={base} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600"><ExternalLink className="h-3.5 w-3.5" />손님 화면 미리 보기</a>
      </div>

      <label className="flex items-center gap-2 text-sm font-semibold text-gray-800 dark:text-gray-200">
        <input type="checkbox" checked={row.active} onChange={e => setRow({ ...row, active: e.target.checked })} className="h-4 w-4" />
        예약 받기 켜기
      </label>
      <label className="block"><span className="mb-1 block text-xs font-semibold text-gray-600 dark:text-gray-400">제목</span>
        <input value={row.title} onChange={e => setRow({ ...row, title: e.target.value })} className={inp} /></label>
      <label className="block"><span className="mb-1 block text-xs font-semibold text-gray-600 dark:text-gray-400">안내 문구</span>
        <textarea rows={2} value={row.intro ?? ''} onChange={e => setRow({ ...row, intro: e.target.value })} className={inp} /></label>
      <label className="block"><span className="mb-1 block text-xs font-semibold text-gray-600 dark:text-gray-400">상품 — 한 줄에 하나, “이름, 가격” (가격 없으면 이름만)</span>
        <textarea rows={5} value={productText} onChange={e => setProductText(e.target.value)} className={`${inp} font-mono`} /></label>
      <div className="grid grid-cols-3 gap-2">
        <label className="block"><span className="mb-1 block text-xs font-semibold text-gray-600 dark:text-gray-400">시작</span>
          <input type="time" value={row.open_time.slice(0, 5)} onChange={e => setRow({ ...row, open_time: e.target.value })} className={inp} /></label>
        <label className="block"><span className="mb-1 block text-xs font-semibold text-gray-600 dark:text-gray-400">마감</span>
          <input type="time" value={row.close_time.slice(0, 5)} onChange={e => setRow({ ...row, close_time: e.target.value })} className={inp} /></label>
        <label className="block"><span className="mb-1 block text-xs font-semibold text-gray-600 dark:text-gray-400">간격</span>
          <select value={row.slot_minutes} onChange={e => setRow({ ...row, slot_minutes: Number(e.target.value) })} className={inp}>
            {[15, 30, 60, 120].map(n => <option key={n} value={n}>{n < 60 ? `${n}분` : `${n / 60}시간`}</option>)}
          </select></label>
      </div>
      <div>
        <span className="mb-1 block text-xs font-semibold text-gray-600 dark:text-gray-400">쉬는 요일</span>
        <div className="flex gap-1">
          {WEEK.map((w, i) => {
            const on = row.closed_weekdays.includes(i)
            return (
              <button key={w} type="button" onClick={() => setRow({ ...row, closed_weekdays: on ? row.closed_weekdays.filter(x => x !== i) : [...row.closed_weekdays, i].sort() })}
                className={`h-9 flex-1 rounded-lg border text-sm font-semibold ${on ? 'border-gray-700 bg-gray-700 text-white' : 'border-gray-300 text-gray-700 dark:border-gray-600 dark:text-gray-300'}`}>{w}</button>
            )
          })}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="block"><span className="mb-1 block text-xs font-semibold text-gray-600 dark:text-gray-400">지금부터 몇 시간 뒤부터</span>
          <input type="number" min={0} max={168} value={row.lead_hours} onChange={e => setRow({ ...row, lead_hours: Math.max(0, Math.min(168, Number(e.target.value) || 0)) })} className={inp} /></label>
        <label className="block"><span className="mb-1 block text-xs font-semibold text-gray-600 dark:text-gray-400">며칠 뒤까지</span>
          <input type="number" min={1} max={365} value={row.max_days} onChange={e => setRow({ ...row, max_days: Math.max(1, Math.min(365, Number(e.target.value) || 1)) })} className={inp} /></label>
      </div>
      <button onClick={save} disabled={saving} className="w-full rounded-lg bg-blue-600 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
        {saving ? '저장 중...' : '저장'}
      </button>
    </div>
  )
}
