'use client'

import { useEffect, useState, useRef, useCallback, useMemo, useId } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { refreshOfficeChatUnread } from '@/lib/use-office-chat-unread'
import { isMessageSoundOn, setMessageSoundOn, playMessageSound } from '@/lib/message-sound'
import { useAuth } from '@/lib/auth-context'
import { Header } from '@/components/layout/header'
import { useToast } from '@/components/toast'
import { cn } from '@/lib/utils'
import {
  User, MessageCircle, MoreHorizontal, Plus, Search, X, Hash, Users, Pin, BellOff, Bell, Camera, ChevronRight, MessageSquare, Volume2, VolumeX,
} from 'lucide-react'
import { ChatRoom, Avatar } from './chat-room'
import {
  type Thread, type Msg, type Member, type MyRow,
  CHAT_BUCKET, chatStoragePath, listTimeLabel, previewText,
} from './shared'

type Tab = 'friends' | 'chats' | 'more'
interface Preview { id: string; text: string; at: string }

/**
 * 사내 메신저 — 카톡처럼 친구·채팅·더보기 세 칸.
 * 대화방 종류: 사무소 전체(group, 사무소당 하나) · 1:1(dm) · 단체방(team).
 * 방 안의 일(메시지·공감·공지·서랍·검색)은 ChatRoom 이 맡고, 여기는 목록·프로필·방 만들기를 맡는다.
 */
