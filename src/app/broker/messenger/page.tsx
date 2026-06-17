'use client'

import { useEffect, useState, useRef, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/lib/auth-context'
import { Header } from '@/components/layout/header'
import { useRouter } from 'next/navigation'
import { useToast } from '@/components/toast'
import { Send, Users, Plus, ArrowLeft, MessageSquare, Hash, X, Paperclip, FileText, Download } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Thread {
  id: string
  kind: 'group' | 'dm' | 'team'
  dm_key: string | null
  title: string | null
  office_broker_id: string
}
interface Msg {
  id: string
  thread_id: string
  sender_broker_id: string | null
  body: string
  image_url?: string | null
  file_url?: string | null
  file_name?: string | null
  created_at: string
}

const pad = (n: number) => String(n).padStart(2, '0')
const timeLabel = (iso: string) => {
  const d = new Date(iso)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  return sameDay ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : `${d.getMonth() + 1}/${d.getDate()}`
}

export default function BrokerMessengerPage() {
  const supabase = createClient()
  const router = useRouter()
  const auth = useAuth()
  const toast = useToast()

  const office = auth.broker ? (auth.broker.is_owner !== false ? auth.broker.id : auth.broker.parent_broker_id) : null
  const myId = auth.broker?.id ?? null

  const [threads, setThreads] = useState<Thread[]>([])
  const [members, setMembers] = useState<{ id: string; name: string }[]>([])
  const [nameOf, setNameOf] = useState<Record<string, string>>({})
  const [active, setActive] = useState<string | null>(null)
  const [messages, setMessages] = useState<Msg[]>([])
  const [previews, setPreviews] = useState<Record<string, { body: string; at: string }>>({})
  const [unread, setUnread] = useState<Record<string, number>>({})
  const [activeMembers, setActiveMembers] = useState<{ broker_id: string; last_read_at: string | null }[]>([])
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [showNewDm, setShowNewDm] = useState(false)
  const [newSel, setNewSel] = useState<Set<string>>(new Set())
  const [newTitle, setNewTitle] = useState('')
  const [sending, setSending] = useState(false)

  const activeRef = useRef<string | null>(null)
  activeRef.current = active
  const bottomRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const otherOfDm = useCallback((t: Thread) => {
    if (t.kind !== 'dm' || !t.dm_key || !myId) return null
    const [a, b] = t.dm_key.split('__')
    return a === myId ? b : a
  }, [myId])

  const threadLabel = useCallback((t: Thread) => {
    if (t.kind === 'group') return '사무소 전체'
    if (t.kind === 'team') return t.title || '단체방'
    const other = otherOfDm(t)
    return other ? (nameOf[other] ?? '직원') : '대화'
  }, [otherOfDm, nameOf])

  // ── 초기 로드: 멤버 + group thread ensure + 내 threads ──
  const init = useCallback(async () => {
    if (!office || !myId) return

    // 멤버
    const { data: memRows } = await supabase
      .from('broker_profiles')
      .select('id, is_owner, is_approved, profiles:user_id(name)')
      .or(`id.eq.${office},parent_broker_id.eq.${office}`)
    const nmap: Record<string, string> = {}
    const mlist: { id: string; name: string }[] = []
    for (const m of (memRows ?? []) as any[]) {
      if (!(m.is_owner || m.is_approved)) continue
      const nm = (Array.isArray(m.profiles) ? m.profiles[0]?.name : m.profiles?.name) ?? '직원'
      nmap[m.id] = nm
      mlist.push({ id: m.id, name: nm })
    }
    setNameOf(nmap)
    setMembers(mlist)

    // group thread ensure
    let groupId: string | null = null
    const { data: g } = await supabase
      .from('office_chat_threads').select('*').eq('office_broker_id', office).eq('kind', 'group').maybeSingle()
    if (g) groupId = g.id
    else {
      const { data: ins } = await supabase
        .from('office_chat_threads').insert({ office_broker_id: office, kind: 'group' }).select().maybeSingle()
      if (ins) groupId = ins.id
      else {
        // race: 다른 곳에서 먼저 생성 → 재조회
        const { data: g2 } = await supabase.from('office_chat_threads').select('*').eq('office_broker_id', office).eq('kind', 'group').maybeSingle()
        groupId = g2?.id ?? null
      }
    }

    // 내가 보는 threads = group + 내 DM
    const { data: myMemberRows } = await supabase
      .from('office_chat_members').select('thread_id, last_read_at').eq('broker_id', myId)
    const lr: Record<string, string> = {}
    for (const r of myMemberRows ?? []) lr[r.thread_id] = r.last_read_at

    // RLS(oct_select)가 group=사무소소속, dm/team=멤버만 반환하므로 그대로 사용
    const { data: allThreads } = await supabase
      .from('office_chat_threads').select('*').eq('office_broker_id', office)
    const mine = (allThreads ?? []) as Thread[]
    mine.sort((a, b) => (a.kind === 'group' ? -1 : b.kind === 'group' ? 1 : 0))
    setThreads(mine)

    // 각 thread의 마지막 메시지(프리뷰) + 안 읽음 수
    const pv: Record<string, { body: string; at: string }> = {}
    const uc: Record<string, number> = {}
    await Promise.all(mine.map(async t => {
      const { data: last } = await supabase
        .from('office_chat_messages').select('body, created_at').eq('thread_id', t.id)
        .order('created_at', { ascending: false }).limit(1).maybeSingle()
      if (last) pv[t.id] = { body: last.body, at: last.created_at }
      let cq = supabase.from('office_chat_messages').select('id', { count: 'exact', head: true })
        .eq('thread_id', t.id).neq('sender_broker_id', myId)
      if (lr[t.id]) cq = cq.gt('created_at', lr[t.id])
      const { count } = await cq
      uc[t.id] = count ?? 0
    }))
    setPreviews(pv)
    setUnread(uc)

    // 기본 선택: group
    if (!activeRef.current && groupId) setActive(groupId)
    setLoading(false)
  }, [office, myId, supabase])

  useEffect(() => {
    if (auth.loading) return
    if (!auth.user) { router.push('/auth/login?redirect=/broker/messenger'); return }
    if (!auth.broker) { router.push('/broker/register'); return }
    init()
  }, [auth.loading, auth.user?.id, auth.broker?.id, init, router])

  // ── 실시간 구독 (내 접근 가능 메시지 전체) ───────────────
  useEffect(() => {
    if (!myId) return
    const channel = supabase
      .channel(`office-chat:${myId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'office_chat_messages' }, (payload) => {
        const msg = payload.new as Msg
        setPreviews(prev => ({ ...prev, [msg.thread_id]: { body: msg.body, at: msg.created_at } }))
        if (msg.thread_id === activeRef.current) {
          setMessages(prev => prev.some(m => m.id === msg.id) ? prev : [...prev, msg])
          // 열려있는 방이면 즉시 읽음 처리
          if (msg.sender_broker_id !== myId) markRead(msg.thread_id)
        } else if (msg.sender_broker_id !== myId) {
          // 다른 방의 새 메시지 → 안 읽음 +1
          setUnread(prev => ({ ...prev, [msg.thread_id]: (prev[msg.thread_id] ?? 0) + 1 }))
        }
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myId])

  // ── 활성 thread 메시지 로드 + 읽음 ──────────────────────
  useEffect(() => {
    if (!active) return
    ;(async () => {
      const { data } = await supabase
        .from('office_chat_messages').select('*').eq('thread_id', active)
        .order('created_at', { ascending: true }).limit(200)
      setMessages((data ?? []) as Msg[])
      markRead(active)
      // 멤버 읽음 시각 (읽음 표시용)
      const { data: mems } = await supabase
        .from('office_chat_members').select('broker_id, last_read_at').eq('thread_id', active)
      setActiveMembers((mems ?? []) as { broker_id: string; last_read_at: string | null }[])
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  // 활성 스레드 멤버의 읽음 시각 실시간 추적
  useEffect(() => {
    if (!active) return
    const ch = supabase
      .channel(`oc-members:${active}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'office_chat_members', filter: `thread_id=eq.${active}` }, (payload) => {
        const row = payload.new as { broker_id?: string; last_read_at?: string }
        if (!row?.broker_id) return
        setActiveMembers(prev => {
          const i = prev.findIndex(m => m.broker_id === row.broker_id)
          const next = { broker_id: row.broker_id!, last_read_at: row.last_read_at ?? null }
          if (i >= 0) { const c = [...prev]; c[i] = next; return c }
          return [...prev, next]
        })
      })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  useEffect(() => { bottomRef.current?.scrollIntoView({ block: 'end' }) }, [messages.length])

  const markRead = async (threadId: string) => {
    if (!myId) return
    const now = new Date().toISOString()
    setUnread(prev => ({ ...prev, [threadId]: 0 }))
    await supabase.from('office_chat_members').upsert(
      { thread_id: threadId, broker_id: myId, last_read_at: now },
      { onConflict: 'thread_id,broker_id' },
    )
  }

  // ── 새 대화 만들기 (1명=DM, 2명+=단체방) ────────────────
  const addThreadToList = async (threadId: string) => {
    if (!threads.some(t => t.id === threadId)) {
      const { data: t } = await supabase.from('office_chat_threads').select('*').eq('id', threadId).maybeSingle()
      if (t) setThreads(prev => prev.some(x => x.id === t.id) ? prev : [...prev, t as Thread])
    }
    setActive(threadId)
    setShowNewDm(false)
    setNewSel(new Set())
    setNewTitle('')
  }

  const startDm = async (otherId: string) => {
    if (!office || !myId) return
    const { data: threadId, error } = await supabase.rpc('get_or_create_dm', { p_office: office, p_other: otherId })
    if (error || !threadId) { toast.error('대화를 시작하지 못했어요'); return }
    await addThreadToList(threadId as string)
  }

  const createTeam = async (memberIds: string[], title: string) => {
    if (!office || !myId) return
    const { data: threadId, error } = await supabase.rpc('create_team_thread', {
      p_office: office, p_title: title.trim() || null, p_members: memberIds,
    })
    if (error || !threadId) { toast.error('단체방을 만들지 못했어요' + (error ? ': ' + error.message : '')); return }
    await addThreadToList(threadId as string)
  }

  // 새 대화 모달 확정
  const confirmNew = async () => {
    const ids = [...newSel]
    if (ids.length === 0) return
    if (ids.length === 1) await startDm(ids[0])
    else await createTeam(ids, newTitle)
  }

  // ── 메시지 전송 ─────────────────────────────────────────
  const send = async () => {
    const body = draft.trim()
    if (!body || !active || !myId || sending) return
    setSending(true)
    setDraft('')
    const { data, error } = await supabase.from('office_chat_messages').insert({
      thread_id: active, sender_broker_id: myId, body,
    }).select().single()
    setSending(false)
    if (error || !data) { toast.error('전송 실패' + (error ? ': ' + error.message : '')); setDraft(body); return }
    appendOptimistic(data as Msg, body)
    notify(active, body)
  }

  // 낙관적 반영 (실시간 이벤트가 늦거나 안 와도 즉시 보이게, 중복은 id로 방지)
  const appendOptimistic = (msg: Msg, previewText: string) => {
    setMessages(prev => prev.some(m => m.id === msg.id) ? prev : [...prev, msg])
    setPreviews(prev => ({ ...prev, [msg.thread_id]: { body: previewText, at: msg.created_at } }))
  }

  // 상대 멤버에게 푸시 (실패는 무시 — 메시지 전송 자체엔 영향 없음)
  const notify = (threadId: string, preview: string) => {
    fetch('/api/messenger/notify', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ threadId, preview }),
    }).catch(() => {})
  }

  // 첨부 전송 (이미지=썸네일, 그 외=파일 카드)
  const fileRef = useRef<HTMLInputElement>(null)
  const sendAttachment = async (file: File) => {
    if (!active || !myId || !office || sending) return
    if (file.size > 20 * 1024 * 1024) { toast.error('20MB 이하 파일만 보낼 수 있어요'); return }
    setSending(true)
    const isImage = file.type.startsWith('image/')
    const ext = (file.name.split('.').pop() || 'bin').toLowerCase()
    const path = `${office}/${active}/${crypto.randomUUID()}.${ext}`
    const { error: upErr } = await supabase.storage.from('office-chat-images').upload(path, file, { contentType: file.type || undefined })
    if (upErr) { setSending(false); toast.error('업로드 실패: ' + upErr.message); return }
    const { data: pub } = supabase.storage.from('office-chat-images').getPublicUrl(path)
    const payload: Record<string, unknown> = { thread_id: active, sender_broker_id: myId, body: '' }
    if (isImage) payload.image_url = pub.publicUrl
    else { payload.file_url = pub.publicUrl; payload.file_name = file.name }
    const { data, error } = await supabase.from('office_chat_messages').insert(payload).select().single()
    setSending(false)
    if (error || !data) { toast.error('전송 실패' + (error ? ': ' + error.message : '')); return }
    appendOptimistic(data as Msg, isImage ? '사진' : '파일')
    notify(active, isImage ? '사진을 보냈습니다' : `파일: ${file.name}`)
  }

  const activeThread = threads.find(t => t.id === active) ?? null
  const dmCandidates = useMemo(() => members.filter(m => m.id !== myId), [members, myId])

  // 내가 보낸 메시지를 아직 안 읽은 멤버 수
  const unreadByOthers = (msg: Msg): number | null => {
    if (!activeThread) return null
    const msgTime = new Date(msg.created_at).getTime()
    if (activeThread.kind === 'group') {
      // 사무소 전체 = 전원(나 제외) - 읽은 사람. 멤버는 읽을 때 lazy 등록되므로
      // 읽은 수만 office_chat_members로 세고, 분모는 사무소 전원(members)으로 계산.
      const total = Math.max(0, members.length - 1)
      const readCount = activeMembers.filter(m =>
        m.broker_id !== myId && m.last_read_at && new Date(m.last_read_at).getTime() >= msgTime
      ).length
      return Math.max(0, total - readCount)
    }
    return activeMembers.filter(m =>
      m.broker_id !== myId && (!m.last_read_at || new Date(m.last_read_at).getTime() < msgTime)
    ).length
  }

  if (auth.loading || loading) return (
    <div className="bg-gray-50 dark:bg-gray-950 min-h-screen flex items-center justify-center">
      <div className="text-gray-500 text-sm">불러오는 중...</div>
    </div>
  )

  return (
    <div className="bg-gray-50 dark:bg-gray-950 min-h-screen">
      <Header user={auth.user} role="broker" />
      <div className="mx-auto max-w-5xl px-0 sm:px-4 py-0 sm:py-6">
        <div className="flex h-[calc(100vh-3.5rem)] sm:h-[calc(100vh-8rem)] overflow-hidden rounded-none sm:rounded-2xl border-0 sm:border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">

          {/* ── 좌측: 스레드 목록 ── */}
          <aside className={cn('w-full sm:w-64 flex-shrink-0 border-r border-gray-100 dark:border-gray-800 flex flex-col',
            active && 'hidden sm:flex')}>
            <div className="flex items-center justify-between border-b border-gray-100 dark:border-gray-800 px-4 py-3">
              <h1 className="font-bold text-gray-900 dark:text-white">사내 대화</h1>
              <button onClick={() => setShowNewDm(true)} className="rounded-lg p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800" title="새 대화" aria-label="새 대화">
                <Plus className="h-4 w-4 text-gray-600 dark:text-gray-400" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {threads.map(t => {
                const cnt = t.id === active ? 0 : (unread[t.id] ?? 0)
                const isUnread = cnt > 0
                return (
                  <button key={t.id} onClick={() => setActive(t.id)}
                    className={cn('flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-800/50 border-b border-gray-50 dark:border-gray-800/50',
                      t.id === active && 'bg-blue-50/60 dark:bg-blue-500/10')}>
                    <div className={cn('flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl',
                      t.kind === 'dm' ? 'bg-gray-100 text-gray-500 dark:bg-gray-800' : 'bg-blue-100 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400')}>
                      {t.kind === 'group' ? <Hash className="h-4 w-4" /> : t.kind === 'team' ? <Users className="h-4 w-4" /> : (threadLabel(t)[0] ?? '·')}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className={cn('truncate text-sm', isUnread ? 'font-bold text-gray-900 dark:text-white' : 'font-medium text-gray-700 dark:text-gray-300')}>
                          {threadLabel(t)}
                        </span>
                        {previews[t.id] && <span className="text-[10px] text-gray-400 flex-shrink-0">{timeLabel(previews[t.id].at)}</span>}
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="truncate text-xs text-gray-400">{previews[t.id]?.body ?? '대화를 시작해보세요'}</span>
                        {isUnread && (
                          <span className="ml-auto flex h-[18px] min-w-[18px] flex-shrink-0 items-center justify-center rounded-full bg-red-500 px-1.5 text-[10px] font-bold text-white">
                            {cnt > 99 ? '99+' : cnt}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          </aside>

          {/* ── 우측: 대화 ── */}
          <section className={cn('flex flex-1 flex-col min-w-0', !active && 'hidden sm:flex')}>
            {activeThread ? (
              <>
                <div className="flex items-center gap-2 border-b border-gray-100 dark:border-gray-800 px-4 py-3">
                  <button onClick={() => setActive(null)} className="sm:hidden rounded-lg p-1 hover:bg-gray-100 dark:hover:bg-gray-800" aria-label="목록으로">
                    <ArrowLeft className="h-5 w-5 text-gray-600" />
                  </button>
                  <div className={cn('flex h-8 w-8 items-center justify-center rounded-lg',
                    activeThread.kind === 'dm' ? 'bg-gray-100 text-gray-500 dark:bg-gray-800' : 'bg-blue-100 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400')}>
                    {activeThread.kind === 'group' ? <Hash className="h-4 w-4" /> : activeThread.kind === 'team' ? <Users className="h-4 w-4" /> : (threadLabel(activeThread)[0] ?? '·')}
                  </div>
                  <span className="font-bold text-gray-900 dark:text-white">{threadLabel(activeThread)}</span>
                  {activeThread.kind === 'group' && <span className="text-xs text-gray-400">· {members.length}명</span>}
                </div>

                <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-2">
                  {messages.length === 0 && (
                    <div className="flex h-full items-center justify-center text-sm text-gray-400">첫 메시지를 보내보세요</div>
                  )}
                  {messages.map((m, i) => {
                    const mine = m.sender_broker_id === myId
                    const prev = messages[i - 1]
                    const showSender = activeThread.kind === 'group' && !mine && (!prev || prev.sender_broker_id !== m.sender_broker_id)
                    return (
                      <div key={m.id} className={cn('flex flex-col', mine ? 'items-end' : 'items-start')}>
                        {showSender && <span className="mb-0.5 ml-1 text-[11px] text-gray-400">{m.sender_broker_id ? (nameOf[m.sender_broker_id] ?? '직원') : '(퇴사)'}</span>}
                        <div className={cn('flex items-end gap-1.5', mine && 'flex-row-reverse')}>
                          {m.image_url ? (
                            <a href={m.image_url} target="_blank" rel="noopener noreferrer" className="block max-w-[60%]">
                              <img src={m.image_url} alt="사진" loading="lazy"
                                className="max-h-60 rounded-2xl border border-gray-200 dark:border-gray-700 object-cover" />
                            </a>
                          ) : m.file_url ? (
                            <a href={m.file_url} target="_blank" rel="noopener noreferrer" download
                              className={cn('flex max-w-[78%] items-center gap-2 rounded-2xl border px-3 py-2 text-sm',
                                mine ? 'bg-blue-600 border-blue-500 text-white rounded-br-md' : 'bg-gray-100 dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-800 dark:text-gray-100 rounded-bl-md')}>
                              <FileText className="h-4 w-4 flex-shrink-0" />
                              <span className="truncate">{m.file_name || '파일'}</span>
                              <Download className="h-3.5 w-3.5 flex-shrink-0 opacity-70" />
                            </a>
                          ) : (
                            <div className={cn('max-w-[78%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm',
                              mine ? 'bg-blue-600 text-white rounded-br-md' : 'bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-100 rounded-bl-md')}>
                              {m.body}
                            </div>
                          )}
                          <div className="mb-0.5 flex flex-col items-end flex-shrink-0 leading-tight">
                            {mine && (() => {
                              const u = unreadByOthers(m)
                              if (u === null) return null
                              return u > 0
                                ? <span className="text-[10px] font-bold text-amber-500">{u}</span>
                                : <span className="text-[10px] text-gray-400">읽음</span>
                            })()}
                            <span className="text-[10px] text-gray-400">{timeLabel(m.created_at)}</span>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                  <div ref={bottomRef} />
                </div>

                <div className="flex items-center gap-2 border-t border-gray-100 dark:border-gray-800 px-3 py-2.5">
                  <input ref={fileRef} type="file" className="hidden"
                    onChange={e => { const f = e.target.files?.[0]; if (f) sendAttachment(f); e.target.value = '' }} />
                  <button onClick={() => fileRef.current?.click()} disabled={sending}
                    className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-40" title="파일·사진 첨부" aria-label="파일·사진 첨부">
                    <Paperclip className="h-5 w-5" />
                  </button>
                  <input
                    value={draft}
                    onChange={e => setDraft(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
                    placeholder="메시지 입력"
                    className="flex-1 rounded-full border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-300"
                  />
                  <button onClick={send} disabled={!draft.trim() || sending}
                    className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40">
                    <Send className="h-4 w-4" />
                  </button>
                </div>
              </>
            ) : (
              <div className="hidden sm:flex flex-1 items-center justify-center text-sm text-gray-400">
                <div className="text-center">
                  <MessageSquare className="mx-auto h-10 w-10 text-gray-200 dark:text-gray-700 mb-2" />
                  왼쪽에서 대화를 선택하세요
                </div>
              </div>
            )}
          </section>
        </div>
      </div>

      {/* 새 대화 모달 — 1명 선택=1:1, 2명+ 선택=단체방 */}
      {showNewDm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => { setShowNewDm(false); setNewSel(new Set()); setNewTitle('') }}>
          <div className="w-full max-w-xs rounded-2xl bg-white dark:bg-gray-900 shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-gray-100 dark:border-gray-800 px-4 py-3">
              <h2 className="font-bold text-gray-900 dark:text-white">새 대화</h2>
              <button onClick={() => { setShowNewDm(false); setNewSel(new Set()); setNewTitle('') }} aria-label="닫기"><X className="h-5 w-5 text-gray-500" /></button>
            </div>

            <p className="px-4 pt-3 text-xs text-gray-400">대화할 직원을 고르세요. 2명 이상이면 단체방이 됩니다.</p>
            <div className="max-h-64 overflow-y-auto py-1">
              {dmCandidates.length === 0 && <p className="px-4 py-6 text-center text-sm text-gray-400">대화할 직원이 없어요</p>}
              {dmCandidates.map(m => {
                const checked = newSel.has(m.id)
                return (
                  <button key={m.id}
                    onClick={() => setNewSel(prev => { const n = new Set(prev); n.has(m.id) ? n.delete(m.id) : n.add(m.id); return n })}
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-gray-50 dark:hover:bg-gray-800">
                    <span className={cn('flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md border',
                      checked ? 'border-blue-500 bg-blue-500 text-white' : 'border-gray-300 dark:border-gray-600')}>
                      {checked && <span className="text-[11px] leading-none">✓</span>}
                    </span>
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gray-100 dark:bg-gray-800 text-sm font-bold text-gray-600 dark:text-gray-400">{m.name[0]}</span>
                    <span className="text-sm text-gray-800 dark:text-gray-200">{m.name}</span>
                  </button>
                )
              })}
            </div>

            {/* 2명 이상이면 단체방 이름 입력 */}
            {newSel.size >= 2 && (
              <div className="border-t border-gray-100 dark:border-gray-800 px-4 py-3">
                <input value={newTitle} onChange={e => setNewTitle(e.target.value)}
                  placeholder="단체방 이름 (선택)"
                  className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-300" />
              </div>
            )}

            <div className="border-t border-gray-100 dark:border-gray-800 px-4 py-3">
              <button onClick={confirmNew} disabled={newSel.size === 0}
                className="w-full rounded-lg bg-blue-600 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-40">
                {newSel.size <= 1 ? '대화 시작' : `단체방 만들기 (${newSel.size}명)`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
