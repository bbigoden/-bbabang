'use client'

/**
 * 예약관리 — 여러 곳(네이버예약·카톡 채널·인스타)으로 들어온 예약을 한 줄로 모은다.
 *
 * 첫 시험은 꽃집도 하는 직원(이예리) 1명, 사장님은 지켜보며 불편한 곳을 찾는다(2026-11-05).
 * 잘 되면 이름만 바꿔 부동산 일정(현장 안내·상담)으로 쓴다 — 그래서 업종 전용 칸이 없다.
 * 권한: 대표 + permissions.events=true 직원만(DB office_event_can_*, 메뉴 canUseEvents). 이사도 빠진다.
 * 대표 화면에만 '시험 현황' 칸이 하나 더 있다(채널별 건수·금액, 놓친 예약, 불편 신고).
 */

import { useEscape } from '@/lib/use-escape'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { fetchAllPaged } from '@/lib/fetch-all-paged'
import { useAuth } from '@/lib/auth-context'
import { Header } from '@/components/layout/header'
import { useToast } from '@/components/toast'
import { canUseEvents } from '@/components/broker/menu-items'
import { BookingSettings } from './booking-settings'
import { todayKST, ymdKST, hmKST, addDays } from '@/lib/date-kst'
import {
  CalendarDays, ChevronLeft, ChevronRight, Plus, Copy, Check, X, Phone, MessageSquareWarning, BarChart3, Pencil, AlertTriangle, Link2,
} from 'lucide-react'

type Source = 'manual' | 'naver' | 'kakao' | 'insta_link' | 'insta_dm' | 'link'
type Status = 'pending' | 'confirmed' | 'done' | 'canceled' | 'no_show'

interface Ev {
  id: string
  office_broker_id: string
  owner_broker_id: string | null
  starts_at: string | null
  title: string
  memo: string | null
  amount: number | null
  paid_amount: number | null
  customer_name: string | null
  customer_phone: string | null
  source: Source
  source_text: string | null
  status: Status
  confirmed_at: string | null
  created_at: string
  photos: string[] | null
}
interface Feedback { id: string; author_broker_id: string | null; event_id: string | null; body: string; resolved: boolean; created_at: string }
// 목록에 받는 칸 — Ev·Feedback 에 칸을 더하면 여기도 더할 것('*' 는 안 쓰는 칸까지 받았다)
const EV_COLS = 'id, office_broker_id, owner_broker_id, starts_at, title, memo, amount, paid_amount, customer_name, customer_phone, source, source_text, status, confirmed_at, created_at, photos'
const FB_COLS = 'id, author_broker_id, event_id, body, resolved, created_at'

const SOURCE_LABEL: Record<Source, string> = {
  manual: '직접 입력', naver: '네이버예약', kakao: '카톡 채널', insta_link: '인스타 링크', insta_dm: '인스타 DM', link: '예약 링크',
}
const SOURCE_COLOR: Record<Source, string> = {
  manual: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  naver: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  kakao: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300',
  insta_link: 'bg-pink-100 text-pink-800 dark:bg-pink-900/40 dark:text-pink-300',
  insta_dm: 'bg-pink-100 text-pink-800 dark:bg-pink-900/40 dark:text-pink-300',
  link: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
}
const STATUS_LABEL: Record<Status, string> = {
  pending: '확인 필요', confirmed: '확정', done: '완료', canceled: '취소', no_show: '노쇼',
}
const DOT: Record<Status, string> = {
  pending: 'bg-red-500', confirmed: 'bg-blue-600', done: 'bg-gray-400', canceled: 'bg-gray-300', no_show: 'bg-gray-400',
}
const CHIP: Record<Status, string> = {
  pending: 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  confirmed: 'bg-blue-50 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  done: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
  canceled: 'bg-gray-100 text-gray-400 line-through',
  no_show: 'bg-gray-100 text-gray-500 line-through dark:bg-gray-800',
}
/** 이만큼 지나도 확인 안 하면 '놓친 예약'으로 본다 */
const MISSED_HOURS = 3

const won = (n: number | null | undefined) => (n == null ? '' : `${n.toLocaleString()}원`)
const WEEK = ['일', '월', '화', '수', '목', '금', '토']
/** YYYY-MM-DD → 11월 8일(토) — 요일은 UTC 로 센다(보는 곳에 따라 밀리지 않게) */
function dayLabel(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`)
  return `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일(${WEEK[d.getUTCDay()]})`
}
function timeLabel(hm: string): string {
  const [h, m] = hm.split(':').map(Number)
  const ap = h < 12 ? '오전' : '오후'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${ap} ${h12}시${m ? ` ${m}분` : ''}`
}
function whenLabel(iso: string | null): string {
  if (!iso) return '날짜 미정'
  return `${dayLabel(ymdKST(iso))} ${timeLabel(hmKST(iso))}`
}
/** 확정 안내 문구 — 손님이 처음 연락한 카톡·DM에 붙여 넣는다(알림톡 대신, 무료). 예약금 안내가 있으면 뒤에 붙인다 */
function confirmText(e: Ev, deposit?: string | null): string {
  const who = e.customer_name ? `${e.customer_name}님, ` : ''
  const base = `${who}${whenLabel(e.starts_at)} ${e.title} 예약 확정되었습니다. 감사합니다.`
  return deposit && e.paid_amount == null ? `${base}\n\n${deposit}` : base
}
const phoneKey = (p: string | null) => (p ?? '').replace(/\D/g, '')
function hoursSince(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / 3_600_000
}

