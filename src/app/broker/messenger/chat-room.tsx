'use client'

import { useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback, Fragment } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/lib/auth-context'
import { isDirector } from '@/lib/office-role'
import { useToast } from '@/components/toast'
import { ImageLightbox } from '@/components/image-lightbox'
import { cn } from '@/lib/utils'
import { ymdKST } from '@/lib/date-kst'
import { setOpenOfficeThread } from '@/lib/message-sound'
import {
  ArrowLeft, Search, Menu, Plus, Send, X, FileText, Download, CornerUpLeft, Copy, Trash2, Clock, AlertCircle, RotateCw,
  Megaphone, ChevronDown, ChevronUp, Image as ImageIcon, Paperclip, Link2, Pin, PinOff,
  Bell, BellOff, Pencil, UserPlus, LogOut, MoreHorizontal, ArrowDown, Phone, Check,
} from 'lucide-react'
import {
  type Thread, type Msg, type Member, type MyRow, type ReactionKey,
  REACTIONS, reactionEmoji, ampm, dayDivider, imagesOf, previewText, URL_RE, whyFailed, shrinkImage, PHONE_RE, telHref,
  CHAT_BUCKET, useSignedUrls, urlOf, primeLocalUrl, type RoomData, cachedRoom, fetchRoom, rememberRoom,
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
        ? <img src={url} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
        : label}
    </span>
  )
}

