'use client'

import { useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback, Fragment } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/components/toast'
import { ImageLightbox } from '@/components/image-lightbox'
import { cn } from '@/lib/utils'
import { ymdKST } from '@/lib/date-kst'
import {
  ArrowLeft, Search, Menu, Plus, Send, X, FileText, Download, CornerUpLeft, Copy, Trash2,
  Megaphone, ChevronDown, ChevronUp, Image as ImageIcon, Paperclip, Link2, Pin, PinOff,
  Bell, BellOff, Pencil, UserPlus, LogOut, MoreHorizontal, ArrowDown,
} from 'lucide-react'
import {
  type Thread, type Msg, type Member, type MyRow, type ReactionKey,
  REACTIONS, reactionEmoji, ampm, dayDivider, imagesOf, previewText, URL_RE,
  CHAT_BUCKET, chatStoragePath, useSignedUrls, urlOf,
} from './shared'

const PAGE = 100
const MAX_PHOTOS = 30
const MAX_FILE = 20 * 1024 * 1024

/** 프로필 사진(없으면 이름 첫 글자). 카톡처럼 둥근 사각형 */
export function Avatar({ member, name, size = 40, className }: { member?: Member | null; name?: string; size?: number; className?: string }) {
  const urls = useSignedUrls([member?.avatarPath])
  const url = urlOf(urls, member?.avatarPath)
  // '(퇴사)'처럼 괄호로 시작하는 이름은 첫 글자가 '(' 라 물음표로 둔다
  const first = (member?.name ?? name ?? '').trim()[0]
  const label = first && first !== '(' ? first : '?'
  return (
    <span
      className={cn('flex flex-shrink-0 items-center justify-center overflow-hidden rounded-[38%] bg-[#a6bdd1] text-white font-bold dark:bg-gray-700', className)}
      style={{ width: size, height: size, fontSize: size * 0.4 }}
    >
      {url
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={url} alt="" className="h-full w-full object-cover" />
        : label}
    </span>
  )
}

type ReactMap = Record<string, Record<string, string[]>> // message → 공감 키 → broker id 들

interface Props {
  thread: Thread
  title: string
  myId: string
  office: string
  members: Member[]
  memberById: Record<string, Member>
  myRow: MyRow | null
  onBack: () => void
  onOpenProfile: (brokerId: string) => void
  onRead: (threadId: string) => void
  onSent: (msg: Msg) => void
  onThreadPatch: (patch: Partial<Thread>) => void
  onTogglePin: () => void
  onToggleMute: () => void
  onInvite: () => void
  onLeave: () => void
}

