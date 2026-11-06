'use client'

import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, Check, Copy, Pencil, Plus, Trash2, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { getOfficeMembers } from '@/lib/office-members'
import { useToast } from '@/components/toast'
import { useEscape } from '@/lib/use-escape'
import { PropertyViewSheet, type PropertyView } from '@/components/broker/property-view-sheet'

// [보기] 창에 필요한 칸 + 메모 열람 판정용 broker_id
const VIEW_COLS = 'broker_id, seq_no, address, deal_type, room_type, status, price, monthly_rent, management_fee, premium, size_pyeong, area_unit, area_supplied, floor, total_floors, move_in_date, rooms_bathrooms, approval_date, parking, direction, brief_memo, memo, assignee, received_date, images'

/**
 * 매물 리스트 (2026-11-06)
 *
 * 이사가 손님 미팅에 가면서 자기 매물과 직원들이 보내 준 매물을 하나하나 모아 갔다.
 * 누가 리스트를 만들어 두면 사무소 사람 누구나 매물목록 줄의 [담기] 로 거기에 보낸다.
 * 리스트 이름·삭제는 만든 사람과 대표·이사만(DB 정책 property_lists_20261106.sql).
 */

interface ListRow { id: string; name: string; created_by: string; created_at: string; count: number }
interface ItemRow {
  property_id: string
  added_by: string
  p: {
    seq_no: number | null; address: string; deal_type: string; room_type: string
    price: number | null; monthly_rent: number | null; size_pyeong: string | null
    area_unit: string | null; floor: number | null; status: string; deleted_at: string | null
  } | null
}

async function loadLists(officeId: string): Promise<ListRow[]> {
  const { data, error } = await createClient().from('property_lists')
    .select('id, name, created_by, created_at, property_list_items(count)')
    .eq('office_broker_id', officeId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return ((data ?? []) as unknown as (Omit<ListRow, 'count'> & { property_list_items: { count: number }[] })[])
    .map(r => ({ id: r.id, name: r.name, created_by: r.created_by, created_at: r.created_at, count: r.property_list_items?.[0]?.count ?? 0 }))
}

/**
 * 재직자(대표 + 승인된 직원)만. 사무소를 탈퇴한 직원은 parent 가 비어 여기 안 잡힌다 —
 * 그 사람 리스트는 화면에서 빠진다(사장님 11-06: 퇴직자는 필요 없고 기록도 안 남겨도 됨).
 */
function useMembers(officeId: string | null) {
  const [members, setMembers] = useState<{ id: string; name: string }[] | null>(null)
  useEffect(() => {
    if (!officeId) return
    getOfficeMembers(officeId).then(
      ms => setMembers(ms.filter(m => m.approved).map(m => ({ id: m.id, name: m.name || '이름 없음' }))),
      () => setMembers([]),
    )
  }, [officeId])
  const names: Record<string, string> = Object.fromEntries((members ?? []).map(m => [m.id, m.name]))
  return { members, names }
}

function Sheet({ label, onClose, paused, children }: {
  label: string; onClose: () => void; children: React.ReactNode
  /** 위에 [보기] 창이 떠 있으면 Esc 는 그 창만 닫는다 */
  paused?: boolean
}) {
  useEscape(!paused, onClose)
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 sm:items-center" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={label} onClick={e => e.stopPropagation()}
        className="flex max-h-[85vh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl sm:max-w-md sm:rounded-2xl dark:bg-gray-900">
        {children}
      </div>
    </div>
  )
}

function SheetHead({ title, sub, onClose, onBack }: { title: string; sub?: string; onClose: () => void; onBack?: () => void }) {
  return (
    <div className="flex items-start gap-2 border-b border-gray-100 px-4 py-3 dark:border-gray-800">
      {onBack && (
        <button type="button" onClick={onBack} aria-label="뒤로" className="-m-1.5 rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800">
          <ArrowLeft className="h-5 w-5" />
        </button>
      )}
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-base font-bold text-gray-900 dark:text-white">{title}</h3>
        {sub && <p className="mt-0.5 truncate text-xs text-gray-500">{sub}</p>}
      </div>
      <button type="button" onClick={onClose} aria-label="닫기" className="-m-1.5 rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800">
        <X className="h-5 w-5" />
      </button>
    </div>
  )
}