// Msg(shared.ts) 칸 그대로 — Msg 에 칸을 더하면 여기도 더할 것
const MSG_COLS = 'id, thread_id, sender_broker_id, body, image_url, image_paths, file_url, file_name, reply_to_id, deleted_at, bot_name, edited_at, mention_ids, created_at'
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
  const auth = useAuth()
  const supabase = useMemo(() => createClient(), [])
  const toast = useToast()

  // 펼쳐 둔 방의 메시지는 알림음을 내지 않는다
  useEffect(() => {
    setOpenOfficeThread(thread.id)
    return () => setOpenOfficeThread(null)
  }, [thread.id])

  const [messages, setMessages] = useState<Msg[]>([])
  const [phoneSheet, setPhoneSheet] = useState<string | null>(null)
  const [reactSheet, setReactSheet] = useState<Msg | null>(null) // 공감한 사람 보기(폰은 마우스를 올려 볼 수 없다)
  const [extra, setExtra] = useState<Record<string, Msg>>({}) // 화면 밖 답장 원본·공지 메시지
  const [hasMore, setHasMore] = useState(false)
  const [detached, setDetached] = useState(false) // 검색으로 옛 대화로 건너가 최신과 끊긴 상태
  const [memRows, setMemRows] = useState<{ broker_id: string; last_read_at: string | null }[]>([])
  const [reacts, setReacts] = useState<ReactMap>({})
  const [loading, setLoading] = useState(true)

  const [draft, setDraft] = useState('')
  const [replyTo, setReplyTo] = useState<Msg | null>(null)
  const [editing, setEditing] = useState<Msg | null>(null) // 고치는 중인 내 메시지 — 입력칸에 본문을 올려 고친다
  const [mentionQ, setMentionQ] = useState<{ at: number; q: string } | null>(null) // '@' 뒤에 쓰는 중인 이름
  const [sending, setSending] = useState(false)
  const [attachOpen, setAttachOpen] = useState(false)
  const [menuMsg, setMenuMsg] = useState<Msg | null>(null)
  const [sideOpen, setSideOpen] = useState(false)
  const [drawer, setDrawer] = useState<null | 'photo' | 'file' | 'link'>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  // 공지는 한 줄로 접힌 채 연다 — 펼쳐 두면 방에 들어올 때마다 대화를 가렸다. 필요하면 눌러 펼친다
  const [noticeFolded, setNoticeFolded] = useState(true)
  const [highlight, setHighlight] = useState<string | null>(null)
  const [lightbox, setLightbox] = useState<{ images: string[]; index: number } | null>(null)
  const [newBelow, setNewBelow] = useState(0) // 위로 올려 보는 중 새로 온 메시지 수
  const [farFromBottom, setFarFromBottom] = useState(false) // 맨 아래로 버튼
  const [unreadFrom, setUnreadFrom] = useState<string | null>(null) // '여기까지 읽었습니다' 아래 첫 메시지
  const [dragging, setDragging] = useState(false)
  const [staged, setStaged] = useState<File[]>([]) // 사진·파일은 바로 보내지 않고 한 번 보여준다(카톡처럼)

  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null) // 대화 높이가 늘면(공감·사진이 늦게 붙으면) 맨 아래에 다시 붙인다
  const atBottomRef = useRef(true)
  const keepScrollRef = useRef<number | null>(null) // 이전 대화를 위에 붙일 때 보던 자리 유지
  const photoRef = useRef<HTMLInputElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const detachedRef = useRef(false)
  detachedRef.current = detached
  const messagesRef = useRef<Msg[]>([])
  messagesRef.current = messages
  // 방을 열기 직전의 내 읽음 시각 — 처음 불러올 때만 써서 안 읽은 곳부터 보여 준다
  // (개발 모드처럼 방 열기가 두 번 돌아도 첫 값을 지키게 방별로 한 번만 잡는다)
  const readMarkRef = useRef<{ thread: string; at: string | null } | null>(null)
  const jumpUnreadRef = useRef<string | null>(null)

  const nameOf = useCallback((id: string | null | undefined) =>
    id ? (memberById[id]?.name ?? '(퇴사)') : '(퇴사)', [memberById])

  const roomMembers = useMemo(() => thread.kind === 'group'
    ? members
    : memRows.map(r => memberById[r.broker_id]).filter((m): m is Member => !!m), [thread.kind, members, memRows, memberById])
  // 태그는 이 방 사람만. 긴 이름부터 맞춰야 '김용' 이 '김용유' 를 먼저 먹지 않는다
  const tagNames = useMemo(() => roomMembers.map(m => m.name).filter(Boolean).sort((a, b) => b.length - a.length), [roomMembers])
  const mentionsIn = (body: string) => {
    const re = tagRegex(tagNames)
    const named = new Set(re ? [...body.matchAll(re)].map(x => x[0].slice(1)) : [])
    return roomMembers.filter(m => m.id !== myId && named.has(m.name)).map(m => m.id)
  }

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

  /**
   * 받은 방 내용을 화면에 — mode: initial(처음 연 것: 안 읽은 곳부터) · refresh(기억해 둔 것을 띄운 뒤 새로 받은 것:
   * 보던 자리 그대로) · latest(맨 아래로 다시). 보내는 중인 내 말풍선은 지우지 않는다
   */
  const applyRoom = useCallback((room: RoomData, mode: 'initial' | 'refresh' | 'latest') => {
    const rows = room.messages
    if (mode === 'initial') {
      // 처음 여는 방(읽은 적 없음)은 맨 아래부터. 내가 쓴 말은 안 읽은 것으로 치지 않는다
      const mark = readMarkRef.current?.at
      const t = mark ? new Date(mark).getTime() : Infinity
      const first = rows.find(m => new Date(m.created_at).getTime() > t && !(m.sender_broker_id === myId && !m.bot_name))
      setUnreadFrom(first?.id ?? null)
      jumpUnreadRef.current = first?.id ?? null
      atBottomRef.current = !jumpUnreadRef.current
    } else if (mode === 'latest') {
      atBottomRef.current = true
    }
    setMessages(prev => {
      const have = new Set(rows.map(r => r.id))
      return [...rows, ...prev.filter(m => m.pending && !have.has(m.id))]
    })
    setHasMore(rows.length === PAGE)
    setDetached(false)
    setNewBelow(0)
    setReacts(() => {
      const next: ReactMap = {}
      for (const m of rows) next[m.id] = {}
      for (const r of room.reactions) (( next[r.message_id] ??= {})[r.emoji] ??= []).push(r.broker_id)
      return next
    })
    setMemRows(room.members)
    if (room.extra.length) setExtra(prev => ({ ...prev, ...Object.fromEntries(room.extra.map(m => [m.id, m])) }))
    setLoading(false)
  }, [myId])

  const loadLatest = useCallback(async (mode: 'initial' | 'refresh' | 'latest' = 'latest') => {
    const room = await fetchRoom(thread.id, PAGE)
    if (room) { applyRoom(room, mode); return }
    // 한 번에 받기가 안 되면 예전처럼 나눠서 받는다
    const [{ data }, { data: mem }] = await Promise.all([
      supabase.from('office_chat_messages').select(MSG_COLS).eq('thread_id', thread.id).order('created_at', { ascending: false }).limit(PAGE),
      supabase.from('office_chat_members').select('broker_id, last_read_at').eq('thread_id', thread.id),
    ])
    const rows = ((data ?? []) as Msg[]).reverse()
    const { data: rx } = rows.length
      ? await supabase.from('office_chat_reactions').select('message_id, broker_id, emoji').in('message_id', rows.map(m => m.id))
      : { data: [] }
    applyRoom({ messages: rows, reactions: rx ?? [], members: mem ?? [], extra: [] }, mode)
  }, [supabase, thread.id, applyRoom])

  useEffect(() => {
    if (readMarkRef.current?.thread !== thread.id) readMarkRef.current = { thread: thread.id, at: myRow?.last_read_at ?? null }
    setUnreadFrom(null); setFarFromBottom(false)
    setLoading(true)
    setMessages([]); setExtra({}); setReacts({}); setMemRows([]); setReplyTo(null); setDraft(''); setEditing(null); setMentionQ(null)
    setSideOpen(false); setDrawer(null); setSearchOpen(false); setNoticeFolded(true)
    // 기억해 둔(또는 목록에서 미리 받은) 방이면 기다리지 않고 바로 띄우고, 새 내용은 뒤에서 맞춘다
    const cached = cachedRoom(thread.id)
    if (cached) applyRoom(cached, 'initial')
    loadLatest(cached ? 'refresh' : 'initial')
    props.onRead(thread.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thread.id])

  // 보고 있는 방의 내용을 기억해 둔다 — 나갔다 다시 들어오면 바로 보이게
  useEffect(() => {
    if (loading || detached) return
    const reactions = Object.entries(reacts).flatMap(([message_id, byKey]) =>
      Object.entries(byKey).flatMap(([emoji, ids]) => ids.map(broker_id => ({ message_id, broker_id, emoji }))))
    rememberRoom(thread.id, {
      messages: messages.filter(m => !m.pending).slice(-PAGE),
      reactions, members: memRows, extra: Object.values(extra),
    })
  }, [loading, detached, messages, reacts, memRows, extra, thread.id])

  const loadOlder = async () => {
    const first = messages[0]
    if (!first) return
    const { data } = await supabase.from('office_chat_messages').select(MSG_COLS).eq('thread_id', thread.id)
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
        supabase.from('office_chat_messages').select(MSG_COLS).eq('thread_id', thread.id)
          .lt('created_at', target.created_at).order('created_at', { ascending: false }).limit(30),
        supabase.from('office_chat_messages').select(MSG_COLS).eq('thread_id', thread.id)
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
    supabase.from('office_chat_messages').select(MSG_COLS).in('id', needIds.split(','))
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
        // 내가 보낸 것은 이미 '보내는 중' 말풍선으로 떠 있다 — 같은 번호로 저장본을 끼운다
        setMessages(prev => prev.some(m => m.id === msg.id) ? prev.map(m => m.id === msg.id ? msg : m) : [...prev, msg])
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
    } else if (jumpUnreadRef.current) {
      // 안 읽은 첫 메시지를 화면 위쪽(공지 아래)에. 남은 게 한 화면이 안 되면 자연히 맨 아래에 닿는다
      const target = document.getElementById(`msg-unread-${jumpUnreadRef.current}`)
      jumpUnreadRef.current = null
      if (target) el.scrollTop += target.getBoundingClientRect().top - el.getBoundingClientRect().top - (notice ? 88 : 8)
      atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    } else if (atBottomRef.current && !highlight) {
      el.scrollTop = el.scrollHeight
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, highlight])

  // 맨 아래를 보던 중이면 사진·공감이 늦게 붙거나 키보드가 올라와도 맨 아래에 붙어 있는다
  // (공감은 메시지보다 늦게 받아 와서, 방을 열면 마지막 메시지·공감이 입력창 뒤로 잘려 있었다)
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const stick = () => { if (atBottomRef.current) el.scrollTop = el.scrollHeight }
    el.addEventListener('load', stick, true)
    const ro = new ResizeObserver(stick)
    ro.observe(el)
    if (contentRef.current) ro.observe(contentRef.current)
    return () => { el.removeEventListener('load', stick, true); ro.disconnect() }
  }, [])

  const onScroll = () => {
    const el = scrollRef.current
    if (!el) return
    const gap = el.scrollHeight - el.scrollTop - el.clientHeight
    atBottomRef.current = gap < 80
    setFarFromBottom(gap > el.clientHeight / 2)
    if (atBottomRef.current && !detached) setNewBelow(0)
  }
  const toBottom = () => {
    if (detached) { loadLatest(); return }
    atBottomRef.current = true
    setNewBelow(0)
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }

  // ── 지운 메시지 원본(대표만) ─────────────────────────────
  // 직원이 '모두에게서 삭제' 한 것도 대표 화면엔 원본을 흐리게 보여 준다. 읽기 권한은 DB 가 대표에게만 준다
  // 대표·이사(2026-11-05 이사=대표 권한). DB 규칙 ocdm_select 도 같다
  const isOwner = myId === office || isDirector(auth.broker)
  const [deletedOrig, setDeletedOrig] = useState<Record<string, Msg | null>>({})
  const needDeleted = useMemo(() => isOwner
    ? messages.filter(m => m.deleted_at && !(m.id in deletedOrig)).map(m => m.id).sort().join(',')
    : '', [isOwner, messages, deletedOrig])
  useEffect(() => {
    if (!needDeleted) return
    const ids = needDeleted.split(',')
    supabase.from('office_chat_deleted_messages').select('message_id, body, image_url, image_paths, file_url, file_name').in('message_id', ids)
      .then(({ data }) => setDeletedOrig(prev => {
        const next = { ...prev }
        for (const id of ids) if (!(id in next)) next[id] = null // 이 기능 전에 지워 원본이 없는 것 — 다시 묻지 않는다
        for (const r of data ?? []) {
          const m = messagesRef.current.find(x => x.id === r.message_id)
          if (m) next[r.message_id] = { ...m, ...r, deleted_at: null }
        }
        return next
      }))
  }, [needDeleted, supabase])

  // ── 첨부 서명 URL ────────────────────────────────────
  const urls = useSignedUrls([...messages, ...Object.values(deletedOrig).filter((x): x is Msg => !!x)].flatMap(m => [...imagesOf(m), m.file_url]))

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

  const resizeInput = () => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 120) + 'px'
  }

  // ── 보내기: 누르면 바로 말풍선, 저장은 뒤에서(2026-11-05 '보낼 때도 빠르게') ──
  // 번호(id)를 여기서 정해 보내므로, 저장본·실시간 도착분이 같은 말풍선 자리에 그대로 들어간다.
  // 저장은 줄 세워 하나씩 — 빨리 연달아 보내도 순서(created_at)가 뒤바뀌지 않는다.
  const sendQueue = useRef<Promise<unknown>>(Promise.resolve())
  const retryJobs = useRef(new Map<string, () => Promise<void>>())
  const patchMsg = (id: string, patch: Partial<Msg> | null, saved?: Msg) => setMessages(prev => {
    if (saved) return prev.some(m => m.id === id) ? prev.map(m => m.id === id ? saved : m) : [...prev, saved]
    return prev.map(m => m.id === id ? { ...m, ...patch } : m)
  })
  /** 보내는 중 말풍선을 먼저 띄우고, 저장 일을 줄에 세운다. 실패하면 말풍선에 '다시 보내기' */
  const enqueueSend = (local: Msg, save: () => Promise<Msg>, preview: string) => {
    appendMine(local)
    const job = async () => {
      patchMsg(local.id, { pending: 'sending' })
      try {
        const saved = await save()
        retryJobs.current.delete(local.id)
        patchMsg(local.id, null, saved)
        props.onSent(saved)
        notify(preview)
      } catch (e) {
        patchMsg(local.id, { pending: 'failed' })
        toast.error(`보내지 못했어요. ${whyFailed(e)}`)
      }
    }
    retryJobs.current.set(local.id, job)
    sendQueue.current = sendQueue.current.then(job)
  }
  const retrySend = (m: Msg) => {
    const job = retryJobs.current.get(m.id)
    if (job) sendQueue.current = sendQueue.current.then(job)
  }
  const dropFailed = (m: Msg) => {
    retryJobs.current.delete(m.id)
    setMessages(prev => prev.filter(x => x.id !== m.id))
  }
  const localMsg = (fields: Partial<Msg>): Msg => ({
    id: crypto.randomUUID(), thread_id: thread.id, sender_broker_id: myId, body: '',
    created_at: new Date().toISOString(), pending: 'sending', ...fields,
  })
  const insertMsg = async (m: Msg): Promise<Msg> => {
    const row = {
      id: m.id, thread_id: m.thread_id, sender_broker_id: m.sender_broker_id, body: m.body,
      reply_to_id: m.reply_to_id ?? null, mention_ids: m.mention_ids ?? null,
      image_paths: m.image_paths ?? null, file_url: m.file_url ?? null, file_name: m.file_name ?? null,
    }
    const { data, error } = await supabase.from('office_chat_messages').insert(row).select().single()
    if (!error && data) return data as Msg
    // 저장은 됐는데 응답만 끊긴 경우 — 다시 보내기가 같은 번호로 또 넣다 '중복'으로 막히면 이미 있는 것을 쓴다
    if (error?.code === '23505') {
      const { data: got } = await supabase.from('office_chat_messages').select(MSG_COLS).eq('id', m.id).maybeSingle()
      if (got) return got as Msg
    }
    throw error ?? new Error('전송 실패')
  }

  const send = () => {
    const body = draft.trim()
    if (!body) return
    if (editing) { if (!sending) saveEdit(editing, body); return }
    const mentionIds = mentionsIn(body)
    const local = localMsg({ body, reply_to_id: replyTo?.id ?? null, mention_ids: mentionIds.length ? mentionIds : null })
    setDraft(''); setReplyTo(null); setMentionQ(null)
    requestAnimationFrame(resizeInput)
    enqueueSend(local, () => insertMsg(local), body.slice(0, 80))
    inputRef.current?.focus()
  }

  // ── 수정 ────────────────────────────────────────────
  const startEdit = (m: Msg) => {
    setMenuMsg(null); setReplyTo(null); setAttachOpen(false)
    setEditing(m); setDraft(m.body)
    requestAnimationFrame(() => {
      const el = inputRef.current
      if (!el) return
      resizeInput(); el.focus(); el.setSelectionRange(el.value.length, el.value.length)
    })
  }
  const cancelEdit = () => {
    setEditing(null); setDraft(''); setMentionQ(null)
    requestAnimationFrame(resizeInput)
  }
  const saveEdit = async (m: Msg, body: string) => {
    if (body === m.body.trim()) { cancelEdit(); return }
    const mentionIds = mentionsIn(body)
    setSending(true)
    const { data, error } = await supabase.rpc('edit_office_chat_message', { p_id: m.id, p_body: body, p_mentions: mentionIds })
    setSending(false)
    if (error) { toast.error(`고치지 못했어요. ${whyFailed(error)}`); return }
    const patch = { body, edited_at: (data as string | null) ?? new Date().toISOString(), mention_ids: mentionIds.length ? mentionIds : null }
    setMessages(prev => prev.map(x => x.id === m.id ? { ...x, ...patch } : x))
    setExtra(prev => prev[m.id] ? { ...prev, [m.id]: { ...prev[m.id], ...patch } } : prev)
    cancelEdit()
  }
  // 카톡처럼 보낸 지 24시간 안의 내 글자 메시지만
  const canEdit = (m: Msg) => m.sender_broker_id === myId && !m.bot_name && !m.deleted_at && !m.pending && !!m.body
    && imagesOf(m).length === 0 && !m.file_url && Date.now() - new Date(m.created_at).getTime() < 24 * 3600 * 1000

  // ── 태그(@이름) ──────────────────────────────────────
  const mentionCandidates = mentionQ
    ? roomMembers.filter(m => m.id !== myId && m.name.toLowerCase().includes(mentionQ.q.toLowerCase())).slice(0, 8)
    : []
  const watchMention = (el: HTMLTextAreaElement) => {
    const before = el.value.slice(0, el.selectionStart ?? el.value.length)
    const hit = before.match(/(?:^|\s)@([^\s@]{0,10})$/)
    setMentionQ(hit ? { at: before.length - hit[1].length - 1, q: hit[1] } : null)
  }
  const pickMention = (m: Member) => {
    const el = inputRef.current
    if (!mentionQ || !el) return
    const end = el.selectionStart ?? draft.length
    const next = `${draft.slice(0, mentionQ.at)}@${m.name} ${draft.slice(end)}`
    const caret = mentionQ.at + m.name.length + 2
    setDraft(next); setMentionQ(null)
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(caret, caret); resizeInput() })
  }

  /** 사진 여러 장은 메시지 하나(묶음)로, 그 밖의 파일은 한 개씩. 말풍선은 바로 뜨고 올리기는 뒤에서 */
  const sendFiles = async (files: File[]) => {
    if (files.length === 0) return
    const big = files.find(f => f.size > MAX_FILE)
    if (big) { toast.error(`20MB 이하 파일만 보낼 수 있어요 (${big.name})`); return }
    const photos = files.filter(f => f.type.startsWith('image/'))
    const others = files.filter(f => !f.type.startsWith('image/'))
    if (photos.length > MAX_PHOTOS) { toast.error(`사진은 한 번에 ${MAX_PHOTOS}장까지 보낼 수 있어요`); return }
    setAttachOpen(false)
    const pathFor = (f: File) => {
      const ext = (f.name.split('.').pop() || 'bin').toLowerCase()
      return `${office}/${thread.id}/${crypto.randomUUID()}.${ext}`
    }
    const put = async (path: string, file: Blob, type?: string) => {
      const { error } = await supabase.storage.from(CHAT_BUCKET).upload(path, file, { contentType: type || undefined })
      if (error) throw error
    }
    // 하나라도 실패하면 올린 것을 모두 지운다 — 다시 보내기가 같은 경로로 처음부터 올린다(덮어쓰기 권한 없이)
    const uploadAll = async (list: { path: string; make: () => Promise<{ blob: Blob; type?: string }> }[], m: Msg) => {
      try {
        await Promise.all(list.map(async x => { const { blob, type } = await x.make(); await put(x.path, blob, type) }))
        return await insertMsg(m)
      } catch (e) {
        await supabase.storage.from(CHAT_BUCKET).remove(list.map(x => x.path)).catch(() => {})
        throw e
      }
    }
    if (photos.length) {
      // 줄이고 올리는 동안에도 말풍선은 폰에 있는 원본 그림으로 먼저 뜬다
      const items = photos.map(f => ({ f, path: pathFor(f) }))
      for (const it of items) primeLocalUrl(it.path, URL.createObjectURL(it.f))
      const local = localMsg({ image_paths: items.map(it => it.path) })
      enqueueSend(local, () => uploadAll(items.map(it => ({
        path: it.path,
        make: async () => { const small = await shrinkImage(it.f, 1600); return { blob: small, type: small.type || it.f.type } },
      })), local), items.length > 1 ? `사진 ${items.length}장을 보냈습니다` : '사진을 보냈습니다')
    }
    for (const f of others) {
      const path = pathFor(f)
      primeLocalUrl(path, URL.createObjectURL(f))
      const local = localMsg({ file_url: path, file_name: f.name })
      enqueueSend(local, () => uploadAll([{ path, make: async () => ({ blob: f, type: f.type }) }], local), `파일: ${f.name}`.slice(0, 80))
    }
  }

  /** 붙여넣기·끌어놓기·앨범·파일 — 보내기 전 확인 창에 올린다. 여러 번 고르면 쌓인다 */
  // 빈 파일은 빼고, 사진이라면서 열리지 않는 파일(확장자만 .png 등)은 깨진 사진 대신 파일로 보낸다.
  // HEIC 처럼 이 브라우저만 못 여는 진짜 사진도 파일로라도 가게 막지는 않는다
  const stage = async (files: File[]) => {
    if (files.length === 0 || sending) return
    setAttachOpen(false)
    const empty = files.filter(f => f.size === 0)
    if (empty.length) toast.error(`빈 파일은 뺐어요: ${empty.map(f => f.name).join(', ')}`)
    const ok = await Promise.all(files.filter(f => f.size > 0).map(async f => {
      if (!f.type.startsWith('image/')) return f
      const opens = await createImageBitmap(f).then(b => { b.close(); return true }, () => false)
      return opens ? f : new File([f], f.name, { type: 'application/octet-stream' })
    }))
    if (ok.length) setStaged(prev => [...prev, ...ok])
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
      toast.error(`공감하지 못했어요. ${whyFailed(error)}`)
      setReacts(prev => mine ? addReact(prev, m.id, key, myId) : removeReact(prev, m.id, key, myId))
    }
  }

  const deleteMsg = async (m: Msg) => {
    setMenuMsg(null)
    if (!window.confirm('모두에게서 삭제할까요? 대화방의 모든 사람에게서 사라지고 "삭제된 메시지입니다"로 남아요.')) return
    // 첨부는 지우지 않는다 — 원본은 대표가 볼 수 있게 office_chat_deleted_messages 로 옮겨진다
    const { error } = await supabase.rpc('delete_office_chat_message', { p_id: m.id })
    if (error) { toast.error(`지우지 못했어요. ${whyFailed(error)}`); return }
    const gone: Msg = { ...m, body: '', image_url: null, image_paths: null, file_url: null, file_name: null, deleted_at: new Date().toISOString() }
    setMessages(prev => prev.map(x => x.id === m.id ? gone : x))
    if (thread.notice_message_id === m.id) props.onThreadPatch({ notice_message_id: null })
    if (isOwner) setDeletedOrig(prev => ({ ...prev, [m.id]: m }))
  }

  const setNotice = async (messageId: string | null) => {
    setMenuMsg(null)
    if (messageId === null && !window.confirm('공지를 내릴까요?')) return
    const { error } = await supabase.rpc('set_office_chat_notice', { p_thread: thread.id, p_message: messageId })
    if (error) { toast.error(`공지를 ${messageId ? '등록' : '내리'}지 못했어요. ${whyFailed(error)}`); return }
    props.onThreadPatch({ notice_message_id: messageId })
    setNoticeFolded(false)
  }

  const copyText = async (text: string, done = '복사했어요') => {
    // 안드로이드는 복사하면 폰이 스스로 '복사했어요' 를 띄운다 — 우리 것까지 두 개 뜨지 않게 거기선 생략
    try { await navigator.clipboard.writeText(text); if (!/Android/i.test(navigator.userAgent)) toast.success(done) } catch { toast.error('복사하지 못했어요') }
  }
  const copy = (m: Msg) => {
    setMenuMsg(null)
    copyText(m.body)
  }

  // ── 길게 누르기(폰) ───────────────────────────────────
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pressAt = useRef<{ x: number; y: number } | null>(null)
  // 메뉴는 연 뒤 바깥을 새로 눌러야 닫힌다 — 길게 누른 손가락을 떼는 것만으로 닫혀 버려 '아무 일도 안 일어나는' 것처럼 보였다
  const menuArmed = useRef(false)
  const pressStart = (m: Msg) => (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' || m.deleted_at) return
    pressAt.current = { x: e.clientX, y: e.clientY }
    pressTimer.current = setTimeout(() => { menuArmed.current = false; setMenuMsg(m) }, 450)
  }
  const pressCancel = () => { if (pressTimer.current) clearTimeout(pressTimer.current) }
  // 누르는 손가락은 조금씩 흔들린다 — 2px 만 움직여도 취소하던 것을 10px 넘게 끌 때(스크롤)만 취소한다
  const pressMove = (e: React.PointerEvent) => {
    const p = pressAt.current
    if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 10) pressCancel()
  }

  const notice = findMsg(thread.notice_message_id)
  const memberCount = thread.kind === 'group' ? members.length : memRows.length

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
      <div ref={scrollRef} onScroll={onScroll} className={cn('flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-3 pb-3', notice && !searchOpen ? 'pt-24' : 'pt-3')}>
        <div ref={contentRef}>
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
              {unreadFrom === m.id && (
                <div id={`msg-unread-${m.id}`} className="my-3 flex items-center gap-2 text-[11px] text-gray-600 dark:text-gray-400">
                  <span className="h-px flex-1 bg-black/15 dark:bg-white/15" />여기까지 읽었습니다<span className="h-px flex-1 bg-black/15 dark:bg-white/15" />
                </div>
              )}
              {newDay && (
                <div className="my-3 flex justify-center">
                  <span className="rounded-full bg-black/10 px-3 py-1 text-[11px] text-gray-700 dark:bg-gray-800 dark:text-gray-400">{dayDivider(m.created_at)}</span>
                </div>
              )}
              <div id={`msg-${m.id}`} className={cn('flex gap-2', mine ? 'justify-end' : 'justify-start', sameAsPrev ? 'mt-1' : 'mt-3')}>
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
                  {/* max-w-full: 답장 인용 줄(truncate)이 긴 글이면 말풍선이 화면 밖으로 뻗었다 */}
                  <div className={cn('group flex max-w-full items-end gap-1.5', mine && 'flex-row-reverse')}>
                    <div
                      onContextMenu={e => { if (m.deleted_at || m.pending) return; e.preventDefault(); menuArmed.current = false; setMenuMsg(m) }}
                      onPointerDown={m.pending ? undefined : pressStart(m)} onPointerUp={pressCancel} onPointerLeave={pressCancel} onPointerMove={pressMove}
                      // 폰은 길게 누르면 글자 선택이 먼저 잡아채 메뉴가 안 떴다 — 글자 선택을 끄고 복사는 메뉴로(카톡과 같다)
                      // 원문으로 건너왔을 때 강조는 말풍선에만 — 줄 전체에 칠하면 빈 아바타 칸까지 노랗게 물들었다
                      className={cn('min-w-0 select-text rounded-2xl pointer-coarse:select-none [-webkit-touch-callout:none]',
                        highlight === m.id && 'ring-4 ring-yellow-300/90 transition-shadow')}
                    >
                      {m.deleted_at && deletedOrig[m.id] ? (
                        <DeletedOriginal orig={deletedOrig[m.id]!} mine={mine} urls={urls} onPhone={setPhoneSheet} tagNames={tagNames}
                          onOpenImages={(images, index) => setLightbox({ images, index })} />
                      ) : m.deleted_at ? (
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
                          !sameAsPrev && (mine ? 'rounded-tr-sm' : 'rounded-tl-sm'),
                          m.mention_ids?.includes(myId) && 'ring-2 ring-[#3a6fd8]/60',
                          replied && 'cursor-pointer')}
                          // 답장 말풍선은 어디를 눌러도 원문으로 — 본문 안 링크·전화번호·태그, 글자 드래그 선택은 그대로 둔다
                          onClick={replied ? e => {
                            if ((e.target as HTMLElement).closest('a,button')) return
                            if (window.getSelection()?.toString()) return
                            jumpTo(replied)
                          } : undefined}>
                          {replied && (
                            <button onClick={e => { e.stopPropagation(); jumpTo(replied) }} className="mb-1.5 block w-full border-b border-black/10 pb-1.5 text-left">
                              <span className="block text-xs font-semibold text-gray-700 dark:text-gray-300">{nameOf(replied.sender_broker_id)}에게 답장</span>
                              <span className="block truncate text-xs text-gray-500">{previewText(replied)}</span>
                            </button>
                          )}
                          <Linkified text={m.body} onPhone={setPhoneSheet} tagNames={tagNames} />
                        </div>
                      )}
                    </div>
                    <div className={cn('relative flex flex-shrink-0 flex-col pb-0.5 leading-tight', mine ? 'items-end' : 'items-start')}>
                      {/* 띄워서 얹는다 — 흐름 안에 넣으면 마우스만 올려도 이 칸이 넓어지고 높아져 말풍선이 옆으로 밀리고 아랫줄이 내려갔다 */}
                      {!m.deleted_at && !m.pending && (
                        <button onClick={() => setMenuMsg(m)} className={cn('absolute bottom-0.5 hidden rounded p-0.5 text-gray-600 hover:bg-black/10 group-hover:block', mine ? 'right-full mr-1' : 'left-full ml-1')} aria-label="메시지 메뉴">
                          <MoreHorizontal className="h-3.5 w-3.5" />
                        </button>
                      )}
                      {m.pending === 'sending' && <Clock className="h-3 w-3 text-gray-500" aria-label="보내는 중" />}
                      {m.pending === 'failed' && (
                        <span className="flex items-center gap-1">
                          <button onClick={() => retrySend(m)} className="flex items-center gap-0.5 rounded bg-red-500 px-1.5 py-0.5 text-[11px] font-semibold text-white" aria-label="다시 보내기">
                            <AlertCircle className="h-3 w-3" /><RotateCw className="h-3 w-3" />
                          </button>
                          <button onClick={() => dropFailed(m)} className="rounded p-0.5 text-gray-500 hover:bg-black/10" aria-label="보내지 않고 지우기"><X className="h-3 w-3" /></button>
                        </span>
                      )}
                      {!m.pending && unread > 0 && <span className="text-[11px] font-bold text-[#e6b800] dark:text-yellow-400">{unread}</span>}
                      {m.edited_at && !m.deleted_at && <span className="whitespace-nowrap text-[10px] text-gray-600 dark:text-gray-400">수정됨</span>}
                      {!sameAsNext && <span className="whitespace-nowrap text-[10px] text-gray-600 dark:text-gray-400">{ampm(m.created_at)}</span>}
                    </div>
                  </div>
                  {rx.length > 0 && (
                    // 공감 칩도 길게 누르면 말풍선과 같은 메뉴 — 안 그러면 폰이 글자 선택(복사·웹 검색 막대)을 띄웠다
                    <div className={cn('mt-1 flex flex-wrap gap-1 select-none [-webkit-touch-callout:none]', mine && 'justify-end')}
                      onContextMenu={e => { if (m.deleted_at) return; e.preventDefault(); menuArmed.current = false; setMenuMsg(m) }}
                      onPointerDown={pressStart(m)} onPointerUp={pressCancel} onPointerLeave={pressCancel} onPointerMove={pressMove}>
                      {rx.map(([k, ids]) => (
                        <button key={k} onClick={() => setReactSheet(m)} title={ids.map(nameOf).join(', ')}
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
      </div>

      {newBelow > 0 ? (
        <button onClick={toBottom} className="absolute bottom-20 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-full bg-gray-900/80 px-3 py-1.5 text-xs text-white shadow">
          <ArrowDown className="h-3.5 w-3.5" /> 새 메시지 {newBelow}개
        </button>
      ) : (farFromBottom || detached) && (
        // 카톡처럼 오른쪽 아래 동그란 '맨 아래로'
        <button onClick={toBottom} aria-label="맨 아래로" title="맨 아래로"
          className="absolute bottom-20 right-3 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-white/90 text-gray-700 shadow-md ring-1 ring-black/5 dark:bg-gray-800/90 dark:text-gray-200">
          <ChevronDown className="h-6 w-6" />
        </button>
      )}

      {/* 태그할 사람 고르기('@' 뒤) */}
      {mentionCandidates.length > 0 && (
        <ul className="max-h-56 overflow-y-auto border-t border-gray-200 bg-white py-1 dark:border-gray-800 dark:bg-gray-900" aria-label="태그할 사람">
          {mentionCandidates.map((m, i) => (
            <li key={m.id}>
              <button onMouseDown={e => e.preventDefault()} onClick={() => pickMention(m)}
                className={cn('flex w-full items-center gap-3 px-3 py-1.5 text-left text-sm text-gray-800 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-800', i === 0 && 'bg-gray-50 dark:bg-gray-800')}>
                <Avatar member={m} size={28} />{m.name}
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* 수정 중 */}
      {editing && (
        <div className="flex items-center gap-2 border-t border-gray-200 bg-white px-3 py-2 dark:border-gray-800 dark:bg-gray-900">
          <Pencil className="h-4 w-4 flex-shrink-0 text-gray-500" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-gray-800 dark:text-gray-200">메시지 수정</p>
            <p className="truncate text-xs text-gray-500">{editing.body}</p>
          </div>
          <button onClick={cancelEdit} className="rounded p-1 text-gray-400 hover:bg-gray-100" aria-label="수정 취소"><X className="h-4 w-4" /></button>
        </div>
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
      <div className="flex items-end gap-2 bg-white px-2 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] dark:bg-gray-900">
        <button onClick={() => setAttachOpen(v => !v)} disabled={sending}
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100 disabled:opacity-40 dark:hover:bg-gray-800" aria-label="사진·파일 보내기">
          {attachOpen ? <X className="h-5 w-5" /> : <Plus className="h-5 w-5" />}
        </button>
        <textarea
          ref={inputRef}
          value={draft}
          rows={1}
          onChange={e => { setDraft(e.target.value); e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px'; watchMention(e.target) }}
          onClick={e => watchMention(e.currentTarget)}
          onKeyDown={e => {
            if (mentionCandidates.length && (e.key === 'Enter' || e.key === 'Tab') && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); pickMention(mentionCandidates[0]); return }
            if (e.key === 'Escape') { if (mentionQ) setMentionQ(null); else if (editing) cancelEdit(); return }
            // 휴대폰 키보드의 줄바꿈 키는 줄만 바꾼다(카톡처럼 보내기는 버튼으로). PC 는 Enter 전송, Shift+Enter 줄바꿈
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && !matchMedia('(pointer: coarse)').matches) { e.preventDefault(); send() }
          }}
          onPaste={e => {
            const files = Array.from(e.clipboardData.files)
            if (files.length) { e.preventDefault(); stage(files) }
          }}
          placeholder={editing ? '고칠 내용 입력' : '메시지 입력'}
          // 전역 포커스 테두리(globals.css *:focus-visible)가 누를 때마다 네모 테두리를 씌웠다 — 이 칸은 늘 글을 쓰는 곳이라 뺀다
          style={{ outline: 'none', borderRadius: 16 }}
          className="max-h-[120px] min-h-[36px] flex-1 resize-none rounded-2xl bg-gray-100 px-3 py-2 text-[15px] outline-none dark:bg-gray-800 dark:text-gray-100"
        />
        <button onClick={send} disabled={!draft.trim() || sending} aria-label={editing ? '수정 완료' : '전송'}
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-[#fee500] text-gray-900 disabled:bg-gray-100 disabled:text-gray-400 dark:disabled:bg-gray-800">
          {editing ? <Check className="h-4 w-4" /> : <Send className="h-4 w-4" />}
        </button>
      </div>

      {/* 메시지 메뉴(길게 누르기·우클릭) */}
      {phoneSheet && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6" onClick={() => setPhoneSheet(null)} role="dialog" aria-modal="true" aria-label="전화번호">
          <div className="w-full max-w-xs overflow-hidden rounded-2xl bg-white dark:bg-gray-900" onClick={e => e.stopPropagation()}>
            <p className="border-b border-gray-100 px-5 py-3 text-center text-sm font-bold text-gray-900 dark:border-gray-800 dark:text-white">{phoneSheet}</p>
            <a href={telHref(phoneSheet)} onClick={() => setPhoneSheet(null)}
              className="flex w-full items-center gap-3 px-5 py-3 text-sm text-gray-800 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-800">
              <Phone className="h-4 w-4" />전화 걸기
            </a>
            <MenuItem icon={Copy} label="번호 복사" onClick={() => { copyText(phoneSheet, '번호를 복사했어요'); setPhoneSheet(null) }} />
          </div>
        </div>
      )}
      {reactSheet && (() => {
        const rows = Object.entries(reacts[reactSheet.id] ?? {}).filter(([, ids]) => ids.length > 0)
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6" onClick={() => setReactSheet(null)} role="dialog" aria-modal="true" aria-label="공감한 사람">
            <div className="w-full max-w-xs overflow-hidden rounded-2xl bg-white dark:bg-gray-900" onClick={e => e.stopPropagation()}>
              <p className="border-b border-gray-100 px-5 py-3 text-center text-sm font-bold text-gray-900 dark:border-gray-800 dark:text-white">공감한 사람</p>
              <div className="max-h-[50vh] overflow-y-auto">
                {rows.length === 0 && <p className="px-5 py-4 text-center text-sm text-gray-500">아직 없어요</p>}
                {rows.flatMap(([k, ids]) => ids.map(id => (
                  <div key={k + id} className="flex items-center gap-3 px-5 py-2.5 text-sm text-gray-800 dark:text-gray-200">
                    <span className="text-lg">{reactionEmoji(k)}</span>
                    <span className="flex-1">{nameOf(id)}{id === myId && ' (나)'}</span>
                    {id === myId && (
                      <button onClick={() => toggleReact(reactSheet, k as ReactionKey)} className="rounded-lg px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800">빼기</button>
                    )}
                  </div>
                )))}
              </div>
            </div>
          </div>
        )
      })()}
      {menuMsg && (
        // 폰은 카톡처럼 화면 가운데에 띄운다 — 아래에 붙이면 기기에 따라 아래 칸(복사·삭제)이 화면 밖으로 잘렸다
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6" onPointerDown={() => { menuArmed.current = true }} onClick={() => { if (menuArmed.current) setMenuMsg(null) }} role="dialog" aria-modal="true" aria-label="메시지 메뉴">
          <div className="max-h-full w-full max-w-sm overflow-y-auto rounded-2xl bg-white dark:bg-gray-900" onClick={e => e.stopPropagation()}>
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
            <MenuItem icon={CornerUpLeft} label="답장" onClick={() => { if (editing) cancelEdit(); setReplyTo(menuMsg); setMenuMsg(null); inputRef.current?.focus() }} />
            {!!menuMsg.body && <MenuItem icon={Copy} label="복사" onClick={() => copy(menuMsg)} />}
            {canEdit(menuMsg) && <MenuItem icon={Pencil} label="수정" onClick={() => startEdit(menuMsg)} />}
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
                  if (error) { toast.error(`이름을 바꾸지 못했어요. ${whyFailed(error)}`); return }
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

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** 본문의 '@이름' 찾기. 긴 이름부터 맞추므로 '@김용유님' 도 김용유로 잡힌다 */
const tagRegex = (names: string[]) => names.length ? new RegExp(`@(?:${names.map(escapeRe).join('|')})`, 'g') : null

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

/** 주소는 새 창 링크로, 전화번호는 누르면 전화 걸기·번호 복사를 고르게 */
function Linkified({ text, onPhone, tagNames = [] }: { text: string; onPhone: (phone: string) => void; tagNames?: string[] }) {
  const tagRe = tagRegex(tagNames)
  const hits = [
    ...[...text.matchAll(URL_RE)].map(m => ({ at: m.index ?? 0, s: m[0], kind: 'url' as const })),
    ...[...text.matchAll(PHONE_RE)].map(m => ({ at: m.index ?? 0, s: m[0], kind: 'phone' as const })),
    ...(tagRe ? [...text.matchAll(tagRe)] : []).map(m => ({ at: m.index ?? 0, s: m[0], kind: 'tag' as const })),
  ].sort((a, b) => a.at - b.at)
  const parts: React.ReactNode[] = []
  let last = 0
  for (const h of hits) {
    if (h.at < last) continue          // 주소 안에 든 숫자는 번호로 보지 않는다
    if (h.at > last) parts.push(text.slice(last, h.at))
    parts.push(h.kind === 'url'
      ? <a key={h.at} href={h.s} target="_blank" rel="noopener noreferrer" className="underline break-all">{h.s}</a>
      : h.kind === 'tag'
      ? <span key={h.at} className="font-semibold text-[#2f5fc4] dark:text-blue-400">{h.s}</span>
      : <button key={h.at} type="button" onClick={e => { e.stopPropagation(); onPhone(h.s) }}
          className="underline decoration-dotted underline-offset-2">{h.s}</button>)
    last = h.at + h.s.length
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

/** 대표 화면의 지운 메시지 — 원본을 흐리게, 위에 '삭제됨 · 대표만 보여요' */
function DeletedOriginal({ orig, mine, urls, onPhone, tagNames, onOpenImages }: {
  orig: Msg; mine: boolean; urls: Record<string, string>; onPhone: (phone: string) => void; tagNames: string[]
  onOpenImages: (images: string[], index: number) => void
}) {
  const imgs = imagesOf(orig)
  return (
    <div className={cn('rounded-2xl border border-dashed border-gray-500/60 px-3 py-2 opacity-70', mine ? 'bg-[#fee500]/60' : 'bg-white/70 dark:bg-gray-800/70')}>
      <span className="mb-1 flex items-center gap-1 text-[11px] font-semibold text-gray-600 dark:text-gray-300">
        <Trash2 className="h-3 w-3" /> 삭제됨 · 대표만 보여요
      </span>
      {imgs.length > 0 && (
        <PhotoGrid paths={imgs} urls={urls} onOpen={idx => {
          const list = imgs.map(p => urlOf(urls, p)).filter((u): u is string => !!u)
          if (list.length) onOpenImages(list, Math.min(idx, list.length - 1))
        }} />
      )}
      {orig.file_url && <FileBubble name={orig.file_name} url={urlOf(urls, orig.file_url)} mine={mine} />}
      {!!orig.body && (
        <div className="whitespace-pre-wrap break-words text-[15px] leading-snug text-gray-900 dark:text-gray-100">
          <Linkified text={orig.body} onPhone={onPhone} tagNames={tagNames} />
        </div>
      )}
    </div>
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
      const { data } = await supabase.from('office_chat_messages').select(MSG_COLS).eq('thread_id', threadId)
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
    let q = supabase.from('office_chat_messages').select(MSG_COLS).eq('thread_id', threadId).is('deleted_at', null)
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