export default function BrokerMessengerPage() {
  const supabase = useMemo(() => createClient(), [])
  const router = useRouter()
  const auth = useAuth()
  const toast = useToast()

  const office = auth.broker ? (auth.broker.is_owner !== false ? auth.broker.id : auth.broker.parent_broker_id) : null
  const myId = auth.broker?.id ?? null

  const [tab, setTab] = useState<Tab>('chats')
  const [soundOn, setSoundOn] = useState(true)
  useEffect(() => { setSoundOn(isMessageSoundOn()) }, [])
  const toggleSound = () => {
    const next = !soundOn
    setSoundOn(next); setMessageSoundOn(next)
    if (next) playMessageSound()
  }
  const [members, setMembers] = useState<Member[]>([])
  const [threads, setThreads] = useState<Thread[]>([])
  const [myRows, setMyRows] = useState<Record<string, MyRow>>({})
  const [previews, setPreviews] = useState<Record<string, Preview>>({})
  const [unread, setUnread] = useState<Record<string, number>>({})
  const [active, setActive] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [profileOf, setProfileOf] = useState<string | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [showInvite, setShowInvite] = useState(false)

  const activeRef = useRef<string | null>(null)
  activeRef.current = active

  const memberById = useMemo(() => Object.fromEntries(members.map(m => [m.id, m])), [members])
  const me = myId ? memberById[myId] ?? null : null

  const otherOfDm = useCallback((t: Thread) => {
    if (t.kind !== 'dm' || !t.dm_key || !myId) return null
    const [a, b] = t.dm_key.split('__')
    return a === myId ? b : a // 나와의 채팅은 a === b === 나
  }, [myId])
  const isSelf = useCallback((t: Thread) => otherOfDm(t) === myId, [otherOfDm, myId])
  const threadLabel = useCallback((t: Thread) => {
    if (t.kind === 'group') return '사무소 전체'
    if (t.kind === 'team') return t.title || '단체방'
    if (isSelf(t)) return '나와의 채팅'
    const other = otherOfDm(t)
    return other ? (memberById[other]?.name ?? '(퇴사)') : '대화'
  }, [otherOfDm, isSelf, memberById])

  // ── 불러오기 ─────────────────────────────────────────
  const loadMembers = useCallback(async () => {
    if (!office) return
    const { data: rows } = await supabase
      .from('broker_profiles')
      .select('id, is_owner, is_approved, profiles:user_id(name)')
      .or(`id.eq.${office},parent_broker_id.eq.${office}`)
    const list = ((rows ?? []) as { id: string; is_owner: boolean | null; is_approved: boolean | null; profiles: { name: string | null } | { name: string | null }[] | null }[])
      .filter(m => m.is_owner || m.is_approved)
    const { data: prof } = await supabase.from('office_chat_profiles').select('broker_id, status_message, avatar_path')
      .in('broker_id', list.map(m => m.id))
    const pmap = new Map((prof ?? []).map(p => [p.broker_id, p]))
    setMembers(list.map(m => {
      const p = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles
      return { id: m.id, name: p?.name ?? '직원', status: pmap.get(m.id)?.status_message ?? null, avatarPath: pmap.get(m.id)?.avatar_path ?? null }
    }).sort((a, b) => a.name.localeCompare(b.name, 'ko')))
  }, [office, supabase])

  const loadThreads = useCallback(async () => {
    if (!office || !myId) return
    // 사무소 전체방(group)은 저절로 만들지 않는다 — 2026-11-02 사장님이 지우고 단체방으로 직접 만들기로 했다.
    // 이미 있는 사무소의 전체방은 그대로 보인다.
    const [{ data: mine }, { data: all }] = await Promise.all([
      supabase.from('office_chat_members').select('thread_id, last_read_at, pinned_at, muted').eq('broker_id', myId),
      // RLS(oct_select)가 사무소 전체방 + 내가 멤버인 방만 돌려준다
      supabase.from('office_chat_threads').select('*').eq('office_broker_id', office),
    ])
    const rows: Record<string, MyRow> = {}
    for (const r of mine ?? []) rows[r.thread_id] = { last_read_at: r.last_read_at, pinned_at: r.pinned_at, muted: r.muted }
    const list = (all ?? []) as Thread[]
    setMyRows(rows)
    setThreads(list)

    const pv: Record<string, Preview> = {}
    const uc: Record<string, number> = {}
    await Promise.all(list.map(async t => {
      const { data: last } = await supabase.from('office_chat_messages')
        .select('id, body, image_url, image_paths, file_url, file_name, deleted_at, created_at')
        .eq('thread_id', t.id).order('created_at', { ascending: false }).limit(1).maybeSingle()
      if (last) pv[t.id] = { id: last.id, text: previewText(last), at: last.created_at }
      let cq = supabase.from('office_chat_messages').select('id', { count: 'exact', head: true })
        .eq('thread_id', t.id).neq('sender_broker_id', myId)
      if (rows[t.id]?.last_read_at) cq = cq.gt('created_at', rows[t.id].last_read_at!)
      const { count } = await cq
      uc[t.id] = count ?? 0
    }))
    setPreviews(pv)
    setUnread(uc)
  }, [office, myId, supabase])

  useEffect(() => {
    if (auth.loading) return
    if (!auth.user) { router.push('/auth/login?redirect=/broker/messenger'); return }
    if (!auth.broker) { router.push('/broker/register'); return }
    Promise.all([loadMembers(), loadThreads()]).finally(() => setLoading(false))
  }, [auth.loading, auth.user, auth.broker, loadMembers, loadThreads, router])

  // ── 실시간: 목록 미리보기·안 읽음·새 방 ─────────────────
  const threadsRef = useRef<Thread[]>([])
  threadsRef.current = threads
  useEffect(() => {
    if (!myId) return
    const ch = supabase.channel(`oc-list:${myId}:${Date.now()}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'office_chat_messages' }, payload => {
        const msg = payload.new as Msg
        if (!threadsRef.current.some(t => t.id === msg.thread_id)) { loadThreads(); return }
        setPreviews(prev => ({ ...prev, [msg.thread_id]: { id: msg.id, text: previewText(msg), at: msg.created_at } }))
        if (msg.thread_id !== activeRef.current && msg.sender_broker_id !== myId) {
          setUnread(prev => ({ ...prev, [msg.thread_id]: (prev[msg.thread_id] ?? 0) + 1 }))
        }
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'office_chat_messages' }, payload => {
        const msg = payload.new as Msg
        setPreviews(prev => prev[msg.thread_id]?.id === msg.id
          ? { ...prev, [msg.thread_id]: { ...prev[msg.thread_id], text: previewText(msg) } } : prev)
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'office_chat_threads' }, payload => {
        const t = payload.new as Thread
        setThreads(prev => prev.map(x => x.id === t.id ? { ...x, ...t } : x))
      })
      // 누가 나를 새 방에 넣으면 목록에 나타나게
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'office_chat_members', filter: `broker_id=eq.${myId}` }, payload => {
        const row = payload.new as { thread_id: string }
        if (!threadsRef.current.some(t => t.id === row.thread_id)) loadThreads()
      })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [myId, supabase, loadThreads])

  // ── 내 멤버 행(읽음·고정·알림) ────────────────────────────
  const upsertMyRow = useCallback(async (threadId: string, patch: Partial<MyRow>) => {
    if (!myId) return
    setMyRows(prev => ({ ...prev, [threadId]: { ...(prev[threadId] ?? { last_read_at: null, pinned_at: null, muted: false }), ...patch } }))
    const { error } = await supabase.from('office_chat_members')
      .upsert({ thread_id: threadId, broker_id: myId, ...patch }, { onConflict: 'thread_id,broker_id' })
    if (error) toast.error('저장 실패: ' + error.message)
  }, [myId, supabase, toast])

  const markRead = useCallback((threadId: string) => {
    setUnread(prev => ({ ...prev, [threadId]: 0 }))
    upsertMyRow(threadId, { last_read_at: new Date().toISOString() }).then(refreshOfficeChatUnread)
  }, [upsertMyRow])

  // 폰은 방이 화면을 덮으니, 휴대폰 뒤로가기가 앱을 떠나지 않고 목록으로 돌아오게 기록을 한 칸 쌓는다
  const openThread = (id: string) => {
    if (window.matchMedia('(max-width: 767px)').matches && !(history.state as { ocRoom?: boolean } | null)?.ocRoom) {
      history.pushState({ ...history.state, ocRoom: true }, '')
    }
    setActive(id); setTab('chats'); setProfileOf(null)
  }
  const closeRoom = () => {
    if ((history.state as { ocRoom?: boolean } | null)?.ocRoom) history.back()  // popstate 가 닫는다
    else setActive(null)
  }
  useEffect(() => {
    const onPop = () => { if (!(history.state as { ocRoom?: boolean } | null)?.ocRoom) setActive(null) }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  // ── 방 만들기·나가기 ─────────────────────────────────────
  const addAndOpen = async (threadId: string) => {
    if (!threads.some(t => t.id === threadId)) await loadThreads()
    openThread(threadId)
    setShowNew(false)
  }
  const startDm = async (otherId: string) => {
    if (!office) return
    const { data, error } = await supabase.rpc('get_or_create_dm', { p_office: office, p_other: otherId })
    if (error || !data) { toast.error('대화를 시작하지 못했어요'); return }
    await addAndOpen(data as string)
  }
  const createTeam = async (ids: string[], title: string) => {
    if (!office) return
    const { data, error } = await supabase.rpc('create_team_thread', { p_office: office, p_title: title.trim() || null, p_members: ids })
    if (error || !data) { toast.error('단체방을 만들지 못했어요' + (error ? ': ' + error.message : '')); return }
    await addAndOpen(data as string)
  }
  const leave = async () => {
    const t = threads.find(x => x.id === active)
    if (!t || t.kind === 'group' || !myId) return
    if (!window.confirm('채팅방을 나갈까요? 대화 내용이 내 목록에서 사라져요.')) return
    const { error } = await supabase.from('office_chat_members').delete().eq('thread_id', t.id).eq('broker_id', myId)
    if (error) { toast.error('나가기 실패: ' + error.message); return }
    setThreads(prev => prev.filter(x => x.id !== t.id))
    closeRoom()
  }
  const invite = async (ids: string[]) => {
    if (!active || ids.length === 0) return
    const { error } = await supabase.from('office_chat_members').insert(ids.map(broker_id => ({ thread_id: active, broker_id })))
    if (error) { toast.error('초대 실패: ' + error.message); return }
    setShowInvite(false)
    toast.success(`${ids.length}명을 초대했어요`)
  }

  // ── 정렬·검색 ───────────────────────────────────────────
  const sortedThreads = useMemo(() => {
    const q = query.trim()
    return threads
      .filter(t => !q || threadLabel(t).includes(q))
      .sort((a, b) => {
        if (isSelf(a) !== isSelf(b)) return isSelf(a) ? -1 : 1
        const pa = myRows[a.id]?.pinned_at, pb = myRows[b.id]?.pinned_at
        if (pa || pb) return (pb ?? '').localeCompare(pa ?? '')
        return (previews[b.id]?.at ?? b.created_at).localeCompare(previews[a.id]?.at ?? a.created_at)
      })
  }, [threads, myRows, previews, query, threadLabel, isSelf])
  const friends = useMemo(() => members.filter(m => m.id !== myId && (!query.trim() || m.name.includes(query.trim()))), [members, myId, query])
  const totalUnread = Object.values(unread).reduce((s, n) => s + n, 0)

  const activeThread = threads.find(t => t.id === active) ?? null

  if (auth.loading || loading) return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-950">
      <div className="text-sm text-gray-500">불러오는 중...</div>
    </div>
  )

  const roomIcon = (t: Thread, size = 44) => {
    if (t.kind === 'dm') {
      const o = otherOfDm(t)
      return <Avatar member={o ? memberById[o] : null} name={threadLabel(t)} size={size} />
    }
    return (
      <span className="flex flex-shrink-0 items-center justify-center rounded-[38%] bg-[#a6bdd1] text-white dark:bg-gray-700" style={{ width: size, height: size }}>
        {t.kind === 'group' ? <Hash className="h-5 w-5" /> : <Users className="h-5 w-5" />}
      </span>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <Header user={auth.user} role="broker" />
      <div className="mx-auto max-w-6xl px-0 sm:px-4 sm:py-3">
        <h1 className="sr-only">메세지</h1>
        {/* 폰은 아래 메뉴바(4rem+안전영역)만큼 뺀다 — 밑에 붙던 푸터는 footer.tsx 에서 숨긴다 */}
        <div className="flex h-[calc(100dvh-4rem-env(safe-area-inset-bottom))] overflow-hidden border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900 sm:h-[calc(100dvh-5.5rem-env(safe-area-inset-bottom))] sm:rounded-2xl md:h-[calc(100dvh-6.5rem)] sm:border">

          {/* 왼쪽 세로 메뉴(PC) — 카톡 PC 판처럼 */}
          <nav className="hidden w-16 flex-shrink-0 flex-col items-center gap-2 bg-[#ececed] py-4 dark:bg-gray-950 md:flex" aria-label="메세지 메뉴">
            <RailButton icon={User} label="친구" on={tab === 'friends'} onClick={() => setTab('friends')} />
            <RailButton icon={MessageCircle} label="채팅" on={tab === 'chats'} onClick={() => setTab('chats')} badge={totalUnread} />
            <RailButton icon={MoreHorizontal} label="더보기" on={tab === 'more'} onClick={() => setTab('more')} />
          </nav>

          {/* 목록 칸 */}
          <div className={cn('flex w-full flex-shrink-0 flex-col border-r border-gray-100 dark:border-gray-800 md:w-80', active && 'hidden md:flex')}>
            <div className="flex items-center justify-between px-4 pb-2 pt-4">
              <h2 className="hidden text-lg font-bold text-gray-900 dark:text-white md:block">{tab === 'friends' ? '친구' : tab === 'chats' ? '채팅' : '더보기'}</h2>
              {/* 폰: 앱 아래 메뉴바와 두 줄이 되지 않게 친구·채팅·더보기는 위에 둔다 */}
              <nav className="flex items-center gap-4 md:hidden" aria-label="메세지 메뉴">
                <TopTab label="친구" on={tab === 'friends'} onClick={() => setTab('friends')} />
                <TopTab label="채팅" on={tab === 'chats'} onClick={() => setTab('chats')} badge={totalUnread} />
                <TopTab label="더보기" on={tab === 'more'} onClick={() => setTab('more')} />
              </nav>
              {tab === 'chats' && (
                <button onClick={() => setShowNew(true)} className="rounded-lg p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800" aria-label="새 채팅" title="새 채팅">
                  <Plus className="h-5 w-5 text-gray-700 dark:text-gray-300" />
                </button>
              )}
            </div>
            {tab !== 'more' && (
              <div className="px-4 pb-2">
                <label className="flex items-center gap-2 rounded-full bg-gray-100 px-3 py-1.5 dark:bg-gray-800">
                  <Search className="h-4 w-4 text-gray-400" />
                  <input value={query} onChange={e => setQuery(e.target.value)} placeholder={tab === 'friends' ? '이름 검색' : '채팅방 이름 검색'}
                    className="flex-1 bg-transparent text-sm outline-none dark:text-gray-100" />
                  {query && <button onClick={() => setQuery('')} aria-label="검색어 지우기"><X className="h-4 w-4 text-gray-400" /></button>}
                </label>
              </div>
            )}

            <div className="flex-1 overflow-y-auto">
              {tab === 'friends' && (
                <>
                  {me && (
                    <button onClick={() => setProfileOf(me.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-800/60">
                      <Avatar member={me} size={56} />
                      <span className="min-w-0">
                        <span className="block font-bold text-gray-900 dark:text-white">{me.name}</span>
                        <span className="block truncate text-sm text-gray-500">{me.status || '상태메시지를 입력해 보세요'}</span>
                      </span>
                    </button>
                  )}
                  <p className="border-t border-gray-100 px-4 pb-1 pt-3 text-xs text-gray-500 dark:border-gray-800">사무소 동료 {friends.length}</p>
                  {friends.map(f => (
                    <button key={f.id} onClick={() => setProfileOf(f.id)} className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-800/60">
                      <Avatar member={f} size={44} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-gray-900 dark:text-gray-100">{f.name}</span>
                        {f.status && <span className="block truncate text-xs text-gray-500">{f.status}</span>}
                      </span>
                    </button>
                  ))}
                  {friends.length === 0 && <p className="px-4 py-8 text-center text-sm text-gray-400">{query ? '찾는 동료가 없어요' : '아직 동료가 없어요 — 직원을 초대해 보세요'}</p>}
                </>
              )}

              {tab === 'chats' && sortedThreads.map(t => {
                const row = myRows[t.id]
                const cnt = t.id === active ? 0 : (unread[t.id] ?? 0)
                const pv = previews[t.id]
                return (
                  <button key={t.id} onClick={() => openThread(t.id)}
                    className={cn('flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-gray-50 dark:hover:bg-gray-800/60', t.id === active && 'bg-gray-100 dark:bg-gray-800')}>
                    {roomIcon(t)}
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1">
                        {isSelf(t) && <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full bg-gray-700 text-[9px] font-bold text-white dark:bg-gray-500">나</span>}
                        <span className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">{threadLabel(t)}</span>
                        {t.kind !== 'dm' && <span className="flex-shrink-0 text-xs text-gray-400">{t.kind === 'group' ? members.length : ''}</span>}
                        {row?.pinned_at && <Pin className="h-3 w-3 flex-shrink-0 text-gray-400" aria-label="고정됨" />}
                        {row?.muted && <BellOff className="h-3 w-3 flex-shrink-0 text-gray-400" aria-label="알림 꺼짐" />}
                      </span>
                      <span className="block truncate text-xs text-gray-500">{pv?.text ?? ''}</span>
                    </span>
                    <span className="flex flex-shrink-0 flex-col items-end gap-1">
                      <span className="text-[11px] text-gray-400">{pv ? listTimeLabel(pv.at) : ''}</span>
                      {cnt > 0 && (
                        <span className={cn('flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1.5 text-[10px] font-bold text-white',
                          row?.muted ? 'bg-gray-400' : 'bg-[#ff5a3c]')}>{cnt > 999 ? '999+' : cnt}</span>
                      )}
                    </span>
                  </button>
                )
              })}

              {tab === 'more' && me && (
                <div className="space-y-2 px-4 py-2">
                  <button onClick={() => setEditOpen(true)} className="flex w-full items-center gap-3 rounded-2xl bg-gray-50 p-4 text-left hover:bg-gray-100 dark:bg-gray-800 dark:hover:bg-gray-700">
                    <Avatar member={me} size={56} />
                    <span className="min-w-0 flex-1">
                      <span className="block font-bold text-gray-900 dark:text-white">{me.name}</span>
                      <span className="block truncate text-sm text-gray-500">{me.status || '상태메시지 없음'}</span>
                    </span>
                    <span className="text-xs text-gray-500">프로필 편집</span>
                  </button>
                  <button onClick={toggleSound} role="switch" aria-checked={soundOn}
                    className="flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left text-sm text-gray-800 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-800">
                    {soundOn ? <Volume2 className="h-5 w-5 text-gray-500" /> : <VolumeX className="h-5 w-5 text-gray-500" />}
                    <span className="flex-1">메세지 알림음 <span className="block text-xs text-gray-500">앱을 보고 있을 때 새 메세지가 오면 띵동</span></span>
                    <span className={cn('relative h-6 w-11 rounded-full transition-colors', soundOn ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600')}>
                      <span className={cn('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all', soundOn ? 'left-[22px]' : 'left-0.5')} />
                    </span>
                  </button>
                  <Link href="/settings/notifications" className="flex items-center gap-3 rounded-2xl px-4 py-3 text-sm text-gray-800 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-800">
                    <Bell className="h-5 w-5 text-gray-500" /> 휴대폰 알림 설정 <ChevronRight className="ml-auto h-4 w-4 text-gray-400" />
                  </Link>
                  <p className="px-1 pt-2 text-xs leading-relaxed text-gray-500">
                    방마다 알림을 끄려면 채팅방 오른쪽 위 ☰ 를 눌러 &lsquo;알림 끄기&rsquo;를 고르세요.
                    메시지를 길게 누르면(PC는 오른쪽 클릭) 공감·답장·공지·삭제를 할 수 있어요.
                  </p>
                </div>
              )}
            </div>

          </div>

          {/* 대화 칸 */}
          {/* 폰은 카톡처럼 방이 화면을 다 덮는다 — 위 머리·아래 메뉴바 없이 */}
          <div className={cn('min-w-0 flex-1', !active ? 'hidden md:flex' : 'max-md:fixed max-md:inset-0 max-md:z-50 max-md:flex max-md:bg-[#bacee0] max-md:pt-[env(safe-area-inset-top)] max-md:dark:bg-gray-900')}>
            {activeThread && myId && office ? (
              <ChatRoom
                key={activeThread.id}
                thread={activeThread}
                title={threadLabel(activeThread)}
                myId={myId}
                office={office}
                members={members}
                memberById={memberById}
                myRow={myRows[activeThread.id] ?? null}
                onBack={closeRoom}
                onOpenProfile={setProfileOf}
                onRead={markRead}
                onSent={m => setPreviews(prev => ({ ...prev, [m.thread_id]: { id: m.id, text: previewText(m), at: m.created_at } }))}
                onThreadPatch={patch => setThreads(prev => prev.map(x => x.id === activeThread.id ? { ...x, ...patch } : x))}
                onTogglePin={() => upsertMyRow(activeThread.id, { pinned_at: myRows[activeThread.id]?.pinned_at ? null : new Date().toISOString() })}
                onToggleMute={() => upsertMyRow(activeThread.id, { muted: !myRows[activeThread.id]?.muted })}
                onInvite={() => setShowInvite(true)}
                onLeave={leave}
              />
            ) : (
              <div className="flex flex-1 items-center justify-center bg-[#f5f5f5] text-sm text-gray-400 dark:bg-gray-950">
                <div className="text-center">
                  <MessageSquare className="mx-auto mb-2 h-10 w-10 text-gray-300 dark:text-gray-700" />
                  채팅방을 고르세요
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {profileOf && memberById[profileOf] && (
        <ProfileCard member={memberById[profileOf]} isMe={profileOf === myId}
          onClose={() => setProfileOf(null)}
          onChat={() => startDm(profileOf)}
          onEdit={() => { setProfileOf(null); setEditOpen(true) }} />
      )}
      {editOpen && me && office && (
        <ProfileEditor me={me} office={office} onClose={() => setEditOpen(false)} onSaved={() => { setEditOpen(false); loadMembers() }} />
      )}
      {showNew && (
        <PickMembers title="대화상대 선택" candidates={members.filter(m => m.id !== myId)} allowTitle
          confirmLabel={n => (n <= 1 ? '채팅 시작' : `단체방 만들기 (${n}명)`)}
          onClose={() => setShowNew(false)}
          onConfirm={(ids, title) => ids.length === 1 ? startDm(ids[0]) : createTeam(ids, title)} />
      )}
      {showInvite && activeThread && (
        <InviteLoader threadId={activeThread.id} members={members} myId={myId} onClose={() => setShowInvite(false)} onConfirm={invite} />
      )}
    </div>
  )
}

function RailButton({ icon: Icon, label, on, onClick, badge = 0 }: { icon: React.ComponentType<{ className?: string }>; label: string; on: boolean; onClick: () => void; badge?: number }) {
  return (
    <button onClick={onClick} title={label} aria-label={label} aria-current={on ? 'page' : undefined}
      className={cn('relative flex h-11 w-11 items-center justify-center rounded-xl', on ? 'text-gray-900 dark:text-white' : 'text-gray-400 hover:text-gray-600')}>
      <Icon className={cn('h-6 w-6', on && 'fill-current')} />
      {badge > 0 && <span className="absolute right-0 top-0 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[#ff5a3c] px-1 text-[9px] font-bold text-white">{badge > 99 ? '99+' : badge}</span>}
    </button>
  )
}

function TopTab({ label, on, onClick, badge = 0 }: { label: string; on: boolean; onClick: () => void; badge?: number }) {
  return (
    <button onClick={onClick} aria-current={on ? 'page' : undefined}
      className={cn('relative text-lg font-bold', on ? 'text-gray-900 dark:text-white' : 'text-gray-400 dark:text-gray-500')}>
      {label}
      {badge > 0 && <span className="absolute -right-3 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[#ff5a3c] px-1 text-[9px] font-bold text-white">{badge > 99 ? '99+' : badge}</span>}
    </button>
  )
}

/** 프로필 보기 — 카톡처럼 큰 사진·이름·상태메시지, 아래에 1:1 채팅(내 프로필이면 나와의 채팅) */
function ProfileCard({ member, isMe, onClose, onChat, onEdit }: { member: Member; isMe: boolean; onClose: () => void; onChat: () => void; onEdit: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose} role="dialog" aria-modal="true" aria-label={`${member.name} 프로필`}>
      <div className="flex w-full max-w-xs flex-col items-center rounded-3xl bg-gradient-to-b from-[#8fa9c2] to-[#5d7a96] px-6 pb-6 pt-10 text-white" onClick={e => e.stopPropagation()}>
        <Avatar member={member} size={96} className="ring-4 ring-white/30" />
        <p className="mt-4 text-lg font-bold">{member.name}</p>
        <p className="mt-1 min-h-[1.25rem] text-center text-sm text-white/80">{member.status ?? ''}</p>
        <div className="mt-8 flex w-full border-t border-white/20 pt-4">
          {isMe ? (
            <>
              <button onClick={onChat} className="flex flex-1 flex-col items-center gap-1 text-xs"><MessageCircle className="h-6 w-6" />나와의 채팅</button>
              <button onClick={onEdit} className="flex flex-1 flex-col items-center gap-1 text-xs"><Camera className="h-6 w-6" />프로필 편집</button>
            </>
          ) : (
            <button onClick={onChat} className="flex flex-1 flex-col items-center gap-1 text-xs"><MessageCircle className="h-6 w-6" />1:1 채팅</button>
          )}
        </div>
      </div>
    </div>
  )
}

/** 내 프로필 편집 — 사진·상태메시지 */
function ProfileEditor({ me, office, onClose, onSaved }: { me: Member; office: string; onClose: () => void; onSaved: () => void }) {
  const supabase = useMemo(() => createClient(), [])
  const toast = useToast()
  const [status, setStatus] = useState(me.status ?? '')
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [removePhoto, setRemovePhoto] = useState(false)
  const [saving, setSaving] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!file) { setPreview(null); return }
    const u = URL.createObjectURL(file)
    setPreview(u)
    return () => URL.revokeObjectURL(u)
  }, [file])

  const save = async () => {
    setSaving(true)
    try {
      let avatarPath = removePhoto ? null : me.avatarPath
      if (file) {
        const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
        const path = `${office}/profiles/${me.id}/${crypto.randomUUID()}.${ext}`
        const { error } = await supabase.storage.from(CHAT_BUCKET).upload(path, file, { contentType: file.type || undefined })
        if (error) throw error
        avatarPath = path
      }
      const { error } = await supabase.from('office_chat_profiles').upsert(
        { broker_id: me.id, status_message: status.trim() || null, avatar_path: avatarPath, updated_at: new Date().toISOString() },
        { onConflict: 'broker_id' },
      )
      if (error) throw error
      // 바꾼 옛 사진은 지운다(실패해도 프로필은 저장된 것이라 기록만)
      const old = chatStoragePath(me.avatarPath)
      if (old && old !== avatarPath) {
        const { error: rmErr } = await supabase.storage.from(CHAT_BUCKET).remove([old])
        if (rmErr) console.error('[messenger] old avatar remove failed', rmErr)
      }
      onSaved()
    } catch (e) {
      toast.error('저장 실패: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setSaving(false)
    }
  }

  const shown: Member = { ...me, avatarPath: removePhoto ? null : me.avatarPath }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose} role="dialog" aria-modal="true" aria-label="프로필 편집">
      <div className="w-full max-w-sm rounded-2xl bg-white p-5 dark:bg-gray-900" onClick={e => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-bold text-gray-900 dark:text-white">프로필 편집</h2>
          <button onClick={onClose} aria-label="닫기"><X className="h-5 w-5 text-gray-500" /></button>
        </div>
        <div className="flex flex-col items-center">
          <button onClick={() => fileRef.current?.click()} className="relative" aria-label="사진 바꾸기">
            {preview
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={preview} alt="" className="h-24 w-24 rounded-[38%] object-cover" />
              : <Avatar member={shown} size={96} />}
            <span className="absolute -bottom-1 -right-1 flex h-8 w-8 items-center justify-center rounded-full border border-gray-200 bg-white shadow dark:border-gray-700 dark:bg-gray-800">
              <Camera className="h-4 w-4 text-gray-700 dark:text-gray-300" />
            </span>
          </button>
          {(me.avatarPath || file) && !removePhoto && (
            <button onClick={() => { setFile(null); setRemovePhoto(true) }} className="mt-2 text-xs text-gray-500 hover:text-red-500">사진 지우기</button>
          )}
          <input ref={fileRef} type="file" accept="image/*" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) { setFile(f); setRemovePhoto(false) } e.target.value = '' }} />
          <p className="mt-3 font-bold text-gray-900 dark:text-white">{me.name}</p>
        </div>
        <label className="mt-4 block text-xs text-gray-500">상태메시지
          <input value={status} onChange={e => setStatus(e.target.value.slice(0, 60))} placeholder="예: 오늘 오후 현장 답사"
            className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:ring-2 focus:ring-gray-300 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100" />
        </label>
        <p className="mt-1 text-right text-[11px] text-gray-400">{status.length}/60</p>
        <button onClick={save} disabled={saving} className="mt-3 w-full rounded-lg bg-[#fee500] py-2.5 text-sm font-bold text-gray-900 disabled:opacity-50">
          {saving ? '저장 중…' : '저장'}
        </button>
      </div>
    </div>
  )
}

/** 사람 고르기 — 새 채팅(1명=1:1, 2명+=단체방)·초대 */
function PickMembers({ title, candidates, allowTitle, confirmLabel, onClose, onConfirm }: {
  title: string; candidates: Member[]; allowTitle?: boolean
  confirmLabel: (n: number) => string; onClose: () => void; onConfirm: (ids: string[], title: string) => void
}) {
  const titleId = useId()
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [roomTitle, setRoomTitle] = useState('')
  const [q, setQ] = useState('')
  const shown = candidates.filter(m => !q.trim() || m.name.includes(q.trim()))
  return (
    <div role="dialog" aria-modal="true" aria-labelledby={titleId} className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="flex max-h-[80vh] w-full max-w-sm flex-col rounded-2xl bg-white dark:bg-gray-900" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3">
          <h2 id={titleId} className="font-bold text-gray-900 dark:text-white">{title} <span className="text-gray-400">{sel.size}</span></h2>
          <button onClick={onClose} aria-label="닫기"><X className="h-5 w-5 text-gray-500" /></button>
        </div>
        {sel.size > 0 && (
          <div className="flex flex-wrap gap-1.5 px-4 pb-2">
            {[...sel].map(id => {
              const m = candidates.find(x => x.id === id)
              return m && (
                <button key={id} onClick={() => setSel(prev => { const n = new Set(prev); n.delete(id); return n })}
                  className="flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700 dark:bg-gray-800 dark:text-gray-300">
                  {m.name}<X className="h-3 w-3" />
                </button>
              )
            })}
          </div>
        )}
        <div className="px-4 pb-2">
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="이름 검색"
            className="w-full rounded-full bg-gray-100 px-3 py-1.5 text-sm outline-none dark:bg-gray-800 dark:text-gray-100" />
        </div>
        <div className="flex-1 overflow-y-auto py-1">
          {shown.length === 0 && <p className="px-4 py-6 text-center text-sm text-gray-400">고를 사람이 없어요</p>}
          {shown.map(m => {
            const checked = sel.has(m.id)
            return (
              <button key={m.id} onClick={() => setSel(prev => { const n = new Set(prev); if (n.has(m.id)) n.delete(m.id); else n.add(m.id); return n })}
                className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-800">
                <Avatar member={m} size={40} />
                <span className="flex-1 text-sm text-gray-800 dark:text-gray-200">{m.name}</span>
                <span className={cn('flex h-5 w-5 items-center justify-center rounded-full border text-[11px]',
                  checked ? 'border-[#fee500] bg-[#fee500] text-gray-900' : 'border-gray-300 dark:border-gray-600')}>{checked && '✓'}</span>
              </button>
            )
          })}
        </div>
        {allowTitle && sel.size >= 2 && (
          <div className="border-t border-gray-100 px-4 py-3 dark:border-gray-800">
            <input value={roomTitle} onChange={e => setRoomTitle(e.target.value)} placeholder="채팅방 이름 (선택)"
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100" />
          </div>
        )}
        <div className="border-t border-gray-100 px-4 py-3 dark:border-gray-800">
          <button onClick={() => onConfirm([...sel], roomTitle)} disabled={sel.size === 0}
            className="w-full rounded-lg bg-[#fee500] py-2.5 text-sm font-bold text-gray-900 disabled:bg-gray-100 disabled:text-gray-400 dark:disabled:bg-gray-800">
            {confirmLabel(sel.size)}
          </button>
        </div>
      </div>
    </div>
  )
}

/** 초대 — 지금 방에 없는 동료만 후보로 */
function InviteLoader({ threadId, members, myId, onClose, onConfirm }: {
  threadId: string; members: Member[]; myId: string | null; onClose: () => void; onConfirm: (ids: string[]) => void
}) {
  const supabase = useMemo(() => createClient(), [])
  const [inRoom, setInRoom] = useState<Set<string> | null>(null)
  useEffect(() => {
    supabase.from('office_chat_members').select('broker_id').eq('thread_id', threadId)
      .then(({ data }) => setInRoom(new Set((data ?? []).map(r => r.broker_id))))
  }, [threadId, supabase])
  if (!inRoom) return null
  return (
    <PickMembers title="대화상대 초대" candidates={members.filter(m => m.id !== myId && !inRoom.has(m.id))}
      confirmLabel={n => (n > 0 ? `초대 (${n}명)` : '초대')} onClose={onClose} onConfirm={ids => onConfirm(ids)} />
  )
}