/**
 * 새 리스트 이름 칸 — 담기 창과 리스트 창이 같이 쓴다.
 * owner = 누구 리스트로 만들지. 대표·이사가 드롭다운에서 직원을 골랐으면 그 직원 것(11-06 — 대표 것으로 만들어졌다).
 */
function NewListForm({ officeId, owner, ownerName, onMade }: {
  officeId: string; owner: string
  /** 남의 이름으로 만들 때만 — 칸 안내에 'OO님 리스트' 로 보인다 */
  ownerName?: string
  onMade: (l: ListRow) => void
}) {
  const toast = useToast()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const n = name.trim()
    if (!n || busy) return
    setBusy(true)
    const { data, error } = await createClient().from('property_lists')
      .insert({ office_broker_id: officeId, created_by: owner, name: n.slice(0, 40) })
      .select('id, name, created_by, created_at').single()
    setBusy(false)
    if (error || !data) { toast.error('리스트를 만들지 못했어요'); return }
    setName('')
    onMade({ ...(data as Omit<ListRow, 'count'>), count: 0 })
  }
  return (
    <form onSubmit={submit} className="flex gap-2">
      <input value={name} onChange={e => setName(e.target.value)} maxLength={40}
        placeholder={ownerName ? `${ownerName}님 새 리스트 이름` : '새 리스트 이름 (예: 11/7 김사장님 미팅)'} aria-label="새 리스트 이름"
        className="min-w-0 flex-1 rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-400/20 dark:border-gray-800 dark:bg-gray-950" />
      <button type="submit" disabled={!name.trim() || busy}
        className="flex shrink-0 items-center gap-1 rounded-xl bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-40">
        <Plus className="h-4 w-4" />만들기
      </button>
    </form>
  )
}

/**
 * 매물 한 건을 리스트에 담는 창 — 줄의 [담기].
 * 리스트를 누르면 바로 담기고, 이미 담긴 리스트를 다시 누르면 뺀다.
 */
