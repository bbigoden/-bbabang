'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { CalendarClock, Check, ChevronRight, ClipboardList, Plus, Search, User, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { getOfficeMembers } from '@/lib/office-members'
import { useToast } from '@/components/toast'
import { useEscape } from '@/lib/use-escape'

/**
 * 미팅 리스트 (2026-11-06 개편)
 *
 * 이사가 손님 미팅에 가면서 자기 매물과 직원들이 보내 준 매물을 하나하나 모아 갔다.
 * 리스트 = 미팅 하나(날짜·손님·상태). 리스트를 한 번 '담는 중' 으로 골라 두면 매물목록 줄의
 * [담기] 한 번으로 바로 들어간다 — 담을 때마다 창을 열고 고르던 3~4번 누르기를 없앴다.
 * 이름은 사무소 모두에게 보이고(보낼 곳을 골라야 하니), 담긴 내용은 만든 사람과 대표·이사만 본다.
 * 권한은 DB 정책(property_lists_*.sql)이 지킨다.
 */

export interface MeetingList {
  id: string
  name: string
  created_by: string
  created_at: string
  meeting_at: string | null
  status: 'ready' | 'done'
  customer_id: string | null
  customer: { client_name: string | null; contact: string | null } | null
  count: number
}

const LIST_COLS = 'id, name, created_by, created_at, meeting_at, status, customer_id, customer:broker_customers(client_name, contact), property_list_items(count)'

type RawList = Omit<MeetingList, 'count'> & { property_list_items: { count: number }[] }
const toList = (r: RawList): MeetingList => {
  const { property_list_items, ...rest } = r
  return { ...rest, count: property_list_items?.[0]?.count ?? 0 }
}

export async function loadLists(officeId: string): Promise<MeetingList[]> {
  const { data, error } = await createClient().from('property_lists').select(LIST_COLS)
    .eq('office_broker_id', officeId).order('created_at', { ascending: false })
  if (error) throw error
  return ((data ?? []) as unknown as RawList[]).map(toList)
}

export async function loadList(id: string): Promise<MeetingList | null> {
  const { data } = await createClient().from('property_lists').select(LIST_COLS).eq('id', id).maybeSingle()
  return data ? toList(data as unknown as RawList) : null
}

/** 준비중 먼저(미팅 가까운 순), 끝난 건 뒤로(최근 순) */
export function sortLists(ls: MeetingList[]) {
  const t = (l: MeetingList) => (l.meeting_at ? Date.parse(l.meeting_at) : Number.MAX_SAFE_INTEGER)
  return [...ls].sort((a, b) => {
    if (a.status !== b.status) return a.status === 'ready' ? -1 : 1
    return a.status === 'ready' ? t(a) - t(b) : t(b) - t(a)
  })
}

/** '11/7(금) 오후 2:00' — 한국 시각 */
export function meetingLabel(iso: string | null) {
  if (!iso) return null
  const d = new Date(iso)
  const p = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', weekday: 'short', hour: 'numeric', minute: '2-digit' })
    .formatToParts(d)
  const g = (k: string) => p.find(x => x.type === k)?.value ?? ''
  return `${g('month')}/${g('day')}(${g('weekday')}) ${g('dayPeriod')} ${g('hour')}:${g('minute')}`
}

/** datetime-local 칸 값('2026-11-07T14:00') ↔ 저장값. 한국 시각으로 읽고 쓴다 */
function toLocalInput(iso: string | null) {
  if (!iso) return ''
  const s = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(iso))
  return s.replace(' ', 'T')
}
const fromLocalInput = (v: string) => (v ? new Date(`${v}:00+09:00`).toISOString() : null)

/**
 * 재직자(대표 + 승인된 직원)만. 사무소를 탈퇴한 직원은 parent 가 비어 여기 안 잡힌다 —
 * 그 사람 리스트는 화면에서 빠진다(사장님 11-06: 퇴직자는 필요 없고 기록도 안 남겨도 됨).
 */
export function useMembers(officeId: string | null) {
  const [members, setMembers] = useState<{ id: string; name: string; isOwner: boolean }[] | null>(null)
  useEffect(() => {
    if (!officeId) return
    getOfficeMembers(officeId).then(
      ms => setMembers(ms.filter(m => m.approved).map(m => ({ id: m.id, name: m.name || '이름 없음', isOwner: m.isOwner }))),
      () => setMembers([]),
    )
  }, [officeId])
  const names: Record<string, string> = Object.fromEntries((members ?? []).map(m => [m.id, m.name]))
  return { members, names }
}

