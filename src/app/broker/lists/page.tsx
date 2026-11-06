'use client'

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  ArrowDown, ArrowLeft, ArrowUp, CalendarClock, CheckCircle2, ClipboardList, Copy, Map as MapIcon, MoreHorizontal,
  Pencil, Plus, RotateCcw, StickyNote, Trash2, User, X,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/lib/auth-context'
import { canManageOffice } from '@/lib/office-role'
import { Header } from '@/components/layout/header'
import { useToast } from '@/components/toast'
import { ImageLightbox } from '@/components/image-lightbox'
import { PropertyViewSheet, type PropertyView } from '@/components/broker/property-view-sheet'
import type { MapRow } from '@/components/broker/properties-map-view'
import {
  ListFormSheet, MemberChips, customerText, loadList, loadLists, meetingLabel, priceText,
  setActiveListId, sortLists, useMembers, type ItemProp, type MeetingList,
} from '@/components/broker/property-lists'

const PropertiesMapView = dynamic(() => import('@/components/broker/properties-map-view').then(m => m.PropertiesMapView), { ssr: false })

/**
 * 미팅 리스트 (2026-11-06 개편)
 *
 * 모음: 미팅 하나가 카드 하나 — 날짜·손님·담당·건수. 준비 중이 위, 끝난 미팅은 아래.
 * 상세(?id=): 사진 카드로 매물을 보여 줄 순서대로, 매물마다 한 줄 메모, 카톡 글, 동선 지도.
 * 담긴 내용은 만든 사람과 대표·이사만 본다(DB 정책). 직원은 자기 리스트만 이 화면에 보인다.
 */

const ITEM_COLS = 'property_id, added_by, sort_order, note, p:broker_properties(id, broker_id, seq_no, address, deal_type, room_type, status, price, monthly_rent, management_fee, premium, size_pyeong, area_unit, area_supplied, floor, total_floors, move_in_date, rooms_bathrooms, approval_date, parking, direction, brief_memo, memo, assignee, received_date, images, lat, lng, deleted_at)'

type FullProp = ItemProp & PropertyView & { broker_id: string; lat: number | null; lng: number | null }
interface Item { property_id: string; added_by: string; sort_order: number; note: string | null; p: FullProp | null }

export default function ListsPage() {
  return <Suspense><ListsInner /></Suspense>
}

function ListsInner() {
  const router = useRouter()
  const auth = useAuth()
  const params = useSearchParams()
  const openId = params.get('id')
  const b = auth.broker
  const officeId = b ? (b.is_owner !== false ? b.id : (b.parent_broker_id ?? b.id)) : null
  const canManage = canManageOffice(b)

  useEffect(() => {
    if (auth.loading) return
    if (!auth.user || !b) router.push('/auth/login')
  }, [auth.loading, auth.user, b, router])

  if (!b || !officeId) return <div className="min-h-screen bg-gray-50 dark:bg-gray-950"><Header user={auth.user} role="broker" /></div>
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <Header user={auth.user} role="broker" />
      {openId
        ? <ListDetail key={openId} id={openId} officeId={officeId} selfId={b.id} canManage={canManage} />
        : <ListIndex officeId={officeId} selfId={b.id} canManage={canManage} />}
    </div>
  )
}