export function AddToListSheet({ officeId, selfId, canManage, property, onClose }: {
  officeId: string; selfId: string
  /** 대표·이사 — 남의 리스트 건수도 다 보인다. 아니면 '내가 담은 n건' */
  canManage: boolean
  property: { id: string; seq_no: number | null; address: string }
  onClose: () => void
}) {
  const toast = useToast()
  const { members, names } = useMembers(officeId)
  const [lists, setLists] = useState<ListRow[] | null>(null)
  const [inList, setInList] = useState<Set<string>>(new Set())
  const [busyId, setBusyId] = useState<string | null>(null)
  const [who, setWho] = useState(selfId)  // 드롭다운 — 누구 리스트에 보낼지
  const counts: Record<string, number> = {}
  for (const l of lists ?? []) counts[l.created_by] = (counts[l.created_by] ?? 0) + 1
  const shown = (lists ?? []).filter(l => l.created_by === who)

  useEffect(() => {
    let alive = true
    const supabase = createClient()
    Promise.all([
      loadLists(officeId),
      supabase.from('property_list_items').select('list_id').eq('property_id', property.id),
    ]).then(([ls, its]) => {
      if (!alive) return
      setLists(ls)
      setInList(new Set(((its.data ?? []) as { list_id: string }[]).map(r => r.list_id)))
    }, () => { if (alive) { setLists([]); toast.error('리스트를 불러오지 못했어요') } })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [officeId, property.id])

  const toggle = async (l: ListRow) => {
    if (busyId) return
    setBusyId(l.id)
    const supabase = createClient()
    const has = inList.has(l.id)
    if (has) {
      const { data, error } = await supabase.from('property_list_items').delete()
        .eq('list_id', l.id).eq('property_id', property.id).select('list_id')
      setBusyId(null)
      if (error || !data?.length) { toast.error('뺄 권한이 없어요 — 담은 사람이나 리스트 만든 사람만 뺄 수 있어요'); return }
      setInList(s => { const n = new Set(s); n.delete(l.id); return n })
      setLists(ls => ls?.map(x => x.id === l.id ? { ...x, count: Math.max(0, x.count - 1) } : x) ?? ls)
      toast.info(`'${l.name}' 에서 뺐어요`)
    } else {
      const { error } = await supabase.from('property_list_items')
        .insert({ list_id: l.id, property_id: property.id, added_by: selfId })
      setBusyId(null)
      // 23505 = 다른 사람이 이미 담아 둔 매물(남이 담은 줄은 안 보여 체크가 비어 있었다)
      if (error && error.code !== '23505') { toast.error('담지 못했어요'); return }
      if (error) { setInList(s => new Set(s).add(l.id)); toast.info(`'${l.name}' 에 이미 담겨 있어요`); return }
      setInList(s => new Set(s).add(l.id))
      setLists(ls => ls?.map(x => x.id === l.id ? { ...x, count: x.count + 1 } : x) ?? ls)
      toast.success(`'${l.name}' 에 담았어요`)
    }
  }

  return (
    <Sheet label="리스트에 담기" onClose={onClose}>
      <SheetHead title="리스트에 담기" sub={`#${property.seq_no ?? ''} ${property.address}`} onClose={onClose} />
      <div className="space-y-2 border-b border-gray-100 px-4 py-3 dark:border-gray-800">
        {/* 누구 리스트에 보낼지 — 재직자만. 나를 고르면 새 리스트도 만들 수 있다 */}
        <select value={who} onChange={e => setWho(e.target.value)} aria-label="누구 리스트에 담을지"
          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-400/20 dark:border-gray-800 dark:bg-gray-950">
          {(members ?? []).map(m => (
            <option key={m.id} value={m.id}>{m.id === selfId ? `${m.name} (나)` : m.name} 리스트{counts[m.id] ? ` · ${counts[m.id]}개` : ''}</option>
          ))}
        </select>
        {(who === selfId || canManage) && (
          <NewListForm officeId={officeId} owner={who} ownerName={who === selfId ? undefined : names[who]} onMade={async l => {
            setLists(ls => [l, ...(ls ?? [])])
            await toggle(l)
          }} />
        )}
      </div>
      <div className="flex-1 overflow-y-auto">
        {lists == null || members == null ? <p className="py-8 text-center text-sm text-gray-500">불러오는 중…</p>
          : shown.length === 0 ? <p className="py-8 text-center text-sm text-gray-500">
              {who === selfId ? '아직 내 리스트가 없어요. 위에서 하나 만들어 담으세요.' : `${names[who] ?? ''}님이 만든 리스트가 없어요.`}
            </p>
          : shown.map(l => {
            const on = inList.has(l.id)
            return (
              <button key={l.id} type="button" onClick={() => toggle(l)} disabled={busyId === l.id}
                className="flex w-full items-center gap-3 border-b border-gray-50 px-4 py-3 text-left hover:bg-gray-50 disabled:opacity-50 dark:border-gray-800 dark:hover:bg-gray-800">
                <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${on ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-300 dark:border-gray-700'}`}>
                  {on && <Check className="h-3.5 w-3.5" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-gray-900 dark:text-white">{l.name}</span>
                  <span className="block text-xs text-gray-500">
                    {canManage || l.created_by === selfId ? `${l.count}건` : `내가 담은 ${l.count}건`}
                  </span>
                </span>
              </button>
            )
          })}
      </div>
      <div className="border-t border-gray-100 p-3 dark:border-gray-800">
        <button type="button" onClick={onClose} className="w-full rounded-xl bg-gray-900 py-2.5 text-sm font-semibold text-white dark:bg-gray-700">완료</button>
      </div>
    </Sheet>
  )
}

const 만 = (n: number | null | undefined) => (n ? `${n.toLocaleString('ko-KR')}만` : null)
function priceText(p: NonNullable<ItemRow['p']>) {
  if (p.deal_type === '월세') return `${만(p.price) ?? '—'}/${만(p.monthly_rent) ?? '—'}`
  return 만(p.price) ?? '—'
}
/** 손님에게 보내는 글엔 읍·면·동·리까지만(매물목록 소재지 칸 안내와 같은 규칙) */
export function shortAddress(addr: string) {
  const parts = addr.trim().split(/\s+/)
  let last = -1
  parts.forEach((w, i) => { if (/[읍면동리가]$/.test(w) && !/^\d/.test(w)) last = i })
  const kept = last >= 0 ? parts.slice(0, last + 1) : parts.slice(0, 3)
  return kept.filter(w => !/^(충청남도|충남|충청북도|충북|경기도|경기)$/.test(w)).join(' ')
}
function copyText(name: string, items: ItemRow[]) {
  const lines = items.filter(i => i.p && !i.p.deleted_at).map((i, n) => {
    const p = i.p!
    const area = p.size_pyeong ? `${p.size_pyeong}${p.area_unit || '평'}` : null
    const floor = p.floor != null ? `${p.floor}층` : null
    return `${n + 1}. ${shortAddress(p.address)} · ${p.room_type} · ${p.deal_type} ${priceText(p)}${area ? ` · ${area}` : ''}${floor ? ` · ${floor}` : ''}`
  })
  return [`[${name}]`, ...lines].join('\n')
}

/** 상단 [리스트] — 리스트들을 보고, 하나를 열어 담긴 매물을 확인·빼기·복사 */
export function PropertyListsSheet({ officeId, selfId, canManage, onClose, canSeeMemo }: {
  officeId: string; selfId: string
  /** 대표·이사 — 남이 만든 리스트도 지우고 뺄 수 있다 */
  canManage: boolean
  onClose: () => void
  /** 담긴 매물을 누르면 그 자리에서 [보기] 창 — 중개사메모를 보여도 되는지(매물목록과 같은 규칙) */
  canSeeMemo: (p: { broker_id: string; assignee: string | null }) => boolean
}) {
  const toast = useToast()
  const { members, names } = useMembers(officeId)
  const [lists, setLists] = useState<ListRow[] | null>(null)
  const [open, setOpen] = useState<ListRow | null>(null)
  const [items, setItems] = useState<ItemRow[] | null>(null)
  const [who, setWho] = useState('')  // 대표·이사 드롭다운 — '' 는 전체
  // 퇴직자 리스트는 뺀다 — 재직자 목록에 없는 사람이 만든 것
  const shown = (lists ?? []).filter(l => names[l.created_by] !== undefined && (!who || l.created_by === who))

  useEffect(() => {
    let alive = true
    // 담긴 내용은 만든 사람과 대표·이사만 본다 — 남의 리스트는 [담기] 창에서 이름만 보인다
    loadLists(officeId).then(ls => { if (alive) setLists(canManage ? ls : ls.filter(l => l.created_by === selfId)) }, () => { if (alive) { setLists([]); toast.error('리스트를 불러오지 못했어요') } })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [officeId])

  const openList = useCallback(async (l: ListRow) => {
    setOpen(l); setItems(null)
    const { data, error } = await createClient().from('property_list_items')
      .select('property_id, added_by, p:broker_properties(seq_no, address, deal_type, room_type, price, monthly_rent, size_pyeong, area_unit, floor, status, deleted_at)')
      .eq('list_id', l.id).order('added_at', { ascending: true })
    if (error) { toast.error('매물을 불러오지 못했어요'); setItems([]); return }
    setItems((data ?? []) as unknown as ItemRow[])
  }, [toast])

  const mayEdit = (l: ListRow) => canManage || l.created_by === selfId

  // 담긴 매물 [보기] — 매물목록으로 갔다가 보기를 또 누르고 돌아오는 왕복을 없앤다(11-06). 닫으면 리스트 그대로.
  const [viewing, setViewing] = useState<{ p: PropertyView; memoVisible: boolean } | null>(null)
  const viewItem = async (it: ItemRow) => {
    const { data, error } = await createClient().from('broker_properties').select(VIEW_COLS).eq('id', it.property_id).single()
    if (error || !data) { toast.error('매물을 불러오지 못했어요'); return }
    const row = data as unknown as PropertyView & { broker_id: string }
    setViewing({ p: { ...row, images: row.images ?? [] }, memoVisible: canSeeMemo(row) })
  }

  const removeItem = async (it: ItemRow) => {
    if (!open) return
    const { data, error } = await createClient().from('property_list_items').delete()
      .eq('list_id', open.id).eq('property_id', it.property_id).select('list_id')
    if (error || !data?.length) { toast.error('뺄 권한이 없어요 — 담은 사람이나 리스트 만든 사람만 뺄 수 있어요'); return }
    setItems(xs => xs?.filter(x => x.property_id !== it.property_id) ?? xs)
    setLists(ls => ls?.map(x => x.id === open.id ? { ...x, count: Math.max(0, x.count - 1) } : x) ?? ls)
  }

  const deleteList = async (l: ListRow) => {
    if (!confirm(`'${l.name}' 리스트를 지울까요? 담긴 매물은 매물목록에 그대로 남습니다.`)) return
    const { data, error } = await createClient().from('property_lists').delete().eq('id', l.id).select('id')
    if (error || !data?.length) { toast.error('지울 권한이 없어요 — 만든 사람이나 대표·이사만 지울 수 있어요'); return }
    setLists(ls => ls?.filter(x => x.id !== l.id) ?? ls)
    setOpen(null)
    toast.info('리스트를 지웠어요')
  }

  // 이름 바꾸기 — 만든 사람과 대표·이사(DB 정책 property_lists_update)
  const renameList = async (l: ListRow) => {
    const next = prompt('리스트 이름', l.name)?.trim().slice(0, 40)
    if (!next || next === l.name) return
    const { data, error } = await createClient().from('property_lists').update({ name: next }).eq('id', l.id).select('id')
    if (error || !data?.length) { toast.error('이름을 바꿀 권한이 없어요 — 만든 사람이나 대표·이사만 바꿀 수 있어요'); return }
    setLists(ls => ls?.map(x => x.id === l.id ? { ...x, name: next } : x) ?? ls)
    setOpen(o => o && o.id === l.id ? { ...o, name: next } : o)
    toast.success('이름을 바꿨어요')
  }

  const copy = async () => {
    if (!open || !items) return
    try {
      await navigator.clipboard.writeText(copyText(open.name, items))
      toast.success('복사했어요 — 카톡에 붙여 넣으세요')
    } catch { toast.error('복사하지 못했어요') }
  }

  if (open) {
    return (
      <>
      <Sheet label={open.name} onClose={onClose} paused={!!viewing}>
        <SheetHead title={open.name} sub={`${names[open.created_by] || '—'} 만듦 · ${items?.length ?? open.count}건`} onClose={onClose} onBack={() => setOpen(null)} />
        <div className="flex-1 overflow-y-auto">
          {items == null ? <p className="py-8 text-center text-sm text-gray-500">불러오는 중…</p>
            : items.length === 0 ? <p className="py-8 text-center text-sm text-gray-500">담긴 매물이 없어요. 매물목록 번호 칸의 [담기] 로 보내세요.</p>
            : items.map(it => {
              const p = it.p
              const canRemove = mayEdit(open) || it.added_by === selfId
              return (
                <div key={it.property_id} className="flex items-start gap-3 border-b border-gray-50 px-4 py-3 dark:border-gray-800">
                  <button type="button" disabled={!p || !!p.deleted_at} onClick={() => viewItem(it)} aria-label={`${p?.seq_no ?? ''}번 매물 보기`}
                    className="flex min-w-0 flex-1 items-start gap-3 text-left disabled:cursor-default">
                  <span className="w-12 shrink-0 rounded-md bg-gray-100 py-1 text-center text-xs font-semibold tabular-nums text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                    {p?.seq_no ?? '—'}
                  </span>
                  <div className="min-w-0 flex-1">
                    {!p || p.deleted_at ? <p className="text-sm text-gray-500">지워진 매물</p> : (
                      <>
                        <p className="break-words text-sm font-medium text-gray-900 dark:text-white">{p.address}</p>
                        <p className="mt-0.5 text-xs text-gray-500">
                          {p.room_type} · {p.deal_type} {priceText(p)}{p.size_pyeong ? ` · ${p.size_pyeong}${p.area_unit || '평'}` : ''}{p.floor != null ? ` · ${p.floor}층` : ''}
                          {p.status === 'contracted' && <span className="ml-1 font-semibold text-red-600">· 계약완료</span>}
                        </p>
                        <p className="mt-0.5 text-[11px] text-gray-400">{names[it.added_by] ?? '퇴직자'} 담음</p>
                      </>
                    )}
                  </div>
                  </button>
                  {canRemove && (
                    <button type="button" onClick={() => removeItem(it)} aria-label="리스트에서 빼기" title="리스트에서 빼기"
                      className="-m-1 shrink-0 rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-red-600 dark:hover:bg-gray-800">
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
              )
            })}
        </div>
        <div className="flex gap-2 border-t border-gray-100 p-3 dark:border-gray-800">
          {mayEdit(open) && (
            <button type="button" onClick={() => deleteList(open)} aria-label="리스트 지우기"
              className="flex items-center justify-center rounded-xl border border-gray-200 px-3 text-gray-500 hover:bg-red-50 hover:text-red-600 dark:border-gray-800">
              <Trash2 className="h-4 w-4" />
            </button>
          )}
          {mayEdit(open) && (
            <button type="button" onClick={() => renameList(open)} aria-label="리스트 이름 바꾸기" title="이름 바꾸기"
              className="flex items-center justify-center rounded-xl border border-gray-200 px-3 text-gray-500 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-800">
              <Pencil className="h-4 w-4" />
            </button>
          )}
          <button type="button" onClick={copy} disabled={!items?.length}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-40">
            <Copy className="h-4 w-4" />손님용 글 복사
          </button>
        </div>
      </Sheet>
      {/* 리스트 창 위에 겹쳐 뜬다(나중에 그려야 위) — 닫으면 리스트가 그대로 있다 */}
      {viewing && <PropertyViewSheet p={viewing.p} memoVisible={viewing.memoVisible} onClose={() => setViewing(null)} />}
      </>
    )
  }

  return (
    <Sheet label="매물 리스트" onClose={onClose}>
      <SheetHead title="매물 리스트" sub="미팅 전에 매물을 한 묶음으로 — 줄마다 [담기] 로 보냅니다" onClose={onClose} />
      <div className="space-y-2 border-b border-gray-100 px-4 py-3 dark:border-gray-800">
        {canManage && (
          <select value={who} onChange={e => setWho(e.target.value)} aria-label="누구 리스트를 볼지"
            className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-400/20 dark:border-gray-800 dark:bg-gray-950">
            <option value="">전체 재직자</option>
            {(members ?? []).map(m => <option key={m.id} value={m.id}>{m.id === selfId ? `${m.name} (나)` : m.name}</option>)}
          </select>
        )}
        {/* 드롭다운이 '전체' 면 내 리스트, 사람을 골랐으면 그 사람 리스트로 만든다 */}
        <NewListForm officeId={officeId} owner={who || selfId} ownerName={who && who !== selfId ? names[who] : undefined}
          onMade={l => { setLists(ls => [l, ...(ls ?? [])]); toast.success(`'${l.name}' 을 만들었어요`) }} />
      </div>
      <div className="flex-1 overflow-y-auto">
        {lists == null || members == null ? <p className="py-8 text-center text-sm text-gray-500">불러오는 중…</p>
          : shown.length === 0 ? <p className="py-8 text-center text-sm text-gray-500">아직 리스트가 없어요</p>
          : shown.map(l => (
            <button key={l.id} type="button" onClick={() => openList(l)}
              className="flex w-full items-center gap-3 border-b border-gray-50 px-4 py-3 text-left hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-800">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-gray-900 dark:text-white">{l.name}</span>
                <span className="block text-xs text-gray-500">{names[l.created_by] || '—'} 만듦</span>
              </span>
              <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold tabular-nums text-gray-600 dark:bg-gray-800 dark:text-gray-300">{l.count}건</span>
            </button>
          ))}
      </div>
    </Sheet>
  )
}