export function ChatRoom(props: Props) {
  const { thread, title, myId, office, members, memberById, myRow } = props
  const supabase = useMemo(() => createClient(), [])
  const toast = useToast()

  const [messages, setMessages] = useState<Msg[]>([])
  const [extra, setExtra] = useState<Record<string, Msg>>({}) // 화면 밖 답장 원본·공지 메시지
  const [hasMore, setHasMore] = useState(false)
  const [detached, setDetached] = useState(false) // 검색으로 옛 대화로 건너가 최신과 끊긴 상태
  const [memRows, setMemRows] = useState<{ broker_id: string; last_read_at: string | null }[]>([])
  const [reacts, setReacts] = useState<ReactMap>({})
  const [loading, setLoading] = useState(true)

  const [draft, setDraft] = useState('')
  const [replyTo, setReplyTo] = useState<Msg | null>(null)
  const [sending, setSending] = useState(false)
  const [attachOpen, setAttachOpen] = useState(false)
  const [menuMsg, setMenuMsg] = useState<Msg | null>(null)
  const [sideOpen, setSideOpen] = useState(false)
  const [drawer, setDrawer] = useState<null | 'photo' | 'file' | 'link'>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [noticeFolded, setNoticeFolded] = useState(false)
  const [highlight, setHighlight] = useState<string | null>(null)
  const [lightbox, setLightbox] = useState<{ images: string[]; index: number } | null>(null)
  const [newBelow, setNewBelow] = useState(0) // 위로 올려 보는 중 새로 온 메시지 수
  const [dragging, setDragging] = useState(false)
  const [staged, setStaged] = useState<File[]>([]) // 사진·파일은 바로 보내지 않고 한 번 보여준다(카톡처럼)

  const scrollRef = useRef<HTMLDivElement>(null)
  const atBottomRef = useRef(true)
  const keepScrollRef = useRef<number | null>(null) // 이전 대화를 위에 붙일 때 보던 자리 유지
  const photoRef = useRef<HTMLInputElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const detachedRef = useRef(false)
  detachedRef.current = detached
  const messagesRef = useRef<Msg[]>([])
  messagesRef.current = messages

  const nameOf = useCallback((id: string | null | undefined) =>
    id ? (memberById[id]?.name ?? '(퇴사)') : '(퇴사)', [memberById])

  // ── 메시지 불러오기 ─────────────────────────────────────
  const loadReactions = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return
    const { data } = await supabase.from('office_chat_reactions').select('message_id, broker_id, emoji').in('message_id', ids)
    setReacts(prev => {
      const next = { ...prev }
      for (const id of ids) next[id] = {}
      for (const r of data ?? []) {
        const byKey = next[r.message_id] ?? (next[r.message_id] = {})
        ;(byKey[r.emoji] ??= []).push(r.broker_id)
      }
      return next
    })
  }, [supabase])

  const loadLatest = useCallback(async () => {
    const { data } = await supabase.from('office_chat_messages').select('*').eq('thread_id', thread.id)
      .order('created_at', { ascending: false }).limit(PAGE)
    const rows = ((data ?? []) as Msg[]).reverse()
    setMessages(rows)
    setHasMore(rows.length === PAGE)
    setDetached(false)
    setNewBelow(0)
    atBottomRef.current = true
    loadReactions(rows.map(m => m.id))
    setLoading(false)
  }, [supabase, thread.id, loadReactions])

  useEffect(() => {
    setLoading(true)
    setMessages([]); setExtra({}); setReacts({}); setReplyTo(null); setDraft('')
    setSideOpen(false); setDrawer(null); setSearchOpen(false); setNoticeFolded(false)
    loadLatest()
    props.onRead(thread.id)
    supabase.from('office_chat_members').select('broker_id, last_read_at').eq('thread_id', thread.id)
      .then(({ data }) => setMemRows(data ?? []))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thread.id])

  const loadOlder = async () => {
    const first = messages[0]
    if (!first) return
    const { data } = await supabase.from('office_chat_messages').select('*').eq('thread_id', thread.id)
      .lt('created_at', first.created_at).order('created_at', { ascending: false }).limit(PAGE)
    const rows = ((data ?? []) as Msg[]).reverse()
    keepScrollRef.current = scrollRef.current ? scrollRef.current.scrollHeight - scrollRef.current.scrollTop : null
    setMessages(prev => [...rows, ...prev])
    setHasMore(rows.length === PAGE)
    loadReactions(rows.map(m => m.id))
  }

  /** 검색·공지·답장 원본으로 건너가기 — 화면에 없으면 그 앞뒤를 새로 불러온다 */
  const jumpTo = async (target: Pick<Msg, 'id' | 'created_at'>) => {
    setSearchOpen(false); setSideOpen(false); setDrawer(null)
    if (!messagesRef.current.some(m => m.id === target.id)) {
      const [before, after] = await Promise.all([
        supabase.from('office_chat_messages').select('*').eq('thread_id', thread.id)
          .lt('created_at', target.created_at).order('created_at', { ascending: false }).limit(30),
        supabase.from('office_chat_messages').select('*').eq('thread_id', thread.id)
          .gte('created_at', target.created_at).order('created_at', { ascending: true }).limit(PAGE),
      ])
      const rows = [...((before.data ?? []) as Msg[]).reverse(), ...((after.data ?? []) as Msg[])]
      setMessages(rows)
      setHasMore((before.data ?? []).length === 30)
      setDetached((after.data ?? []).length === PAGE)
      loadReactions(rows.map(m => m.id))
    }
    setHighlight(target.id)
    requestAnimationFrame(() => requestAnimationFrame(() => {
      document.getElementById(`msg-${target.id}`)?.scrollIntoView({ block: 'center' })
    }))
    setTimeout(() => setHighlight(h => (h === target.id ? null : h)), 2000)
  }

  // 답장 원본·공지가 화면 밖에 있으면 따로 받아 둔다
  const needIds = useMemo(() => {
    const have = new Set(messages.map(m => m.id))
    const ids = new Set<string>()
    for (const m of messages) if (m.reply_to_id && !have.has(m.reply_to_id)) ids.add(m.reply_to_id)
    if (thread.notice_message_id && !have.has(thread.notice_message_id)) ids.add(thread.notice_message_id)
    return [...ids].filter(id => !extra[id]).sort().join(',')
  }, [messages, thread.notice_message_id, extra])
  useEffect(() => {
    if (!needIds) return
    supabase.from('office_chat_messages').select('*').in('id', needIds.split(','))
      .then(({ data }) => setExtra(prev => {
        const next = { ...prev }
        for (const m of (data ?? []) as Msg[]) next[m.id] = m
        return next
      }))
  }, [needIds, supabase])
  const findMsg = (id: string | null | undefined) =>
    id ? (messages.find(m => m.id === id) ?? extra[id] ?? null) : null

  // ── 실시간: 이 방의 메시지·읽음·공감 ─────────────────────
  useEffect(() => {
    const ch = supabase.channel(`oc-room:${thread.id}:${Date.now()}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'office_chat_messages', filter: `thread_id=eq.${thread.id}` }, payload => {
        const msg = payload.new as Msg
        if (msg.sender_broker_id !== myId) props.onRead(thread.id)
        if (detachedRef.current) { setNewBelow(n => n + 1); return }
        setMessages(prev => prev.some(m => m.id === msg.id) ? prev : [...prev, msg])
        if (!atBottomRef.current && msg.sender_broker_id !== myId) setNewBelow(n => n + 1)
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'office_chat_messages', filter: `thread_id=eq.${thread.id}` }, payload => {
        const msg = payload.new as Msg
        setMessages(prev => prev.map(m => m.id === msg.id ? msg : m))
        setExtra(prev => prev[msg.id] ? { ...prev, [msg.id]: msg } : prev)
        if (msg.deleted_at) setReacts(prev => ({ ...prev, [msg.id]: {} }))
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'office_chat_members', filter: `thread_id=eq.${thread.id}` }, payload => {
        if (payload.eventType === 'DELETE') {
          const old = payload.old as { broker_id?: string }
          if (old.broker_id) setMemRows(prev => prev.filter(r => r.broker_id !== old.broker_id))
          return
        }
        const row = payload.new as { broker_id: string; last_read_at: string | null }
        setMemRows(prev => {
          const i = prev.findIndex(r => r.broker_id === row.broker_id)
          if (i < 0) return [...prev, { broker_id: row.broker_id, last_read_at: row.last_read_at }]
          const c = [...prev]; c[i] = { broker_id: row.broker_id, last_read_at: row.last_read_at }; return c
        })
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'office_chat_reactions' }, payload => {
        const r = payload.new as { message_id: string; broker_id: string; emoji: string }
        if (!messagesRef.current.some(m => m.id === r.message_id)) return
        setReacts(prev => addReact(prev, r.message_id, r.emoji, r.broker_id))
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'office_chat_reactions' }, payload => {
        const r = payload.old as { message_id?: string; broker_id?: string; emoji?: string }
        if (!r.message_id || !r.broker_id || !r.emoji) return
        setReacts(prev => removeReact(prev, r.message_id!, r.emoji!, r.broker_id!))
      })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thread.id, myId, supabase])

  // ── 스크롤 ───────────────────────────────────────────
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    if (keepScrollRef.current !== null) {
      el.scrollTop = el.scrollHeight - keepScrollRef.current
      keepScrollRef.current = null
    } else if (atBottomRef.current && !highlight) {
      el.scrollTop = el.scrollHeight
    }
  }, [messages, highlight])
  const onScroll = () => {
    const el = scrollRef.current
    if (!el) return
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    if (atBottomRef.current && !detached) setNewBelow(0)
  }
  const toBottom = () => {
    if (detached) { loadLatest(); return }
    atBottomRef.current = true
    setNewBelow(0)
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }

  // ── 첨부 서명 URL ────────────────────────────────────
  const urls = useSignedUrls(messages.flatMap(m => [...imagesOf(m), m.file_url]))

  // ── 읽지 않은 사람 수(카톡의 노란 숫자) ────────────────
  const unreadCount = (m: Msg): number => {
    const t = new Date(m.created_at).getTime()
    const readAt = new Map(memRows.map(r => [r.broker_id, r.last_read_at]))
    // 사무소 전체방은 멤버 행이 처음 읽을 때 생기므로 대상은 사무소 전원
    const audience = thread.kind === 'group' ? members.map(x => x.id) : memRows.map(r => r.broker_id)
    return audience.filter(id => {
      if (id === myId || id === m.sender_broker_id) return false
      const r = readAt.get(id)
      return !r || new Date(r).getTime() < t
    }).length
  }

  // ── 보내기 ──────────────────────────────────────────
  const notify = (preview: string) => {
    fetch('/api/messenger/notify', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ threadId: thread.id, preview }),
    }).catch(() => {})
  }
  const appendMine = (msg: Msg) => {
    if (detachedRef.current) loadLatest()
    else setMessages(prev => prev.some(m => m.id === msg.id) ? prev : [...prev, msg])
    atBottomRef.current = true
    props.onSent(msg)
  }

  const send = async () => {
    const body = draft.trim()
    if (!body || sending) return
    const replyId = replyTo?.id ?? null
    setSending(true)
    setDraft(''); setReplyTo(null)
    const { data, error } = await supabase.from('office_chat_messages')
      .insert({ thread_id: thread.id, sender_broker_id: myId, body, reply_to_id: replyId }).select().single()
    setSending(false)
    if (error || !data) { toast.error('전송 실패' + (error ? ': ' + error.message : '')); setDraft(body); return }
    appendMine(data as Msg)
    notify(body.slice(0, 80))
    inputRef.current?.focus()
  }

  const upload = async (file: File) => {
    const ext = (file.name.split('.').pop() || 'bin').toLowerCase()
    const path = `${office}/${thread.id}/${crypto.randomUUID()}.${ext}`
    const { error } = await supabase.storage.from(CHAT_BUCKET).upload(path, file, { contentType: file.type || undefined })
    if (error) throw error
    return path
  }

  /** 사진 여러 장은 메시지 하나(묶음)로, 그 밖의 파일은 한 개씩 */
  const sendFiles = async (files: File[]) => {
    if (files.length === 0 || sending) return
    const big = files.find(f => f.size > MAX_FILE)
    if (big) { toast.error(`20MB 이하 파일만 보낼 수 있어요 (${big.name})`); return }
    const photos = files.filter(f => f.type.startsWith('image/'))
    const others = files.filter(f => !f.type.startsWith('image/'))
    if (photos.length > MAX_PHOTOS) { toast.error(`사진은 한 번에 ${MAX_PHOTOS}장까지 보낼 수 있어요`); return }
    setSending(true); setAttachOpen(false)
    try {
      if (photos.length) {
        const paths = await Promise.all(photos.map(upload))
        const { data, error } = await supabase.from('office_chat_messages')
          .insert({ thread_id: thread.id, sender_broker_id: myId, body: '', image_paths: paths }).select().single()
        if (error || !data) { await supabase.storage.from(CHAT_BUCKET).remove(paths); throw error ?? new Error('전송 실패') }
        appendMine(data as Msg)
        notify(paths.length > 1 ? `사진 ${paths.length}장을 보냈습니다` : '사진을 보냈습니다')
      }
      for (const f of others) {
        const path = await upload(f)
        const { data, error } = await supabase.from('office_chat_messages')
          .insert({ thread_id: thread.id, sender_broker_id: myId, body: '', file_url: path, file_name: f.name }).select().single()
        if (error || !data) { await supabase.storage.from(CHAT_BUCKET).remove([path]); throw error ?? new Error('전송 실패') }
        appendMine(data as Msg)
        notify(`파일: ${f.name}`.slice(0, 80))
      }
    } catch (e) {
      toast.error('전송 실패: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setSending(false)
    }
  }

  /** 붙여넣기·끌어놓기·앨범·파일 — 보내기 전 확인 창에 올린다. 여러 번 고르면 쌓인다 */
  const stage = (files: File[]) => {
    if (files.length === 0 || sending) return
    setAttachOpen(false)
    setStaged(prev => [...prev, ...files])
  }

  // ── 메시지 메뉴 동작 ──────────────────────────────────
  const toggleReact = async (m: Msg, key: ReactionKey) => {
    setMenuMsg(null)
    const mine = reacts[m.id]?.[key]?.includes(myId)
    setReacts(prev => mine ? removeReact(prev, m.id, key, myId) : addReact(prev, m.id, key, myId))
    const { error } = mine
      ? await supabase.from('office_chat_reactions').delete().eq('message_id', m.id).eq('broker_id', myId).eq('emoji', key)
      : await supabase.from('office_chat_reactions').insert({ message_id: m.id, broker_id: myId, emoji: key })
    if (error && error.code !== '23505') {
      toast.error('공감 실패: ' + error.message)
      setReacts(prev => mine ? addReact(prev, m.id, key, myId) : removeReact(prev, m.id, key, myId))
    }
  }

  const deleteMsg = async (m: Msg) => {
    setMenuMsg(null)
    if (!window.confirm('모두에게서 삭제할까요? 대화방의 모든 사람에게서 사라지고 "삭제된 메시지입니다"로 남아요.')) return
    const { data, error } = await supabase.rpc('delete_office_chat_message', { p_id: m.id })
    if (error) { toast.error('삭제 실패: ' + error.message); return }
    const gone: Msg = { ...m, body: '', image_url: null, image_paths: null, file_url: null, file_name: null, deleted_at: new Date().toISOString() }
    setMessages(prev => prev.map(x => x.id === m.id ? gone : x))
    if (thread.notice_message_id === m.id) props.onThreadPatch({ notice_message_id: null })
    // 첨부는 행이 비워진 뒤에 지운다 — 저장소 정책은 올린 사람만 지울 수 있다(나 = 보낸 사람)
    const paths = ((data ?? []) as string[]).map(chatStoragePath).filter((p): p is string => !!p)
    if (paths.length) {
      const { error: rmErr } = await supabase.storage.from(CHAT_BUCKET).remove(paths)
      if (rmErr) console.error('[messenger] attachment remove failed', rmErr)
    }
  }

  const setNotice = async (messageId: string | null) => {
    setMenuMsg(null)
    if (messageId === null && !window.confirm('공지를 내릴까요?')) return
    const { error } = await supabase.rpc('set_office_chat_notice', { p_thread: thread.id, p_message: messageId })
    if (error) { toast.error('공지 ' + (messageId ? '등록' : '내리기') + ' 실패: ' + error.message); return }
    props.onThreadPatch({ notice_message_id: messageId })
    setNoticeFolded(false)
  }

  const copy = async (m: Msg) => {
    setMenuMsg(null)
    try { await navigator.clipboard.writeText(m.body); toast.success('복사했어요') } catch { toast.error('복사하지 못했어요') }
  }

  // ── 길게 누르기(폰) ───────────────────────────────────
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pressStart = (m: Msg) => (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' || m.deleted_at) return
    pressTimer.current = setTimeout(() => setMenuMsg(m), 450)
  }
  const pressCancel = () => { if (pressTimer.current) clearTimeout(pressTimer.current) }

  const notice = findMsg(thread.notice_message_id)
  const memberCount = thread.kind === 'group' ? members.length : memRows.length
  const roomMembers = thread.kind === 'group'
    ? members
    : memRows.map(r => memberById[r.broker_id]).filter((m): m is Member => !!m)

  return (
    <section
      className="relative flex h-full min-w-0 flex-1 flex-col bg-[#bacee0] dark:bg-gray-950"
      onDragOver={e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDragging(true) } }}
      onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false) }}
      onDrop={e => { e.preventDefault(); setDragging(false); stage(Array.from(e.dataTransfer.files)) }}
    >
      {dragging && (
        <div className="pointer-events-none absolute inset-2 z-30 flex items-center justify-center rounded-xl border-2 border-dashed border-gray-600 bg-white/40">
          <span className="rounded-xl bg-white px-4 py-3 text-sm font-semibold text-gray-800 shadow">여기에 놓으세요</span>
        </div>
      )}
      {staged.length > 0 && (
        <StagedSend files={staged} sending={sending}
          onCancel={() => { setStaged([]); inputRef.current?.focus() }}
          onSend={async () => { const f = staged; setStaged([]); await sendFiles(f); inputRef.current?.focus() }} />
      )}

      {/* 머리 */}
      <header className="flex items-center gap-2 bg-[#bacee0]/95 px-3 py-2.5 dark:bg-gray-900">
        <button onClick={props.onBack} className="rounded-lg p-1 text-gray-800 hover:bg-black/5 dark:text-gray-200 md:hidden" aria-label="목록으로">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h2 className="min-w-0 truncate font-bold text-gray-900 dark:text-white">{title}</h2>
        {thread.kind !== 'dm' && <span className="flex-shrink-0 text-sm text-gray-600 dark:text-gray-400">{memberCount}</span>}
        {myRow?.muted && <BellOff className="h-3.5 w-3.5 flex-shrink-0 text-gray-500" aria-label="알림 꺼짐" />}
        <span className="ml-auto" />
        <button onClick={() => setSearchOpen(v => !v)} className="rounded-lg p-1.5 text-gray-800 hover:bg-black/5 dark:text-gray-200" aria-label="대화 검색" title="대화 검색">
          <Search className="h-5 w-5" />
        </button>
        <button onClick={() => setSideOpen(true)} className="rounded-lg p-1.5 text-gray-800 hover:bg-black/5 dark:text-gray-200" aria-label="채팅방 서랍" title="채팅방 서랍">
          <Menu className="h-5 w-5" />
        </button>
      </header>

      {searchOpen && <SearchBar threadId={thread.id} nameOf={nameOf} onPick={jumpTo} onClose={() => setSearchOpen(false)} />}

      {/* 공지 */}
      {notice && !searchOpen && (
        <div className="absolute left-3 right-3 top-14 z-20 rounded-xl bg-white/95 shadow-md dark:bg-gray-800">
          <div className="flex items-start gap-2 px-3 py-2.5">
            <Megaphone className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-700 dark:text-gray-300" />
            <button onClick={() => jumpTo(notice)} className={cn('min-w-0 flex-1 text-left text-sm text-gray-800 dark:text-gray-100', noticeFolded ? 'truncate' : 'line-clamp-3 whitespace-pre-wrap')}>
              {previewText(notice)}
            </button>
            <button onClick={() => setNoticeFolded(v => !v)} className="rounded p-0.5 text-gray-500" aria-label={noticeFolded ? '공지 펼치기' : '공지 접기'}>
              {noticeFolded ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
            </button>
          </div>
          {!noticeFolded && (
            <div className="flex items-center justify-between border-t border-gray-100 px-3 py-1.5 text-[11px] text-gray-500 dark:border-gray-700">
              <span>{nameOf(notice.sender_broker_id)} · {dayDivider(notice.created_at)}</span>
              <button onClick={() => setNotice(null)} className="font-semibold text-gray-600 hover:text-red-500 dark:text-gray-300">내리기</button>
            </div>
          )}
        </div>
      )}

      {/* 대화 */}
      <div ref={scrollRef} onScroll={onScroll} className={cn('flex-1 overflow-y-auto px-3 pb-3', notice && !searchOpen ? 'pt-24' : 'pt-3')}>
        {loading && <p className="py-10 text-center text-sm text-gray-600">불러오는 중…</p>}
        {!loading && hasMore && (
          <div className="mb-3 flex justify-center">
            <button onClick={loadOlder} className="rounded-full bg-black/10 px-3 py-1 text-xs text-gray-700 hover:bg-black/15 dark:text-gray-300">이전 대화 더 보기</button>
          </div>
        )}
        {!loading && messages.length === 0 && (
          <p className="py-16 text-center text-sm text-gray-600 dark:text-gray-400">첫 메시지를 보내 보세요</p>
        )}
        {messages.map((m, i) => {
          const prev = messages[i - 1]
          const next = messages[i + 1]
          // 등록 봇 답장은 봇 계정(대표)이 보내지만 '부소장봇'으로 따로 보인다
          const mine = m.sender_broker_id === myId && !m.bot_name
          const newDay = !prev || ymdKST(prev.created_at) !== ymdKST(m.created_at)
          // 같은 사람이 같은 분에 연달아 보낸 말은 한 덩어리 — 이름·사진은 첫 말, 시각은 끝 말에만
          const sameAsPrev = !!prev && !newDay && senderKey(prev) === senderKey(m) && ampm(prev.created_at) === ampm(m.created_at)
          const sameAsNext = !!next && ymdKST(next.created_at) === ymdKST(m.created_at) && senderKey(next) === senderKey(m) && ampm(next.created_at) === ampm(m.created_at)
          const showHead = !mine && !sameAsPrev
          const unread = unreadCount(m)
          const replied = findMsg(m.reply_to_id)
          const imgs = imagesOf(m)
          const rx = Object.entries(reacts[m.id] ?? {}).filter(([, ids]) => ids.length > 0)
          return (
            <Fragment key={m.id}>
              {newDay && (
                <div className="my-3 flex justify-center">
                  <span className="rounded-full bg-black/10 px-3 py-1 text-[11px] text-gray-700 dark:bg-gray-800 dark:text-gray-400">{dayDivider(m.created_at)}</span>
                </div>
              )}
              <div id={`msg-${m.id}`} className={cn('flex gap-2', mine ? 'justify-end' : 'justify-start', sameAsPrev ? 'mt-1' : 'mt-3',
                highlight === m.id && 'rounded-lg bg-yellow-200/60 transition-colors')}>
                {!mine && (
                  <div className="w-10 flex-shrink-0">
                    {showHead && m.bot_name && (
                      <span className="flex h-10 w-10 items-center justify-center rounded-[38%] bg-[#fee500] text-xl" aria-hidden>🤖</span>
                    )}
                    {showHead && !m.bot_name && (
                      <button onClick={() => m.sender_broker_id && props.onOpenProfile(m.sender_broker_id)} aria-label={`${nameOf(m.sender_broker_id)} 프로필`}>
                        <Avatar member={m.sender_broker_id ? memberById[m.sender_broker_id] : null} name={nameOf(m.sender_broker_id)} />
                      </button>
                    )}
                  </div>
                )}
                <div className={cn('flex min-w-0 max-w-[75%] flex-col', mine ? 'items-end' : 'items-start')}>
                  {showHead && <span className="mb-1 text-xs text-gray-700 dark:text-gray-300">{m.bot_name ?? nameOf(m.sender_broker_id)}</span>}
                  <div className={cn('group flex items-end gap-1.5', mine && 'flex-row-reverse')}>
                    <div
                      onContextMenu={e => { if (m.deleted_at) return; e.preventDefault(); setMenuMsg(m) }}
                      onPointerDown={pressStart(m)} onPointerUp={pressCancel} onPointerLeave={pressCancel} onPointerMove={pressCancel}
                      className="min-w-0 select-text"
                    >
                      {m.deleted_at ? (
                        <div className={cn('flex items-center gap-1.5 rounded-2xl px-3 py-2 text-sm text-gray-500', mine ? 'bg-[#fee500]/70' : 'bg-white/80 dark:bg-gray-800')}>
                          <Trash2 className="h-3.5 w-3.5" /> 삭제된 메시지입니다.
                        </div>
                      ) : imgs.length > 0 ? (
                        <PhotoGrid paths={imgs} urls={urls} onOpen={idx => {
                          const list = imgs.map(p => urlOf(urls, p)).filter((u): u is string => !!u)
                          if (list.length) setLightbox({ images: list, index: Math.min(idx, list.length - 1) })
                        }} />
                      ) : m.file_url ? (
                        <FileBubble name={m.file_name} url={urlOf(urls, m.file_url)} mine={mine} />
                      ) : (
                        <div className={cn('whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-[15px] leading-snug',
                          mine ? 'bg-[#fee500] text-gray-900' : 'bg-white text-gray-900 dark:bg-gray-800 dark:text-gray-100',
                          !sameAsPrev && (mine ? 'rounded-tr-sm' : 'rounded-tl-sm'))}>
                          {replied && (
                            <button onClick={() => jumpTo(replied)} className="mb-1.5 block w-full border-b border-black/10 pb-1.5 text-left">
                              <span className="block text-xs font-semibold text-gray-700 dark:text-gray-300">{nameOf(replied.sender_broker_id)}에게 답장</span>
                              <span className="block truncate text-xs text-gray-500">{previewText(replied)}</span>
                            </button>
                          )}
                          <Linkified text={m.body} />
                        </div>
                      )}
                    </div>
                    <div className={cn('flex flex-shrink-0 flex-col pb-0.5 leading-tight', mine ? 'items-end' : 'items-start')}>
                      {!m.deleted_at && (
                        <button onClick={() => setMenuMsg(m)} className="mb-0.5 hidden rounded p-0.5 text-gray-600 hover:bg-black/10 group-hover:block" aria-label="메시지 메뉴">
                          <MoreHorizontal className="h-3.5 w-3.5" />
                        </button>
                      )}
                      {unread > 0 && <span className="text-[11px] font-bold text-[#e6b800] dark:text-yellow-400">{unread}</span>}
                      {!sameAsNext && <span className="whitespace-nowrap text-[10px] text-gray-600 dark:text-gray-400">{ampm(m.created_at)}</span>}
                    </div>
                  </div>
                  {rx.length > 0 && (
                    <div className={cn('mt-1 flex flex-wrap gap-1', mine && 'justify-end')}>
                      {rx.map(([k, ids]) => (
                        <button key={k} onClick={() => toggleReact(m, k as ReactionKey)} title={ids.map(nameOf).join(', ')}
                          className={cn('flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs',
                            ids.includes(myId) ? 'border-gray-700 bg-white text-gray-900' : 'border-transparent bg-white/70 text-gray-700 dark:bg-gray-800 dark:text-gray-300')}>
                          <span>{reactionEmoji(k)}</span><span>{ids.length}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </Fragment>
          )
        })}
      </div>

      {(newBelow > 0 || detached) && (
        <button onClick={toBottom} className="absolute bottom-20 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-full bg-gray-900/80 px-3 py-1.5 text-xs text-white shadow">
          <ArrowDown className="h-3.5 w-3.5" /> {newBelow > 0 ? `새 메시지 ${newBelow}개` : '최신 메시지로'}
        </button>
      )}

      {/* 답장 중 */}
      {replyTo && (
        <div className="flex items-center gap-2 border-t border-gray-200 bg-white px-3 py-2 dark:border-gray-800 dark:bg-gray-900">
          <CornerUpLeft className="h-4 w-4 flex-shrink-0 text-gray-500" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-gray-800 dark:text-gray-200">{nameOf(replyTo.sender_broker_id)}에게 답장</p>
            <p className="truncate text-xs text-gray-500">{previewText(replyTo)}</p>
          </div>
          <button onClick={() => setReplyTo(null)} className="rounded p-1 text-gray-400 hover:bg-gray-100" aria-label="답장 취소"><X className="h-4 w-4" /></button>
        </div>
      )}

      {/* 첨부 고르기 */}
      {attachOpen && (
        <div className="grid grid-cols-2 gap-2 border-t border-gray-200 bg-white px-3 py-3 dark:border-gray-800 dark:bg-gray-900 sm:grid-cols-4">
          <button onClick={() => photoRef.current?.click()} className="flex flex-col items-center gap-1 rounded-xl py-2 text-xs text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#7bc96f] text-white"><ImageIcon className="h-5 w-5" /></span>앨범
          </button>
          <button onClick={() => fileRef.current?.click()} className="flex flex-col items-center gap-1 rounded-xl py-2 text-xs text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#6aa4e8] text-white"><Paperclip className="h-5 w-5" /></span>파일
          </button>
        </div>
      )}
      <input ref={photoRef} type="file" accept="image/*" multiple className="hidden"
        onChange={e => { stage(Array.from(e.target.files ?? [])); e.target.value = '' }} />
      <input ref={fileRef} type="file" multiple className="hidden"
        onChange={e => { stage(Array.from(e.target.files ?? [])); e.target.value = '' }} />

      {/* 입력 */}
      <div className="flex items-end gap-2 bg-white px-2 py-2 dark:bg-gray-900">
        <button onClick={() => setAttachOpen(v => !v)} disabled={sending}
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100 disabled:opacity-40 dark:hover:bg-gray-800" aria-label="사진·파일 보내기">
          {attachOpen ? <X className="h-5 w-5" /> : <Plus className="h-5 w-5" />}
        </button>
        <textarea
          ref={inputRef}
          value={draft}
          rows={1}
          onChange={e => { setDraft(e.target.value); e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px' }}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send() }
          }}
          onPaste={e => {
            const files = Array.from(e.clipboardData.files)
            if (files.length) { e.preventDefault(); stage(files) }
          }}
          placeholder="메시지 입력"
          className="max-h-[120px] min-h-[36px] flex-1 resize-none rounded-2xl bg-gray-100 px-3 py-2 text-[15px] outline-none dark:bg-gray-800 dark:text-gray-100"
        />
        <button onClick={send} disabled={!draft.trim() || sending} aria-label="전송"
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-[#fee500] text-gray-900 disabled:bg-gray-100 disabled:text-gray-400 dark:disabled:bg-gray-800">
          <Send className="h-4 w-4" />
        </button>
      </div>

      {/* 메시지 메뉴(길게 누르기·우클릭) */}
      {menuMsg && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={() => setMenuMsg(null)} role="dialog" aria-modal="true" aria-label="메시지 메뉴">
          <div className="w-full max-w-sm overflow-hidden rounded-t-2xl bg-white dark:bg-gray-900 sm:rounded-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex justify-around border-b border-gray-100 px-2 py-3 dark:border-gray-800">
              {REACTIONS.map(r => {
                const on = reacts[menuMsg.id]?.[r.key]?.includes(myId)
                return (
                  <button key={r.key} onClick={() => toggleReact(menuMsg, r.key)} title={r.label} aria-label={r.label}
                    className={cn('flex h-10 w-10 items-center justify-center rounded-full text-2xl transition-transform hover:scale-110', on && 'bg-gray-100 dark:bg-gray-800')}>
                    {r.emoji}
                  </button>
                )
              })}
            </div>
            <MenuItem icon={CornerUpLeft} label="답장" onClick={() => { setReplyTo(menuMsg); setMenuMsg(null); inputRef.current?.focus() }} />
            {!!menuMsg.body && <MenuItem icon={Copy} label="복사" onClick={() => copy(menuMsg)} />}
            {thread.notice_message_id === menuMsg.id
              ? <MenuItem icon={Megaphone} label="공지 내리기" onClick={() => setNotice(null)} />
              : <MenuItem icon={Megaphone} label="공지로 등록" onClick={() => setNotice(menuMsg.id)} />}
            {menuMsg.sender_broker_id === myId && <MenuItem icon={Trash2} label="모두에게서 삭제" danger onClick={() => deleteMsg(menuMsg)} />}
          </div>
        </div>
      )}

      {/* 채팅방 서랍(오른쪽에서 나옴) */}
      {sideOpen && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={() => setSideOpen(false)}>
          <aside className="flex h-full w-full max-w-xs flex-col bg-white dark:bg-gray-900" onClick={e => e.stopPropagation()} aria-label="채팅방 서랍">
            <div className="flex items-center justify-between px-4 py-3">
              <h3 className="font-bold text-gray-900 dark:text-white">채팅방 서랍</h3>
              <button onClick={() => setSideOpen(false)} aria-label="닫기"><X className="h-5 w-5 text-gray-500" /></button>
            </div>
            <div className="grid grid-cols-3 gap-1 border-b border-gray-100 px-3 pb-3 dark:border-gray-800">
              {([['photo', '사진·동영상', ImageIcon], ['file', '파일', FileText], ['link', '링크', Link2]] as const).map(([k, l, Icon]) => (
                <button key={k} onClick={() => setDrawer(k)} className="flex flex-col items-center gap-1 rounded-xl py-3 text-xs text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800">
                  <Icon className="h-5 w-5" />{l}
                </button>
              ))}
            </div>
            <div className="flex-1 overflow-y-auto">
              <p className="px-4 pb-1 pt-3 text-xs font-semibold text-gray-500">대화상대 {roomMembers.length}</p>
              {thread.kind === 'team' && (
                <button onClick={() => { setSideOpen(false); props.onInvite() }} className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-gray-800">
                  <span className="flex h-9 w-9 items-center justify-center rounded-[38%] bg-gray-100 dark:bg-gray-800"><UserPlus className="h-4 w-4 text-gray-600" /></span>
                  대화상대 초대
                </button>
              )}
              {roomMembers.map(mem => (
                <button key={mem.id} onClick={() => props.onOpenProfile(mem.id)} className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-800">
                  <Avatar member={mem} size={36} />
                  <span className="text-sm text-gray-800 dark:text-gray-200">{mem.name}{mem.id === myId && <span className="ml-1 rounded bg-gray-200 px-1 text-[10px] text-gray-600">나</span>}</span>
                </button>
              ))}
            </div>
            <div className="flex items-center justify-around border-t border-gray-100 py-2 dark:border-gray-800">
              <SideButton icon={myRow?.pinned_at ? PinOff : Pin} label={myRow?.pinned_at ? '고정 해제' : '위에 고정'} onClick={props.onTogglePin} />
              <SideButton icon={myRow?.muted ? Bell : BellOff} label={myRow?.muted ? '알림 켜기' : '알림 끄기'} onClick={props.onToggleMute} />
              {thread.kind === 'team' && (
                <SideButton icon={Pencil} label="이름 변경" onClick={async () => {
                  const name = window.prompt('채팅방 이름', thread.title ?? '')
                  if (name === null) return
                  const t = name.trim() || null
                  const { error } = await supabase.from('office_chat_threads').update({ title: t }).eq('id', thread.id)
                  if (error) { toast.error('이름 변경 실패: ' + error.message); return }
                  props.onThreadPatch({ title: t })
                }} />
              )}
              {thread.kind !== 'group' && <SideButton icon={LogOut} label="나가기" danger onClick={() => { setSideOpen(false); props.onLeave() }} />}
            </div>
          </aside>
        </div>
      )}

      {drawer && (
        <Drawer kind={drawer} threadId={thread.id} nameOf={nameOf} onClose={() => setDrawer(null)}
          onJump={jumpTo} onOpenImages={(images, index) => setLightbox({ images, index })} />
      )}

      {lightbox && (
        <ImageLightbox
          images={lightbox.images}
          index={lightbox.index}
          onClose={() => setLightbox(null)}
          onNext={() => setLightbox(l => l && { ...l, index: (l.index + 1) % l.images.length })}
          onPrev={() => setLightbox(l => l && { ...l, index: (l.index - 1 + l.images.length) % l.images.length })}
          onGoTo={i => setLightbox(l => l && { ...l, index: i })}
        />
      )}
    </section>
  )
}

// ── 작은 조각들 ─────────────────────────────────────────

const senderKey = (m: Msg) => (m.bot_name ? `bot:${m.bot_name}` : m.sender_broker_id)

function addReact(prev: ReactMap, msgId: string, key: string, who: string): ReactMap {
  const byKey = { ...(prev[msgId] ?? {}) }
  const ids = byKey[key] ?? []
  if (ids.includes(who)) return prev
  byKey[key] = [...ids, who]
  return { ...prev, [msgId]: byKey }
}
function removeReact(prev: ReactMap, msgId: string, key: string, who: string): ReactMap {
  const byKey = prev[msgId]
  if (!byKey?.[key]?.includes(who)) return prev
  return { ...prev, [msgId]: { ...byKey, [key]: byKey[key].filter(x => x !== who) } }
}

function Linkified({ text }: { text: string }) {
  const parts: React.ReactNode[] = []
  let last = 0
  for (const m of text.matchAll(URL_RE)) {
    const at = m.index ?? 0
    if (at > last) parts.push(text.slice(last, at))
    parts.push(<a key={at} href={m[0]} target="_blank" rel="noopener noreferrer" className="underline break-all">{m[0]}</a>)
    last = at + m[0].length
  }
  if (last < text.length) parts.push(text.slice(last))
  return <>{parts}</>
}

function PhotoGrid({ paths, urls, onOpen }: { paths: string[]; urls: Record<string, string>; onOpen: (i: number) => void }) {
  if (paths.length === 1) {
    const u = urlOf(urls, paths[0])
    return u ? (
      <button onClick={() => onOpen(0)} className="block overflow-hidden rounded-2xl">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={u} alt="사진" loading="lazy" className="max-h-72 max-w-[240px] object-cover" />
      </button>
    ) : <div className="flex h-40 w-48 items-center justify-center rounded-2xl bg-white/60 text-xs text-gray-500">사진 불러오는 중…</div>
  }
  const cols = paths.length === 2 || paths.length === 4 ? 2 : 3
  return (
    <div className={cn('grid w-[240px] gap-0.5 overflow-hidden rounded-2xl', cols === 2 ? 'grid-cols-2' : 'grid-cols-3')}>
      {paths.map((p, i) => {
        const u = urlOf(urls, p)
        return (
          <button key={p} onClick={() => onOpen(i)} className="aspect-square bg-white/60">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {u && <img src={u} alt={`사진 ${i + 1}`} loading="lazy" className="h-full w-full object-cover" />}
          </button>
        )
      })}
    </div>
  )
}

function FileBubble({ name, url, mine }: { name: string | null | undefined; url: string | null; mine: boolean }) {
  const href = url ? `${url}${url.includes('?') ? '&' : '?'}download=${encodeURIComponent(name || 'file')}` : undefined
  return (
    <a href={href} target="_blank" rel="noopener noreferrer"
      className={cn('flex w-60 items-center gap-3 rounded-2xl px-3 py-3', mine ? 'bg-[#fee500]' : 'bg-white dark:bg-gray-800')}>
      <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-black/5"><FileText className="h-5 w-5 text-gray-700 dark:text-gray-300" /></span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-gray-900 dark:text-gray-100">{name || '파일'}</span>
        <span className="text-[11px] text-gray-500">{url ? '눌러서 받기' : '준비 중…'}</span>
      </span>
      <Download className="h-4 w-4 flex-shrink-0 text-gray-500" />
    </a>
  )
}

function MenuItem({ icon: Icon, label, onClick, danger }: { icon: React.ComponentType<{ className?: string }>; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button onClick={onClick} className={cn('flex w-full items-center gap-3 px-5 py-3 text-left text-sm hover:bg-gray-50 dark:hover:bg-gray-800',
      danger ? 'text-red-600' : 'text-gray-800 dark:text-gray-200')}>
      <Icon className="h-4 w-4" />{label}
    </button>
  )
}

function SideButton({ icon: Icon, label, onClick, danger }: { icon: React.ComponentType<{ className?: string }>; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button onClick={onClick} className={cn('flex flex-col items-center gap-1 rounded-lg px-2 py-1 text-[11px] hover:bg-gray-50 dark:hover:bg-gray-800',
      danger ? 'text-red-600' : 'text-gray-600 dark:text-gray-300')}>
      <Icon className="h-5 w-5" />{label}
    </button>
  )
}

/** 대화 검색 — 이 방의 글자 메시지에서 찾아 누르면 그 자리로 건너간다 */
function SearchBar({ threadId, nameOf, onPick, onClose }: {
  threadId: string; nameOf: (id: string | null) => string; onPick: (m: Msg) => void; onClose: () => void
}) {
  const supabase = useMemo(() => createClient(), [])
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<Msg[] | null>(null)

  useEffect(() => {
    const term = q.trim()
    if (term.length < 1) { setHits(null); return }
    const t = setTimeout(async () => {
      // ilike 의 % _ \ 는 글자 그대로 찾게 막는다
      const safe = term.replace(/[\\%_]/g, c => '\\' + c)
      const { data } = await supabase.from('office_chat_messages').select('*').eq('thread_id', threadId)
        .is('deleted_at', null).ilike('body', `%${safe}%`).order('created_at', { ascending: false }).limit(50)
      setHits((data ?? []) as Msg[])
    }, 250)
    return () => clearTimeout(t)
  }, [q, threadId, supabase])

  return (
    <div className="relative z-30 bg-white shadow dark:bg-gray-900">
      <div className="flex items-center gap-2 px-3 py-2">
        <Search className="h-4 w-4 text-gray-400" />
        <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="대화 내용 검색"
          className="flex-1 bg-transparent text-sm outline-none dark:text-gray-100" />
        <button onClick={onClose} className="text-sm text-gray-500">닫기</button>
      </div>
      {hits && (
        <ul className="max-h-72 overflow-y-auto border-t border-gray-100 dark:border-gray-800">
          {hits.length === 0 && <li className="px-4 py-6 text-center text-sm text-gray-400">찾는 대화가 없어요</li>}
          {hits.map(h => (
            <li key={h.id}>
              <button onClick={() => onPick(h)} className="block w-full px-4 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-800">
                <span className="flex justify-between text-[11px] text-gray-500"><span>{nameOf(h.sender_broker_id)}</span><span>{dayDivider(h.created_at)} {ampm(h.created_at)}</span></span>
                <span className="line-clamp-2 text-sm text-gray-800 dark:text-gray-200">{h.body}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** 서랍 — 이 방에서 오간 사진·파일·링크 모아 보기 */
function Drawer({ kind, threadId, nameOf, onClose, onJump, onOpenImages }: {
  kind: 'photo' | 'file' | 'link'; threadId: string; nameOf: (id: string | null) => string
  onClose: () => void; onJump: (m: Msg) => void; onOpenImages: (images: string[], index: number) => void
}) {
  const supabase = useMemo(() => createClient(), [])
  const [rows, setRows] = useState<Msg[] | null>(null)

  useEffect(() => {
    setRows(null)
    let q = supabase.from('office_chat_messages').select('*').eq('thread_id', threadId).is('deleted_at', null)
    if (kind === 'photo') q = q.or('image_url.not.is.null,image_paths.not.is.null')
    else if (kind === 'file') q = q.not('file_url', 'is', null)
    else q = q.ilike('body', '%http%')
    q.order('created_at', { ascending: false }).limit(300).then(({ data }) => setRows((data ?? []) as Msg[]))
  }, [kind, threadId, supabase])

  const photos = useMemo(() => (rows ?? []).flatMap(m => imagesOf(m)), [rows])
  const urls = useSignedUrls(kind === 'photo' ? photos : (rows ?? []).map(m => m.file_url))
  const links = useMemo(() => (rows ?? []).flatMap(m => [...m.body.matchAll(URL_RE)].map(x => ({ url: x[0], m }))), [rows])
  const title = kind === 'photo' ? '사진·동영상' : kind === 'file' ? '파일' : '링크'

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <aside className="flex h-full w-full max-w-md flex-col bg-white dark:bg-gray-900" onClick={e => e.stopPropagation()} aria-label={title}>
        <div className="flex items-center gap-2 px-4 py-3">
          <button onClick={onClose} aria-label="뒤로"><ArrowLeft className="h-5 w-5 text-gray-600" /></button>
          <h3 className="font-bold text-gray-900 dark:text-white">{title}</h3>
        </div>
        <div className="flex-1 overflow-y-auto">
          {rows === null && <p className="py-10 text-center text-sm text-gray-400">불러오는 중…</p>}
          {rows && rows.length === 0 && <p className="py-10 text-center text-sm text-gray-400">아직 없어요</p>}
          {kind === 'photo' && (
            <div className="grid grid-cols-3 gap-0.5">
              {photos.map((p, i) => {
                const u = urlOf(urls, p)
                return (
                  <button key={p} className="aspect-square bg-gray-100 dark:bg-gray-800" onClick={() => {
                    const list = photos.map(x => urlOf(urls, x)).filter((x): x is string => !!x)
                    onOpenImages(list, Math.max(0, list.indexOf(u ?? '')))
                  }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {u && <img src={u} alt={`사진 ${i + 1}`} loading="lazy" className="h-full w-full object-cover" />}
                  </button>
                )
              })}
            </div>
          )}
          {kind === 'file' && (rows ?? []).map(m => {
            const u = urlOf(urls, m.file_url)
            return (
              <a key={m.id} href={u ? `${u}${u.includes('?') ? '&' : '?'}download=${encodeURIComponent(m.file_name || 'file')}` : undefined}
                target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800">
                <FileText className="h-5 w-5 flex-shrink-0 text-gray-500" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-gray-900 dark:text-gray-100">{m.file_name || '파일'}</span>
                  <span className="text-[11px] text-gray-500">{nameOf(m.sender_broker_id)} · {dayDivider(m.created_at)}</span>
                </span>
                <Download className="h-4 w-4 text-gray-400" />
              </a>
            )
          })}
          {kind === 'link' && links.map(({ url, m }, i) => (
            <div key={`${m.id}-${i}`} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800">
              <Link2 className="h-5 w-5 flex-shrink-0 text-gray-500" />
              <a href={url} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1">
                <span className="block truncate text-sm text-blue-700 dark:text-blue-400">{url}</span>
                <span className="text-[11px] text-gray-500">{nameOf(m.sender_broker_id)} · {dayDivider(m.created_at)}</span>
              </a>
              <button onClick={() => onJump(m)} className="text-xs text-gray-500 hover:text-gray-800">대화 보기</button>
            </div>
          ))}
        </div>
      </aside>
    </div>
  )
}

/** 붙여넣기·끌어놓기한 사진·파일을 보내기 전에 보여준다. Enter 전송, Esc 취소 */
function StagedSend({ files, sending, onSend, onCancel }: {
  files: File[]; sending: boolean; onSend: () => void; onCancel: () => void
}) {
  const previews = useMemo(
    () => files.map(f => (f.type.startsWith('image/') ? URL.createObjectURL(f) : null)),
    [files],
  )
  useEffect(() => () => previews.forEach(u => u && URL.revokeObjectURL(u)), [previews])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onCancel() }
      else if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); onSend() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onSend, onCancel])

  const photos = files.filter(f => f.type.startsWith('image/')).length
  const title = photos === files.length
    ? (photos > 1 ? `사진 ${photos}장 보내기` : '사진 보내기')
    : `파일 ${files.length}개 보내기`

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onCancel} role="dialog" aria-modal="true" aria-label={title}>
      <div className="w-full max-w-sm overflow-hidden rounded-2xl bg-white dark:bg-gray-900" onClick={e => e.stopPropagation()}>
        <p className="px-4 pt-4 text-[15px] font-semibold text-gray-900 dark:text-gray-100">{title}</p>
        <div className={cn('grid max-h-[50vh] gap-1 overflow-y-auto p-4', files.length > 1 ? 'grid-cols-3' : 'grid-cols-1')}>
          {files.map((f, i) => previews[i] ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={i} src={previews[i]!} alt={f.name}
              className={cn('w-full rounded-lg bg-gray-100 object-cover', files.length > 1 ? 'aspect-square' : 'max-h-[45vh] object-contain')} />
          ) : (
            <div key={i} className="col-span-full flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-2 dark:bg-gray-800">
              <FileText className="h-4 w-4 flex-shrink-0 text-gray-500" />
              <span className="truncate text-sm text-gray-800 dark:text-gray-200">{f.name}</span>
            </div>
          ))}
        </div>
        <div className="flex border-t border-gray-100 dark:border-gray-800">
          <button onClick={onCancel} className="flex-1 py-3 text-sm text-gray-600 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800">취소</button>
          <button onClick={onSend} disabled={sending} autoFocus
            className="flex-1 bg-[#fee500] py-3 text-sm font-semibold text-gray-900 disabled:opacity-50">전송</button>
        </div>
      </div>
    </div>
  )
}
