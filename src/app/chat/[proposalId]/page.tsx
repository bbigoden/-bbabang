'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/lib/auth-context'
import { useToast } from '@/components/toast'
import { formatPrice, maskAddress, cn } from '@/lib/utils'
import { Send, ArrowLeft, CheckCircle, MapPin, Phone, Building2, X, ChevronRight, ChevronLeft, Star, ImagePlus, Search } from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'

// ── 타입 ──────────────────────────────────────────
interface PropertySnapshot {
  deal_type: string
  room_type: string
  address: string
  price: number
  monthly_rent: number | null
  size_pyeong: number | null
  floor: number | null
  total_floors: number | null
  options: string[]
  description: string | null
  images?: string[]
  property_id: string
}

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

interface BrokerProperty {
  id: string
  deal_type: string
  room_type: string
  address: string
  price: number
  monthly_rent: number | null
  size_pyeong: number | null
  floor: number | null
  total_floors: number | null
  options: string[]
  description: string | null
  images: string[]
  status: string
}

// ── 매물 카드 컴포넌트 ──────────────────────────────
function PropertyCard({ snapshot, isMine, onClick }: { snapshot: PropertySnapshot; isMine: boolean; onClick?: () => void }) {
  const priceText = snapshot.deal_type === '월세'
    ? `보증금 ${formatPrice(snapshot.price)} / 월 ${formatPrice(snapshot.monthly_rent ?? 0)}`
    : formatPrice(snapshot.price)

  return (
    <div
      onClick={onClick}
      className={cn(
        'w-72 max-w-full sm:w-80 rounded-2xl border overflow-hidden shadow-sm transition-shadow',
        isMine ? 'border-blue-200 bg-blue-50' : 'border-gray-100 bg-white',
        onClick && 'cursor-pointer hover:shadow-md'
      )}
    >
      {/* 헤더 */}
      <div className={cn(
        'flex items-center gap-2 px-4 py-2.5 border-b',
        isMine ? 'bg-blue-500 border-blue-400' : 'bg-gray-50 border-gray-100'
      )}>
        <Building2 className={cn('h-4 w-4', isMine ? 'text-white' : 'text-blue-600')} />
        <span className={cn('text-xs font-semibold', isMine ? 'text-white' : 'text-gray-700')}>
          매물 공유
        </span>
        <span className={cn(
          'ml-auto text-xs font-medium px-2 py-0.5 rounded-full',
          isMine ? 'bg-blue-400 text-white' : 'bg-blue-100 text-blue-700'
        )}>
          {snapshot.deal_type}
        </span>
      </div>

      {/* 사진 */}
      {snapshot.images && snapshot.images.length > 0 && (
        <div className="relative h-36 overflow-hidden">
          <Image
            src={snapshot.images[0]}
            alt={snapshot.address}
            fill
            className="object-cover"
            sizes="256px"
          />
          {snapshot.images.length > 1 && (
            <span className="absolute bottom-2 right-2 rounded-full bg-black/50 px-2 py-0.5 text-xs text-white">
              +{snapshot.images.length - 1}
            </span>
          )}
        </div>
      )}

      {/* 내용 */}
      <div className="px-4 py-3 space-y-1.5">
        <p className={cn('text-sm font-semibold leading-snug', isMine ? 'text-blue-900' : 'text-gray-900')}>
          {maskAddress(snapshot.address)}
        </p>
        <p className={cn('text-xs', isMine ? 'text-blue-700' : 'text-gray-500')}>
          {snapshot.room_type}
          {snapshot.size_pyeong && ` · ${snapshot.size_pyeong}평`}
          {snapshot.floor && ` · ${snapshot.floor}층${snapshot.total_floors ? `/${snapshot.total_floors}층` : ''}`}
        </p>
        <p className={cn('text-base font-black', isMine ? 'text-blue-800' : 'text-blue-600')}>
          {priceText}
        </p>
        {snapshot.description && (
          <p className={cn('text-xs line-clamp-2 pt-0.5 border-t', isMine ? 'border-blue-200 text-blue-700' : 'border-gray-100 text-gray-500')}>
            {snapshot.description}
          </p>
        )}
      </div>
      {onClick && (
        <div className={cn('px-4 py-2 text-center text-xs border-t', isMine ? 'border-blue-200 text-blue-500' : 'border-gray-100 text-gray-400')}>
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
      <div
        className="w-full max-w-sm rounded-t-2xl bg-white dark:bg-gray-900 shadow-xl md:rounded-2xl overflow-hidden"
        style={{ maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}
        onClick={e => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="flex items-center justify-between border-b border-gray-100 dark:border-gray-800 px-5 py-4 flex-shrink-0">
          <div className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-blue-600" />
            <span className="font-bold text-gray-900 dark:text-white">매물 상세</span>
          </div>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 dark:bg-gray-800 text-gray-400">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1">
          {/* 이미지 캐러셀 */}
          {images.length > 0 ? (
            <div
              className="relative h-52 w-full overflow-hidden bg-gray-100 dark:bg-gray-800 flex-shrink-0"
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

              {/* 이전 버튼 */}
              {imgIdx > 0 && (
                <button onClick={e => { e.stopPropagation(); prevImg() }}
                  className="absolute left-2 top-1/2 -translate-y-1/2 flex h-8 w-8 items-center justify-center rounded-full bg-black/40 text-white hover:bg-black/60 transition-colors">
                  <ChevronLeft className="h-4 w-4" />
                </button>
              )}

              {/* 다음 버튼 */}
              {imgIdx < images.length - 1 && (
                <button onClick={e => { e.stopPropagation(); nextImg() }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 flex h-8 w-8 items-center justify-center rounded-full bg-black/40 text-white hover:bg-black/60 transition-colors">
                  <ChevronRight className="h-4 w-4" />
                </button>
              )}

              {/* N/전체 카운터 */}
              {images.length > 1 && (
                <span className="absolute top-2 right-2 rounded-full bg-black/50 px-2.5 py-1 text-xs text-white font-medium">
                  {imgIdx + 1} / {images.length}
                </span>
              )}

              {/* 점 인디케이터 */}
              {images.length > 1 && (
                <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1.5">
                  {images.map((_, i) => (
                    <button key={i} onClick={e => { e.stopPropagation(); setImgIdx(i) }}
                      className={cn('rounded-full transition-all', i === imgIdx ? 'w-4 h-1.5 bg-white' : 'w-1.5 h-1.5 bg-white/50')}
                    />
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="h-20 flex items-center justify-center bg-gray-50 dark:bg-gray-950 flex-shrink-0">
              <Building2 className="h-8 w-8 text-gray-200" />
            </div>
          )}

          <div className="p-5 space-y-4">
            {/* 유형 + 주소 */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${dealColors[snapshot.deal_type] ?? 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'}`}>
                  {snapshot.deal_type}
                </span>
                <span className="text-xs text-gray-500">{snapshot.room_type}</span>
              </div>
              <p className="text-lg font-bold text-gray-900 dark:text-white">{maskAddress(snapshot.address)}</p>
            </div>

            {/* 가격 */}
            <div className="rounded-xl bg-blue-50 p-4">
              <p className="text-2xl font-black text-blue-600">{priceText}</p>
            </div>

            {/* 상세 정보 */}
            <div className="grid grid-cols-2 gap-3">
              {snapshot.size_pyeong && (
                <div className="rounded-xl border border-gray-100 dark:border-gray-800 p-3">
                  <p className="text-xs text-gray-400 mb-1">면적</p>
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">{snapshot.size_pyeong}평</p>
                </div>
              )}
              {snapshot.floor && (
                <div className="rounded-xl border border-gray-100 dark:border-gray-800 p-3">
                  <p className="text-xs text-gray-400 mb-1">층수</p>
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">{snapshot.floor}층{snapshot.total_floors ? ` / ${snapshot.total_floors}층` : ''}</p>
                </div>
              )}
            </div>

            {/* 매물설명 */}
            {snapshot.description && (
              <div>
                <p className="text-xs font-semibold text-gray-500 mb-2">매물설명</p>
                <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-wrap">{snapshot.description}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── 메인 컴포넌트 ──────────────────────────────────
export default function ChatPage() {
  const params = useParams()
  const router = useRouter()
  const proposalId = params.proposalId as string
  const supabaseRef = useRef(createClient())
  const supabase = supabaseRef.current
  const auth = useAuth()
  const toast = useToast()

  const [user, setUser] = useState<any>(null)
  const [room, setRoom] = useState<any>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [loading, setLoading] = useState(true)

  // 매물 피커
  const [showPicker, setShowPicker] = useState(false)
  const [brokerProperties, setBrokerProperties] = useState<BrokerProperty[]>([])
  const [loadingProps, setLoadingProps] = useState(false)
  const [pickerSearch, setPickerSearch] = useState('')
  const [selectedPropIds, setSelectedPropIds] = useState<Set<string>>(new Set())
  const [sendingProps, setSendingProps] = useState(false)

  // 매물 상세 모달
  const [viewingSnapshot, setViewingSnapshot] = useState<PropertySnapshot | null>(null)

  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  useEffect(() => { scrollToBottom() }, [messages, scrollToBottom])

  useEffect(() => {
    if (auth.loading) return
    if (!auth.user) { router.push('/auth/login'); return }
    let destroyed = false
    let channelCleanup: (() => void) | undefined
    initChat().then(fn => {
      if (destroyed) {
        fn?.()
      } else {
        channelCleanup = fn
      }
    })
    return () => {
      destroyed = true
      channelCleanup?.()
    }
  }, [proposalId, auth.loading, auth.user?.id])

  const initChat = async () => {
    const currentUser = auth.user!
    setUser(currentUser)

    const { data: proposal } = await supabase
      .from('proposals')
      .select('*, broker_profiles(*, profiles(*)), request_posts(*, profiles(*))')
      .eq('id', proposalId)
      .single()

    if (!proposal) { router.push('/'); return }

    let chatRoom: any = null
    // .limit(1)로 중복 채팅방이 있어도 안전하게 처리
    const { data: existingRooms } = await supabase
      .from('chat_rooms')
      .select('*')
      .eq('proposal_id', proposalId)
      .order('created_at', { ascending: true })
      .limit(1)

    if (existingRooms && existingRooms.length > 0) {
      chatRoom = existingRooms[0]
    } else {
      const { data: newRoom } = await supabase
        .from('chat_rooms')
        .insert({
          request_id: proposal.request_id,
          user_id: proposal.request_posts?.user_id,
          broker_id: proposal.broker_profiles?.user_id,
          proposal_id: proposalId,
        })
        .select()
        .single()
      chatRoom = newRoom
    }

    // chatRoom이 null이면 방 생성 실패 → 홈으로
    if (!chatRoom) { router.push('/'); return }

    setRoom({ ...chatRoom, proposal })

    const { data: msgs } = await supabase
      .from('chat_messages')
      .select('*')
      .eq('room_id', chatRoom.id)
      .order('created_at', { ascending: true })

    const loadedMessages = (msgs ?? []) as Message[]
    setMessages(loadedMessages)
    setLoading(false)

    // 상대방이 보낸 읽지 않은 메시지 → 모두 읽음 처리
    const markAsRead = async (senderId: string) => {
      await supabase
        .from('chat_messages')
        .update({ is_read: true })
        .eq('room_id', chatRoom.id)
        .neq('sender_id', senderId)
        .eq('is_read', false)
    }
    await markAsRead(currentUser.id)

    const channel = supabase
      .channel(`chat:${chatRoom.id}:${Date.now()}`)
      // 새 메시지 도착
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'chat_messages',
        filter: `room_id=eq.${chatRoom.id}`,
      }, async (payload) => {
        const newMsg = payload.new as Message
        setMessages(prev => [...prev, newMsg])
        // 상대방이 보낸 메시지라면 즉시 읽음 처리
        if (newMsg.sender_id !== currentUser.id) {
          await supabase
            .from('chat_messages')
            .update({ is_read: true })
            .eq('id', newMsg.id)
        }
      })
      // 메시지 읽음 상태 변경 → 내 메시지가 읽혔을 때 UI 업데이트
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'chat_messages',
        filter: `room_id=eq.${chatRoom.id}`,
      }, (payload) => {
        const updated = payload.new as Message
        setMessages(prev =>
          prev.map(m => m.id === updated.id ? { ...m, is_read: updated.is_read } : m)
        )
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }

  // 텍스트 메시지 전송
  const sendMessage = async () => {
    if (!input.trim() || !room || sending) return
    setSending(true)
    const content = input.trim()
    setInput('')
    await supabase.from('chat_messages').insert({
      room_id: room.id,
      sender_id: user.id,
      content,
      message_type: 'text',
    })
    setSending(false)
    inputRef.current?.focus()
  }

  // 이미지 전송
  const sendImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !room) return
    e.target.value = ''

    const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
    if (!ALLOWED_TYPES.includes(file.type)) { toast.error('지원하지 않는 이미지 형식입니다 (jpg/png/webp/gif)'); return }
    if (file.size > 10 * 1024 * 1024) { toast.error('이미지가 10MB를 초과합니다'); return }
    if (file.size === 0) { toast.error('빈 파일입니다'); return }

    const ext = file.name.split('.').pop()
    const path = `chat/${room.id}/${Date.now()}.${ext}`
    const { error: uploadErr } = await supabase.storage.from('property-images').upload(path, file, { upsert: false })
    if (uploadErr) {
      console.error('[chat] image upload failed', uploadErr)
      toast.error(`이미지 업로드 실패: ${uploadErr.message}`)
      return
    }

    const { data: { publicUrl } } = supabase.storage.from('property-images').getPublicUrl(path)
    const { error: msgErr } = await supabase.from('chat_messages').insert({
      room_id: room.id,
      sender_id: user.id,
      content: publicUrl,
      message_type: 'image',
    })
    if (msgErr) {
      console.error('[chat] image message insert failed', msgErr)
      toast.error(`이미지 메시지 전송 실패: ${msgErr.message}`)
    }
  }

  // 매물 피커 열기 (중개사만)
  const openPropertyPicker = async () => {
    if (loadingProps) return
    setShowPicker(true)
    if (brokerProperties.length > 0) return

    setLoadingProps(true)
    const { data: broker } = await supabase
      .from('broker_profiles')
      .select('id')
      .eq('user_id', user.id)
      .single()

    if (broker) {
      const { data } = await supabase
        .from('broker_properties')
        .select('id, deal_type, room_type, address, price, monthly_rent, size_pyeong, floor, total_floors, options, description, images, status')
        .eq('broker_id', broker.id)
        .eq('status', 'available')
        .order('created_at', { ascending: false })
      setBrokerProperties(data ?? [])
    }
    setLoadingProps(false)
  }

  // 매물 카드 전송 (단일)
  const buildSnapshot = (property: BrokerProperty): PropertySnapshot => ({
    deal_type: property.deal_type,
    room_type: property.room_type,
    address: property.address,
    price: property.price,
    monthly_rent: property.monthly_rent,
    size_pyeong: property.size_pyeong,
    floor: property.floor,
    total_floors: property.total_floors,
    options: property.options,
    description: property.description,
    images: property.images ?? [],
    property_id: property.id,
  })

  // 선택된 매물 전체 전송 (N개 → 1번 insert로 일괄)
  const sendSelectedProperties = async () => {
    if (!room || selectedPropIds.size === 0 || sendingProps) return
    setSendingProps(true)
    const toSend = brokerProperties.filter(p => selectedPropIds.has(p.id))
    const rows = toSend.map(property => ({
      room_id: room.id,
      sender_id: user.id,
      content: JSON.stringify(buildSnapshot(property)),
      message_type: 'property' as const,
      property_id: property.id,
    }))
    if (rows.length > 0) {
      const { error } = await supabase.from('chat_messages').insert(rows)
      if (error) {
        console.error('[chat] sendSelectedProperties failed', error)
        toast.error(`매물 발송 실패: ${error.message}`)
        setSendingProps(false)
        return
      }
    }
    setSendingProps(false)
    setShowPicker(false)
    setSelectedPropIds(new Set())
    setPickerSearch('')
  }

  const togglePropSelection = (id: string) => {
    setSelectedPropIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-950">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
          <p className="text-sm text-gray-400">채팅방 불러오는 중...</p>
        </div>
      </div>
    )
  }

  const proposal = room?.proposal
  const broker = proposal?.broker_profiles
  const brokerProfile = broker?.profiles
  const requester = proposal?.request_posts?.profiles
  const isUser = user?.id === proposal?.request_posts?.user_id
  const isBroker = !isUser
  const otherName = isUser ? (brokerProfile?.name ?? '중개사') : (requester?.name ?? '고객')
  const otherPhone = isUser ? brokerProfile?.phone : requester?.phone

  // 날짜별 그룹화
  const groupedMessages = messages.reduce((groups: Record<string, Message[]>, msg) => {
    const date = new Date(msg.created_at).toLocaleDateString('ko-KR', {
      month: 'long', day: 'numeric', weekday: 'short',
    })
    if (!groups[date]) groups[date] = []
    groups[date].push(msg)
    return groups
  }, {})

  return (
    <div className="flex h-screen flex-col bg-gray-50 dark:bg-gray-950">

      {/* ── 상단 헤더 ── */}
      <div className="border-b border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3">
          <Link href={isUser ? '/dashboard/user' : '/dashboard/broker'} className="flex h-9 w-9 items-center justify-center rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 dark:bg-gray-800 transition-colors">
            <ArrowLeft className="h-5 w-5 text-gray-600 dark:text-gray-400" />
          </Link>

          <button
            className="flex flex-1 items-center gap-3 text-left"
          >
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-700 font-bold text-lg">
              {otherName[0]}
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="font-bold text-gray-900 dark:text-white">{otherName}</span>
                {isUser && broker?.is_verified && (
                  <CheckCircle className="h-4 w-4 text-blue-500" />
                )}
              </div>
              {isUser && broker?.office_name && (
                <p className="text-xs text-gray-400">{broker.office_name} · {broker.district?.split(',')?.[0]}</p>
              )}
            </div>
          </button>

          {isUser && proposal?.status === 'accepted' && (
            <Link href={`/review/${proposalId}`} className="flex h-9 w-9 items-center justify-center rounded-xl bg-yellow-50 text-yellow-500 hover:bg-yellow-100 transition-colors" title="리뷰 남기기">
              <Star className="h-4 w-4" />
            </Link>
          )}
          {otherPhone && (
            <a href={`tel:${otherPhone}`} className="flex h-9 w-9 items-center justify-center rounded-xl bg-green-50 text-green-600 hover:bg-green-100 transition-colors">
              <Phone className="h-4 w-4" />
            </a>
          )}
        </div>

        {/* 제안 요약 바 */}
        {proposal && (
          <div className="border-t border-gray-50 bg-blue-50 px-4 py-2">
            <div className="mx-auto flex max-w-2xl items-center justify-between">
              {proposal.property_address && (
                <span className="flex items-center gap-1 text-sm text-blue-700">
                  <MapPin className="h-3.5 w-3.5" />
                  {maskAddress(proposal.property_address)}
                </span>
              )}
              <span className="ml-auto font-bold text-blue-700">{formatPrice(proposal.price)}</span>
            </div>
          </div>
        )}
      </div>

      {/* ── 메시지 목록 ── */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="mx-auto max-w-2xl space-y-1">

          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="mb-3 text-4xl">👋</div>
              <p className="font-semibold text-gray-600 dark:text-gray-400">{otherName}님과 대화를 시작해보세요</p>
              <p className="mt-1 text-sm text-gray-400">매물 정보, 계약 조건 등을 자유롭게 문의하세요</p>
              {isBroker && (
                <button
                  onClick={openPropertyPicker}
                  className="mt-4 flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100 transition-colors"
                >
                  <Building2 className="h-4 w-4" />
                  매물 바로 공유하기
                </button>
              )}
            </div>
          )}

          {Object.entries(groupedMessages).map(([date, msgs]) => (
            <div key={date}>
              <div className="my-4 flex items-center gap-3">
                <div className="h-px flex-1 bg-gray-200" />
                <span className="bg-gray-50 dark:bg-gray-950 px-2 text-xs text-gray-400">{date}</span>
                <div className="h-px flex-1 bg-gray-200" />
              </div>

              <div className="space-y-1">
                {msgs.map((msg, idx) => {
                  const isMine = msg.sender_id === user?.id
                  const prevMsg = msgs[idx - 1]
                  const showTime = !prevMsg
                    || new Date(msg.created_at).getMinutes() !== new Date(prevMsg.created_at).getMinutes()
                    || prevMsg.sender_id !== msg.sender_id
                  const isLast = idx === msgs.length - 1 || msgs[idx + 1].sender_id !== msg.sender_id
                  const isPropertyMsg = msg.message_type === 'property'

                  let propertySnapshot: PropertySnapshot | null = null
                  if (isPropertyMsg) {
                    try { propertySnapshot = JSON.parse(msg.content) } catch { }
                  }

                  return (
                    <div
                      key={msg.id}
                      className={cn('flex items-end gap-2', isMine ? 'justify-end' : 'justify-start')}
                    >
                      {/* 상대방 아바타 */}
                      {!isMine && (
                        <div className={cn(
                          'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-700 text-sm font-bold',
                          !isLast && 'invisible'
                        )}>
                          {otherName[0]}
                        </div>
                      )}

                      <div className={cn('flex flex-col', isMine ? 'items-end' : 'items-start')}>
                        {/* 매물 카드 */}
                        {isPropertyMsg && propertySnapshot ? (
                          <PropertyCard snapshot={propertySnapshot} isMine={isMine} onClick={() => setViewingSnapshot(propertySnapshot)} />
                        ) : msg.message_type === 'image' ? (
                          /* 이미지 메시지 */
                          <a href={msg.content} target="_blank" rel="noopener noreferrer">
                            <div className="relative max-w-xs overflow-hidden rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm" style={{ width: '240px', height: '200px' }}>
                              <Image
                                src={msg.content}
                                alt="사진"
                                fill
                                className="object-cover"
                                sizes="240px"
                              />
                            </div>
                          </a>
                        ) : (
                          /* 일반 텍스트 말풍선 */
                          <div className={cn(
                            'max-w-xs rounded-2xl px-4 py-2.5 text-sm leading-relaxed md:max-w-sm',
                            isMine
                              ? 'bg-blue-600 text-white rounded-br-sm'
                              : 'bg-white border border-gray-100 text-gray-800 shadow-sm rounded-bl-sm'
                          )}>
                            {msg.content}
                          </div>
                        )}

                        {(showTime || isLast) && (
                          <div className="mt-1 px-1 flex items-center gap-1.5">
                            {isMine && (
                              <span className={cn(
                                'text-xs font-medium',
                                msg.is_read ? 'text-blue-400' : 'text-gray-300'
                              )}>
                                {msg.is_read ? '읽음' : ''}
                              </span>
                            )}
                            <span className="text-xs text-gray-400">
                              {new Date(msg.created_at).toLocaleTimeString('ko-KR', {
                                hour: '2-digit', minute: '2-digit',
                              })}
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
          <div ref={bottomRef} />
        </div>
      </div>

      {/* ── 매물 상세 모달 ── */}
      {viewingSnapshot && (
        <PropertyDetailModal snapshot={viewingSnapshot} onClose={() => setViewingSnapshot(null)} />
      )}

      {/* ── 매물 피커 모달 (중개사만) ── */}
      {showPicker && isBroker && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 md:items-center" onClick={() => { setShowPicker(false); setPickerSearch(''); setSelectedPropIds(new Set()) }}>
          <div
            className="w-full max-w-xl rounded-t-2xl bg-white dark:bg-gray-900 shadow-xl md:rounded-2xl"
            style={{ maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}
            onClick={e => e.stopPropagation()}
          >
            {/* 모달 헤더 */}
            <div className="flex items-center justify-between border-b border-gray-100 dark:border-gray-800 px-5 py-4 flex-shrink-0">
              <div className="flex items-center gap-2">
                <Building2 className="h-5 w-5 text-blue-600" />
                <span className="font-bold text-gray-900 dark:text-white">매물목록</span>
                {!loadingProps && <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-bold text-blue-700">{brokerProperties.length}</span>}
              </div>
              <button onClick={() => { setShowPicker(false); setPickerSearch(''); setSelectedPropIds(new Set()) }} className="flex h-8 w-8 items-center justify-center rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 dark:bg-gray-800 text-gray-400 transition-colors">
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* 검색창 */}
            {!loadingProps && brokerProperties.length > 0 && (
              <div className="border-b border-gray-100 dark:border-gray-800 px-4 py-3 flex-shrink-0">
                <div className="flex items-center gap-2 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-950 px-3 py-2 focus-within:border-blue-400 focus-within:bg-white dark:bg-gray-900 transition-colors">
                  <Search className="h-4 w-4 text-gray-400 flex-shrink-0" />
                  <input
                    type="text"
                    value={pickerSearch}
                    onChange={e => setPickerSearch(e.target.value)}
                    placeholder="주소, 거래유형, 방종류 검색..."
                    className="flex-1 bg-transparent text-sm outline-none placeholder:text-gray-400"
                    autoFocus
                  />
                  {pickerSearch && (
                    <button onClick={() => setPickerSearch('')} className="text-gray-400 hover:text-gray-600 dark:text-gray-400">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* 테이블 헤더 */}
            {!loadingProps && brokerProperties.length > 0 && (
              <div className="grid grid-cols-[2rem_3rem_1fr_auto] gap-x-3 border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-950 px-4 py-2 text-xs font-semibold text-gray-400 flex-shrink-0">
                <span></span>
                <span>유형</span>
                <span>소재지</span>
                <span className="text-right">가격</span>
              </div>
            )}

            {/* 목록 */}
            <div className="overflow-y-auto flex-1">
              {loadingProps ? (
                <div className="flex items-center justify-center py-12">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
                </div>
              ) : brokerProperties.length === 0 ? (
                <div className="py-12 text-center">
                  <Building2 className="mx-auto mb-3 h-10 w-10 text-gray-200" />
                  <p className="text-sm text-gray-500">등록된 매물이 없습니다</p>
                  <Link href="/broker/properties/new" className="mt-3 inline-block text-sm font-semibold text-blue-600 underline">
                    매물 등록하기
                  </Link>
                </div>
              ) : (() => {
                const dealColors: Record<string, string> = {
                  '매매': 'bg-blue-100 text-blue-700',
                  '전세': 'bg-green-100 text-green-700',
                  '월세': 'bg-orange-100 text-orange-700',
                  '단기': 'bg-purple-100 text-purple-700',
                }
                const filtered = brokerProperties.filter(p => {
                  if (!pickerSearch) return true
                  const q = pickerSearch.toLowerCase()
                  return (
                    p.address.toLowerCase().includes(q) ||
                    p.deal_type.includes(q) ||
                    p.room_type.includes(q) ||
                    (p.description ?? '').toLowerCase().includes(q)
                  )
                })
                if (filtered.length === 0) return (
                  <div className="py-12 text-center text-sm text-gray-400">
                    검색 결과가 없습니다
                  </div>
                )
                return (
                  <div className="divide-y divide-gray-50">
                    {filtered.map(prop => {
                      const isSelected = selectedPropIds.has(prop.id)
                      const priceText = prop.deal_type === '월세'
                        ? `${formatPrice(prop.price)}/${formatPrice(prop.monthly_rent ?? 0)}`
                        : formatPrice(prop.price)
                      return (
                        <button
                          key={prop.id}
                          onClick={() => togglePropSelection(prop.id)}
                          className={cn(
                            'grid grid-cols-[2rem_3rem_1fr_auto] w-full gap-x-3 items-center px-4 py-3 text-left transition-colors',
                            isSelected ? 'bg-blue-50' : 'hover:bg-gray-50'
                          )}
                        >
                          {/* 체크박스 */}
                          <span className={cn(
                            'flex h-5 w-5 items-center justify-center rounded-full border-2 transition-colors flex-shrink-0',
                            isSelected ? 'border-blue-600 bg-blue-600' : 'border-gray-300 bg-white'
                          )}>
                            {isSelected && <span className="text-white text-[10px] font-bold">✓</span>}
                          </span>
                          <span className={`inline-flex items-center justify-center rounded-lg px-1.5 py-1 text-xs font-bold ${dealColors[prop.deal_type] ?? 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'}`}>
                            {prop.deal_type}
                          </span>
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">{prop.address}</p>
                            <p className="text-xs text-gray-400 truncate">
                              {prop.room_type}{prop.size_pyeong ? ` · ${prop.size_pyeong}평` : ''}{prop.floor ? ` · ${prop.floor}층` : ''}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-black text-blue-600 whitespace-nowrap">{priceText}</p>
                            {prop.description && <p className="text-xs text-gray-400 truncate max-w-[100px]">{prop.description}</p>}
                          </div>
                        </button>
                      )
                    })}
                  </div>
                )
              })()}
            </div>

            {/* 하단 보내기 버튼 */}
            <div className="border-t border-gray-100 dark:border-gray-800 px-4 py-3 flex-shrink-0">
              <button
                onClick={sendSelectedProperties}
                disabled={selectedPropIds.size === 0 || sendingProps}
                className={cn(
                  'w-full rounded-xl py-3 text-sm font-bold transition-colors',
                  selectedPropIds.size > 0
                    ? 'bg-blue-600 text-white hover:bg-blue-700'
                    : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                )}
              >
                {sendingProps
                  ? '전송 중...'
                  : selectedPropIds.size > 0
                    ? `선택한 매물 ${selectedPropIds.size}건 보내기`
                    : '매물을 선택하세요'
                }
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 입력창 ── */}
      <div className="border-t border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 py-3">
        <div className="mx-auto flex max-w-2xl items-end gap-2">
          {/* 중개사: 매물 보내기 버튼 */}
          {isBroker && (
            <button
              onClick={showPicker ? () => setShowPicker(false) : openPropertyPicker}
              className={cn(
                'flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl transition-all border',
                showPicker
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-gray-50 text-gray-500 border-gray-200 hover:bg-blue-50 hover:text-blue-600 hover:border-blue-200'
              )}
              title="매물 보내기"
            >
              <Building2 className="h-4 w-4" />
            </button>
          )}

          {/* 이미지 전송 버튼 (누구나) */}
          <label
            className="flex h-11 w-11 flex-shrink-0 cursor-pointer items-center justify-center rounded-2xl border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-950 text-gray-500 transition-all hover:bg-blue-50 hover:text-blue-600 hover:border-blue-200"
            title="사진 보내기"
          >
            <ImagePlus className="h-4 w-4" />
            <input type="file" accept="image/*" className="hidden" onChange={sendImage} />
          </label>

          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => {
              setInput(e.target.value)
              e.target.style.height = 'auto'
              e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px'
            }}
            onKeyDown={handleKeyDown}
            placeholder="메시지를 입력하세요 (Enter로 전송, Shift+Enter 줄바꿈)"
            rows={1}
            className="flex-1 resize-none overflow-hidden rounded-2xl border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-950 px-4 py-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:bg-white dark:bg-gray-900 transition-all"
            style={{ minHeight: '46px', maxHeight: '120px' }}
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim() || sending}
            className={cn(
              'flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl transition-all',
              input.trim()
                ? 'bg-blue-600 text-white hover:bg-blue-700 shadow-sm'
                : 'bg-gray-100 text-gray-400 cursor-not-allowed'
            )}
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
