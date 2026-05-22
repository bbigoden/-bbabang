'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useAuthOptional } from '@/lib/auth-context'
import { Flag, X, AlertTriangle, Check } from 'lucide-react'

type Target = 'broker' | 'property' | 'request' | 'review'

interface Props {
  type: Target
  id: string
  /** 텍스트만 보여줄지(헤더용) 또는 페이지 우상단 작은 버튼인지 */
  variant?: 'text' | 'compact'
  label?: string
}

const REASONS: Record<Target, string[]> = {
  broker: ['허위 정보', '부적절한 행위', '연락두절', '기타'],
  property: ['허위 매물', '가격 정보 불일치', '이미지 부적절', '기타'],
  request: ['스팸·광고', '욕설·비방', '허위 내용', '기타'],
  review: ['욕설·비방', '허위 후기', '광고성', '기타'],
}

const TARGET_LABEL: Record<Target, string> = {
  broker: '중개사',
  property: '매물',
  request: '요청',
  review: '리뷰',
}

export function ReportButton({ type, id, variant = 'compact', label }: Props) {
  const router = useRouter()
  const supabaseRef = useRef(createClient())
  const supabase = supabaseRef.current
  const { user } = useAuthOptional()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState<string>('')
  const [content, setContent] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const click = () => {
    if (!user) {
      router.push('/auth/login')
      return
    }
    setOpen(true)
    setReason('')
    setContent('')
    setErr(null)
    setDone(false)
  }

  const submit = async () => {
    if (!reason) { setErr('사유를 선택해주세요'); return }
    if (!content.trim() || content.trim().length < 5) { setErr('내용을 5자 이상 입력해주세요'); return }
    if (!user) { setErr('로그인이 필요합니다'); return }
    setBusy(true); setErr(null)
    const { error } = await supabase.from('reports').insert({
      reporter_id: user.id,
      kind: 'report',
      target_type: type,
      target_id: id,
      subject: reason,
      content: content.trim(),
    })
    setBusy(false)
    if (error) {
      setErr('신고 등록 중 오류가 발생했습니다.')
      return
    }
    setDone(true)
    setTimeout(() => setOpen(false), 1800)
  }

  const triggerClass = variant === 'text'
    ? 'inline-flex items-center gap-1 text-xs text-gray-400 hover:text-red-500 transition-colors'
    : 'inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-50 hover:text-red-500 transition-colors'

  return (
    <>
      <button type="button" onClick={click} className={triggerClass} aria-label="신고하기">
        <Flag className="h-3.5 w-3.5" />
        {label ?? '신고'}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
          onClick={() => !busy && setOpen(false)}>
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-gray-900 shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-gray-100 dark:border-gray-800 px-5 py-4">
              <h3 className="font-bold text-gray-900 dark:text-white flex items-center gap-2">
                <Flag className="h-4 w-4 text-red-500" />
                {TARGET_LABEL[type]} 신고
              </h3>
              <button onClick={() => setOpen(false)} disabled={busy}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 dark:bg-gray-800">
                <X className="h-4 w-4" />
              </button>
            </div>

            {done ? (
              <div className="px-5 py-10 text-center">
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-green-50">
                  <Check className="h-6 w-6 text-green-600" />
                </div>
                <p className="font-semibold text-gray-900 dark:text-white">신고가 접수됐어요</p>
                <p className="mt-1 text-sm text-gray-500">관리자가 확인 후 조치할게요</p>
              </div>
            ) : (
              <>
                <div className="px-5 py-5 space-y-4">
                  <div className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2.5">
                    <AlertTriangle className="h-4 w-4 text-amber-500 flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-amber-700 leading-relaxed">
                      허위 신고 시 서비스 이용에 제한이 있을 수 있어요. 신중하게 작성해주세요.
                    </p>
                  </div>

                  <div>
                    <p className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">신고 사유</p>
                    <div className="grid grid-cols-2 gap-2">
                      {REASONS[type].map(r => (
                        <button key={r} type="button" onClick={() => setReason(r)}
                          className={`rounded-xl border px-3 py-2 text-sm font-medium transition-all ${
                            reason === r
                              ? 'border-red-300 bg-red-50 text-red-600'
                              : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                          }`}>
                          {r}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">상세 내용</label>
                    <textarea
                      value={content}
                      onChange={e => setContent(e.target.value)}
                      maxLength={1000}
                      rows={4}
                      placeholder="구체적인 상황을 알려주세요 (최소 5자)"
                      className="w-full rounded-xl border border-gray-200 dark:border-gray-800 px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 resize-none"
                    />
                    <p className="mt-1 text-right text-xs text-gray-400">{content.length}/1000</p>
                  </div>

                  {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{err}</p>}
                </div>

                <div className="flex gap-2 border-t border-gray-100 dark:border-gray-800 px-5 py-4">
                  <button onClick={() => setOpen(false)} disabled={busy}
                    className="flex-1 rounded-xl border border-gray-200 dark:border-gray-800 py-2.5 text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 dark:bg-gray-950 disabled:opacity-50">
                    취소
                  </button>
                  <button onClick={submit} disabled={busy}
                    className="flex-1 rounded-xl bg-red-500 py-2.5 text-sm font-semibold text-white hover:bg-red-600 disabled:opacity-50">
                    {busy ? '접수 중...' : '신고 제출'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}