// ── 모음 ──────────────────────────────────────────────
function ListIndex({ officeId, selfId, canManage }: { officeId: string; selfId: string; canManage: boolean }) {
  const toast = useToast()
  const router = useRouter()
  const { members, names } = useMembers(officeId)
  const [lists, setLists] = useState<MeetingList[] | null>(null)
  const [thumbs, setThumbs] = useState<Record<string, string[]>>({})
  const [who, setWho] = useState('')
  const [making, setMaking] = useState(false)

  useEffect(() => {
    let alive = true
    const supabase = createClient()
    loadLists(officeId).then(async ls => {
      // 직원은 자기 리스트만(남의 리스트는 담긴 내용이 안 보여 빈 카드가 된다). 퇴직자 리스트는 아래에서 뺀다
      const mine = canManage ? ls : ls.filter(l => l.created_by === selfId)
      if (!alive) return
      setLists(sortLists(mine))
      // 카드 사진 — 리스트마다 앞의 매물 사진 몇 장. 한 번에 받는다
      const ids = mine.map(l => l.id)
      if (!ids.length) return
      const { data } = await supabase.from('property_list_items')
        .select('list_id, sort_order, p:broker_properties(images)').in('list_id', ids).order('sort_order')
      if (!alive) return
      const m: Record<string, string[]> = {}
      for (const r of (data ?? []) as unknown as { list_id: string; p: { images: string[] | null } | null }[]) {
        const img = r.p?.images?.[0]
        if (img && (m[r.list_id] ??= []).length < 4) m[r.list_id].push(img)
      }
      setThumbs(m)
    }, () => { if (alive) { setLists([]); toast.error('리스트를 불러오지 못했어요') } })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [officeId])

  const visible = (lists ?? []).filter(l => names[l.created_by] !== undefined && (!who || l.created_by === who))
  const ready = visible.filter(l => l.status === 'ready')
  const done = visible.filter(l => l.status === 'done')

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <div className="mb-4 flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">미팅 리스트</h1>
          <p className="mt-0.5 text-sm text-gray-500">손님 미팅에 들고 갈 매물 묶음</p>
        </div>
        <button type="button" onClick={() => setMaking(true)}
          className="flex shrink-0 items-center gap-1.5 rounded-xl bg-blue-600 px-3.5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700">
          <Plus className="h-4 w-4" />새 미팅
        </button>
      </div>

      {canManage && members && (
        <div className="mb-4"><MemberChips members={members} selfId={selfId} value={who} onChange={setWho} allLabel="전체" /></div>
      )}

      {lists == null || members == null ? (
        <p className="py-16 text-center text-sm text-gray-500">불러오는 중…</p>
      ) : visible.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white px-6 py-14 text-center dark:border-gray-700 dark:bg-gray-900">
          <ClipboardList className="mx-auto h-8 w-8 text-gray-300" />
          <p className="mt-3 font-semibold text-gray-800 dark:text-gray-100">첫 미팅 리스트를 만들어 보세요</p>
          <p className="mt-1 text-sm text-gray-500">미팅을 만들고 매물목록에서 [담기]만 누르면 모입니다.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {ready.length > 0 && <Section title="준비 중" lists={ready} names={names} thumbs={thumbs} />}
          {done.length > 0 && <Section title="미팅 끝" lists={done} names={names} thumbs={thumbs} muted />}
        </div>
      )}

      {making && members && (
        <ListFormSheet officeId={officeId} selfId={selfId} canManage={canManage} members={members}
          defaultOwner={who || selfId} onClose={() => setMaking(false)}
          onSaved={l => { setMaking(false); router.push(`/broker/lists?id=${l.id}`) }} />
      )}
    </div>
  )
}