// ── 담는 중 리스트 — 이 기기에서만 기억한다(사람마다·기기마다 다를 수 있는 편의) ──
const activeKey = (brokerId: string) => `busojang_active_list_v1:${brokerId}`
const ACTIVE_EVENT = 'busojang-active-list'

export function setActiveListId(brokerId: string, id: string | null) {
  try {
    if (id) localStorage.setItem(activeKey(brokerId), id)
    else localStorage.removeItem(activeKey(brokerId))
  } catch { /* 저장소가 막힌 창 — 이번 화면에서만 기억 */ }
  window.dispatchEvent(new CustomEvent(ACTIVE_EVENT, { detail: { brokerId, id } }))
}

export function useActiveListId(brokerId: string | null | undefined): [string | null, (id: string | null) => void] {
  const [id, setId] = useState<string | null>(null)
  useEffect(() => {
    if (!brokerId) return
    try { setId(localStorage.getItem(activeKey(brokerId))) } catch { setId(null) }
    const on = (e: Event) => {
      const d = (e as CustomEvent<{ brokerId: string; id: string | null }>).detail
      if (d?.brokerId === brokerId) setId(d.id)
    }
    window.addEventListener(ACTIVE_EVENT, on)
    return () => window.removeEventListener(ACTIVE_EVENT, on)
  }, [brokerId])
  const set = useCallback((next: string | null) => { if (brokerId) setActiveListId(brokerId, next) }, [brokerId])
  return [id, set]
}

// ── 창 틀 ──
export function Sheet({ label, onClose, paused, children }: {
  label: string; onClose: () => void; children: React.ReactNode
  /** 위에 다른 창이 떠 있으면 Esc 는 그 창만 닫는다 */
  paused?: boolean
}) {
  useEscape(!paused, onClose)
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 sm:items-center" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={label} onClick={e => e.stopPropagation()}
        className="flex max-h-[88vh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl sm:max-w-md sm:rounded-2xl dark:bg-gray-900">
        {children}
      </div>
    </div>
  )
}

