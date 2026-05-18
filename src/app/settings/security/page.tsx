'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Lock, Trash2, Check, AlertCircle } from 'lucide-react'

export default function SettingsSecurityPage() {
  const router = useRouter()
  const supabase = createClient()

  const [pwNew, setPwNew] = useState('')
  const [pwConfirm, setPwConfirm] = useState('')
  const [pwSaving, setPwSaving] = useState(false)
  const [pwMsg, setPwMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  const [showWithdraw, setShowWithdraw] = useState(false)
  const [withdrawing, setWithdrawing] = useState(false)
  const [withdrawErr, setWithdrawErr] = useState<string | null>(null)

  const changePassword = async () => {
    if (!pwNew || !pwConfirm) { setPwMsg({ type: 'err', text: '새 비밀번호를 입력해주세요.' }); return }
    if (pwNew !== pwConfirm) { setPwMsg({ type: 'err', text: '새 비밀번호가 일치하지 않습니다.' }); return }
    if (pwNew.length < 6) { setPwMsg({ type: 'err', text: '비밀번호는 6자 이상이어야 합니다.' }); return }
    setPwSaving(true); setPwMsg(null)
    const { error } = await supabase.auth.updateUser({ password: pwNew })
    setPwSaving(false)
    if (error) { setPwMsg({ type: 'err', text: '비밀번호 변경에 실패했습니다.' }); return }
    setPwMsg({ type: 'ok', text: '비밀번호가 변경됐습니다.' })
    setPwNew(''); setPwConfirm('')
    setTimeout(() => setPwMsg(null), 3000)
  }

  const withdraw = async () => {
    setWithdrawing(true); setWithdrawErr(null)
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/delete-user`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${session?.access_token}`,
        'Content-Type': 'application/json',
      },
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok || json.error) {
      setWithdrawErr(json.error ?? '탈퇴 중 오류가 발생했습니다.')
      setWithdrawing(false)
      return
    }
    await supabase.auth.signOut()
    router.push('/')
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-gray-200 bg-white p-6">
        <h2 className="mb-4 font-bold text-gray-900 flex items-center gap-2">
          <Lock className="h-4 w-4 text-gray-400" /> 비밀번호 변경
        </h2>
        <div className="space-y-3">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">새 비밀번호</label>
            <input type="password" value={pwNew} onChange={e => setPwNew(e.target.value)} placeholder="6자 이상"
              className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">새 비밀번호 확인</label>
            <input type="password" value={pwConfirm} onChange={e => setPwConfirm(e.target.value)} placeholder="비밀번호 재입력"
              className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
          </div>
        </div>
        {pwMsg && (
          <div className={`mt-3 flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${pwMsg.type === 'ok' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
            {pwMsg.type === 'ok' ? <Check className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
            {pwMsg.text}
          </div>
        )}
        <button onClick={changePassword} disabled={pwSaving}
          className="mt-4 w-full rounded-xl bg-gray-800 py-2.5 text-sm font-semibold text-white hover:bg-gray-900 disabled:opacity-50 transition-colors">
          {pwSaving ? '변경 중...' : '비밀번호 변경'}
        </button>
      </div>

      <div className="rounded-2xl border border-red-100 bg-white p-6">
        <h2 className="mb-1 font-bold text-gray-900 flex items-center gap-2">
          <Trash2 className="h-4 w-4 text-red-400" /> 회원탈퇴
        </h2>
        <p className="mb-4 text-sm text-gray-400">탈퇴 시 모든 데이터가 삭제되며 복구할 수 없어요.</p>
        <button onClick={() => { setShowWithdraw(true); setWithdrawErr(null) }}
          className="rounded-xl border border-red-200 px-4 py-2 text-sm font-medium text-red-500 hover:bg-red-50 transition-colors">
          탈퇴하기
        </button>
      </div>

      {showWithdraw && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-100 mx-auto">
              <Trash2 className="h-6 w-6 text-red-500" />
            </div>
            <h3 className="text-center text-lg font-bold text-gray-900 mb-2">정말 탈퇴하시겠어요?</h3>
            <p className="text-center text-sm text-gray-500 mb-5">
              계정과 모든 데이터가 즉시 삭제되며<br />되돌릴 수 없어요.
            </p>
            {withdrawErr && (
              <div className="mb-4 flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
                <AlertCircle className="h-4 w-4 flex-shrink-0" />
                {withdrawErr}
              </div>
            )}
            <div className="flex gap-3">
              <button onClick={() => setShowWithdraw(false)} disabled={withdrawing}
                className="flex-1 rounded-xl border border-gray-200 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors">
                취소
              </button>
              <button onClick={withdraw} disabled={withdrawing}
                className="flex-1 rounded-xl bg-red-500 py-2.5 text-sm font-semibold text-white hover:bg-red-600 disabled:opacity-50 transition-colors">
                {withdrawing ? '처리 중...' : '탈퇴 확인'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
