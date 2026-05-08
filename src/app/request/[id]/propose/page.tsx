'use client'

import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Header } from '@/components/layout/header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardBody } from '@/components/ui/card'
import { Home, SendHorizonal, ArrowLeft, CheckCircle } from 'lucide-react'

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

  // 페이지 진입 시 이미 제안했는지 확인
  useEffect(() => {
    const checkExisting = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data: broker } = await supabase
        .from('broker_profiles')
        .select('id')
        .eq('user_id', user.id)
        .limit(1)
        .single()
      if (!broker) return

      const { data: existing } = await supabase
        .from('proposals')
        .select('id')
        .eq('request_id', requestId)
        .eq('broker_id', broker.id)
        .limit(1)
        .maybeSingle()

      if (existing) setAlreadyProposed(true)
    }
    checkExisting()
  }, [requestId])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/auth/login'); return }

    // 중개사 프로필 확인
    const { data: broker } = await supabase
      .from('broker_profiles')
      .select('id')
      .eq('user_id', user.id)
      .limit(1)
      .single()

    if (!broker) {
      setError('중개사 등록이 필요합니다.')
      setLoading(false)
      return
    }

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
      // 중복 제안 (UNIQUE 제약)
      if (insertError.code === '23505') {
        setError('이미 이 요청에 제안을 보내셨습니다. 요청 페이지에서 확인하세요.')
      } else {
        setError('제안 등록 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.')
      }
      setLoading(false)
      return
    }

    // 제안 수 업데이트 + 요청자에게 알림 전송
    const { data: reqData } = await supabase
      .from('request_posts')
      .select('proposal_count, user_id')
      .eq('id', requestId)
      .single()
    if (reqData) {
      await supabase
        .from('request_posts')
        .update({ proposal_count: (reqData.proposal_count ?? 0) + 1 })
        .eq('id', requestId)

      // 요청자에게 알림
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
