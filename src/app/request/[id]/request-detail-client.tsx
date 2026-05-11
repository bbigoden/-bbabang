'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Header } from '@/components/layout/header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatDate, formatPrice, maskAddress, cn } from '@/lib/utils'
import {
  MapPin, Star, MessageCircle, Home, CheckCircle,
  Pencil, Archive, Send, Building2, X,
  ImagePlus, Phone, ChevronLeft, ChevronRight, Search
} from 'lucide-react'
import { CloseRequestButton } from '@/components/close-request-button'
import { ProposalActions } from '@/components/proposal-actions'
import { ShareButton } from '@/components/share-button'
import Link from 'next/link'
import Image from 'next/image'

// ── Types ─────────────────────────────────────────
interface Message {
  id: string
  room_id: string
  sender_id: string
  content: string
  message_type: 'text' | 'property' | 'image'
  property_id: string | null
  created_at: string
  is_read: boolean
}

interface PropertySnapshot {
  deal_type: string; room_type: string; address: string
  price: number; monthly_rent: number | null; size_pyeong: number | null
  floor: number | null; total_floors: number | null
  options: string[]; description: string | null; images?: string[]; property_id: string
}

// ── 매물 카드 ──────────────────────────────────────
function PropertyCard({ snapshot, isMine, onClick }: { snapshot: PropertySnapshot; isMine: boolean; onClick?: () => void }) {
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
        <p className={cn('text-xs', isMine ? 'text-blue-700' : 'text-gray-500')}>{snapshot.room_type}{snapshot.size_pyeong && ` · ${snapshot.size_pyeong}평`}</p>
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

// ── 매물 상세 모달 ──────────────────────────────────
function PropertyDetailModal({ snapshot, onClose }: { snapshot: PropertySnapshot; onClose: () => void }) {
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
                  <p className="text-sm font-semibold text-gray-900">{snapshot.size_pyeong}평</p>
                </div>
              )}
              {snapshot.floor && (
                <div className="rounded-xl border border-gray-100 p-3">
                  <p className="text-xs text-gray-400 mb-1">층수</p>
                  <p className="text-sm font-semibold text-gray-900">{snapshot.floor}층{snapshot.total_floors ? ` / ${snapshot.total_floors}층` : ''}</p>
                </div>
              )}
            </div>
            {(snapshot.options ?? []).length > 0 && (
              <div>
                <p className="text-xs font-semibold text-gray-500 mb-2">옵션</p>
                <div className="flex flex-wrap gap-1.5">
                  {(snapshot.options ?? []).map(opt => (
                    <span key={opt} className="rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-700">{opt}</span>
                  ))}
                </div>
              </div>
            )}
            {snapshot.description && (
              <div>
                <p className="text-xs font-semibold text-gray-500 mb-2">메모</p>
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
function ChatPanel({ proposalId, currentUser, isOwner, onBack }: {
  proposalId: string; currentUser: any; isOwner: boolean; onBack: () => void
}) {
  const supabase = createClient()
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

  const sendMessage = async () => {
    if (!input.trim() || !room || sending) return
    setSending(true); const content = input.trim(); setInput('')
    await supabase.from('chat_messages').insert({ room_id: room.id, sender_id: currentUser.id, content, message_type: 'text' })
    setSending(false); inputRef.current?.focus()
  }

  const sendImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file || !room) return; e.target.value = ''
    const path = `chat/${room.id}/${Date.now()}.${file.name.split('.').pop()}`
    const { error } = await supabase.storage.from('property-images').upload(path, file, { upsert: false })
    if (error) return
    const { data: { publicUrl } } = supabase.storage.from('property-images').getPublicUrl(path)
    await supabase.from('chat_messages').insert({ room_id: room.id, sender_id: currentUser.id, content: publicUrl, message_type: 'image' })
  }

  const openPropertyPicker = async () => {
    setShowPicker(true); if (brokerProperties.length > 0 || loadingProps) return
    setLoadingProps(true)
    const { data: broker } = await supabase.from('broker_profiles').select('id').eq('user_id', currentUser.id).single()
    if (broker) {
      const { data } = await supabase.from('broker_properties').select('*').eq('broker_id', broker.id).eq('status', 'available').order('created_at', { ascending: false })
      setBrokerProperties(data ?? [])
    }
    setLoadingProps(false)
  }

  const buildSnapshot = (prop: any): PropertySnapshot => ({
    deal_type: prop.deal_type, room_type: prop.room_type, address: prop.address,
    price: prop.price, monthly_rent: prop.monthly_rent, size_pyeong: prop.size_pyeong,
    floor: prop.floor, total_floors: prop.total_floors, options: prop.options,
    description: prop.description, images: prop.images ?? [], property_id: prop.id,
  })

  const sendSelectedProperties = async () => {
    if (!room || selectedPropIds.size === 0 || sendingProps) return
    setSendingProps(true)
    const toSend = brokerProperties.filter(p => selectedPropIds.has(p.id))
    for (const prop of toSend) {
      await supabase.from('chat_messages').insert({ room_id: room.id, sender_id: currentUser.id, content: JSON.stringify(buildSnapshot(prop)), message_type: 'property', property_id: prop.id })
    }
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
  const otherName = isOwner ? (brokerProfile?.name ?? '중개사') : (requester?.name ?? '고객')
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
          {isOwner && broker?.office_name && <p className="text-xs text-gray-400 truncate">{broker.office_name}</p>}
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
      {proposal?.price && (
        <div className="bg-blue-50 border-b border-blue-100 px-3 py-1.5 flex-shrink-0 flex items-center justify-between">
          {proposal.property_address && (
            <span className="flex items-center gap-1 text-xs text-blue-700">
              <MapPin className="h-3 w-3" />{maskAddress(proposal.property_address)}
            </span>
          )}
          <span className="ml-auto text-sm font-bold text-blue-700">{formatPrice(proposal.price)}</span>
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
                  if (msg.message_type === 'property') { try { snap = JSON.parse(msg.content) } catch { } }
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
                <h3 className="font-bold text-gray-900">내 매물장</h3>
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
            <button onClick={showPicker ? () => setShowPicker(false) : openPropertyPicker}
              className={cn('flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl border transition-all',
                showPicker ? 'bg-blue-600 text-white border-blue-600' : 'bg-gray-50 text-gray-500 border-gray-200 hover:bg-blue-50 hover:text-blue-600')}>
              <Building2 className="h-4 w-4" />
            </button>
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
    </div>
  )
}

// ── 메인 클라이언트 컴포넌트 ────────────────────────
interface Props {
  request: any
  proposals: any[]
  user: any
  userRole: string | null
}

export function RequestDetailClient({ request, proposals, user, userRole }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [mobileTab, setMobileTab] = useState<'proposals' | 'chat'>('proposals')
  const isOwner = user?.id === request.user_id

  const handleSelect = (id: string) => { setSelectedId(id); setMobileTab('chat') }

  return (
    <div className="flex flex-col bg-gray-50" style={{ height: '100dvh' }}>
      <Header user={user} role={userRole} />

      <div className="flex flex-1 overflow-hidden">
        {/* ── 왼쪽 패널: 요청 정보 + 제안 목록 ── */}
        <div className={cn(
          'flex flex-col border-r border-gray-200 bg-white overflow-y-auto flex-shrink-0',
          'w-full md:w-[380px] lg:w-[420px]',
          mobileTab === 'chat' ? 'hidden md:flex' : 'flex'
        )}>
          {/* 요청 요약 */}
          <div className="px-4 py-4 border-b border-gray-100">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {request.is_co_broker && <Badge variant="default" className="bg-purple-100 text-purple-700 border-purple-200">공동중개</Badge>}
                  <Badge variant={request.status === 'active' ? 'success' : request.status === 'matched' ? 'info' : 'default'}>
                    {request.status === 'active' ? '모집 중' : request.status === 'matched' ? '매칭 완료' : '마감'}
                  </Badge>
                  {(request.deal_type?.split(',') ?? []).map((t: string) => <Badge key={t} variant="info">{t.trim()}</Badge>)}
                  {(request.room_type?.split(',') ?? []).slice(0, 2).map((t: string) => <Badge key={t} variant="default">{t.trim()}</Badge>)}
                </div>
                <h1 className="text-lg font-bold text-gray-900">{request.city} {request.district}</h1>
                <div className="text-xl font-black text-blue-600 mt-0.5">{formatPrice(request.min_price)}~{formatPrice(request.max_price)}</div>
                {request.min_monthly && (
                  <div className="text-xs text-gray-500 mt-0.5">월세 {formatPrice(request.min_monthly)}~{formatPrice(request.max_monthly)}</div>
                )}
              </div>
              <ShareButton
                title={`${request.city} ${request.district} 구합니다`}
                text={`빠방에서 ${request.city} ${request.district} 매물을 찾고 있어요!`}
                url={`https://bbabang.vercel.app/request/${request.id}`}
              />
            </div>
            {request.description && (
              <p className="mt-2 text-xs text-gray-500 leading-relaxed line-clamp-3">{request.description}</p>
            )}
            <div className="mt-2 flex flex-wrap gap-3 text-xs text-gray-400">
              {request.min_size && <span>최소 {request.min_size}평</span>}
              {request.max_size && <span>최대 {request.max_size}평</span>}
              {request.move_in_date && <span>입주 희망: {String(request.move_in_date)}</span>}
            </div>

            {/* 마감 배너 */}
            {request.status === 'closed' && (
              <div className="mt-3 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                <Archive className="h-4 w-4 text-amber-500 flex-shrink-0" />
                <div>
                  <p className="text-xs font-semibold text-amber-800">마감된 요청입니다</p>
                  <p className="text-[10px] text-amber-600">새 제안을 받지 않으며, 기존 제안만 확인할 수 있어요</p>
                </div>
              </div>
            )}

            {/* 수정/마감 버튼 */}
            {isOwner && request.status === 'active' && (
              <div className="mt-3 flex gap-2">
                <CloseRequestButton requestId={request.id} />
                <Link href={`/request/${request.id}/edit`}>
                  <Button variant="outline" size="sm">
                    <Pencil className="mr-1 h-3.5 w-3.5" />수정
                  </Button>
                </Link>
              </div>
            )}

            {/* 중개사: 제안하기 버튼 */}
            {userRole === 'broker' && request.status === 'active' && (
              <Link href={`/request/${request.id}/propose`} className="mt-3 flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 transition-colors">
                <Home className="h-4 w-4" />이 고객에게 매물 제안하기
              </Link>
            )}
          </div>

          {/* 제안 목록 */}
          <div className="px-4 py-3 flex-1">
            <h2 className="text-sm font-bold text-gray-700 mb-3 flex items-center gap-2">
              중개사 제안
              <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-bold text-blue-700">{proposals.length}</span>
            </h2>

            {proposals.length === 0 ? (
              <div className="py-12 text-center">
                <Home className="mx-auto mb-2 h-8 w-8 text-gray-200" />
                <p className="text-sm text-gray-400">아직 제안이 없습니다</p>
                <p className="mt-1 text-xs text-gray-300">인근 중개사들에게 알림이 발송됩니다</p>
              </div>
            ) : (
              <div className="space-y-2 pb-4">
                {proposals.map((proposal: any) => {
                  const broker = proposal.broker_profiles
                  const brokerProfile = broker?.profiles
                  const isSelected = selectedId === proposal.id
                  return (
                    <button key={proposal.id} onClick={() => handleSelect(proposal.id)}
                      className={cn(
                        'w-full text-left rounded-xl border p-3 transition-all',
                        isSelected ? 'border-blue-400 bg-blue-50 ring-2 ring-blue-200' : 'border-gray-200 bg-white hover:border-blue-200 hover:bg-blue-50/40'
                      )}
                    >
                      <div className="flex items-center gap-2.5">
                        <Link href={`/broker/${broker?.id}`} onClick={e => e.stopPropagation()}>
                          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-700 font-bold text-sm hover:ring-2 hover:ring-blue-300 transition-all">
                            {brokerProfile?.name?.[0] ?? 'B'}
                          </div>
                        </Link>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1">
                            <span className="text-sm font-bold text-gray-900 truncate">{brokerProfile?.name ?? '중개사'}</span>
                            {broker?.is_verified && <CheckCircle className="h-3.5 w-3.5 text-blue-500 flex-shrink-0" />}
                          </div>
                          <p className="text-xs text-gray-500 truncate">{broker?.office_name}</p>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <div className="text-sm font-black text-blue-600">{formatPrice(proposal.price)}</div>
                          <div className="flex items-center gap-0.5 justify-end mt-0.5">
                            <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />
                            <span className="text-xs text-gray-500">{broker?.rating?.toFixed(1) ?? '신규'}</span>
                          </div>
                        </div>
                      </div>

                      {proposal.property_address && (
                        <div className="mt-1.5 flex items-center gap-1 text-xs text-gray-500">
                          <MapPin className="h-3 w-3 flex-shrink-0" />
                          <span className="truncate">{maskAddress(proposal.property_address)}</span>
                        </div>
                      )}
                      {proposal.description && (
                        <p className="mt-1.5 text-xs text-gray-500 line-clamp-2">{proposal.description}</p>
                      )}

                      <div className="mt-2 flex items-center justify-between">
                        <span className="text-[10px] text-gray-400">{formatDate(proposal.created_at)}</span>
                        {isSelected ? (
                          <span className="text-xs font-semibold text-blue-600 flex items-center gap-1">
                            <MessageCircle className="h-3 w-3" />채팅 중
                          </span>
                        ) : (
                          <span className="text-xs text-gray-400 flex items-center gap-1">
                            <MessageCircle className="h-3 w-3" />채팅하기 →
                          </span>
                        )}
                      </div>

                      {isOwner && (
                        <div className="mt-2" onClick={e => e.stopPropagation()}>
                          <ProposalActions
                            proposalId={proposal.id}
                            requestId={request.id}
                            currentStatus={proposal.status}
                            brokerId={broker?.user_id}
                            requestOwnerId={request.user_id}
                          />
                        </div>
                      )}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* ── 오른쪽 패널: 채팅 ── */}
        <div className={cn(
          'flex-1 flex flex-col overflow-hidden',
          mobileTab === 'proposals' ? 'hidden md:flex' : 'flex'
        )}>
          {selectedId && user ? (
            <ChatPanel
              key={selectedId}
              proposalId={selectedId}
              currentUser={user}
              isOwner={isOwner}
              onBack={() => setMobileTab('proposals')}
            />
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center text-center px-4 bg-gray-50">
              {!user ? (
                <>
                  <MessageCircle className="mb-3 h-12 w-12 text-gray-200" />
                  <p className="font-semibold text-gray-500">로그인 후 채팅할 수 있어요</p>
                  <Link href="/auth/login" className="mt-4 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 transition-colors">
                    로그인하기
                  </Link>
                </>
              ) : (
                <>
                  <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-100">
                    <MessageCircle className="h-8 w-8 text-blue-500" />
                  </div>
                  <h3 className="text-base font-bold text-gray-800">제안을 선택하세요</h3>
                  <p className="mt-1.5 text-sm text-gray-400">왼쪽에서 중개사 제안을 클릭하면<br />바로 채팅을 시작할 수 있어요</p>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 모바일 하단 탭 */}
      <div className="md:hidden flex border-t border-gray-200 bg-white flex-shrink-0">
        <button
          onClick={() => setMobileTab('proposals')}
          className={cn('flex-1 py-3 text-sm font-semibold transition-colors',
            mobileTab === 'proposals' ? 'text-blue-600 border-t-2 border-blue-600 -mt-px' : 'text-gray-500')}
        >
          제안 목록 ({proposals.length})
        </button>
        <button
          onClick={() => selectedId && setMobileTab('chat')}
          className={cn('flex-1 py-3 text-sm font-semibold transition-colors',
            mobileTab === 'chat' ? 'text-blue-600 border-t-2 border-blue-600 -mt-px' : selectedId ? 'text-gray-500' : 'text-gray-300')}
        >
          {selectedId ? '채팅' : '채팅 (제안 선택)'}
        </button>
      </div>
    </div>
  )
}
