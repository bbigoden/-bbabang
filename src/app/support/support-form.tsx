'use client'

import { useState, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuthOptional } from '@/lib/auth-context'
import { Send, Check, AlertCircle } from 'lucide-react'

export function SupportForm() {
  const supabaseRef = useRef(createClient())
  const supabase = supabaseRef.current
  const { user, profile } = useAuthOptional()

  const [subject, setSubject] = useState('')
  const [content, setContent] = useState('')
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const submit = async () => {
    setErr(null)
    if (!subject.trim()) { setErr('제목을 입력해주세요'); return }
    if (!content.trim() || content.trim().length < 5) { setErr('내용을 5자 이상 입력해주세요'); return }
    if (!user && !email.trim()) { setErr('답변받을 이메일을 입력해주세요'); return }

    setBusy(true)
    const { error } = await supabase.from('reports').insert({
      reporter_id: user?.id ?? null,
      reporter_email: user ? (profile?.email ?? null) : email.trim(),
      kind: 'inquiry',
      subject: subject.trim(),
      content: content.trim(),
    })
    setBusy(false)
    if (error) {
      setErr('등록 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.')
      return
    }
    setDone(true)
    setSubject('')
    setContent('')
    setEmail('')
  }

  if (done) {
    return (
      <div className="rounded-2xl border border-green-200 bg-green-50 px-6 py-10 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
          <Check className="h-6 w-6 text-green-600" />
        </div>
        <p className="font-semibold text-green-800">문의가 접수됐어요</p>
        <p className="mt-1 text-sm text-green-700">담당자가 확인 후 빠르게 답변드릴게요</p>
        <button
          onClick={() => setDone(false)}
          className="mt-5 inline-flex items-center gap-1.5 rounded-xl bg-white border border-green-200 px-4 py-2 text-sm font-medium text-green-700 hover:bg-green-100 transition-colors"
        >
          새 문의 작성
        </button>
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
      <div className="space-y-4">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-gray-700">제목</label>
          <input
            type="text"
            value={subject}
            onChange={e => setSubject(e.target.value)}
            maxLength={200}
            placeholder="문의 제목"
            className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          />
        </div>

        {!user && (
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">답변받을 이메일</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="example@email.com"
              className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
            <p className="mt-1 text-xs text-gray-400">비로그인 상태에서는 이메일이 필요해요</p>
          </div>
        )}

        <div>
          <label className="mb-1.5 block text-sm font-medium text-gray-700">내용</label>
          <textarea
            value={content}
            onChange={e => setContent(e.target.value)}
            rows={6}
            maxLength={2000}
            placeholder="문의하실 내용을 자세히 적어주세요 (최소 5자)"
            className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 resize-none"
          />
          <p className="mt-1 text-right text-xs text-gray-400">{content.length}/2000</p>
        </div>

        {err && (
          <div className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
            <AlertCircle className="h-4 w-4 flex-shrink-0" />
            {err}
          </div>
        )}

        <button
          onClick={submit}
          disabled={busy}
          className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl bg-blue-600 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          <Send className="h-4 w-4" />
          {busy ? '접수 중...' : '문의 보내기'}
        </button>
      </div>
    </div>
  )
}