export function SheetHead({ title, sub, onClose }: { title: string; sub?: string; onClose: () => void }) {
  return (
    <div className="flex items-start gap-2 border-b border-gray-100 px-5 py-4 dark:border-gray-800">
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

/** 사람 칩 — 전체/나/재직자. allLabel 을 주면 맨 앞에 '전체' */
export function MemberChips({ members, selfId, value, onChange, allLabel }: {
  members: { id: string; name: string }[]; selfId: string; value: string; onChange: (id: string) => void; allLabel?: string
}) {
  const me = members.find(m => m.id === selfId)
  const others = members.filter(m => m.id !== selfId)
  const chip = (id: string, label: string) => (
    <button key={id || 'all'} type="button" onClick={() => onChange(id)} aria-pressed={value === id}
      className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${value === id
        ? 'border-blue-600 bg-blue-600 text-white'
        : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800'}`}>
      {label}
    </button>
  )
  return (
    <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5">
      {allLabel !== undefined && chip('', allLabel)}
      {me && chip(me.id, '나')}
      {others.map(m => chip(m.id, m.name))}
    </div>
  )
}

/** 손님 고르기 — 고객목록에서 이름·연락처·요청으로 찾는다 */
function CustomerPick({ officeId, value, onChange }: {
  officeId: string
  value: { id: string; label: string } | null
  onChange: (v: { id: string; label: string } | null) => void
}) {
  const [q, setQ] = useState('')
  const [rows, setRows] = useState<{ id: string; client_name: string | null; contact: string | null; request: string | null }[]>([])
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open) return
    let alive = true
    const t = setTimeout(async () => {
      let qb = createClient().from('broker_customers').select('id, client_name, contact, request').eq('office_broker_id', officeId)
      const w = q.trim().replace(/[,()%]/g, ' ').trim()
      if (w) qb = qb.or(`client_name.ilike.%${w}%,contact.ilike.%${w}%,request.ilike.%${w}%`)
      const { data } = await qb.order('created_at', { ascending: false }).limit(20)
      if (alive) setRows((data ?? []) as typeof rows)
    }, q ? 250 : 0)
    return () => { alive = false; clearTimeout(t) }
  }, [q, open, officeId])

  if (value) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-gray-200 px-3 py-2 text-sm dark:border-gray-800">
        <User className="h-4 w-4 shrink-0 text-gray-400" />
        <span className="min-w-0 flex-1 truncate">{value.label}</span>
        <button type="button" onClick={() => onChange(null)} aria-label="손님 빼기" className="text-gray-400 hover:text-gray-600"><X className="h-4 w-4" /></button>
      </div>
    )
  }
  return (
    <div>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <input value={q} onChange={e => setQ(e.target.value)} onFocus={() => setOpen(true)}
          placeholder="고객목록에서 찾기 (이름·연락처·요청)" aria-label="손님 찾기"
          className="w-full rounded-xl border border-gray-200 py-2 pl-9 pr-3 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-400/20 dark:border-gray-800 dark:bg-gray-950" />
      </div>
      {open && (
        <div className="mt-1 max-h-44 overflow-y-auto rounded-xl border border-gray-100 dark:border-gray-800">
          {rows.length === 0 ? <p className="px-3 py-3 text-xs text-gray-500">맞는 고객이 없어요</p> : rows.map(r => (
            <button key={r.id} type="button" onClick={() => { onChange({ id: r.id, label: [r.client_name, r.contact].filter(Boolean).join(' · ') || '이름 없는 고객' }); setOpen(false); setQ('') }}
              className="block w-full border-b border-gray-50 px-3 py-2 text-left last:border-0 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-800">
              <span className="block truncate text-sm text-gray-900 dark:text-white">{[r.client_name, r.contact].filter(Boolean).join(' · ') || '이름 없는 고객'}</span>
              {r.request && <span className="block truncate text-xs text-gray-500">{r.request}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * 미팅 리스트 만들기·고치기 — 이름, 누구 리스트(대표·이사만 고름), 미팅 날짜·시간, 손님.
 */
export function ListFormSheet({ officeId, selfId, canManage, members, initial, defaultOwner, onSaved, onClose }: {
  officeId: string; selfId: string; canManage: boolean
  members: { id: string; name: string }[]
  /** 있으면 고치기 */
  initial?: MeetingList
  /** 새로 만들 때 기본 주인 — 대표·이사가 칩에서 고른 사람 */
  defaultOwner?: string
  onSaved: (l: MeetingList) => void
  onClose: () => void
}) {
  const toast = useToast()
  const [name, setName] = useState(initial?.name ?? '')
  const [owner, setOwner] = useState(initial?.created_by ?? defaultOwner ?? selfId)
  const [when, setWhen] = useState(toLocalInput(initial?.meeting_at ?? null))
  const [cust, setCust] = useState<{ id: string; label: string } | null>(
    initial?.customer_id ? { id: initial.customer_id, label: [initial.customer?.client_name, initial.customer?.contact].filter(Boolean).join(' · ') || '연결된 고객' } : null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const n = name.trim().slice(0, 40)
    if (!n) { toast.error('리스트 이름을 적어 주세요'); return }
    setBusy(true)
    const row = { name: n, created_by: owner, meeting_at: fromLocalInput(when), customer_id: cust?.id ?? null }
    const supabase = createClient()
    const res = initial
      ? await supabase.from('property_lists').update(row).eq('id', initial.id).select(LIST_COLS).single()
      : await supabase.from('property_lists').insert({ ...row, office_broker_id: officeId }).select(LIST_COLS).single()
    setBusy(false)
    if (res.error || !res.data) { toast.error(initial ? '고치지 못했어요' : '만들지 못했어요'); return }
    onSaved(toList(res.data as unknown as RawList))
  }

  return (
    <Sheet label={initial ? '미팅 리스트 고치기' : '새 미팅 리스트'} onClose={onClose}>
      <SheetHead title={initial ? '미팅 리스트 고치기' : '새 미팅 리스트'} onClose={onClose} />
      <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-gray-500">리스트 이름</span>
            <input autoFocus value={name} onChange={e => setName(e.target.value)} maxLength={40} placeholder="곱창집 미팅"
              className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-400/20 dark:border-gray-800 dark:bg-gray-950" />
          </label>
          {canManage && (
            <div>
              <span className="mb-1.5 block text-xs font-semibold text-gray-500">누구 리스트</span>
              <MemberChips members={members} selfId={selfId} value={owner} onChange={setOwner} />
            </div>
          )}
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-gray-500">미팅 날짜·시간 <span className="font-normal">(선택)</span></span>
            <input type="datetime-local" value={when} onChange={e => setWhen(e.target.value)}
              className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-400/20 dark:border-gray-800 dark:bg-gray-950" />
          </label>
          <div>
            <span className="mb-1.5 block text-xs font-semibold text-gray-500">손님 <span className="font-normal">(선택)</span></span>
            <CustomerPick officeId={officeId} value={cust} onChange={setCust} />
          </div>
        </div>
        <div className="flex gap-2 border-t border-gray-100 p-3 dark:border-gray-800">
          <button type="button" onClick={onClose} className="flex-1 rounded-xl border border-gray-200 py-2.5 text-sm font-semibold text-gray-600 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-300 dark:hover:bg-gray-800">취소</button>
          <button type="submit" disabled={busy} className="flex-[2] rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
            {busy ? '저장 중…' : initial ? '저장' : '만들기'}
          </button>
        </div>
      </form>
    </Sheet>
  )
}

/** 리스트 한 줄 — 모음 화면·고르기 창이 같이 쓴다 */
export function ListLine({ l, ownerName, active, onClick, right }: {
  l: MeetingList; ownerName?: string; active?: boolean; onClick: () => void; right?: React.ReactNode
}) {
  const when = meetingLabel(l.meeting_at)
  const who = l.customer?.client_name || (l.customer_id ? '손님 연결됨' : null)
  return (
    <button type="button" onClick={onClick}
      className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors ${active ? 'bg-blue-50 dark:bg-blue-950/30' : 'hover:bg-gray-50 dark:hover:bg-gray-800'}`}>
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${l.status === 'done' ? 'bg-gray-100 text-gray-400 dark:bg-gray-800' : 'bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-300'}`}>
        <ClipboardList className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className={`truncate text-sm font-semibold ${l.status === 'done' ? 'text-gray-500' : 'text-gray-900 dark:text-white'}`}>{l.name}</span>
          {l.status === 'done' && <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500 dark:bg-gray-800">미팅 끝</span>}
        </span>
        <span className="mt-0.5 block truncate text-xs text-gray-500">
          {[when, who, ownerName].filter(Boolean).join(' · ') || '날짜·손님 없음'}
        </span>
      </span>
      {right ?? (active ? <Check className="h-4 w-4 shrink-0 text-blue-600" /> : <ChevronRight className="h-4 w-4 shrink-0 text-gray-300" />)}
    </button>
  )
}

/**
 * 담을 리스트 고르기 — 고르면 '담는 중' 이 된다. 리스트 이름은 모두에게 보인다(남의 리스트에 보내야 하니).
 * 끝난 미팅은 접어 둔다.
 */
export function ListPickerSheet({ officeId, selfId, canManage, activeId, onPick, onClose }: {
  officeId: string; selfId: string; canManage: boolean
  activeId: string | null
  onPick: (l: MeetingList) => void
  onClose: () => void
}) {
  const toast = useToast()
  const { members, names } = useMembers(officeId)
  const [lists, setLists] = useState<MeetingList[] | null>(null)
  const [who, setWho] = useState(selfId)
  const [making, setMaking] = useState(false)
  useEffect(() => {
    let alive = true
    loadLists(officeId).then(ls => { if (alive) setLists(sortLists(ls)) }, () => { if (alive) { setLists([]); toast.error('리스트를 불러오지 못했어요') } })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [officeId])
  const shown = (lists ?? []).filter(l => l.created_by === who && l.status === 'ready')

  if (making && members) {
    return <ListFormSheet officeId={officeId} selfId={selfId} canManage={canManage} members={members}
      defaultOwner={canManage ? who : selfId} onClose={() => setMaking(false)} onSaved={l => { setMaking(false); onPick(l) }} />
  }
  return (
    <Sheet label="담을 리스트 고르기" onClose={onClose}>
      <SheetHead title="담을 리스트 고르기" sub="고르면 매물목록 [담기] 한 번으로 바로 들어갑니다" onClose={onClose} />
      <div className="border-b border-gray-100 px-4 py-3 dark:border-gray-800">
        {members && <MemberChips members={members} selfId={selfId} value={who} onChange={setWho} />}
      </div>
      <div className="min-h-[30vh] flex-1 divide-y divide-gray-50 overflow-y-auto dark:divide-gray-800">
        {lists == null || members == null ? <p className="py-10 text-center text-sm text-gray-500">불러오는 중…</p>
          : shown.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-gray-500">
              {who === selfId ? '준비 중인 내 미팅 리스트가 없어요' : `${names[who] ?? ''}님의 준비 중인 리스트가 없어요`}
            </p>
          ) : shown.map(l => <ListLine key={l.id} l={l} active={l.id === activeId} onClick={() => onPick(l)} />)}
      </div>
      {(who === selfId || canManage) && (
        <div className="border-t border-gray-100 p-3 dark:border-gray-800">
          <button type="button" onClick={() => setMaking(true)}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-gray-300 py-2.5 text-sm font-semibold text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800">
            <Plus className="h-4 w-4" />{who === selfId ? '새 미팅 리스트' : `${names[who] ?? ''}님 새 미팅 리스트`}
          </button>
        </div>
      )}
    </Sheet>
  )
}

/** 매물목록 아래 '담는 중' 막대 — 폰은 하단 메뉴 위 */
export function ActiveListBar({ list, ownerName, onChange, onClear }: {
  list: MeetingList; ownerName?: string; onChange: () => void; onClear: () => void
}) {
  const when = meetingLabel(list.meeting_at)
  return (
    <div className="fixed inset-x-0 z-40 flex justify-center px-3 bottom-[calc(env(safe-area-inset-bottom)+4.25rem)] md:bottom-5">
      <div className="flex w-full max-w-lg items-center gap-1 rounded-2xl bg-gray-900 py-1.5 pl-3 pr-1.5 text-white shadow-xl dark:bg-gray-800">
        <ClipboardList className="h-4 w-4 shrink-0 text-blue-300" />
        <Link href={`/broker/lists?id=${list.id}`} className="min-w-0 flex-1 px-1.5 py-1">
          <span className="block truncate text-sm font-semibold">{list.name} <span className="font-normal text-gray-400">에 담는 중</span></span>
          <span className="block truncate text-[11px] text-gray-400">
            {[ownerName, when ? <><CalendarClock className="mr-0.5 inline h-3 w-3" />{when}</> : null, `${list.count}건`].filter(Boolean).map((x, i) => <span key={i}>{i > 0 && ' · '}{x}</span>)}
          </span>
        </Link>
        <button type="button" onClick={onChange} className="shrink-0 rounded-xl px-2.5 py-2 text-xs font-semibold text-gray-200 hover:bg-white/10">바꾸기</button>
        <button type="button" onClick={onClear} aria-label="담기 그만" title="담기 그만" className="shrink-0 rounded-xl p-2 text-gray-400 hover:bg-white/10"><X className="h-4 w-4" /></button>
      </div>
    </div>
  )
}

// ── 손님용 글 ──
export interface ItemProp {
  id: string
  seq_no: number | null; address: string; deal_type: string; room_type: string
  price: number | null; monthly_rent: number | null; size_pyeong: string | null
  area_unit: string | null; floor: number | null; status: string; deleted_at: string | null
}
const 만 = (n: number | null | undefined) => (n ? `${n.toLocaleString('ko-KR')}만` : null)
export function priceText(p: Pick<ItemProp, 'deal_type' | 'price' | 'monthly_rent'>) {
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
export function customerText(l: MeetingList, items: { p: ItemProp | null; note: string | null }[]) {
  const when = meetingLabel(l.meeting_at)
  const lines = items.filter(i => i.p && !i.p.deleted_at && i.p.status !== 'contracted').map((i, n) => {
    const p = i.p!
    const area = p.size_pyeong ? `${p.size_pyeong}${p.area_unit || '평'}` : null
    const floor = p.floor != null ? `${p.floor}층` : null
    const head = `${n + 1}. ${shortAddress(p.address)} · ${p.room_type} · ${p.deal_type} ${priceText(p)}${area ? ` · ${area}` : ''}${floor ? ` · ${floor}` : ''}`
    return i.note?.trim() ? `${head}\n   - ${i.note.trim()}` : head
  })
  return [`[${l.name}]${when ? ` ${when}` : ''}`, '', ...lines].join('\n')
}