type Tab = 'calendar' | 'pending' | 'upcoming' | 'past' | 'stats'

interface FormState {
  id?: string
  date: string; time: string; title: string; customer_name: string; customer_phone: string
  amount: string; source: Source; memo: string; source_text: string; status: Status
}
const emptyForm = (): FormState => ({
  date: todayKST(), time: '', title: '', customer_name: '', customer_phone: '',
  amount: '', source: 'manual', memo: '', source_text: '', status: 'confirmed',
})

export default function EventsPage() {
  const router = useRouter()
  const auth = useAuth()
  const supabase = createClient()
  const toast = useToast()

  const b = auth.broker
  const isOwner = !!b && b.is_owner !== false
  const officeId = b ? (isOwner ? b.id : b.parent_broker_id ?? null) : null
  const allowed = canUseEvents(b)

  const [events, setEvents] = useState<Ev[]>([])
  const [feedback, setFeedback] = useState<Feedback[]>([])
  const [names, setNames] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('calendar')
  const [month, setMonth] = useState(() => todayKST().slice(0, 7))   // YYYY-MM (한국 기준)
  const [selDay, setSelDay] = useState(() => todayKST())
  const [form, setForm] = useState<FormState | null>(null)
  const [saving, setSaving] = useState(false)
  const [fbOpen, setFbOpen] = useState<{ eventId: string | null } | null>(null)
  const [fbText, setFbText] = useState('')
  const [linkOpen, setLinkOpen] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const [deposits, setDeposits] = useState<Record<string, string>>({})   // 담당 → 예약금 안내
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({}) // 저장 경로 → 잠깐 열리는 주소

  useEffect(() => {
    if (auth.loading) return
    if (!auth.user || !b) { router.push('/auth/login'); return }
    if (!allowed || !officeId) { setLoading(false); return }
    load()
    // allowed 도 본다 — 폰에 저장된 예전 계정 정보(events 표시 전)로 먼저 열리면 목록을 안 불러오고,
    // 새 정보가 와도 id 가 같아 다시 안 불러서 빈 화면이 남았다(11-05 대표 화면).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.loading, auth.user?.id, b?.id, allowed, officeId])

  const load = async () => {
    setLoading(true)
    // 일정은 이어받는다 — .limit(1000) 이면 1,000건을 넘는 순간 오래된 순 끝쪽, 곧 가장 최근·앞으로의
    // 일정이 말없이 빠졌다(달력·시험 현황·단골 기록이 전부 이 목록을 본다). 쪽이 겹치지 않게 id 로도 줄 세운다.
    const evAll = fetchAllPaged<Ev>((from, to) => supabase.from('office_events').select(EV_COLS).eq('office_broker_id', officeId!)
      .order('starts_at', { ascending: true, nullsFirst: true }).order('id').range(from, to) as unknown as PromiseLike<{ data: Ev[] | null; error: unknown }>)
      .then(data => ({ data, error: null as { message: string } | null }), (e: { message?: string }) => ({ data: null as Ev[] | null, error: { message: e?.message ?? String(e) } }))
    const [{ data: ev, error }, { data: fb }, { data: pages }] = await Promise.all([
      evAll,
      supabase.from('office_event_feedback').select(FB_COLS).eq('office_broker_id', officeId!)
        .order('created_at', { ascending: false }).limit(200),
      supabase.from('office_booking_pages').select('owner_broker_id, deposit_text').eq('office_broker_id', officeId!),
    ])
    if (error) toast.error(`불러오기 실패: ${error.message}`)
    const list = (ev ?? []) as Ev[]
    setEvents(list)
    setFeedback((fb ?? []) as Feedback[])
    const dm: Record<string, string> = {}
    for (const p of (pages ?? []) as { owner_broker_id: string; deposit_text: string | null }[]) if (p.deposit_text) dm[p.owner_broker_id] = p.deposit_text
    setDeposits(dm)
    // 손님 사진 — 한 번에 묶어 잠깐 열리는 주소를 받는다(비공개 보관함)
    const paths = list.flatMap(e => e.photos ?? [])
    if (paths.length) {
      const { data: signed } = await supabase.storage.from('booking-photos').createSignedUrls(paths, 3600)
      const pm: Record<string, string> = {}
      for (const x of signed ?? []) if (x.path && x.signedUrl) pm[x.path] = x.signedUrl
      setPhotoUrls(pm)
    }
    // 대표는 누구 예약인지 봐야 한다
    if (isOwner) {
      const ids = [...new Set([...list.map(e => e.owner_broker_id), ...((fb ?? []) as Feedback[]).map(f => f.author_broker_id)].filter(Boolean))] as string[]
      if (ids.length) {
        const { data: ps } = await supabase.from('broker_profiles').select('id, profiles:profiles_visible(name)').in('id', ids)
        const m: Record<string, string> = {}
        for (const p of (ps ?? []) as unknown as { id: string; profiles: { name: string | null } | null }[]) m[p.id] = p.profiles?.name ?? ''
        setNames(m)
      }
    }
    setLoading(false)
  }

  const today = todayKST()
  const groups = useMemo(() => {
    const pending = events.filter(e => e.status === 'pending')
      .sort((a, c) => a.created_at.localeCompare(c.created_at))
    const upcoming = events.filter(e => e.status === 'confirmed' && (!e.starts_at || ymdKST(e.starts_at) >= today))
    const past = events.filter(e => e.status !== 'pending' && !upcoming.includes(e))
      .sort((a, c) => (c.starts_at ?? c.created_at).localeCompare(a.starts_at ?? a.created_at))
    return { pending, upcoming, past }
  }, [events, today])

  // ── 단골 — 같은 번호의 예약을 시간순으로(취소 빼고) ──
  const history = useMemo(() => {
    const m: Record<string, Ev[]> = {}
    for (const e of events) {
      const k = phoneKey(e.customer_phone)
      if (k.length < 9 || e.status === 'canceled') continue
      ;(m[k] ??= []).push(e)
    }
    for (const k in m) m[k].sort((a, c) => (a.starts_at ?? a.created_at).localeCompare(c.starts_at ?? c.created_at))
    return m
  }, [events])
  const regular = (e: Ev): { nth: number; last: Ev } | null => {
    const h = history[phoneKey(e.customer_phone)]
    const i = h ? h.findIndex(x => x.id === e.id) : -1
    return i > 0 ? { nth: i + 1, last: h[i - 1] } : null
  }

  // ── 달력 ── 날짜는 전부 한국 기준 문자열로 센다(AGENTS.md)
  const byDay = useMemo(() => {
    const m: Record<string, Ev[]> = {}
    for (const e of events) {
      if (!e.starts_at || e.status === 'canceled') continue
      ;(m[ymdKST(e.starts_at)] ??= []).push(e)
    }
    for (const k in m) m[k].sort((a, c) => a.starts_at!.localeCompare(c.starts_at!))
    return m
  }, [events])
  const grid = useMemo(() => {
    const first = `${month}-01`
    const dow = new Date(`${first}T00:00:00Z`).getUTCDay()
    const start = addDays(first, -dow)
    // 그달이 걸친 주만(4~6줄) — 다음 달만 있는 빈 줄은 안 그린다
    const [y, m] = month.split('-').map(Number)
    const days = new Date(Date.UTC(y, m, 0)).getUTCDate()
    return Array.from({ length: Math.ceil((dow + days) / 7) * 7 }, (_, i) => addDays(start, i))
  }, [month])
  const moveMonth = (n: number) => {
    const [y, m] = month.split('-').map(Number)
    const d = new Date(Date.UTC(y, m - 1 + n, 1))
    setMonth(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`)
  }

  // ── 저장 ──
  const save = async () => {
    if (!form || !b || !officeId) return
    if (!form.title.trim()) { toast.error('내용을 적어 주세요'); return }
    const starts_at = form.date && form.time
      ? new Date(`${form.date}T${form.time}:00+09:00`).toISOString()
      : form.date ? new Date(`${form.date}T00:00:00+09:00`).toISOString() : null
    const amount = form.amount.trim() ? Number(form.amount.replace(/[^\d]/g, '')) : null
    const row = {
      starts_at, title: form.title.trim(), memo: form.memo.trim() || null, amount,
      customer_name: form.customer_name.trim() || null, customer_phone: form.customer_phone.trim() || null,
      source: form.source, source_text: form.source_text.trim() || null, status: form.status,
    }
    setSaving(true)
    const res = form.id
      ? await supabase.from('office_events').update(row).eq('id', form.id).select('*').single()
      : await supabase.from('office_events').insert({ ...row, office_broker_id: officeId, owner_broker_id: b.id }).select('*').single()
    setSaving(false)
    if (res.error) { toast.error(`저장 실패: ${res.error.message}`); return }
    const saved = res.data as Ev
    setEvents(prev => form.id ? prev.map(e => (e.id === saved.id ? saved : e)) : [...prev, saved])
    setForm(null)
    toast.success(form.id ? '고쳤어요' : '넣었어요')
  }

  const setStatus = async (e: Ev, status: Status) => {
    const patch: Partial<Ev> = { status }
    if (status === 'done') {
      const v = prompt('받은 금액(원)을 적어 주세요. 모르면 비워 두세요.', e.amount != null ? String(e.amount) : e.paid_amount != null ? String(e.paid_amount) : '')
      if (v === null) return
      patch.paid_amount = v.trim() ? Number(v.replace(/[^\d]/g, '')) : null
    }
    if (status === 'canceled' && !confirm('이 예약을 취소로 바꿀까요?')) return
    const { data, error } = await supabase.from('office_events').update(patch).eq('id', e.id).select('*').single()
    if (error) { toast.error(`바꾸기 실패: ${error.message}`); return }
    setEvents(prev => prev.map(x => (x.id === e.id ? (data as Ev) : x)))
    if (status === 'confirmed') copy(data as Ev)
  }

  /** 예약금 받음 — 받은 금액(paid_amount)에 적는다. 완료 때 다시 물을 때 기본값이 된다 */
  const markDeposit = async (e: Ev) => {
    const v = prompt('받은 예약금(원)을 적어 주세요. 지우면 안 받은 것으로 돌아가요.', e.paid_amount != null ? String(e.paid_amount) : '')
    if (v === null) return
    const paid_amount = v.trim() ? Number(v.replace(/[^\d]/g, '')) : null
    const { data, error } = await supabase.from('office_events').update({ paid_amount }).eq('id', e.id).select('*').single()
    if (error) { toast.error(`저장 실패: ${error.message}`); return }
    setEvents(prev => prev.map(x => (x.id === e.id ? (data as Ev) : x)))
  }

  const copy = async (e: Ev) => {
    try {
      await navigator.clipboard.writeText(confirmText(e, deposits[e.owner_broker_id ?? '']))
      setCopied(e.id)
      setTimeout(() => setCopied(c => (c === e.id ? null : c)), 2000)
      toast.success('안내 문구를 복사했어요 — 손님 카톡·DM에 붙여 넣으세요')
    } catch {
      prompt('아래 문구를 길게 눌러 복사하세요', confirmText(e, deposits[e.owner_broker_id ?? '']))
    }
  }

  const openEdit = (e: Ev) => setForm({
    id: e.id,
    date: e.starts_at ? ymdKST(e.starts_at) : '', time: e.starts_at ? hmKST(e.starts_at) : '',
    title: e.title, customer_name: e.customer_name ?? '', customer_phone: e.customer_phone ?? '',
    amount: e.amount != null ? String(e.amount) : '', source: e.source, memo: e.memo ?? '',
    source_text: e.source_text ?? '', status: e.status,
  })

  const sendFeedback = async () => {
    if (!b || !officeId || !fbText.trim()) return
    const { data, error } = await supabase.from('office_event_feedback')
      .insert({ office_broker_id: officeId, author_broker_id: b.id, event_id: fbOpen?.eventId ?? null, body: fbText.trim() })
      .select('*').single()
    if (error) { toast.error(`보내기 실패: ${error.message}`); return }
    setFeedback(prev => [data as Feedback, ...prev])
    setFbOpen(null); setFbText('')
    toast.success('불편한 점을 남겼어요. 고마워요!')
  }

  const toggleResolved = async (f: Feedback) => {
    const { error } = await supabase.from('office_event_feedback').update({ resolved: !f.resolved }).eq('id', f.id)
    if (error) { toast.error(error.message); return }
    setFeedback(prev => prev.map(x => (x.id === f.id ? { ...x, resolved: !x.resolved } : x)))
  }

  /** 예약 카드 한 장 — 목록 탭과 달력 아래 '그날 예약'이 같이 쓴다 */
  const renderCard = (e: Ev, i: number, arr: Ev[], withDay: boolean) => {
              const newDay = withDay && e.starts_at && (i === 0 || ymdKST(arr[i - 1].starts_at ?? '') !== ymdKST(e.starts_at))
              const late = e.status === 'pending' && hoursSince(e.created_at) >= MISSED_HOURS
              const reg = regular(e)
              return (
                <li key={e.id}>
                  {newDay && (
                    <p className="mb-1 mt-3 px-1 text-xs font-bold text-gray-500">
                      {ymdKST(e.starts_at!) === today ? '오늘 · ' : ''}{dayLabel(ymdKST(e.starts_at!))}
                    </p>
                  )}
                  <div className={`rounded-xl border bg-white p-3 dark:bg-gray-900 ${late ? 'border-red-300 dark:border-red-800' : 'border-gray-200 dark:border-gray-800'}`}>
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5 text-xs">
                          <span className={`rounded px-1.5 py-0.5 font-semibold ${SOURCE_COLOR[e.source]}`}>{SOURCE_LABEL[e.source]}</span>
                          {e.status !== 'pending' && e.status !== 'confirmed' && (
                            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-gray-600 dark:bg-gray-800 dark:text-gray-400">{STATUS_LABEL[e.status]}</span>
                          )}
                          {late && <span className="font-semibold text-red-600">{Math.floor(hoursSince(e.created_at))}시간째 확인 안 함</span>}
                          {isOwner && e.owner_broker_id && names[e.owner_broker_id] && <span className="text-gray-400">· {names[e.owner_broker_id]}</span>}
                          {reg && <span className="rounded bg-violet-100 px-1.5 py-0.5 font-semibold text-violet-800 dark:bg-violet-900/40 dark:text-violet-300">단골 · {reg.nth}번째</span>}
                        </div>
                        <p className="mt-1 font-semibold text-gray-900 dark:text-white">{whenLabel(e.starts_at)}</p>
                        <p className="text-sm text-gray-800 dark:text-gray-200 break-words">{e.title}{e.amount != null && <span className="ml-1 text-gray-500">· {won(e.amount)}</span>}</p>
                        <p className="mt-0.5 flex flex-wrap items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                          {e.customer_name && <span>{e.customer_name}</span>}
                          {e.customer_phone && (
                            <a href={`tel:${e.customer_phone.replace(/[^\d+]/g, '')}`} className="flex items-center gap-0.5 text-blue-600"><Phone className="h-3.5 w-3.5" />{e.customer_phone}</a>
                          )}
                          {e.status === 'done' && e.paid_amount != null && <span className="text-green-700">받은 금액 {won(e.paid_amount)}</span>}
                          {(e.status === 'pending' || e.status === 'confirmed') && e.paid_amount != null && <span className="text-green-700">예약금 {won(e.paid_amount)} 받음</span>}
                        </p>
                        {reg && <p className="mt-0.5 text-xs text-violet-700 dark:text-violet-300">지난번 {reg.last.starts_at ? dayLabel(ymdKST(reg.last.starts_at)) : ''} {reg.last.title}</p>}
                        {(e.photos?.length ?? 0) > 0 && (
                          <div className="mt-1.5 flex gap-1.5">
                            {e.photos!.map(p => photoUrls[p] ? (
                              <a key={p} href={photoUrls[p]} target="_blank" rel="noreferrer" className="block h-14 w-14 overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={photoUrls[p]} alt="손님 사진" className="h-full w-full object-cover" />
                              </a>
                            ) : <span key={p} className="flex h-14 w-14 items-center justify-center rounded-lg bg-gray-100 text-[10px] text-gray-400 dark:bg-gray-800">사진</span>)}
                          </div>
                        )}
                        {e.memo && <p className="mt-1 whitespace-pre-wrap text-xs text-gray-500">{e.memo}</p>}
                        {e.source_text && (
                          <details className="mt-1 text-xs text-gray-500">
                            <summary className="cursor-pointer">원문 보기</summary>
                            <p className="mt-1 whitespace-pre-wrap rounded bg-gray-50 p-2 dark:bg-gray-800">{e.source_text}</p>
                          </details>
                        )}
                      </div>
                      <button onClick={() => openEdit(e)} aria-label="고치기" className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"><Pencil className="h-4 w-4" /></button>
                    </div>
                    <div className="mt-2 flex flex-wrap justify-end gap-2">
                      {e.status === 'pending' && <>
                        <Btn onClick={() => setStatus(e, 'canceled')} tone="gray"><X className="h-3.5 w-3.5" />취소</Btn>
                        <Btn onClick={() => setStatus(e, 'confirmed')} tone="blue"><Check className="h-3.5 w-3.5" />확정</Btn>
                      </>}
                      {e.status === 'confirmed' && <>
                        <Btn onClick={() => markDeposit(e)} tone="gray">{e.paid_amount != null ? '예약금 고치기' : '예약금 받음'}</Btn>
                        <Btn onClick={() => copy(e)} tone="gray">{copied === e.id ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}안내 문구</Btn>
                        <Btn onClick={() => setStatus(e, 'canceled')} tone="gray">취소</Btn>
                        <Btn onClick={() => setStatus(e, 'no_show')} tone="gray">노쇼</Btn>
                        <Btn onClick={() => setStatus(e, 'done')} tone="green"><Check className="h-3.5 w-3.5" />완료</Btn>
                      </>}
                      <Btn onClick={() => { setFbOpen({ eventId: e.id }); setFbText('') }} tone="amber"><MessageSquareWarning className="h-3.5 w-3.5" />불편</Btn>
                    </div>
                  </div>
                </li>
              )
  }

  if (!auth.loading && b && !allowed) {
    return (
      <div className="bg-gray-50 dark:bg-gray-950 min-h-screen">
        <Header />
        <section className="mx-auto max-w-3xl px-4 py-16 text-center text-sm text-gray-500">
          예약관리는 아직 시험 중인 기능이에요.
        </section>
      </div>
    )
  }

  const list = tab === 'pending' ? groups.pending : tab === 'upcoming' ? groups.upcoming : groups.past
  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: 'calendar', label: '달력' },
    { id: 'pending', label: '확인 필요', count: groups.pending.length },
    { id: 'upcoming', label: '다가오는', count: groups.upcoming.length },
    { id: 'past', label: '지난·완료' },
    ...(isOwner ? [{ id: 'stats' as Tab, label: '시험 현황' }] : []),
  ]

  return (
    <div className="bg-gray-50 dark:bg-gray-950 min-h-screen">
      <Header />
      <section className="mx-auto max-w-3xl px-4 py-6">
        <div className="mb-4 flex flex-wrap items-start gap-2">
          <h1 className="mr-auto text-2xl font-bold text-gray-900 dark:text-white">예약관리</h1>
          <button onClick={() => setLinkOpen(true)}
            className="flex items-center gap-1.5 rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300">
            <Link2 className="h-4 w-4" />예약 링크
          </button>
          <button onClick={() => { setFbOpen({ eventId: null }); setFbText('') }}
            className="flex items-center gap-1.5 rounded-xl border border-amber-300 bg-white px-3 py-2 text-sm font-semibold text-amber-700 hover:bg-amber-50 dark:bg-gray-900">
            <MessageSquareWarning className="h-4 w-4" />불편 신고
          </button>
          <button onClick={() => setForm({ ...emptyForm(), date: tab === 'calendar' ? selDay : todayKST() })}
            className="flex items-center gap-1.5 rounded-xl bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700">
            <Plus className="h-4 w-4" />새 예약
          </button>
        </div>

        <div className="mb-4 flex overflow-x-auto rounded-xl border border-gray-200 bg-white p-1 dark:border-gray-800 dark:bg-gray-900">
          {tabs.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex flex-1 shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-lg px-2 py-2 text-sm font-semibold transition-colors ${tab === t.id ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-gray-800'}`}>
              {t.id === 'stats' && <BarChart3 className="h-4 w-4" />}
              {t.id === 'calendar' && <CalendarDays className="h-4 w-4" />}
              {t.label}
              {!!t.count && <span className={`rounded-full px-1.5 text-xs ${tab === t.id ? 'bg-white/20' : t.id === 'pending' ? 'bg-red-500 text-white' : 'bg-gray-100 dark:bg-gray-800'}`}>{t.count}</span>}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="py-20 text-center text-sm text-gray-500">불러오는 중...</div>
        ) : tab === 'calendar' ? (
          <div>
            <div className="mb-2 flex items-center gap-1">
              <button onClick={() => moveMonth(-1)} aria-label="이전 달" className="rounded-lg p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800"><ChevronLeft className="h-5 w-5 text-gray-600" /></button>
              <h2 className="min-w-[5.5rem] text-center text-lg font-bold tabular-nums text-gray-900 dark:text-white">{month.replace('-', '.')}</h2>
              <button onClick={() => moveMonth(1)} aria-label="다음 달" className="rounded-lg p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800"><ChevronRight className="h-5 w-5 text-gray-600" /></button>
              <button onClick={() => { setMonth(today.slice(0, 7)); setSelDay(today) }}
                className="ml-1 rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-semibold text-gray-600 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800">오늘</button>
              <span className="ml-auto flex items-center gap-2 text-[11px] text-gray-500">
                <span className="flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-red-500" />확인 필요</span>
                <span className="flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-blue-600" />확정</span>
                <span className="hidden items-center gap-1 sm:flex"><i className="h-2 w-2 rounded-full bg-gray-400" />완료</span>
              </span>
            </div>
            <div className="mb-1 grid grid-cols-7 text-center text-xs font-semibold text-gray-400">
              {WEEK.map((w, i) => <div key={w} className={i === 0 ? 'text-rose-400' : i === 6 ? 'text-blue-400' : ''}>{w}</div>)}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {grid.map((d, idx) => {
                const inMonth = d.startsWith(month)
                const evs = byDay[d] ?? []
                const sel = d === selDay
                const dow = idx % 7
                return (
                  <button key={d} onClick={() => setSelDay(d)}
                    className={`flex min-h-[56px] flex-col items-start justify-start rounded-lg border p-1 text-left sm:min-h-[92px] ${sel ? 'border-blue-500 ring-1 ring-blue-500' : inMonth ? 'border-gray-100 dark:border-gray-800' : 'border-transparent'} ${inMonth ? 'bg-white dark:bg-gray-900' : 'bg-gray-50/60 dark:bg-gray-950'}`}>
                    <span className={`text-xs font-semibold ${d === today ? 'inline-flex h-5 w-5 items-center justify-center rounded-full bg-blue-600 text-white' : !inMonth ? 'text-gray-300 dark:text-gray-700' : dow === 0 ? 'text-rose-500' : dow === 6 ? 'text-blue-500' : 'text-gray-700 dark:text-gray-300'}`}>
                      {Number(d.slice(8))}
                    </span>
                    {/* 폰: 점만 / 큰 화면: 시간·내용 3줄 */}
                    <div className="mt-0.5 flex flex-wrap gap-0.5 sm:hidden">
                      {evs.slice(0, 4).map(e => <i key={e.id} className={`h-1.5 w-1.5 rounded-full ${DOT[e.status]}`} />)}
                      {evs.length > 4 && <span className="text-[9px] leading-none text-gray-400">+{evs.length - 4}</span>}
                    </div>
                    <div className="mt-0.5 hidden w-full space-y-0.5 sm:block">
                      {evs.slice(0, 3).map(e => (
                        <div key={e.id} className={`truncate rounded px-1 py-0.5 text-[10px] font-medium leading-tight ${CHIP[e.status]}`}>
                          <span className="tabular-nums opacity-70">{hmKST(e.starts_at!)} </span>{e.title}
                        </div>
                      ))}
                      {evs.length > 3 && <div className="px-1 text-[10px] text-gray-400">+{evs.length - 3}</div>}
                    </div>
                  </button>
                )
              })}
            </div>
            <p className="mb-2 mt-4 px-1 text-sm font-bold text-gray-700 dark:text-gray-300">
              {selDay === today ? '오늘 · ' : ''}{dayLabel(selDay)} 예약 {(byDay[selDay] ?? []).length}건
            </p>
            {(byDay[selDay] ?? []).length === 0 ? (
              <div className="rounded-xl border border-dashed border-gray-300 py-8 text-center text-sm text-gray-500 dark:border-gray-700">이날은 예약이 없어요</div>
            ) : (
              <ul className="space-y-2">{(byDay[selDay] ?? []).map((e, i, arr) => renderCard(e, i, arr, false))}</ul>
            )}
            {groups.pending.some(e => !e.starts_at) && (
              <p className="mt-3 text-xs text-gray-500">날짜가 정해지지 않은 예약은 <button onClick={() => setTab('pending')} className="font-semibold text-blue-600 underline">확인 필요</button>에 있어요.</p>
            )}
          </div>
        ) : tab === 'stats' ? (
          <Stats events={events} feedback={feedback} names={names} onToggle={toggleResolved} />
        ) : list.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-300 py-14 text-center text-sm text-gray-500 dark:border-gray-700">
            {tab === 'pending' ? '확인할 예약이 없어요' : tab === 'upcoming' ? '다가오는 예약이 없어요' : '지난 예약이 없어요'}
          </div>
        ) : (
          <ul className="space-y-2">
            {list.map((e, i) => renderCard(e, i, list, tab === 'upcoming'))}
          </ul>
        )}
      </section>

      {/* 넣기·고치기 */}
      {form && (
        <Sheet title={form.id ? '예약 고치기' : '새 예약'} onClose={() => setForm(null)}>
          <div className="grid grid-cols-2 gap-2">
            <Field label="날짜"><input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} className={inp} /></Field>
            <Field label="시간"><input type="time" value={form.time} onChange={e => setForm({ ...form, time: e.target.value })} className={inp} /></Field>
          </div>
          <Field label="내용 *"><input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="예: 꽃다발 3만원, 픽업" className={inp} /></Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="손님 이름"><input value={form.customer_name} onChange={e => setForm({ ...form, customer_name: e.target.value })} className={inp} /></Field>
            <Field label="연락처"><input type="tel" value={form.customer_phone} onChange={e => setForm({ ...form, customer_phone: e.target.value })} className={inp} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="금액(원)"><input inputMode="numeric" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} className={inp} /></Field>
            <Field label="들어온 곳">
              <select value={form.source} onChange={e => setForm({ ...form, source: e.target.value as Source })} className={inp}>
                {(Object.keys(SOURCE_LABEL) as Source[]).map(s => <option key={s} value={s}>{SOURCE_LABEL[s]}</option>)}
              </select>
            </Field>
          </div>
          <Field label="상태">
            <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value as Status })} className={inp}>
              {(Object.keys(STATUS_LABEL) as Status[]).map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </select>
          </Field>
          <Field label="메모"><textarea rows={2} value={form.memo} onChange={e => setForm({ ...form, memo: e.target.value })} className={inp} /></Field>
          <Field label="손님이 보낸 원문(붙여넣기)"><textarea rows={3} value={form.source_text} onChange={e => setForm({ ...form, source_text: e.target.value })} placeholder="카톡·DM 내용을 붙여 두면 나중에 확인하기 쉬워요" className={inp} /></Field>
          <button onClick={save} disabled={saving} className="mt-1 w-full rounded-lg bg-blue-600 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
            {saving ? '저장 중...' : '저장'}
          </button>
        </Sheet>
      )}

      {/* 예약 링크 페이지 설정 */}
      {linkOpen && officeId && b && (
        <Sheet title="예약 링크" onClose={() => setLinkOpen(false)}>
          <BookingSettings officeId={officeId} myId={b.id} isOwner={isOwner} />
        </Sheet>
      )}

      {/* 불편 신고 */}
      {fbOpen && (
        <Sheet title="불편한 점 남기기" onClose={() => setFbOpen(null)}>
          <p className="text-xs text-gray-500">쓰다가 막히거나 번거로운 점을 한 줄로 남겨 주세요. 대표님이 보고 고쳐요.</p>
          <textarea autoFocus rows={4} value={fbText} onChange={e => setFbText(e.target.value)} placeholder="예: 인스타 DM 예약을 옮겨 적기가 번거로워요" className={inp} />
          <button onClick={sendFeedback} disabled={!fbText.trim()} className="w-full rounded-lg bg-amber-500 py-3 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-50">보내기</button>
        </Sheet>
      )}
    </div>
  )
}

