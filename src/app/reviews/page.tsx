'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/lib/auth-context'
import { Header } from '@/components/layout/header'
import Image from 'next/image'
import { Star, Edit2, Trash2, Check, X, AlertTriangle, Building2, ShieldCheck } from 'lucide-react'
import { formatDate, cn } from '@/lib/utils'
import { EmptyState } from '@/components/empty-state'

interface Review {
  id: string
  broker_id: string
  rating: number
  content: string | null
  images: string[] | null
  created_at: string
  broker_profiles: {
    id: string
    office_name: string | null
    is_verified: boolean | null
    profiles: { name: string | null } | null
  } | null
}

async function recalcBrokerRating(supabase: ReturnType<typeof createClient>, brokerId: string) {
  const { data: rs } = await supabase.from('reviews').select('rating').eq('broker_id', brokerId)
  if (!rs) return
  if (rs.length === 0) {
    await supabase.from('broker_profiles').update({ rating: 0, review_count: 0 }).eq('id', brokerId)
  } else {
    const avg = rs.reduce((s, r) => s + r.rating, 0) / rs.length
    await supabase
      .from('broker_profiles')
      .update({ rating: Math.round(avg * 10) / 10, review_count: rs.length })
      .eq('id', brokerId)
  }
}

export default function MyReviewsPage() {
  const router = useRouter()
  const supabaseRef = useRef(createClient())
  const supabase = supabaseRef.current
  const auth = useAuth()

  const [reviews, setReviews] = useState<Review[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Review | null>(null)
  const [deleting, setDeleting] = useState<Review | null>(null)

  useEffect(() => {
    if (auth.loading) return
    if (!auth.user) router.push('/auth/login?redirect=/reviews')
  }, [auth.loading, auth.user, router])

  const load = useCallback(async () => {
    if (!auth.user) return
    setLoading(true)
    const { data } = await supabase
      .from('reviews')
      .select('id, broker_id, rating, content, images, created_at, broker_profiles(id, office_name, is_verified, profiles(name))')
      .eq('user_id', auth.user.id)
      .order('created_at', { ascending: false })
    setReviews((data ?? []) as any)
    setLoading(false)
  }, [auth.user, supabase])

  useEffect(() => {
    if (auth.user) load()
  }, [auth.user, load])

  if (auth.loading || !auth.user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-950">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <Header />

      <div className="mx-auto max-w-5xl px-4 py-8">
        <div className="mb-6">
          <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900 dark:text-white">
            <Star className="h-6 w-6 fill-yellow-400 text-yellow-400" />
            내 리뷰
          </h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">중개사에게 작성한 리뷰를 관리해요</p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
          </div>
        ) : reviews.length === 0 ? (
          <EmptyState
            variant="full"
            icon={Star}
            message="작성한 리뷰가 없어요"
            description="중개사와 거래를 마치면 리뷰를 남길 수 있어요"
            darkBg
          />
        ) : (
          <ul className="space-y-3">
            {reviews.map(r => (
              <li key={r.id} className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
                <div className="flex items-start justify-between gap-3">
                  <Link href={`/broker/${r.broker_id}`} className="flex items-center gap-3 min-w-0 flex-1 group">
                    <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                      <Building2 className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="font-semibold text-gray-900 dark:text-white truncate group-hover:text-blue-600 transition-colors">
                          {r.broker_profiles?.profiles?.name ?? '(알 수 없음)'}
                        </p>
                        {r.broker_profiles?.is_verified && (
                          <ShieldCheck className="h-3.5 w-3.5 text-blue-500 flex-shrink-0" />
                        )}
                      </div>
                      <p className="text-xs text-gray-500 truncate">{r.broker_profiles?.office_name ?? ''}</p>
                    </div>
                  </Link>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => setEditing(r)}
                      title="수정"
                      aria-label="수정"
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 dark:bg-gray-800 hover:text-gray-700 dark:text-gray-300 transition-colors"
                    >
                      <Edit2 className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => setDeleting(r)}
                      title="삭제"
                      aria-label="삭제"
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 hover:bg-red-50 hover:text-red-500 transition-colors"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                <div className="mt-3 flex items-center gap-0.5">
                  {[1,2,3,4,5].map(i => (
                    <Star key={i} className={`h-4 w-4 ${i <= r.rating ? 'fill-yellow-400 text-yellow-400' : 'text-gray-200'}`} />
                  ))}
                  <span className="ml-2 text-xs text-gray-500">{formatDate(r.created_at)}</span>
                </div>

                {r.content && (
                  <p className="mt-2 text-sm text-gray-600 dark:text-gray-500 leading-relaxed whitespace-pre-line">{r.content}</p>
                )}

                {Array.isArray(r.images) && r.images.length > 0 && (
                  <div className="mt-3 flex gap-2 overflow-x-auto">
                    {r.images.map((url, i) => (
                      <div key={i} className="relative h-20 w-20 flex-shrink-0 overflow-hidden rounded-lg">
                        <Image src={url} alt={`리뷰 사진 ${i + 1}`} fill className="object-cover" sizes="80px" />
                      </div>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {editing && (
        <EditReviewModal
          review={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null)
            await load()
          }}
          supabase={supabase}
        />
      )}

      {deleting && (
        <DeleteReviewModal
          review={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={async () => {
            setDeleting(null)
            await load()
          }}
          supabase={supabase}
        />
      )}
    </div>
  )
}

function EditReviewModal({ review, onClose, onSaved, supabase }: {
  review: Review; onClose: () => void; onSaved: () => void; supabase: ReturnType<typeof createClient>
}) {
  const [rating, setRating] = useState(review.rating)
  const [hovered, setHovered] = useState(0)
  const [content, setContent] = useState(review.content ?? '')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const save = async () => {
    if (rating < 1) { setErr('별점을 선택해주세요'); return }
    setSaving(true); setErr(null)
    const { error } = await supabase
      .from('reviews')
      .update({ rating, content })
      .eq('id', review.id)
    if (error) {
      setErr('저장 중 오류가 발생했습니다.')
      setSaving(false)
      return
    }
    if (rating !== review.rating) {
      await recalcBrokerRating(supabase, review.broker_id)
    }
    setSaving(false)
    onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={() => !saving && onClose()}>
      <div className="w-full max-w-md rounded-2xl bg-white dark:bg-gray-900 shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-gray-100 dark:border-gray-800 px-5 py-4">
          <h3 className="font-bold text-gray-900 dark:text-white">리뷰 수정</h3>
          <button onClick={onClose} disabled={saving} aria-label="닫기" className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 dark:bg-gray-800">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-5 py-5">
          <p className="text-sm text-gray-500 mb-1">{review.broker_profiles?.profiles?.name} 중개사</p>
          <div className="mb-4 flex justify-center gap-2">
            {[1,2,3,4,5].map(star => (
              <button
                key={star}
                onMouseEnter={() => setHovered(star)}
                onMouseLeave={() => setHovered(0)}
                onClick={() => setRating(star)}
                className="transition-transform hover:scale-110"
              >
                <Star className={cn('h-9 w-9', (hovered || rating) >= star ? 'fill-yellow-400 text-yellow-400' : 'fill-gray-200 text-gray-200')} />
              </button>
            ))}
          </div>
          <textarea
            value={content}
            onChange={e => setContent(e.target.value)}
            rows={4}
            maxLength={1000}
            placeholder="후기를 자유롭게 작성해주세요 (선택)"
            className="w-full rounded-xl border border-gray-200 dark:border-gray-800 px-4 py-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 resize-none"
          />
          {err && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{err}</p>}
        </div>
        <div className="flex gap-2 border-t border-gray-100 dark:border-gray-800 px-5 py-4">
          <button onClick={onClose} disabled={saving}
            className="flex-1 rounded-xl border border-gray-200 dark:border-gray-800 py-2.5 text-sm font-medium text-gray-600 dark:text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 dark:bg-gray-950 disabled:opacity-50">
            취소
          </button>
          <button onClick={save} disabled={saving}
            className="flex-1 rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-1.5">
            <Check className="h-4 w-4" />
            {saving ? '저장 중...' : '저장'}
          </button>
        </div>
      </div>
    </div>
  )
}

function DeleteReviewModal({ review, onClose, onDeleted, supabase }: {
  review: Review; onClose: () => void; onDeleted: () => void; supabase: ReturnType<typeof createClient>
}) {
  const [deleting, setDeleting] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const remove = async () => {
    setDeleting(true); setErr(null)
    const { error } = await supabase.from('reviews').delete().eq('id', review.id)
    if (error) {
      setErr('삭제 중 오류가 발생했습니다.')
      setDeleting(false)
      return
    }
    await recalcBrokerRating(supabase, review.broker_id)
    setDeleting(false)
    onDeleted()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={() => !deleting && onClose()}>
      <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-gray-900 shadow-xl p-6" onClick={e => e.stopPropagation()}>
        <div className="flex flex-col items-center text-center">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-50">
            <AlertTriangle className="h-6 w-6 text-red-500" />
          </div>
          <h3 className="text-lg font-bold text-gray-900 dark:text-white">리뷰를 삭제할까요?</h3>
          <p className="mt-2 text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
            삭제하면 중개사 페이지에서 사라지고<br />다시 복구할 수 없어요.
          </p>
        </div>
        {err && <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{err}</p>}
        <div className="mt-5 flex gap-3">
          <button onClick={onClose} disabled={deleting}
            className="flex-1 rounded-xl border border-gray-200 dark:border-gray-800 py-2.5 text-sm font-medium text-gray-600 dark:text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 dark:bg-gray-950 disabled:opacity-50">
            취소
          </button>
          <button onClick={remove} disabled={deleting}
            className="flex-1 rounded-xl bg-red-500 py-2.5 text-sm font-semibold text-white hover:bg-red-600 disabled:opacity-50">
            {deleting ? '삭제 중...' : '삭제'}
          </button>
        </div>
      </div>
    </div>
  )
}
