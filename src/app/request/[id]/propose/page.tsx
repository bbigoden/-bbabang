'use client'

import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Header } from '@/components/layout/header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardBody } from '@/components/ui/card'
import { formatPrice } from '@/lib/utils'
import { validatePrice } from '@/lib/validation'
import { Home, SendHorizonal, ArrowLeft, CheckCircle, BookOpen, X, MapPin, Check } from 'lucide-react'

export default function ProposePage() {
  const router = useRouter()
  const params = useParams()
  const requestId = params.id as string
  const supabase = createClient()

  const [price, setPrice] = useState('')
  const [address, setAddress] = useState('')
  const [description, setDescription] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [alreadyProposed, setAlreadyProposed] = useState(false)

  // 내 매물 모달
  const [showPropertyModal, setShowPropertyModal] = useState(false)
  const [myProperties, setMyProperties] = useState<any[]>([])
  const [propertiesLoading, setPropertiesLoading] = useState(false)
  const [selectedPropertyId, setSelectedPropertyId] = useState<string | null>(null)

  useEffect(() => {
    const checkExisting = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data: broker } = await supabase.from('broker_profiles').select('id').eq('user_id', user.id).limit(1).single()
      if (!broker) return
      const { data: existing } = await supabase.from('proposals').select('id').eq('request_id', requestId).eq('broker_id', broker.id).limit(1).maybeSingle()
      if (existing) setAlreadyProposed(true)
    }
    checkExisting()
  }, [requestId])

  const loadMyProperties = async () => {
    setPropertiesLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setPropertiesLoading(false); return }
    const { data: broker } = await supabase.from('broker_profiles').select('id').eq('user_id', user.id).single()
    if (!broker) { setPropertiesLoading(false); return }
    const { data } = await supabase
      .from('broker_properties')
      .select('id, address, deal_type, room_type, price, monthly_rent, brief_memo, status')
      .eq('broker_id', broker.id)
      .eq('status', 'available')
      .order('created_at', { ascending: false })
    setMyProperties(data ?? [])
    setPropertiesLoading(false)
  }

  const openModal = () => {
    setShowPropertyModal(true)
    if (myProperties.length === 0) loadMyProperties()
  }

  const applyProperty = (prop: any) => {
    setPrice(String(prop.price ?? ''))
    setAddress(prop.address ?? '')
    // 메모가 있으면 description에 채워줌
    if (prop.brief_memo) setDescription(prop.brief_memo)
    setSelectedPropertyId(prop.id)
    setShowPropertyModal(false)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const priceCheck = validatePrice(price, '제안 가격')
    if (!priceCheck.valid) { setError(priceCheck.error); return }
    setLoading(true)
    setError('')

    let user: any = null
    try {
      const { data } = await supabase.auth.getUser()
      user = data.user
    } catch { setError('오류가 발생했습니다. 다시 시도해주세요.'); setLoading(false); return }
    if (!user) { router.push('/auth/login'); return }

    const { data: broker } = await supabase.from('broker_profiles').select('id').eq('user_id', user.id).limit(1).single()
    if (!broker) { setError('중개사 등록이 필요합니다.'); setLoading(false); return }

    const { error: insertError } = await supabase.from('proposals').insert({
      request_id: requestId,
      broker_id: broker.id,
      price: Number(price),
      description,
      property_address: address || null,
      property_images: [],
      status: 'pending',
    })

    if (insertError) {
      if (insertError.code === '23505') {
        setError('이미 이 요청에 제안을 보내셨습니다. 요청 페이지에서 확인하세요.')
      } else {
        setError('제안 등록 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.')
      }
      setLoading(false)
      return
    }

    const { data: reqData } = await supabase.from('request_posts').select('proposal_count, user_id').eq('id', requestId).single()
    if (reqData) {
      await supabase.from('request_posts').update({ proposal_count: (reqData.proposal_count ?? 0) + 1 }).eq('id', requestId)
      if (reqData.user_id) {
        await supabase.from('notifications').insert({
          user_id: reqData.user_id,
          type: 'new_proposal',
          title: '새 제안이 도착했어요! 📨',
          body: `중개사가 새로운 매물을 제안했습니다. 지금 확인해보세요.`,
          link: `/request/${requestId}`,
        })
      }
    }

    router.push(`/request/${requestId}`)
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />

      {/* 내 매물 선택 모달 */}
      {showPropertyModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowPropertyModal(false)} />
          <div className="relative w-full sm:max-w-lg bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl max-h-[75vh] flex flex-col">
            {/* 모달 헤더 */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h2 className="font-bold text-gray-900">내 매물에서 가져오기</h2>
              <button onClick={() => setShowPropertyModal(false)} className="text-gray-400 hover:text-gray-600">
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* 매물 목록 */}
            <div className="overflow-y-auto flex-1 p-4 space-y-2">
              {propertiesLoading ? (
                <div className="py-10 text-center text-sm text-gray-400">불러오는 중...</div>
              ) : myProperties.length === 0 ? (
                <div className="py-10 text-center">
                  <Home className="mx-auto mb-2 h-8 w-8 text-gray-300" />
                  <p className="text-sm text-gray-400">매물있음 상태의 매물이 없습니다</p>
                  <p className="mt-1 text-xs text-gray-400">매물목록에서 매물을 먼저 등록해주세요</p>
                </div>
              ) : (
                myProperties.map(prop => (
                  <button
                    key={prop.id}
                    onClick={() => applyProperty(prop)}
                    className={`w-full text-left rounded-xl border p-3.5 transition-all hover:border-blue-400 hover:bg-blue-50 ${
                      selectedPropertyId === prop.id ? 'border-blue-500 bg-blue-50' : 'border-gray-200'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                            prop.deal_type === '매매' ? 'bg-blue-100 text-blue-700' :
                            prop.deal_type === '전세' ? 'bg-purple-100 text-purple-700' :
                            'bg-orange-100 text-orange-700'
                          }`}>{prop.deal_type}</span>
                          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-600">{prop.room_type}</span>
                        </div>
                        <div className="flex items-center gap-1 text-xs text-gray-500 truncate">
                          <MapPin className="h-3 w-3 flex-shrink-0" />
                          <span className="truncate">{prop.address || '주소 없음'}</span>
                        </div>
                        {prop.brief_memo && (
                          <p className="mt-1 text-xs text-gray-400 truncate">{prop.brief_memo}</p>
                        )}
                      </div>
                      <div className="text-right flex-shrink-0">
                        <div className="text-sm font-bold text-blue-600">{formatPrice(prop.price)}</div>
                        {prop.monthly_rent && (
                          <div className="text-xs text-gray-500">월 {formatPrice(prop.monthly_rent)}</div>
                        )}
                      </div>
                    </div>
                    {selectedPropertyId === prop.id && (
                      <div className="mt-2 flex items-center gap-1 text-xs text-blue-600 font-medium">
                        <Check className="h-3 w-3" /> 선택됨
                      </div>
                    )}
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      <div className="mx-auto max-w-xl px-4 py-10">
        <div className="mb-6">
          <button
            onClick={() => router.push(`/request/${requestId}`)}
            className="mb-4 flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            뒤로가기
          </button>
          <h1 className="text-2xl font-bold text-gray-900">매물 제안하기</h1>
          <p className="mt-1 text-sm text-gray-500">고객의 조건에 맞는 매물을 제안해보세요</p>
        </div>

        {alreadyProposed ? (
          <Card>
            <CardBody className="py-12 text-center">
              <CheckCircle className="mx-auto mb-4 h-12 w-12 text-green-500" />
              <h2 className="text-lg font-bold text-gray-900">이미 제안을 보내셨어요</h2>
              <p className="mt-2 text-sm text-gray-500">이 요청에는 제안을 한 번만 보낼 수 있습니다.</p>
              <button
                onClick={() => router.push(`/request/${requestId}`)}
                className="mt-6 inline-flex items-center gap-2 rounded-xl bg-blue-600 px-6 py-3 text-sm font-semibold text-white hover:bg-blue-700 transition-colors"
              >
                요청 페이지에서 확인하기
              </button>
            </CardBody>
          </Card>
        ) : (
          <Card>
            <CardBody>
              {/* 내 매물 가져오기 버튼 */}
              <button
                type="button"
                onClick={openModal}
                className="mb-5 flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-blue-300 bg-blue-50 py-3 text-sm font-semibold text-blue-600 hover:border-blue-400 hover:bg-blue-100 transition-colors"
              >
                <BookOpen className="h-4 w-4" />
                매물목록에서 가져오기
                {selectedPropertyId && <span className="ml-1 rounded-full bg-blue-600 px-2 py-0.5 text-[11px] text-white">선택됨</span>}
              </button>

              <form onSubmit={handleSubmit} className="space-y-5">
                <Input
                  label="제안 가격 (만원)"
                  type="number"
                  placeholder="30000"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  required
                  hint="전세·매매는 총액, 월세는 보증금을 입력해주세요"
                />
                <Input
                  label="매물 주소"
                  placeholder="서울시 강남구 역삼동 123-45"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                />
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-gray-700">
                    제안 내용 <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    placeholder="매물의 특징, 장점, 옵션 등을 자유롭게 적어주세요&#10;예: 풀옵션 원룸, 역 도보 3분, 반려동물 가능, 즉시 입주 가능"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    required
                    rows={6}
                    className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 resize-none"
                  />
                </div>

                {error && (
                  <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>
                )}

                <Button type="submit" size="lg" className="w-full" loading={loading}>
                  <SendHorizonal className="mr-2 h-5 w-5" />
                  제안 보내기
                </Button>
              </form>
            </CardBody>
          </Card>
        )}
      </div>
    </div>
  )
}