const inp = 'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-white'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1 block text-xs font-semibold text-gray-600 dark:text-gray-400">{label}</span>{children}</label>
}

function Btn({ onClick, tone, children }: { onClick: () => void; tone: 'blue' | 'green' | 'gray' | 'amber'; children: React.ReactNode }) {
  const c = {
    blue: 'bg-blue-600 text-white hover:bg-blue-700',
    green: 'bg-green-600 text-white hover:bg-green-700',
    gray: 'border border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800',
    amber: 'border border-amber-200 text-amber-700 hover:bg-amber-50 dark:border-amber-900 dark:text-amber-400',
  }[tone]
  return <button onClick={onClick} className={`flex items-center gap-1 rounded-lg px-3 py-2 text-xs font-semibold ${c}`}>{children}</button>
}

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEscape(true, onClose)
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div role="dialog" aria-label={title} onClick={e => e.stopPropagation()}
        className="max-h-[90vh] w-full space-y-3 overflow-y-auto rounded-t-2xl bg-white p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:max-w-md sm:rounded-2xl dark:bg-gray-900">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-gray-900 dark:text-white">{title}</h2>
          <button onClick={onClose} aria-label="닫기" className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"><X className="h-5 w-5" /></button>
        </div>
        {children}
      </div>
    </div>
  )
}

