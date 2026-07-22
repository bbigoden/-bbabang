'use client'

import { useEffect, useState, useMemo, useCallback, useId } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/lib/auth-context'
import { Header } from '@/components/layout/header'
import { useRouter } from 'next/navigation'
import { useToast } from '@/components/toast'
import {
  ChevronLeft, ChevronRight, Plus, X, Trash2, Clock, MapPin,
  Users, Lock, Bell, BellOff, Calendar as CalIcon, Building2, UserRound,
} from 'lucide-react'
import { cn } from '@/lib/utils'

// ── 색상 팔레트 ─────────────────────────────────────────
const COLORS = [
  { key: 'blue',   dot: 'bg-blue-500',   chip: 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-500/15 dark:text-blue-300 dark:border-blue-500/20' },
  { key: 'green',  dot: 'bg-emerald-500', chip: 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/20' },
  { key: 'amber',  dot: 'bg-amber-500',  chip: 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/20' },
  { key: 'rose',   dot: 'bg-rose-500',   chip: 'bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:border-rose-500/20' },
  { key: 'purple', dot: 'bg-purple-500', chip: 'bg-purple-100 text-purple-700 border-purple-200 dark:bg-purple-500/15 dark:text-purple-300 dark:border-purple-500/20' },
  { key: 'gray',   dot: 'bg-gray-400',   chip: 'bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-700/40 dark:text-gray-300 dark:border-gray-700' },
] as const
const colorOf = (k: string | null) => COLORS.find(c => c.key === k) ?? COLORS[0]

interface EventRow {
  id: string
  office_broker_id: string
  created_by: string | null
  title: string
  description: string | null
  starts_at: string
  ends_at: string | null
  all_day: boolean
  visibility: 'office' | 'private'
  color: string | null
  location: string | null
  customer_id: string | null
  property_id: string | null
  remind_minutes: number | null
}

const pad = (n: number) => String(n).padStart(2, '0')
const dateKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const toLocalInput = (d: Date, dateOnly: boolean) => {
  const s = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  return dateOnly ? s : `${s}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']

type Filter = 'all' | 'office' | 'mine'

export default function BrokerSchedulePage() {
  const supabase = createClient()
  const router = useRouter()
  const auth = useAuth()
  const toast = useToast()

  const [cursor, setCursor] = useState(() => new Date())   // 표시 중인 달(1일)
  const [events, setEvents] = useState<EventRow[]>([])
  const [memberNames, setMemberNames] = useState<Record<string, string>>({})
  const [memberIds, setMemberIds] = useState<string[]>([])
  const [filter, setFilter] = useState<Filter>('all')
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState<{ event: EventRow | null; date: Date } | null>(null)

  const office = auth.broker ? (auth.broker.is_owner !== false ? auth.broker.id : auth.broker.parent_broker_id) : null
  const myId = auth.broker?.id ?? null

  // ── 월 범위 일정 로드 ───────────────────────────────────
  const load = useCallback(async () => {
    if (!office) return
    const y = cursor.getFullYear(), m = cursor.getMonth()
    const from = new Date(y, m, 1 - 7).toISOString()
    const to = new Date(y, m + 1, 7).toISOString()
    const { data } = await supabase
      .from('office_events')
      .select('*')
      .eq('office_broker_id', office)
      .gte('starts_at', from)
      .lt('starts_at', to)
      .order('starts_at', { ascending: true })
    setEvents((data ?? []) as EventRow[])
    setLoading(false)
  }, [office, cursor, supabase])

  useEffect(() => {
    if (auth.loading) return
    if (!auth.user) { router.push('/auth/login?redirect=/broker/schedule'); return }
    if (!auth.broker) { router.push('/broker/register'); return }
    load()
  }, [auth.loading, auth.user?.id, auth.broker?.id, load, router])

  // ── 사무소 멤버 이름맵 (작성자 표시용) ────────────────────
  useEffect(() => {
    if (!office) return
    ;(async () => {
      const { data } = await supabase
        .from('broker_profiles')
        .select('id, is_owner, is_approved, profiles:user_id(name)')
        .or(`id.eq.${office},parent_broker_id.eq.${office}`)
      const map: Record<string, string> = {}
      const ids: string[] = []
      for (const m of (data ?? []) as any[]) {
        if (!(m.is_owner || m.is_approved)) continue
        ids.push(m.id)
        map[m.id] = (Array.isArray(m.profiles) ? m.profiles[0]?.name : m.profiles?.name) ?? '—'
      }
      setMemberNames(map)
      setMemberIds(ids)
    })()
  }, [office, supabase])

  // ── 필터 적용 ───────────────────────────────────────────
  const visibleEvents = useMemo(() => events.filter(e => {
    if (filter === 'office') return e.visibility === 'office'
    if (filter === 'mine') return e.created_by === myId
    return true
  }), [events, filter, myId])

  // 날짜별 그룹
  const byDay = useMemo(() => {
    const map: Record<string, EventRow[]> = {}
    for (const e of visibleEvents) {
      const k = dateKey(new Date(e.starts_at))
      ;(map[k] ??= []).push(e)
    }
    return map
  }, [visibleEvents])

  // ── 캘린더 그리드 (6주 = 42칸) ─────────────────────────
  const grid = useMemo(() => {
    const y = cursor.getFullYear(), m = cursor.getMonth()
    const first = new Date(y, m, 1)
    const start = new Date(y, m, 1 - first.getDay())
    return Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i))
  }, [cursor])

  const todayKey = dateKey(new Date())

  const reload = () => { load() }

  if (auth.loading || loading) return (
    <div className="bg-gray-50 dark:bg-gray-950 min-h-screen flex items-center justify-center">
      <div className="text-gray-500 text-sm">불러오는 중...</div>
    </div>
  )

  return (
    <div className="bg-gray-50 dark:bg-gray-950 min-h-screen">
      <Header user={auth.user} role="broker" />
      <div className="mx-auto max-w-5xl px-3 sm:px-4 py-6">

        {/* 상단 바 */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
              className="rounded-lg p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800" aria-label="이전 달">
              <ChevronLeft className="h-5 w-5 text-gray-600 dark:text-gray-400" />
            </button>
            <h1 className="text-xl font-bold text-gray-900 dark:text-white tabular-nums">
              {cursor.getFullYear()}.{pad(cursor.getMonth() + 1)}
            </h1>
            <button onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
              className="rounded-lg p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800" aria-label="다음 달">
              <ChevronRight className="h-5 w-5 text-gray-600 dark:text-gray-400" />
            </button>
            <button onClick={() => setCursor(new Date())}
              className="ml-1 rounded-lg border border-gray-200 dark:border-gray-700 px-2.5 py-1 text-xs font-semibold text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800">
              오늘
            </button>
          </div>

          <div className="flex items-center gap-2">
            {/* 필터 */}
            <div className="flex rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden text-xs font-semibold">
              {([['all', '전체'], ['office', '공유'], ['mine', '내 일정']] as const).map(([k, label]) => (
                <button key={k} onClick={() => setFilter(k)}
                  className={cn('px-2.5 py-1.5', filter === k ? 'bg-blue-600 text-white' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800')}>
                  {label}
                </button>
              ))}
            </div>
            <button onClick={() => setModal({ event: null, date: new Date() })}
              className="flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-bold text-white hover:bg-blue-700">
              <Plus className="h-4 w-4" /> 일정
            </button>
          </div>
        </div>

        {/* 요일 헤더 */}
        <div className="grid grid-cols-7 text-center text-xs font-semibold text-gray-400 mb-1">
          {WEEKDAYS.map((w, i) => (
            <div key={w} className={cn('py-1', i === 0 && 'text-rose-400', i === 6 && 'text-blue-400')}>{w}</div>
          ))}
        </div>

        {/* 캘린더 그리드 */}
        <div className="grid grid-cols-7 gap-1">
          {grid.map(d => {
            const k = dateKey(d)
            const inMonth = d.getMonth() === cursor.getMonth()
            const dayEvents = byDay[k] ?? []
            const isToday = k === todayKey
            return (
              <button key={k} onClick={() => setModal({ event: null, date: d })}
                className={cn(
                  'min-h-[84px] sm:min-h-[100px] rounded-lg border p-1 text-left align-top transition-colors',
                  inMonth ? 'bg-white dark:bg-gray-900 border-gray-100 dark:border-gray-800' : 'bg-gray-50/60 dark:bg-gray-950 border-transparent',
                  'hover:border-blue-300 dark:hover:border-blue-700',
                )}>
                <div className="flex items-center justify-between px-0.5">
                  <span className={cn(
                    'text-xs font-semibold',
                    isToday ? 'flex h-5 w-5 items-center justify-center rounded-full bg-blue-600 text-white' :
                    !inMonth ? 'text-gray-300 dark:text-gray-700' :
                    d.getDay() === 0 ? 'text-rose-500' : d.getDay() === 6 ? 'text-blue-500' : 'text-gray-700 dark:text-gray-300',
                  )}>{d.getDate()}</span>
                </div>
                <div className="mt-0.5 space-y-0.5">
                  {dayEvents.slice(0, 3).map(e => {
                    const c = colorOf(e.color)
                    return (
                      <div key={e.id}
                        onClick={(ev) => { ev.stopPropagation(); setModal({ event: e, date: new Date(e.starts_at) }) }}
                        className={cn('truncate rounded border px-1 py-0.5 text-[10px] font-medium leading-tight cursor-pointer', c.chip)}>
                        {e.visibility === 'private' && <Lock className="inline h-2.5 w-2.5 mr-0.5 -mt-0.5" />}
                        {!e.all_day && <span className="tabular-nums opacity-70">{pad(new Date(e.starts_at).getHours())}:{pad(new Date(e.starts_at).getMinutes())} </span>}
                        {e.title}
                      </div>
                    )
                  })}
                  {dayEvents.length > 3 && (
                    <div className="px-1 text-[10px] text-gray-400">+{dayEvents.length - 3}</div>
                  )}
                </div>
              </button>
            )
          })}
        </div>

        <p className="mt-3 text-[11px] text-gray-400">
          날짜를 누르면 일정을 추가하고, 일정을 누르면 수정해요. <Lock className="inline h-3 w-3" /> 표시는 나만 보는 개인 일정.
        </p>
      </div>

      {modal && office && myId && (
        <EventModal
          office={office}
          myId={myId}
          memberNames={memberNames}
          memberIds={memberIds}
          initial={modal.event}
          initialDate={modal.date}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); reload() }}
        />
      )}
    </div>
  )
}

// ── 일정 추가/수정 모달 ──────────────────────────────────
function EventModal({ office, myId, memberNames, memberIds, initial, initialDate, onClose, onSaved }: {
  office: string
  myId: string
  memberNames: Record<string, string>
  memberIds: string[]
  initial: EventRow | null
  initialDate: Date
  onClose: () => void
  onSaved: () => void
}) {
  const supabase = createClient()
  const toast = useToast()
  const isEdit = !!initial
  const canEdit = !initial || initial.created_by === myId || office === myId // 본인 작성 or 대표

  const start0 = initial ? new Date(initial.starts_at) : new Date(initialDate.getFullYear(), initialDate.getMonth(), initialDate.getDate(), 9, 0)
  const [allDay, setAllDay] = useState(initial?.all_day ?? false)
  const [title, setTitle] = useState(initial?.title ?? '')
  const [starts, setStarts] = useState(toLocalInput(start0, initial?.all_day ?? false))
  const [ends, setEnds] = useState(initial?.ends_at ? toLocalInput(new Date(initial.ends_at), initial.all_day) : '')
  const startsId = useId()
  const endsId = useId()
  const [visibility, setVisibility] = useState<'office' | 'private'>(initial?.visibility ?? 'office')
  const [color, setColor] = useState(initial?.color ?? 'blue')
  const [location, setLocation] = useState(initial?.location ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [remind, setRemind] = useState(initial?.remind_minutes != null)
  const [saving, setSaving] = useState(false)

  // 고객/매물 연동
  const [customerId, setCustomerId] = useState<string | null>(initial?.customer_id ?? null)
  const [customerLabel, setCustomerLabel] = useState<string>('')
  const [propertyId, setPropertyId] = useState<string | null>(initial?.property_id ?? null)
  const [propertyLabel, setPropertyLabel] = useState<string>('')

  // 기존 연동 라벨 로드
  useEffect(() => {
    ;(async () => {
      if (initial?.customer_id) {
        const { data } = await supabase.from('broker_customers').select('request, contact').eq('id', initial.customer_id).maybeSingle()
        if (data) setCustomerLabel(data.request || data.contact || '고객')
      }
      if (initial?.property_id) {
        const { data } = await supabase.from('broker_properties').select('seq_no, address').eq('id', initial.property_id).maybeSingle()
        if (data) setPropertyLabel(`${data.seq_no ? '#' + data.seq_no + ' ' : ''}${data.address ?? '매물'}`)
      }
    })()
  }, [initial, supabase])

  const onAllDayToggle = (v: boolean) => {
    setAllDay(v)
    // input 포맷 변경 (날짜만 ↔ 날짜+시간)
    const s = new Date(starts)
    setStarts(toLocalInput(isNaN(s.getTime()) ? start0 : s, v))
    if (ends) { const e = new Date(ends); setEnds(toLocalInput(isNaN(e.getTime()) ? start0 : e, v)) }
  }

  const save = async () => {
    if (!title.trim()) { toast.error('제목을 입력해주세요'); return }
    if (!starts) { toast.error('시작 일시를 입력해주세요'); return }
    setSaving(true)
    const startsIso = new Date(starts).toISOString()
    const endsIso = ends ? new Date(ends).toISOString() : null
    const payload = {
      title: title.trim(),
      description: description.trim() || null,
      starts_at: startsIso,
      ends_at: endsIso,
      all_day: allDay,
      visibility,
      color,
      location: location.trim() || null,
      customer_id: customerId,
      property_id: propertyId,
      remind_minutes: remind ? 60 : null,
    }
    let error
    if (isEdit) {
      ;({ error } = await supabase.from('office_events').update(payload).eq('id', initial!.id))
    } else {
      ;({ error } = await supabase.from('office_events').insert({ ...payload, office_broker_id: office, created_by: myId }))
    }
    setSaving(false)
    if (error) { toast.error('저장 실패: ' + error.message); return }
    onSaved()
  }

  const remove = async () => {
    if (!initial) return
    if (!confirm('이 일정을 삭제할까요?')) return
    const { error } = await supabase.from('office_events').delete().eq('id', initial.id)
    if (error) { toast.error('삭제 실패: ' + error.message); return }
    onSaved()
  }

  const authorName = initial?.created_by ? memberNames[initial.created_by] : null
  const fieldCls = 'w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-300'

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4" onClick={onClose}>
      <div className="w-full sm:max-w-md max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-white dark:bg-gray-900 shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 flex items-center justify-between border-b border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 py-3">
          <h2 className="font-bold text-gray-900 dark:text-white">{isEdit ? '일정 수정' : '새 일정'}</h2>
          <button onClick={onClose} className="rounded-lg p-1 hover:bg-gray-100 dark:hover:bg-gray-800" aria-label="닫기">
            <X className="h-5 w-5 text-gray-500" />
          </button>
        </div>

        <div className="space-y-3 px-4 py-4">
          {!canEdit && (
            <div className="rounded-lg bg-gray-50 dark:bg-gray-800 px-3 py-2 text-xs text-gray-500">
              {authorName ? `${authorName}님의 일정` : '다른 직원의 일정'} — 읽기 전용
            </div>
          )}

          {/* 제목 */}
          <input value={title} onChange={e => setTitle(e.target.value)} disabled={!canEdit}
            placeholder="일정 제목" className={cn(fieldCls, 'font-semibold')} autoFocus={!isEdit} />

          {/* 색상 */}
          <div className="flex items-center gap-2">
            {COLORS.map(c => (
              <button key={c.key} onClick={() => canEdit && setColor(c.key)} disabled={!canEdit}
                className={cn('h-6 w-6 rounded-full', c.dot, color === c.key && 'ring-2 ring-offset-2 ring-gray-400 dark:ring-offset-gray-900')}
                aria-label={`색상 ${c.key}`} />
            ))}
          </div>

          {/* 종일 토글 */}
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input type="checkbox" checked={allDay} onChange={e => onAllDayToggle(e.target.checked)} disabled={!canEdit} className="h-4 w-4 rounded" />
            종일
          </label>

          {/* 시작/종료 */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label htmlFor={startsId} className="mb-1 block text-xs font-medium text-gray-500">시작</label>
              <input id={startsId} type={allDay ? 'date' : 'datetime-local'} value={starts} onChange={e => setStarts(e.target.value)} disabled={!canEdit} className={fieldCls} />
            </div>
            <div>
              <label htmlFor={endsId} className="mb-1 block text-xs font-medium text-gray-500">종료 <span className="text-gray-400">(선택)</span></label>
              <input id={endsId} type={allDay ? 'date' : 'datetime-local'} value={ends} onChange={e => setEnds(e.target.value)} disabled={!canEdit} className={fieldCls} />
            </div>
          </div>

          {/* 공개 범위 */}
          <div className="flex rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden text-sm font-semibold">
            <button onClick={() => canEdit && setVisibility('office')} disabled={!canEdit}
              className={cn('flex flex-1 items-center justify-center gap-1.5 py-2', visibility === 'office' ? 'bg-blue-600 text-white' : 'text-gray-600 dark:text-gray-300')}>
              <Users className="h-4 w-4" /> 사무소 공유
            </button>
            <button onClick={() => canEdit && setVisibility('private')} disabled={!canEdit}
              className={cn('flex flex-1 items-center justify-center gap-1.5 py-2', visibility === 'private' ? 'bg-blue-600 text-white' : 'text-gray-600 dark:text-gray-300')}>
              <Lock className="h-4 w-4" /> 개인
            </button>
          </div>

          {/* 장소 */}
          <div className="flex items-center gap-2">
            <MapPin className="h-4 w-4 text-gray-400 flex-shrink-0" />
            <input value={location} onChange={e => setLocation(e.target.value)} disabled={!canEdit} placeholder="장소 (선택)" className={fieldCls} />
          </div>

          {/* 고객 연동 */}
          <LinkPicker
            kind="customer" label="고객 연결" icon={<UserRound className="h-4 w-4 text-gray-400" />}
            memberIds={memberIds} disabled={!canEdit}
            selectedId={customerId} selectedLabel={customerLabel}
            onSelect={(id, lbl) => { setCustomerId(id); setCustomerLabel(lbl) }}
            onClear={() => { setCustomerId(null); setCustomerLabel('') }}
          />

          {/* 매물 연동 */}
          <LinkPicker
            kind="property" label="매물 연결" icon={<Building2 className="h-4 w-4 text-gray-400" />}
            memberIds={memberIds} disabled={!canEdit}
            selectedId={propertyId} selectedLabel={propertyLabel}
            onSelect={(id, lbl) => { setPropertyId(id); setPropertyLabel(lbl) }}
            onClear={() => { setPropertyId(null); setPropertyLabel('') }}
          />

          {/* 알림 */}
          <button onClick={() => canEdit && setRemind(!remind)} disabled={!canEdit}
            className={cn('flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-sm',
              remind ? 'border-blue-200 bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:border-blue-500/20 dark:text-blue-300' : 'border-gray-200 dark:border-gray-700 text-gray-500')}>
            {remind ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}
            {remind ? '알림 켜짐 — 당일 아침에 알려드려요' : '알림 꺼짐'}
          </button>

          {/* 설명 */}
          <textarea value={description} onChange={e => setDescription(e.target.value)} disabled={!canEdit}
            placeholder="메모 (선택)" rows={2} className={cn(fieldCls, 'resize-none')} />
        </div>

        {/* 하단 액션 */}
        {canEdit && (
          <div className="sticky bottom-0 flex items-center gap-2 border-t border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 py-3">
            {isEdit && (
              <button onClick={remove} className="flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10">
                <Trash2 className="h-4 w-4" /> 삭제
              </button>
            )}
            <button onClick={save} disabled={saving}
              className="ml-auto rounded-lg bg-blue-600 px-5 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50">
              {saving ? '저장 중...' : '저장'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── 고객/매물 검색·선택 ──────────────────────────────────
function LinkPicker({ kind, label, icon, memberIds, disabled, selectedId, selectedLabel, onSelect, onClear }: {
  kind: 'customer' | 'property'
  label: string
  icon: React.ReactNode
  memberIds: string[]
  disabled?: boolean
  selectedId: string | null
  selectedLabel: string
  onSelect: (id: string, label: string) => void
  onClear: () => void
}) {
  const supabase = createClient()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [results, setResults] = useState<{ id: string; label: string }[]>([])

  const search = async (term: string) => {
    setQ(term)
    if (!term.trim() || memberIds.length === 0) { setResults([]); return }
    if (kind === 'customer') {
      const { data } = await supabase
        .from('broker_customers')
        .select('id, request, contact, client_name')
        .in('broker_id', memberIds)
        .or(`request.ilike.%${term}%,contact.ilike.%${term}%,client_name.ilike.%${term}%`)
        .limit(8)
      setResults((data ?? []).map((c: any) => ({ id: c.id, label: c.request || c.client_name || c.contact || '고객' })))
    } else {
      const num = term.replace(/[^0-9]/g, '')
      let query = supabase.from('broker_properties').select('id, seq_no, address').in('broker_id', memberIds)
      query = num ? query.or(`address.ilike.%${term}%,seq_no.eq.${num}`) : query.ilike('address', `%${term}%`)
      const { data } = await query.limit(8)
      setResults((data ?? []).map((p: any) => ({ id: p.id, label: `${p.seq_no ? '#' + p.seq_no + ' ' : ''}${p.address ?? '매물'}` })))
    }
  }

  if (selectedId) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2 text-sm">
        {icon}
        <span className="flex-1 truncate text-gray-700 dark:text-gray-300">{selectedLabel || label}</span>
        {!disabled && <button onClick={onClear} className="text-gray-400 hover:text-red-500" aria-label="연결 해제"><X className="h-4 w-4" /></button>}
      </div>
    )
  }

  if (disabled) return null

  return (
    <div>
      {!open ? (
        <button onClick={() => setOpen(true)} className="flex w-full items-center gap-2 rounded-lg border border-dashed border-gray-300 dark:border-gray-700 px-3 py-2 text-sm text-gray-500 hover:border-blue-300">
          {icon} {label}
        </button>
      ) : (
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-2">
          <input value={q} onChange={e => search(e.target.value)} autoFocus
            placeholder={kind === 'customer' ? '고객 요청·연락처 검색' : '매물 주소·번호 검색'}
            className="w-full rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-blue-300" />
          <div className="mt-1 max-h-40 overflow-y-auto">
            {results.map(r => (
              <button key={r.id} onClick={() => { onSelect(r.id, r.label); setOpen(false); setQ('') }}
                className="block w-full truncate rounded-md px-2.5 py-1.5 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-blue-50 dark:hover:bg-gray-800">
                {r.label}
              </button>
            ))}
            {q && results.length === 0 && <p className="px-2.5 py-2 text-xs text-gray-400">검색 결과 없음</p>}
          </div>
        </div>
      )}
    </div>
  )
}
