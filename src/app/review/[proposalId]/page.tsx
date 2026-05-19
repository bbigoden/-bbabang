'use client'

import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Header } from '@/components/layout/header'
import { Star, CheckCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

export default function ReviewPage() {
  const router = useRouter()
  const params = useParams()
  const proposalId = params.proposalId as string
  const supabase = createClient()

  const [loading, setLoading] = useState(false)
  const [initialLoading, setInitialLoading] = useState(true)
  const [done, setDone] = useState(false)
  const [rating, setRating] = useState(0)
  const [hovered, setHovered] = useState(0)
  const [comment, setComment] = useState('')
  const [brokerName, setBrokerName] = useState('')
  const [brokerId, setBrokerId] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    const load = async () => {
      let user: any = null
      try {
        const { data } = await supabase.auth.getUser()
        user = data.user
      } catch { router.push('/auth/login'); return }
      if (!user) { router.push('/auth/login'); return }

      const { data: proposal } = await supabase
        .from('proposals')
        .select('*, broker_profiles(id, profiles(name)), request_posts(user_id)')
        .eq('id', proposalId)
        .single()

      if (!proposal || proposal.status !== 'accepted') {
        router.push('/dashboard/user'); return
      }
      if (proposal.request_posts?.user_id !== user.id) {
        router.push('/dashboard/user'); return
      }

      const brokerIdVal = proposal.broker_profiles?.id ?? ''

      // 이미 리뷰 작성했는지 확인 (broker_id + user_id 유니크 조합으로 체크)
      const { data: existing } = await supabase
        .from('reviews')
        .select('id')
        .eq('broker_id', brokerIdVal)
        .eq('user_id', user.id)
        .maybeSingle()

      if (existing) { setDone(true) }

      setBrokerId(brokerIdVal)
      setBrokerName(proposal.broker_profiles?.profiles?.name ?? '중개사')
      setInitialLoading(false)
    }
    load()
  }, [proposalId])

  const handleSubmit = async () => {
    if (rating === 0) { setError('별점을 선택해주세요'); return }
    setLoading(true)
    setError('')

    let user: any = null
    try {
      const { data } = await supabase.auth.getUser()
      user = data.user
    } catch { setError('오류가 발생했습니다. 다시 시도해주세요.'); setLoading(false); return }
    if (!user) return

    const { error: insertError } = await supabase.from('reviews').insert({
      broker_id: brokerId,
      user_id: user.id,
      rating,
      content: comment || '',
    })

    if (insertError) {
      setError('리뷰 등록 중 오류가 발생했습니다.')
      setLoading(false)
      return
    }

    // 중개사 평점 업데이트
    const { data: reviews } = await supabase
      .from('reviews')
      .select('rating')
      .eq('broker_id', brokerId)

    if (reviews && reviews.length > 0) {
      const avg = reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length
      await supabase
        .from('broker_profiles')
        .update({ rating: Math.round(avg * 10) / 10, review_count: reviews.length })
        .eq('id', brokerId)
    }

    setDone(true)
    setLoading(false)
  }

  if (initialLoading) {
    return <div className="min-h-screen flex items-center justify-center text-gray-400">불러오는 중...</div>
  }

  if (done) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
            <CheckCircle className="h-8 w-8 text-green-600" />
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">리뷰 등록 완료!</h2>
          <p className="text-gray-500 text-sm mb-6">{brokerName} 중개사에게 소중한 리뷰가 전달됩니다</p>
          <Button variant="primary" onClick={() => router.push('/dashboard/user')}>
            대시보드로 돌아가기
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      <div className="mx-auto max-w-lg px-4 py-12">
        <div className="rounded-2xl bg-white p-8 shadow-sm border border-gray-100">
          <div className="text-center mb-8">
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-100 text-blue-700 text-2xl font-black">
              {brokerName[0]}
            </div>
            <h1 className="text-xl font-bold text-gray-900">{brokerName} 중개사</h1>
            <p className="mt-1 text-sm text-gray-500">거래는 만족스러우셨나요? 솔직한 후기를 남겨주세요</p>
          </div>

          {/* 별점 */}
          <div className="mb-6 text-center">
            <p className="mb-3 text-sm font-medium text-gray-700">별점</p>
            <div className="flex justify-center gap-2">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  onMouseEnter={() => setHovered(star)}
                  onMouseLeave={() => setHovered(0)}
                  onClick={() => setRating(star)}
                  className="transition-transform hover:scale-110"
                >
                  <Star
                    className={cn(
                      'h-10 w-10 transition-colors',
                      (hovered || rating) >= star
                        ? 'fill-yellow-400 text-yellow-400'
                        : 'fill-gray-200 text-gray-200'
                    )}
                  />
                </button>
              ))}
            </div>
            {rating > 0 && (
              <p className="mt-2 text-sm font-semibold text-yellow-600">
                {['', '별로예요', '그저그래요', '보통이에요', '좋아요', '최고예요!'][rating]}
              </p>
            )}
          </div>

          {/* 후기 */}
          <div className="mb-6">
            <label className="mb-1.5 block text-sm font-medium text-gray-700">
              후기 <span className="text-gray-400 font-normal">(선택)</span>
            </label>
            <textarea
              placeholder="중개사님과의 거래 경험을 자유롭게 작성해주세요"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={4}
              maxLength={1000}
              className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 resize-none"
            />
          </div>

          {error && (
            <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">⚠️ {error}</div>
          )}

          <Button variant="primary" size="lg" className="w-full" loading={loading} onClick={handleSubmit}>
            리뷰 등록하기
          </Button>
        </div>
      </div>
    </div>
  )
}