/** 대표만 — 시험이 잘 되고 있나. 최근 30일 */
function Stats({ events, feedback, names, onToggle }: {
  events: Ev[]; feedback: Feedback[]; names: Record<string, string>; onToggle: (f: Feedback) => void
}) {
  const since = Date.now() - 30 * 86_400_000
  const recent = events.filter(e => new Date(e.created_at).getTime() >= since)
  const bySource = (Object.keys(SOURCE_LABEL) as Source[]).map(s => {
    const rows = recent.filter(e => e.source === s)
    return {
      s, count: rows.length,
      expected: rows.filter(e => e.status !== 'canceled').reduce((a, e) => a + (e.amount ?? 0), 0),
      paid: rows.filter(e => e.status === 'done').reduce((a, e) => a + (e.paid_amount ?? 0), 0),
    }
  }).filter(r => r.count > 0)
  const confirmGaps = recent.filter(e => e.confirmed_at).map(e => (new Date(e.confirmed_at!).getTime() - new Date(e.created_at).getTime()) / 3_600_000)
  const avgGap = confirmGaps.length ? confirmGaps.reduce((a, x) => a + x, 0) / confirmGaps.length : null
  const missed = events.filter(e => e.status === 'pending' && hoursSince(e.created_at) >= MISSED_HOURS)
  const count = (st: Status) => recent.filter(e => e.status === st).length
  const card = 'rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900'

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          ['최근 30일 예약', `${recent.length}건`],
          ['완료 / 노쇼 / 취소', `${count('done')} / ${count('no_show')} / ${count('canceled')}`],
          ['확인까지 평균', avgGap == null ? '-' : avgGap < 1 ? `${Math.round(avgGap * 60)}분` : `${avgGap.toFixed(1)}시간`],
          ['지금 놓친 예약', `${missed.length}건`],
        ].map(([k, v]) => (
          <div key={k} className={card}>
            <p className="text-xs text-gray-500">{k}</p>
            <p className={`mt-1 text-lg font-bold ${k === '지금 놓친 예약' && missed.length ? 'text-red-600' : 'text-gray-900 dark:text-white'}`}>{v}</p>
          </div>
        ))}
      </div>

      <div className={card}>
        <h3 className="mb-2 text-sm font-bold text-gray-900 dark:text-white">들어온 곳별 (최근 30일)</h3>
        {bySource.length === 0 ? <p className="text-sm text-gray-500">아직 예약이 없어요</p> : (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-gray-500"><th className="py-1 font-medium">들어온 곳</th><th className="text-right font-medium">건수</th><th className="text-right font-medium">예상 금액</th><th className="text-right font-medium">받은 금액</th></tr></thead>
            <tbody>
              {bySource.map(r => (
                <tr key={r.s} className="border-t border-gray-100 dark:border-gray-800">
                  <td className="py-1.5"><span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${SOURCE_COLOR[r.s]}`}>{SOURCE_LABEL[r.s]}</span></td>
                  <td className="text-right">{r.count}</td>
                  <td className="text-right">{won(r.expected)}</td>
                  <td className="text-right">{won(r.paid)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {missed.length > 0 && (
        <div className={`${card} border-red-200 dark:border-red-900`}>
          <h3 className="mb-2 flex items-center gap-1 text-sm font-bold text-red-700"><AlertTriangle className="h-4 w-4" />{MISSED_HOURS}시간 넘게 확인 안 한 예약</h3>
          <ul className="space-y-1 text-sm">
            {missed.map(e => (
              <li key={e.id} className="text-gray-700 dark:text-gray-300">
                {SOURCE_LABEL[e.source]} · {e.customer_name ?? '이름 없음'} · {e.title} <span className="text-red-600">({Math.floor(hoursSince(e.created_at))}시간째)</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className={card}>
        <h3 className="mb-2 text-sm font-bold text-gray-900 dark:text-white">불편 신고 ({feedback.filter(f => !f.resolved).length}건 남음)</h3>
        {feedback.length === 0 ? <p className="text-sm text-gray-500">아직 신고가 없어요</p> : (
          <ul className="space-y-2">
            {feedback.map(f => {
              const ev = f.event_id ? events.find(e => e.id === f.event_id) : null
              return (
                <li key={f.id} className={`flex items-start gap-2 text-sm ${f.resolved ? 'opacity-50' : ''}`}>
                  <input type="checkbox" checked={f.resolved} onChange={() => onToggle(f)} aria-label="해결" className="mt-1 h-4 w-4" />
                  <div className="min-w-0 flex-1">
                    <p className={`whitespace-pre-wrap text-gray-800 dark:text-gray-200 ${f.resolved ? 'line-through' : ''}`}>{f.body}</p>
                    <p className="text-xs text-gray-500">
                      {(f.author_broker_id && names[f.author_broker_id]) || ''} · {ymdKST(f.created_at)} {hmKST(f.created_at)}
                      {ev && ` · ${ev.title}`}
                    </p>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
