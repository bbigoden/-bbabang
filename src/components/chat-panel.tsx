'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { formatPrice, maskAddress, cn } from '@/lib/utils'
import {
  Building2, X, ChevronLeft, ChevronRight, Send,
  ImagePlus, Phone, CheckCircle, Star, MapPin, Search, Calendar, Clock,
  Footprints, FileSignature, Coins, Home, PartyPopper, ChevronDown, XOctagon
} from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'

// ── Types ─────────────────────────────────────────
export interface Message {
  id: string
  room_id: string
  sender_id: string
  content: string
  message_type: 'text' | 'property' | 'image' | 'event'
  property_id: string | null
  created_at: string
  is_read: boolean
}

export interface EventPayload {
  title: string
  datetime: string  // ISO
  location?: string
  note?: string
}

export interface PropertySnapshot {
  deal_type: string; room_type: string; address: string
  price: number; monthly_rent: number | null; size_pyeong: number | null
  area_type?: string; area_unit?: string
  floor: number | null; total_floors: number | null
  options: string[]; description: string | null; images?: string[]; property_id: string
}

// ── 매물 카드 ──────────────────────────────────────
export function PropertyCard({ snapshot, isMine, onClick }: { snapshot: PropertySnapshot; isMine: boolean; onClick?: () => void }) {
  const priceText = snapshot.deal_type === '월세'
    ? `보증금 ${formatPrice(snapshot.price)} / 월 ${formatPrice(snapshot.monthly_rent ?? 0)}`
    : formatPrice(snapshot.price)
  return (
    <div onClick={onClick} className={cn('w-52 rounded-2xl border overflow-hidden shadow-sm transition-shadow', isMine ? 'border-blue-200 bg-blue-50' : 'border-gray-100 bg-white', onClick && 'cursor-pointer hover:shadow-md')}>
      <div className={cn('flex items-center gap-2 px-3 py-2 border-b text-xs font-semibold', isMine ? 'bg-blue-500 border-blue-400 text-white' : 'bg-gray-50 border-gray-100 text-gray-700')}>
        <Building2 className="h-3.5 w-3.5" />매물 공유
        <span className={cn('ml-auto px-2 py-0.5 rounded-full text-xs font-medium', isMine ? 'bg-blue-400 text-white' : 'bg-blue-100 text-blue-700')}>{snapshot.deal_type}</span>
      </div>
      {snapshot.images && snapshot.images.length > 0 && (
        <div className="relative h-28 overflow-hidden">
          <Image src={snapshot.images[0]} alt={snapshot.address} fill className="object-cover" sizes="208px" />
        </div>
      )}
      <div className="px-3 py-2.5 space-y-1">
        <p className={cn('text-xs font-semibold leading-snug', isMine ? 'text-blue-900' : 'text-gray-900')}>{maskAddress(snapshot.address)}</p>
        <p className={cn('text-xs', isMine ? 'text-blue-700' : 'text-gray-500')}>{snapshot.room_type}{snapshot.size_pyeong && ` · ${snapshot.size_pyeong}${snapshot.area_unit ?? '평'}(${snapshot.area_type ?? '전용'})`}</p>
        <p className={cn('text-sm font-black', isMine ? 'text-blue-800' : 'text-blue-600')}>{priceText}</p>
      </div>
      {onClick && (
        <div className={cn('px-3 py-1.5 text-center text-xs border-t', isMine ? 'border-blue-200 text-blue-500' : 'border-gray-100 text-gray-400')}>
          탭하면 상세 정보 보기
        </div>
      )}
    </div>
  )
}

// ── 일정 카드 ──────────────────────────────────────
export function EventCard({ event, isMine }: { event: EventPayload; isMine: boolean }) {
  const dt = new Date(event.datetime)
  const dateStr = dt.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' })
  const timeStr = dt.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
  const calendarUrl = `https://www.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(event.title)}&dates=${dt.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '')}/${new Date(dt.getTime() + 60 * 60 * 1000).toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '')}${event.location ? `&location=${encodeURIComponent(event.location)}` : ''}${event.note ? `&details=${encodeURIComponent(event.note)}` : ''}`
  return (
    <div className={cn('w-56 rounded-2xl border overflow-hidden shadow-sm', isMine ? 'border-emerald-200 bg-emerald-50' : 'border-gray-100 bg-white')}>
      <div className={cn('flex items-center gap-2 px-3 py-2 border-b text-xs font-semibold', isMine ? 'bg-emerald-500 border-emerald-400 text-white' : 'bg-emerald-50 border-emerald-100 text-emerald-700')}>
        <Calendar className="h-3.5 w-3.5" />일정 공유
      </div>
      <div className="px-3 py-2.5 space-y-1.5">
        <p className={cn('text-sm font-bold leading-snug', isMine ? 'text-emerald-900' : 'text-gray-900')}>{event.title}</p>
        <p className={cn('flex items-center gap-1 text-xs', isMine ? 'text-emerald-700' : 'text-gray-500')}>
          <Clock className="h-3 w-3" />
          {dateStr} · {timeStr}
        </p>
        {event.location && (
          <p className={cn('flex items-center gap-1 text-xs', isMine ? 'text-emerald-700' : 'text-gray-500')}>
            <MapPin className="h-3 w-3" />
            {event.location}
          </p>
        )}
        {event.note && (
          <p className={cn('text-xs leading-relaxed line-clamp-2 mt-1', isMine ? 'text-emerald-800' : 'text-gray-600')}>{event.note}</p>
        )}
      </div>
      <a href={calendarUrl} target="_blank" rel="noopener noreferrer"
        className={cn('block px-3 py-1.5 text-center text-xs font-semibold border-t', isMine ? 'border-emerald-200 text-emerald-700 hover:bg-emerald-100' : 'border-gray-100 text-blue-600 hover:bg-gray-50')}>
        구글 캘린더에 추가
      </a>
    </div>
  )
}