function Section({ title, lists, names, thumbs, muted }: {
  title: string; lists: MeetingList[]; names: Record<string, string>; thumbs: Record<string, string[]>; muted?: boolean
}) {
  return (
    <section>
      <h2 className="mb-2 px-1 text-xs font-semibold text-gray-500">{title} <span className="font-normal">{lists.length}</span></h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {lists.map(l => {
          const when = meetingLabel(l.meeting_at)
          const imgs = thumbs[l.id] ?? []
          return (
            <Link key={l.id} href={`/broker/lists?id=${l.id}`}
              className={`block rounded-2xl border border-gray-200 bg-white p-4 transition-colors hover:border-blue-300 dark:border-gray-800 dark:bg-gray-900 ${muted ? 'opacity-70' : ''}`}>
              <div className="flex items-start gap-2">
                <p className="min-w-0 flex-1 truncate font-semibold text-gray-900 dark:text-white">{l.name}</p>
                <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold tabular-nums text-gray-600 dark:bg-gray-800 dark:text-gray-300">{l.count}건</span>
              </div>
              <div className="mt-1.5 space-y-0.5 text-xs text-gray-500">
                {when && <p className="flex items-center gap-1"><CalendarClock className="h-3.5 w-3.5" />{when}</p>}
                {(l.customer?.client_name || l.customer_id) && <p className="flex items-center gap-1"><User className="h-3.5 w-3.5" />{l.customer?.client_name || '손님 연결됨'}</p>}
                <p>{names[l.created_by]}</p>
              </div>
              {imgs.length > 0 && (
                <div className="mt-3 flex gap-1.5">
                  {imgs.map(src => <img key={src} src={src} alt="" loading="lazy" className="h-12 w-12 rounded-lg object-cover" />)}
                  {l.count > imgs.length && <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-gray-100 text-xs text-gray-500 dark:bg-gray-800">+{l.count - imgs.length}</span>}
                </div>
              )}
            </Link>
          )
        })}
      </div>
    </section>
  )
}

// ── 상세 ──────────────────────────────────────────────
function ListDetail({ id, officeId, selfId, canManage }: { id: string; officeId: string; selfId: string; canManage: boolean }) {
  const toast = useToast()
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])
  const { members, names } = useMembers(officeId)
  const ownerName = members?.find(m => m.isOwner)?.name ?? ''
  const [list, setList] = useState<MeetingList | null | undefined>(undefined)
  const [items, setItems] = useState<Item[] | null>(null)
  const [editing, setEditing] = useState(false)
  const [menu, setMenu] = useState(false)
  const [viewing, setViewing] = useState<Item | null>(null)
  const [noteFor, setNoteFor] = useState<string | null>(null)
  const [showMap, setShowMap] = useState(false)
  const [lightbox, setLightbox] = useState<{ images: string[]; index: number } | null>(null)
  const geocodeCacheRef = useRef<Record<string, { lat: number; lng: number } | null>>({})
  const savedCoordIdsRef = useRef<Set<string>>(new Set())

  const load = useCallback(async () => {
    const [l, its] = await Promise.all([
      loadList(id),
      supabase.from('property_list_items').select(ITEM_COLS).eq('list_id', id).order('sort_order').order('added_at'),
    ])
    setList(l)
    setItems(((its.data ?? []) as unknown as Item[]))
  }, [id, supabase])
  useEffect(() => { void load() }, [load])

  if (list === undefined) return <p className="py-16 text-center text-sm text-gray-500">불러오는 중…</p>
  if (list === null) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <p className="text-sm text-gray-500">지워졌거나 볼 수 없는 리스트예요.</p>
        <Link href="/broker/lists" className="mt-3 inline-block text-sm font-semibold text-blue-600">미팅 리스트로</Link>
      </div>
    )
  }
  const mayEdit = canManage || list.created_by === selfId
  const live = (items ?? []).filter(i => i.p && !i.p.deleted_at)
  const when = meetingLabel(list.meeting_at)
  const memoOk = (p: FullProp) => canManage || p.broker_id === selfId
    || (!!ownerName && (p.assignee ?? '').split(',').map(s => s.trim()).includes(ownerName))

  const saveOrder = async (next: Item[]) => {
    const prev = items
    setItems(next)
    const changed = next.map((it, i) => ({ it, n: i + 1 })).filter(({ it, n }) => it.sort_order !== n)
    const results = await Promise.all(changed.map(({ it, n }) =>
      supabase.from('property_list_items').update({ sort_order: n }).eq('list_id', id).eq('property_id', it.property_id)))
    if (results.some(r => r.error)) { setItems(prev); toast.error('순서를 바꾸지 못했어요'); return }
    setItems(next.map((it, i) => ({ ...it, sort_order: i + 1 })))
  }
  const move = (idx: number, d: -1 | 1) => {
    if (!items) return
    const j = idx + d
    if (j < 0 || j >= items.length) return
    const next = [...items];
    [next[idx], next[j]] = [next[j], next[idx]]
    void saveOrder(next)
  }
  const remove = async (it: Item) => {
    const { data, error } = await supabase.from('property_list_items').delete().eq('list_id', id).eq('property_id', it.property_id).select('list_id')
    if (error || !data?.length) { toast.error('뺄 권한이 없어요'); return }
    setItems(xs => xs?.filter(x => x.property_id !== it.property_id) ?? xs)
    setList(l => l && { ...l, count: Math.max(0, l.count - 1) })
  }
  const saveNote = async (it: Item, note: string) => {
    const v = note.trim().slice(0, 200) || null
    setNoteFor(null)
    if (v === (it.note ?? null)) return
    const { error } = await supabase.from('property_list_items').update({ note: v }).eq('list_id', id).eq('property_id', it.property_id)
    if (error) { toast.error('메모를 저장하지 못했어요'); return }
    setItems(xs => xs?.map(x => x.property_id === it.property_id ? { ...x, note: v } : x) ?? xs)
  }
  const setStatus = async (status: 'ready' | 'done') => {
    setMenu(false)
    const { error } = await supabase.from('property_lists').update({ status }).eq('id', id)
    if (error) { toast.error('바꾸지 못했어요'); return }
    setList(l => l && { ...l, status })
    if (status === 'done') setActiveListId(selfId, null)
    toast.success(status === 'done' ? '미팅 끝으로 옮겼어요' : '다시 준비 중으로')
  }
  const del = async () => {
    setMenu(false)
    if (!confirm(`'${list.name}' 리스트를 지울까요? 매물은 매물목록에 그대로 남습니다.`)) return
    const { data, error } = await supabase.from('property_lists').delete().eq('id', id).select('id')
    if (error || !data?.length) { toast.error('지울 권한이 없어요'); return }
    setActiveListId(selfId, null)
    router.push('/broker/lists')
  }
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(customerText(list, live.map(i => ({ p: i.p, note: i.note }))))
      toast.success('복사했어요 — 카톡에 붙여 넣으세요')
    } catch { toast.error('복사하지 못했어요') }
  }
  const startAdding = () => {
    setActiveListId(selfId, list.id)
    router.push('/broker/properties')
  }
  const mapRows: MapRow[] = live.map(i => ({ ...i.p!, price: i.p!.price ?? 0, status: i.p!.status as MapRow['status'], images: i.p!.images ?? [] }))

  return (
    <div className="mx-auto max-w-2xl px-4 pb-32 pt-4">
      {/* 머리 */}
      <div className="mb-4 flex items-start gap-2">
        <Link href="/broker/lists" aria-label="미팅 리스트로" className="-ml-1.5 mt-0.5 rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-xl font-bold text-gray-900 dark:text-white">{list.name}</h1>
            {list.status === 'done' && <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[11px] font-medium text-gray-500 dark:bg-gray-800">미팅 끝</span>}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-sm text-gray-500">
            {when && <span className="flex items-center gap-1"><CalendarClock className="h-4 w-4" />{when}</span>}
            {(list.customer?.client_name || list.customer_id) && (
              <span className="flex items-center gap-1"><User className="h-4 w-4" />{[list.customer?.client_name || '손님 연결됨', list.customer?.contact].filter(Boolean).join(' · ')}</span>
            )}
            <span>{names[list.created_by] ?? ''}</span>
          </div>
        </div>
        {mayEdit && (
          <div className="relative">
            <button type="button" onClick={() => setMenu(v => !v)} aria-label="더보기" className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800">
              <MoreHorizontal className="h-5 w-5" />
            </button>
            {menu && (
              <div className="absolute right-0 top-9 z-20 w-44 overflow-hidden rounded-xl border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-800 dark:bg-gray-900">
                <MenuItem icon={Pencil} label="정보 고치기" onClick={() => { setMenu(false); setEditing(true) }} />
                {list.status === 'ready'
                  ? <MenuItem icon={CheckCircle2} label="미팅 끝으로" onClick={() => setStatus('done')} />
                  : <MenuItem icon={RotateCcw} label="다시 준비 중으로" onClick={() => setStatus('ready')} />}
                <MenuItem icon={Trash2} label="리스트 지우기" danger onClick={del} />
              </div>
            )}
          </div>
        )}
      </div>

      {/* 지도 */}
      {showMap && mapRows.length > 0 && (
        <div className="mb-4 overflow-hidden rounded-2xl border border-gray-200 dark:border-gray-800">
          <PropertiesMapView mapRows={mapRows} mapLoading={false} officeAddress={null} supabase={supabase}
            geocodeCacheRef={geocodeCacheRef} savedCoordIdsRef={savedCoordIdsRef}
            onOpenImages={images => setLightbox({ images, index: 0 })}
            onJumpToList={pid => { setShowMap(false); document.getElementById(`item-${pid}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }) }} />
        </div>
      )}

      {/* 매물 카드 */}
      {items == null ? <p className="py-16 text-center text-sm text-gray-500">불러오는 중…</p>
        : items.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-gray-300 bg-white px-6 py-12 text-center dark:border-gray-700 dark:bg-gray-900">
            <p className="font-semibold text-gray-800 dark:text-gray-100">아직 담긴 매물이 없어요</p>
            <p className="mt-1 text-sm text-gray-500">[매물 담으러 가기] 를 누르고 매물목록에서 [담기] 를 누르세요.</p>
          </div>
        ) : (
          <ol className="space-y-2.5">
            {items.map((it, idx) => {
              const p = it.p
              const gone = !p || !!p.deleted_at
              return (
                <li key={it.property_id} id={`item-${it.property_id}`} className="rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
                  <div className="flex gap-3 p-3">
                    <button type="button" disabled={gone} onClick={() => setViewing(it)} className="flex min-w-0 flex-1 gap-3 text-left" aria-label={`${p?.seq_no ?? ''}번 매물 보기`}>
                      <span className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-gray-100 dark:bg-gray-800">
                        {p?.images?.[0]
                          ? <img src={p.images[0]} alt="" loading="lazy" className="h-full w-full object-cover" />
                          : <span className="flex h-full w-full items-center justify-center text-[11px] text-gray-400">사진 없음</span>}
                        <span className="absolute left-1 top-1 rounded-md bg-black/60 px-1.5 text-[11px] font-semibold text-white">{idx + 1}</span>
                      </span>
                      <span className="min-w-0 flex-1">
                        {gone ? <span className="text-sm text-gray-500">지워진 매물</span> : (
                          <>
                            <span className="flex items-center gap-1.5">
                              <span className="text-xs font-semibold tabular-nums text-gray-400">#{p!.seq_no}</span>
                              {p!.status === 'contracted' && <span className="rounded bg-red-50 px-1.5 text-[11px] font-semibold text-red-600 dark:bg-red-950/40">계약완료</span>}
                            </span>
                            <span className="mt-0.5 block text-sm font-semibold text-gray-900 dark:text-white">{p!.deal_type} {priceText(p!)}</span>
                            <span className="mt-0.5 block truncate text-xs text-gray-500">
                              {[p!.room_type, p!.size_pyeong ? `${p!.size_pyeong}${p!.area_unit || '평'}` : null, p!.floor != null ? `${p!.floor}층` : null].filter(Boolean).join(' · ')}
                            </span>
                            <span className="mt-0.5 block truncate text-xs text-gray-400">{p!.address}</span>
                          </>
                        )}
                      </span>
                    </button>
                    {mayEdit && (
                      <div className="flex shrink-0 flex-col items-center justify-between">
                        <button type="button" onClick={() => move(idx, -1)} disabled={idx === 0} aria-label="위로" className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 disabled:opacity-20 dark:hover:bg-gray-800"><ArrowUp className="h-4 w-4" /></button>
                        <button type="button" onClick={() => remove(it)} aria-label="리스트에서 빼기" className="rounded-lg p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"><X className="h-4 w-4" /></button>
                        <button type="button" onClick={() => move(idx, 1)} disabled={idx === items.length - 1} aria-label="아래로" className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 disabled:opacity-20 dark:hover:bg-gray-800"><ArrowDown className="h-4 w-4" /></button>
                      </div>
                    )}
                  </div>
                  {/* 손님에게 할 말 한 줄 — 카톡 글에도 들어간다 */}
                  {mayEdit && !gone && (noteFor === it.property_id ? (
                    <NoteInput initial={it.note ?? ''} onDone={v => saveNote(it, v)} />
                  ) : (
                    <button type="button" onClick={() => setNoteFor(it.property_id)}
                      className={`flex w-full items-center gap-1.5 border-t border-gray-100 px-3 py-2 text-left text-xs dark:border-gray-800 ${it.note ? 'text-blue-700 dark:text-blue-300' : 'text-gray-400'}`}>
                      <StickyNote className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{it.note || '손님에게 할 말 메모'}</span>
                    </button>
                  ))}
                  {!mayEdit && <p className="border-t border-gray-100 px-3 py-1.5 text-[11px] text-gray-400 dark:border-gray-800">{names[it.added_by] ?? '퇴직자'} 담음</p>}
                </li>
              )
            })}
          </ol>
        )}

      {/* 아래 버튼 — 폰은 하단 메뉴 위 */}
      <div className="fixed inset-x-0 z-30 flex justify-center px-3 bottom-[calc(env(safe-area-inset-bottom)+4.25rem)] md:bottom-5">
        <div className="flex w-full max-w-2xl gap-2 rounded-2xl border border-gray-200 bg-white/95 p-2 shadow-lg backdrop-blur dark:border-gray-800 dark:bg-gray-900/95">
          <button type="button" onClick={copy} disabled={!live.length}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-gray-200 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800">
            <Copy className="h-4 w-4" />카톡 글
          </button>
          <button type="button" onClick={() => setShowMap(v => !v)} disabled={!live.length}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl border py-2.5 text-sm font-semibold disabled:opacity-40 ${showMap ? 'border-gray-900 bg-gray-900 text-white dark:border-gray-200 dark:bg-gray-200 dark:text-gray-900' : 'border-gray-200 text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800'}`}>
            <MapIcon className="h-4 w-4" />지도
          </button>
          {list.status === 'ready' && (
            <button type="button" onClick={startAdding}
              className="flex flex-[1.4] items-center justify-center gap-1.5 rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700">
              <Plus className="h-4 w-4" />매물 담으러 가기
            </button>
          )}
        </div>
      </div>

      {editing && members && (
        <ListFormSheet officeId={officeId} selfId={selfId} canManage={canManage} members={members} initial={list}
          onClose={() => setEditing(false)} onSaved={l => { setEditing(false); setList(l) }} />
      )}
      {viewing?.p && <PropertyViewSheet p={{ ...viewing.p, images: viewing.p.images ?? [] }} memoVisible={memoOk(viewing.p)} onClose={() => setViewing(null)} />}
      {lightbox && (
        <ImageLightbox images={lightbox.images} index={lightbox.index} onClose={() => setLightbox(null)}
          onNext={() => setLightbox(lb => lb && lb.index < lb.images.length - 1 ? { ...lb, index: lb.index + 1 } : lb)}
          onPrev={() => setLightbox(lb => lb && lb.index > 0 ? { ...lb, index: lb.index - 1 } : lb)}
          onGoTo={i => setLightbox(lb => lb ? { ...lb, index: i } : lb)} />
      )}
    </div>
  )
}

function MenuItem({ icon: Icon, label, onClick, danger }: { icon: React.ComponentType<{ className?: string }>; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button type="button" onClick={onClick}
      className={`flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm hover:bg-gray-50 dark:hover:bg-gray-800 ${danger ? 'text-red-600' : 'text-gray-700 dark:text-gray-200'}`}>
      <Icon className="h-4 w-4" />{label}
    </button>
  )
}

function NoteInput({ initial, onDone }: { initial: string; onDone: (v: string) => void }) {
  const [v, setV] = useState(initial)
  return (
    <form onSubmit={e => { e.preventDefault(); onDone(v) }} className="flex gap-2 border-t border-gray-100 p-2 dark:border-gray-800">
      <input autoFocus value={v} onChange={e => setV(e.target.value)} maxLength={200} placeholder="주차 넉넉, 권리 협의 가능"
        onBlur={() => onDone(v)}
        className="min-w-0 flex-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm outline-none focus:border-blue-400 dark:border-gray-700 dark:bg-gray-950" />
      <button type="submit" className="rounded-lg bg-blue-600 px-3 text-xs font-semibold text-white">저장</button>
    </form>
  )
}