// ── 매물 상세 모달 ──────────────────────────────────
export function PropertyDetailModal({ snapshot, onClose }: { snapshot: PropertySnapshot; onClose: () => void }) {
  const [imgIdx, setImgIdx] = useState(0)
  const [touchStartX, setTouchStartX] = useState<number | null>(null)
  const images = snapshot.images ?? []

  const prevImg = () => setImgIdx(i => Math.max(0, i - 1))
  const nextImg = () => setImgIdx(i => Math.min(images.length - 1, i + 1))

  const priceText = snapshot.deal_type === '월세'
    ? `보증금 ${formatPrice(snapshot.price)} / 월 ${formatPrice(snapshot.monthly_rent ?? 0)}`
    : formatPrice(snapshot.price)
  const dealColors: Record<string, string> = {
    '매매': 'bg-blue-100 text-blue-700',
    '전세': 'bg-green-100 text-green-700',
    '월세': 'bg-orange-100 text-orange-700',
    '단기': 'bg-purple-100 text-purple-700',
  }
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 md:items-center" onClick={onClose}>
      <div className="w-full max-w-sm rounded-t-2xl bg-white shadow-xl md:rounded-2xl overflow-hidden flex flex-col" style={{ maxHeight: '90vh' }} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4 flex-shrink-0">
          <div className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-blue-600" />
            <span className="font-bold text-gray-900">매물 상세</span>
          </div>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-xl hover:bg-gray-100 text-gray-400">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="overflow-y-auto flex-1">
          {/* 이미지 캐러셀 */}
          {images.length > 0 ? (
            <div className="relative h-52 w-full overflow-hidden bg-gray-100 flex-shrink-0"
              onTouchStart={e => setTouchStartX(e.touches[0].clientX)}
              onTouchEnd={e => {
                if (touchStartX === null) return
                const diff = touchStartX - e.changedTouches[0].clientX
                if (diff > 50) nextImg()
                else if (diff < -50) prevImg()
                setTouchStartX(null)
              }}
            >
              <Image key={imgIdx} src={images[imgIdx]} alt={snapshot.address} fill className="object-cover" sizes="400px" />
              {imgIdx > 0 && (
                <button onClick={e => { e.stopPropagation(); prevImg() }}
                  className="absolute left-2 top-1/2 -translate-y-1/2 flex h-8 w-8 items-center justify-center rounded-full bg-black/40 text-white hover:bg-black/60 transition-colors">
                  <ChevronLeft className="h-4 w-4" />
                </button>
              )}
              {imgIdx < images.length - 1 && (
                <button onClick={e => { e.stopPropagation(); nextImg() }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 flex h-8 w-8 items-center justify-center rounded-full bg-black/40 text-white hover:bg-black/60 transition-colors">
                  <ChevronRight className="h-4 w-4" />
                </button>
              )}
              {images.length > 1 && (
                <span className="absolute top-2 right-2 rounded-full bg-black/50 px-2.5 py-1 text-xs text-white font-medium">
                  {imgIdx + 1} / {images.length}
                </span>
              )}
              {images.length > 1 && (
                <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1.5">
                  {images.map((_, i) => (
                    <button key={i} onClick={e => { e.stopPropagation(); setImgIdx(i) }}
                      className={cn('rounded-full transition-all', i === imgIdx ? 'w-4 h-1.5 bg-white' : 'w-1.5 h-1.5 bg-white/50')} />
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="h-20 flex items-center justify-center bg-gray-50 flex-shrink-0">
              <Building2 className="h-8 w-8 text-gray-200" />
            </div>
          )}
          <div className="p-5 space-y-4">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${dealColors[snapshot.deal_type] ?? 'bg-gray-100 text-gray-600'}`}>{snapshot.deal_type}</span>
                <span className="text-xs text-gray-500">{snapshot.room_type}</span>
              </div>
              <p className="text-lg font-bold text-gray-900">{maskAddress(snapshot.address)}</p>
            </div>
            <div className="rounded-xl bg-blue-50 p-4">
              <p className="text-2xl font-black text-blue-600">{priceText}</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {snapshot.size_pyeong && (
                <div className="rounded-xl border border-gray-100 p-3">
                  <p className="text-xs text-gray-400 mb-1">면적</p>
                  <p className="text-sm font-semibold text-gray-900">{snapshot.size_pyeong}{snapshot.area_unit ?? '평'}<span className="ml-1 text-xs font-normal text-gray-400">({snapshot.area_type ?? '전용'})</span></p>
                </div>
              )}
              {snapshot.floor && (
                <div className="rounded-xl border border-gray-100 p-3">
                  <p className="text-xs text-gray-400 mb-1">층수</p>
                  <p className="text-sm font-semibold text-gray-900">{snapshot.floor}층{snapshot.total_floors ? ` / ${snapshot.total_floors}층` : ''}</p>
                </div>
              )}
            </div>
            {snapshot.description && (
              <div>
                <p className="text-xs font-semibold text-gray-500 mb-2">매물설명</p>
                <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{snapshot.description}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── 채팅 패널 ──────────────────────────────────────
export function ChatPanel({ proposalId, currentUser, isOwner, onBack }: {
  proposalId: string; currentUser: any; isOwner: boolean; onBack: () => void
}) {
  const supabaseRef = useRef(createClient())
  const supabase = supabaseRef.current
  const [room, setRoom] = useState<any>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [loading, setLoading] = useState(true)
  const [showPicker, setShowPicker] = useState(false)
  const [brokerProperties, setBrokerProperties] = useState<any[]>([])
  const [loadingProps, setLoadingProps] = useState(false)
  const [pickerSearch, setPickerSearch] = useState('')
  const [selectedPropIds, setSelectedPropIds] = useState<Set<string>>(new Set())
  const [sendingProps, setSendingProps] = useState(false)
  const [viewingSnapshot, setViewingSnapshot] = useState<PropertySnapshot | null>(null)
  const [hasReview, setHasReview] = useState<boolean | null>(null)
  const [showEventModal, setShowEventModal] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const scrollToBottom = useCallback(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [])
  useEffect(() => { scrollToBottom() }, [messages, scrollToBottom])

  useEffect(() => {
    let destroyed = false
    let cleanup: (() => void) | undefined
    setLoading(true); setMessages([]); setRoom(null)
    initChat().then(fn => { if (destroyed) fn?.(); else cleanup = fn })
    return () => { destroyed = true; cleanup?.() }
  }, [proposalId])

  const initChat = async () => {
    const { data: proposal } = await supabase
      .from('proposals')
      .select('*, broker_profiles(*, profiles(*)), request_posts(*, profiles(*))')
      .eq('id', proposalId).single()
    if (!proposal) { setLoading(false); return }

    let chatRoom: any = null
    const { data: existing } = await supabase.from('chat_rooms').select('*').eq('proposal_id', proposalId).order('created_at', { ascending: true }).limit(1)
    if (existing && existing.length > 0) {
      chatRoom = existing[0]
    } else {
      const { data: newRoom } = await supabase.from('chat_rooms').insert({
        request_id: proposal.request_id,
        user_id: proposal.request_posts?.user_id,
        broker_id: proposal.broker_profiles?.user_id,
        proposal_id: proposalId,
      }).select().single()
      chatRoom = newRoom
    }
    if (!chatRoom) { setLoading(false); return }

    setRoom({ ...chatRoom, proposal })
    const { data: msgs } = await supabase.from('chat_messages').select('*').eq('room_id', chatRoom.id).order('created_at', { ascending: true })
    setMessages((msgs ?? []) as Message[])
    setLoading(false)

    // 수락 상태이고 고객 본인일 때 리뷰 작성 여부 체크
    if (isOwner && proposal.status === 'accepted' && proposal.broker_profiles?.id) {
      const { data: existingReview } = await supabase
        .from('reviews')
        .select('id')
        .eq('broker_id', proposal.broker_profiles.id)
        .eq('user_id', currentUser.id)
        .maybeSingle()
      setHasReview(!!existingReview)
    }

    await supabase.from('chat_messages').update({ is_read: true }).eq('room_id', chatRoom.id).neq('sender_id', currentUser.id).eq('is_read', false)

    const channel = supabase.channel(`chat:${chatRoom.id}:${Date.now()}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `room_id=eq.${chatRoom.id}` }, async (payload) => {
        const msg = payload.new as Message
        setMessages(prev => [...prev, msg])
        if (msg.sender_id !== currentUser.id) await supabase.from('chat_messages').update({ is_read: true }).eq('id', msg.id)
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'chat_messages', filter: `room_id=eq.${chatRoom.id}` }, (payload) => {
        const u = payload.new as Message
        setMessages(prev => prev.map(m => m.id === u.id ? { ...m, is_read: u.is_read } : m))
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }

  const notifyRecipient = async (preview: string) => {
    if (!room) return
    const recipientId = room.user_id === currentUser.id ? room.broker_id : room.user_id
    if (!recipientId || recipientId === currentUser.id) return
    const url = room.user_id === currentUser.id ? `/broker/chats` : `/chat/${room.proposal_id}`
    try {
      await fetch('/api/push/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetUserId: recipientId,
          title: '새 메시지',
          body: preview.slice(0, 80),
          url,
          tag: `chat-${room.id}`,
        }),
      })
    } catch {}
  }

  const sendMessage = async () => {
    if (!input.trim() || !room || sending) return
    setSending(true); const content = input.trim(); setInput('')
    await supabase.from('chat_messages').insert({ room_id: room.id, sender_id: currentUser.id, content, message_type: 'text' })
    notifyRecipient(content)
    setSending(false); inputRef.current?.focus()
  }

  const sendEvent = async (payload: EventPayload) => {
    if (!room) return
    await supabase.from('chat_messages').insert({
      room_id: room.id,
      sender_id: currentUser.id,
      content: JSON.stringify(payload),
      message_type: 'event',
    })
    notifyRecipient(`📅 일정: ${payload.title}`)
    setShowEventModal(false)
  }

  const sendImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file || !room) return; e.target.value = ''
    const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
    if (!ALLOWED_TYPES.includes(file.type) || file.size > 10 * 1024 * 1024) return
    const path = `chat/${room.id}/${Date.now()}.${file.name.split('.').pop()}`
    const { error } = await supabase.storage.from('property-images').upload(path, file, { upsert: false })
    if (error) return
    const { data: { publicUrl } } = supabase.storage.from('property-images').getPublicUrl(path)
    await supabase.from('chat_messages').insert({ room_id: room.id, sender_id: currentUser.id, content: publicUrl, message_type: 'image' })
    notifyRecipient('📷 사진을 보냈어요')
  }

  const openPropertyPicker = async () => {
    setShowPicker(true); if (brokerProperties.length > 0 || loadingProps) return
    setLoadingProps(true)
    const { data: broker } = await supabase.from('broker_profiles').select('id').eq('user_id', currentUser.id).single()
    if (broker) {
      const { data } = await supabase.from('broker_properties').select('*').eq('broker_id', broker.id).eq('status', 'available').order('created_at', { ascending: false }).range(0, 9999)
      setBrokerProperties(data ?? [])
    }
    setLoadingProps(false)
  }

  const buildSnapshot = (prop: any): PropertySnapshot => ({
    deal_type: prop.deal_type, room_type: prop.room_type, address: prop.address,
    price: prop.price, monthly_rent: prop.monthly_rent, size_pyeong: prop.size_pyeong,
    area_type: prop.area_type ?? '전용', area_unit: prop.area_unit ?? '평',
    floor: prop.floor, total_floors: prop.total_floors, options: prop.options,
    description: prop.description, images: prop.images ?? [], property_id: prop.id,
  })

  const sendSelectedProperties = async () => {
    if (!room || selectedPropIds.size === 0 || sendingProps) return
    setSendingProps(true)
    const toSend = brokerProperties.filter(p => selectedPropIds.has(p.id))
    const rows = toSend.map(prop => ({
      room_id: room.id,
      sender_id: currentUser.id,
      content: JSON.stringify(buildSnapshot(prop)),
      message_type: 'property' as const,
      property_id: prop.id,
    }))
    if (rows.length > 0) {
      await supabase.from('chat_messages').insert(rows)
    }
    notifyRecipient(`🏠 매물 ${toSend.length}건을 공유했어요`)
    setSendingProps(false); setShowPicker(false); setSelectedPropIds(new Set()); setPickerSearch('')
  }

  const togglePropSelection = (id: string) => {
    setSelectedPropIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  const proposal = room?.proposal
  const broker = proposal?.broker_profiles
  const brokerProfile = broker?.profiles
  const requester = proposal?.request_posts?.profiles
  const isBroker = !isOwner
  // 고객 입장: 사무소 이름 우선 표시 (없으면 개인 이름)
  const otherName = isOwner ? (broker?.office_name ?? brokerProfile?.name ?? '중개사') : (requester?.name ?? '고객')
  // 대표(is_owner=true)일 때만 개인 이름 노출
  const otherSubName = isOwner ? (broker?.office_name && broker?.is_owner !== false ? brokerProfile?.name : null) : null
  const otherPhone = isOwner ? brokerProfile?.phone : requester?.phone

  const grouped = messages.reduce((g: Record<string, Message[]>, m) => {
    const d = new Date(m.created_at).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' })
    if (!g[d]) g[d] = []; g[d].push(m); return g
  }, {})

  if (loading) return (
    <div className="flex h-full items-center justify-center">
      <div className="flex flex-col items-center gap-2">
        <div className="h-6 w-6 animate-spin rounded-full border-[3px] border-blue-600 border-t-transparent" />
        <p className="text-xs text-gray-400">채팅 불러오는 중...</p>
      </div>
    </div>
  )

  return (
    <div className="flex h-full flex-col bg-white">
      {/* 채팅 헤더 */}
      <div className="flex items-center gap-2.5 border-b border-gray-100 px-3 py-2.5 flex-shrink-0">
        <button onClick={onBack} className="md:hidden flex h-8 w-8 items-center justify-center rounded-xl hover:bg-gray-100 transition-colors">
          <ChevronLeft className="h-5 w-5 text-gray-600" />
        </button>
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-100 text-blue-700 font-bold text-sm flex-shrink-0">
          {otherName[0]}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1">
            <span className="font-bold text-gray-900 text-sm">{otherName}</span>
            {isOwner && broker?.is_verified && <CheckCircle className="h-3.5 w-3.5 text-blue-500" />}
          </div>
          {otherSubName && <p className="text-xs text-gray-400 truncate">{otherSubName}</p>}
        </div>
        {isOwner && proposal?.status === 'accepted' && (
          <Link href={`/review/${proposalId}`} className="flex h-8 w-8 items-center justify-center rounded-xl bg-yellow-50 text-yellow-500 hover:bg-yellow-100 transition-colors">
            <Star className="h-4 w-4" />
          </Link>
        )}
        {otherPhone && (
          <a href={`tel:${otherPhone}`} className="flex h-8 w-8 items-center justify-center rounded-xl bg-green-50 text-green-600 hover:bg-green-100 transition-colors">
            <Phone className="h-4 w-4" />
          </a>
        )}
      </div>

      {/* 제안 가격 바 */}
      {!!proposal?.price && (
        <div className="bg-blue-50 border-b border-blue-100 px-3 py-1.5 flex-shrink-0 flex items-center justify-between">
          {proposal.property_address && (
            <span className="flex items-center gap-1 text-xs text-blue-700">
              <MapPin className="h-3 w-3" />{maskAddress(proposal.property_address)}
            </span>
          )}
          <span className="ml-auto text-sm font-bold text-blue-700">{formatPrice(proposal.price)}</span>
        </div>
      )}

      {/* 거래 단계 트래커 (수락된 제안만) */}
      {proposal?.status === 'accepted' && (
        <StageTracker
          proposalId={proposalId}
          currentStage={(proposal.stage as Stage) ?? 'proposal'}
          isBroker={isBroker}
          onStageChange={async (newStage) => {
            await supabase.from('proposals').update({ stage: newStage }).eq('id', proposalId)
            // 시스템 메시지로 단계 변경 알림
            await supabase.from('chat_messages').insert({
              room_id: room?.id,
              sender_id: currentUser.id,
              content: `🔔 거래 단계가 '${STAGE_META[newStage].label}'로 변경됐어요`,
              message_type: 'text',
            })
            // 상대방 notification
            if (room) {
              const recipientId = room.user_id === currentUser.id ? room.broker_id : room.user_id
              if (recipientId) {
                await supabase.from('notifications').insert({
                  user_id: recipientId,
                  type: 'stage_changed',
                  title: `거래 단계 변경: ${STAGE_META[newStage].label}`,
                  body: '채팅에서 자세한 내용을 확인하세요',
                  link: `/chat/${proposalId}`,
                })
              }
            }
            setRoom((prev: any) => prev ? { ...prev, proposal: { ...prev.proposal, stage: newStage } } : prev)
          }}
        />
      )}

      {/* 수락 후 안내 배너 — 고객 본인, 수락됨, 리뷰 미작성 */}
      {isOwner && proposal?.status === 'accepted' && hasReview === false && (
        <div className="border-b border-yellow-200 bg-gradient-to-r from-yellow-50 to-amber-50 px-3 py-2 flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-yellow-100 text-yellow-600 flex-shrink-0">
              <Star className="h-4 w-4 fill-current" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold text-yellow-900">거래 마무리되셨나요?</p>
              <p className="text-[11px] text-yellow-700">중개사를 평가해주시면 다른 고객에게 큰 도움이 돼요</p>
            </div>
            <Link href={`/review/${proposalId}`}
              className="rounded-lg bg-yellow-500 px-3 py-1.5 text-xs font-bold text-white hover:bg-yellow-600 transition-colors flex-shrink-0">
              리뷰 작성
            </Link>
          </div>
        </div>
      )}

      {/* 리뷰 완료 표시 */}
      {isOwner && proposal?.status === 'accepted' && hasReview === true && (
        <div className="border-b border-green-100 bg-green-50 px-3 py-1.5 flex-shrink-0 flex items-center gap-2 justify-center">
          <CheckCircle className="h-3.5 w-3.5 text-green-500" />
          <p className="text-[11px] font-semibold text-green-700">리뷰를 작성해주셨어요. 감사합니다!</p>
        </div>
      )}

      {/* 메시지 목록 */}
      <div className="flex-1 overflow-y-auto px-3 py-3 bg-gray-50">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="text-3xl mb-2">👋</div>
            <p className="text-sm font-semibold text-gray-600">{otherName}님과 대화를 시작하세요</p>
            <p className="mt-1 text-xs text-gray-400">매물 정보, 계약 조건을 자유롭게 문의하세요</p>
            {isBroker && (
              <button onClick={openPropertyPicker} className="mt-3 flex items-center gap-1.5 rounded-xl border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100 transition-colors">
                <Building2 className="h-3.5 w-3.5" />매물 바로 공유하기
              </button>
            )}
          </div>
        )}
        <div className="space-y-0.5">
          {Object.entries(grouped).map(([date, msgs]) => (
            <div key={date}>
              <div className="my-3 flex items-center gap-2">
                <div className="h-px flex-1 bg-gray-200" />
                <span className="text-[10px] text-gray-400">{date}</span>
                <div className="h-px flex-1 bg-gray-200" />
              </div>
              <div className="space-y-0.5">
                {msgs.map((msg, idx) => {
                  const isMine = msg.sender_id === currentUser?.id
                  const prev = msgs[idx - 1]
                  const showMeta = !prev || new Date(msg.created_at).getMinutes() !== new Date(prev.created_at).getMinutes() || prev.sender_id !== msg.sender_id
                  const isLast = idx === msgs.length - 1 || msgs[idx + 1].sender_id !== msg.sender_id
                  let snap: PropertySnapshot | null = null
                  let event: EventPayload | null = null
                  if (msg.message_type === 'property') { try { snap = JSON.parse(msg.content) } catch { } }
                  if (msg.message_type === 'event') { try { event = JSON.parse(msg.content) } catch { } }
                  return (
                    <div key={msg.id} className={cn('flex items-end gap-1.5', isMine ? 'justify-end' : 'justify-start')}>
                      {!isMine && (
                        <div className={cn('flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-700 text-xs font-bold', !isLast && 'invisible')}>
                          {otherName[0]}
                        </div>
                      )}
                      <div className={cn('flex flex-col', isMine ? 'items-end' : 'items-start')}>
                        {msg.message_type === 'property' && snap ? (
                          <PropertyCard snapshot={snap} isMine={isMine} onClick={() => setViewingSnapshot(snap)} />
                        ) : msg.message_type === 'event' && event ? (
                          <EventCard event={event} isMine={isMine} />
                        ) : msg.message_type === 'image' ? (
                          <a href={msg.content} target="_blank" rel="noopener noreferrer">
                            <div className="relative overflow-hidden rounded-2xl border border-gray-100" style={{ width: '200px', height: '160px' }}>
                              <Image src={msg.content} alt="사진" fill className="object-cover" sizes="200px" />
                            </div>
                          </a>
                        ) : (
                          <div className={cn('max-w-[200px] rounded-2xl px-3 py-2 text-sm leading-relaxed break-words',
                            isMine ? 'bg-blue-600 text-white rounded-br-sm' : 'bg-white border border-gray-100 text-gray-800 shadow-sm rounded-bl-sm')}>
                            {msg.content}
                          </div>
                        )}
                        {(showMeta || isLast) && (
                          <div className="mt-0.5 px-1 flex items-center gap-1">
                            {isMine && msg.is_read && <span className="text-[10px] text-blue-400">읽음</span>}
                            <span className="text-[10px] text-gray-400">
                              {new Date(msg.created_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
        <div ref={bottomRef} />
      </div>

      {/* 매물 상세 모달 */}
      {viewingSnapshot && <PropertyDetailModal snapshot={viewingSnapshot} onClose={() => setViewingSnapshot(null)} />}

      {/* 매물 피커 모달 */}
      {showPicker && isBroker && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => { setShowPicker(false); setPickerSearch(''); setSelectedPropIds(new Set()) }}>
          <div className="w-full max-w-xl bg-white rounded-t-2xl sm:rounded-2xl shadow-xl overflow-hidden flex flex-col" style={{ maxHeight: '85vh' }} onClick={e => e.stopPropagation()}>
            {/* 모달 헤더 */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
              <div className="flex items-center gap-2">
                <Building2 className="h-5 w-5 text-blue-600" />
                <h3 className="font-bold text-gray-900">매물목록</h3>
                {!loadingProps && <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-bold text-blue-700">{brokerProperties.length}</span>}
              </div>
              <button onClick={() => { setShowPicker(false); setPickerSearch(''); setSelectedPropIds(new Set()) }} className="flex h-8 w-8 items-center justify-center rounded-xl hover:bg-gray-100 transition-colors">
                <X className="h-4 w-4 text-gray-500" />
              </button>
            </div>

            {/* 검색창 */}
            {!loadingProps && brokerProperties.length > 0 && (
              <div className="border-b border-gray-100 px-4 py-3 flex-shrink-0">
                <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 focus-within:border-blue-400 focus-within:bg-white transition-colors">
                  <Search className="h-4 w-4 text-gray-400 flex-shrink-0" />
                  <input type="text" value={pickerSearch} onChange={e => setPickerSearch(e.target.value)}
                    placeholder="주소, 거래유형, 방종류 검색..." className="flex-1 bg-transparent text-sm outline-none placeholder:text-gray-400" autoFocus />
                  {pickerSearch && <button onClick={() => setPickerSearch('')} className="text-gray-400 hover:text-gray-600"><X className="h-3.5 w-3.5" /></button>}
                </div>
              </div>
            )}

            {/* 테이블 헤더 */}
            {!loadingProps && brokerProperties.length > 0 && (
              <div className="grid grid-cols-[2rem_3rem_1fr_auto] gap-x-3 border-b border-gray-100 bg-gray-50 px-4 py-2 text-xs font-semibold text-gray-400 flex-shrink-0">
                <span></span><span>유형</span><span>소재지</span><span className="text-right">가격</span>
              </div>
            )}

            {/* 목록 */}
            <div className="flex-1 overflow-y-auto">
              {loadingProps ? (
                <div className="flex flex-col items-center justify-center py-12 gap-3">
                  <div className="h-6 w-6 animate-spin rounded-full border-[3px] border-blue-600 border-t-transparent" />
                  <p className="text-sm text-gray-400">매물 불러오는 중...</p>
                </div>
              ) : brokerProperties.length === 0 ? (
                <div className="py-12 text-center">
                  <Building2 className="mx-auto mb-3 h-10 w-10 text-gray-200" />
                  <p className="text-sm text-gray-500">등록된 매물이 없습니다</p>
                  <a href="/broker/properties/new" target="_blank" className="mt-3 inline-block text-sm font-semibold text-blue-600 underline">매물 등록하러 가기</a>
                </div>
              ) : (() => {
                const dealColors: Record<string, string> = { '매매': 'bg-blue-100 text-blue-700', '전세': 'bg-green-100 text-green-700', '월세': 'bg-orange-100 text-orange-700', '단기': 'bg-purple-100 text-purple-700' }
                const filtered = brokerProperties.filter(p => {
                  if (!pickerSearch) return true
                  const q = pickerSearch.toLowerCase()
                  return p.address.toLowerCase().includes(q) || p.deal_type.includes(q) || p.room_type.includes(q) || (p.brief_memo ?? '').toLowerCase().includes(q)
                })
                if (filtered.length === 0) return <div className="py-12 text-center text-sm text-gray-400">검색 결과가 없습니다</div>
                return (
                  <div className="divide-y divide-gray-50">
                    {filtered.map(p => {
                      const isSelected = selectedPropIds.has(p.id)
                      const priceText = p.deal_type === '월세' ? `${formatPrice(p.price)}/${formatPrice(p.monthly_rent ?? 0)}` : formatPrice(p.price)
                      return (
                        <button key={p.id} onClick={() => togglePropSelection(p.id)}
                          className={cn('grid grid-cols-[2rem_3rem_1fr_auto] w-full gap-x-3 items-center px-4 py-3 text-left transition-colors', isSelected ? 'bg-blue-50' : 'hover:bg-gray-50')}>
                          <span className={cn('flex h-5 w-5 items-center justify-center rounded-full border-2 transition-colors flex-shrink-0', isSelected ? 'border-blue-600 bg-blue-600' : 'border-gray-300 bg-white')}>
                            {isSelected && <span className="text-white text-[10px] font-bold">✓</span>}
                          </span>
                          <span className={cn('inline-flex items-center justify-center rounded-lg px-1.5 py-1 text-xs font-bold', dealColors[p.deal_type] ?? 'bg-gray-100 text-gray-600')}>{p.deal_type}</span>
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-gray-900 truncate">{p.address}</p>
                            <p className="text-xs text-gray-400 truncate">{p.room_type}{p.size_pyeong ? ` · ${p.size_pyeong}평` : ''}{p.floor ? ` · ${p.floor}층` : ''}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-black text-blue-600 whitespace-nowrap">{priceText}</p>
                            {p.brief_memo && <p className="text-xs text-gray-400 truncate max-w-[100px]">{p.brief_memo}</p>}
                          </div>
                        </button>
                      )
                    })}
                  </div>
                )
              })()}
            </div>

            {/* 하단 보내기 버튼 */}
            <div className="border-t border-gray-100 px-4 py-3 flex-shrink-0">
              <button onClick={sendSelectedProperties} disabled={selectedPropIds.size === 0 || sendingProps}
                className={cn('w-full rounded-xl py-3 text-sm font-bold transition-colors', selectedPropIds.size > 0 ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-gray-100 text-gray-400 cursor-not-allowed')}>
                {sendingProps ? '전송 중...' : selectedPropIds.size > 0 ? `선택한 매물 ${selectedPropIds.size}건 보내기` : '매물을 선택하세요'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 입력창 */}
      <div className="border-t border-gray-100 bg-white px-3 py-2.5 flex-shrink-0">
        <div className="flex items-end gap-1.5">
          {isBroker && (
            <>
              <button onClick={showPicker ? () => setShowPicker(false) : openPropertyPicker}
                className={cn('flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl border transition-all',
                  showPicker ? 'bg-blue-600 text-white border-blue-600' : 'bg-gray-50 text-gray-500 border-gray-200 hover:bg-blue-50 hover:text-blue-600')}
                title="매물 공유">
                <Building2 className="h-4 w-4" />
              </button>
              <button onClick={() => setShowEventModal(true)}
                className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl border border-gray-200 bg-gray-50 text-gray-500 hover:bg-emerald-50 hover:text-emerald-600 transition-all"
                title="일정 공유">
                <Calendar className="h-4 w-4" />
              </button>
            </>
          )}
          <label className="flex h-9 w-9 flex-shrink-0 cursor-pointer items-center justify-center rounded-xl border border-gray-200 bg-gray-50 text-gray-500 hover:bg-blue-50 hover:text-blue-600 transition-all">
            <ImagePlus className="h-4 w-4" />
            <input type="file" accept="image/*" className="hidden" onChange={sendImage} />
          </label>
          <textarea ref={inputRef} value={input}
            onChange={(e) => { setInput(e.target.value); e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 100) + 'px' }}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() } }}
            placeholder="메시지 입력 (Enter 전송)" rows={1}
            className="flex-1 resize-none overflow-hidden rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:bg-white transition-all"
            style={{ minHeight: '38px', maxHeight: '100px' }}
          />
          <button onClick={sendMessage} disabled={!input.trim() || sending}
            className={cn('flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl transition-all',
              input.trim() ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-gray-100 text-gray-400 cursor-not-allowed')}>
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>

      {showEventModal && (
        <EventComposeModal onClose={() => setShowEventModal(false)} onSend={sendEvent} />
      )}
    </div>
  )
}

// ── 거래 단계 트래커 ───────────────────────────────
type Stage = 'proposal' | 'visit' | 'contract' | 'deposit' | 'move_in' | 'completed' | 'canceled'

export const STAGE_META: Record<Stage, { label: string; icon: any; color: string }> = {
  proposal:  { label: '제안',        icon: CheckCircle,    color: 'bg-blue-500' },
  visit:     { label: '현장 답상',   icon: Footprints,     color: 'bg-cyan-500' },
  contract:  { label: '계약',        icon: FileSignature,  color: 'bg-purple-500' },
  deposit:   { label: '잔금',        icon: Coins,          color: 'bg-amber-500' },
  move_in:   { label: '입주',        icon: Home,           color: 'bg-emerald-500' },
  completed: { label: '거래 완료',   icon: PartyPopper,    color: 'bg-green-600' },
  canceled:  { label: '거래 취소',   icon: XOctagon,       color: 'bg-gray-500' },
}

const FLOW: Stage[] = ['proposal', 'visit', 'contract', 'deposit', 'move_in', 'completed']

function StageTracker({ currentStage, isBroker, onStageChange }: {
  proposalId: string
  currentStage: Stage
  isBroker: boolean
  onStageChange: (s: Stage) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const cur = STAGE_META[currentStage]
  const idx = FLOW.indexOf(currentStage)
  const isCanceled = currentStage === 'canceled'

  const change = async (s: Stage) => {
    setBusy(true)
    await onStageChange(s)
    setBusy(false)
    setOpen(false)
  }

  return (
    <div className="border-b border-gray-100 bg-white px-3 py-2 flex-shrink-0">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          {isCanceled ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-1 text-xs font-bold text-gray-600">
              <XOctagon className="h-3 w-3" /> 취소된 거래
            </span>
          ) : (
            <>
              {/* 진행 단계 점들 */}
              <div className="flex items-center gap-0.5">
                {FLOW.map((s, i) => {
                  const passed = i <= idx
                  const m = STAGE_META[s]
                  return (
                    <div key={s} className="flex items-center">
                      <div className={cn('h-2 w-2 rounded-full transition-colors', passed ? m.color : 'bg-gray-200')} />
                      {i < FLOW.length - 1 && <div className={cn('h-px w-3', i < idx ? 'bg-blue-300' : 'bg-gray-200')} />}
                    </div>
                  )
                })}
              </div>
              <span className="ml-2 inline-flex items-center gap-1 text-xs font-bold">
                <cur.icon className={cn('h-3.5 w-3.5', cur.color.replace('bg-', 'text-'))} />
                {cur.label}
              </span>
            </>
          )}
        </div>

        {isBroker && !isCanceled && (
          <button onClick={() => setOpen(o => !o)} disabled={busy}
            className="flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50">
            단계 변경
            <ChevronDown className="h-3 w-3" />
          </button>
        )}
      </div>

      {open && (
        <div className="mt-2 rounded-xl border border-gray-200 bg-white p-2 grid grid-cols-3 sm:grid-cols-6 gap-1.5">
          {FLOW.map((s, i) => {
            const m = STAGE_META[s]
            const active = s === currentStage
            return (
              <button key={s} onClick={() => change(s)} disabled={busy || active}
                className={cn('flex flex-col items-center gap-1 rounded-lg px-1.5 py-2 text-[10px] font-semibold transition-all',
                  active ? `${m.color} text-white` : 'bg-gray-50 text-gray-600 hover:bg-gray-100',
                  busy && 'opacity-50')}>
                <m.icon className="h-3.5 w-3.5" />
                <span className="leading-tight">{i + 1}. {m.label}</span>
              </button>
            )
          })}
          <button onClick={() => change('canceled')} disabled={busy}
            className="col-span-3 sm:col-span-6 mt-1 flex items-center justify-center gap-1 rounded-lg border border-red-200 bg-white px-2 py-1.5 text-xs font-semibold text-red-500 hover:bg-red-50 disabled:opacity-50">
            <XOctagon className="h-3 w-3" /> 거래 취소로 변경
          </button>
        </div>
      )}
    </div>
  )
}

function EventComposeModal({ onClose, onSend }: {
  onClose: () => void
  onSend: (payload: EventPayload) => Promise<void>
}) {
  const now = new Date()
  now.setMinutes(0, 0, 0)
  now.setHours(now.getHours() + 1)
  const defaultDate = now.toISOString().slice(0, 10)
  const defaultTime = now.toISOString().slice(11, 16)

  const [title, setTitle] = useState('')
  const [date, setDate] = useState(defaultDate)
  const [time, setTime] = useState(defaultTime)
  const [location, setLocation] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const submit = async () => {
    if (!title.trim()) { setErr('일정 제목을 입력해주세요'); return }
    if (!date || !time) { setErr('일시를 입력해주세요'); return }
    const dt = new Date(`${date}T${time}:00`)
    if (isNaN(dt.getTime())) { setErr('올바른 일시를 입력해주세요'); return }
    setBusy(true)
    await onSend({
      title: title.trim(),
      datetime: dt.toISOString(),
      location: location.trim() || undefined,
      note: note.trim() || undefined,
    })
    setBusy(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={() => !busy && onClose()}>
      <div className="w-full max-w-md rounded-2xl bg-white shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <h3 className="flex items-center gap-2 font-bold text-gray-900">
            <Calendar className="h-4 w-4 text-emerald-500" />
            일정 공유
          </h3>
          <button onClick={onClose} disabled={busy} className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 py-5 space-y-3">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">제목 *</label>
            <input value={title} onChange={e => setTitle(e.target.value)} maxLength={100}
              placeholder="예: 매물 방문 일정, 계약 일정"
              className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">날짜 *</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)}
                className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">시간 *</label>
              <input type="time" value={time} onChange={e => setTime(e.target.value)}
                className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">장소 (선택)</label>
            <input value={location} onChange={e => setLocation(e.target.value)} maxLength={200}
              placeholder="주소 또는 만날 장소"
              className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">메모 (선택)</label>
            <textarea value={note} onChange={e => setNote(e.target.value)} maxLength={300} rows={2}
              placeholder="준비물·특이사항"
              className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 resize-none" />
          </div>
          {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{err}</p>}
        </div>

        <div className="flex gap-2 border-t border-gray-100 px-5 py-4">
          <button onClick={onClose} disabled={busy}
            className="flex-1 rounded-xl border border-gray-200 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50">
            취소
          </button>
          <button onClick={submit} disabled={busy}
            className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-500 py-2.5 text-sm font-semibold text-white hover:bg-emerald-600 disabled:opacity-50">
            <Calendar className="h-4 w-4" />
            {busy ? '전송 중...' : '일정 보내기'}
          </button>
        </div>
      </div>
    </div>
  )
}
