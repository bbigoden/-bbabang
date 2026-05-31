'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { User, Mail, Calendar, Check, AlertCircle, Lock, Trash2, Shield, ShieldCheck, ShieldOff, Copy } from 'lucide-react'
import { transferBrokerData } from '@/lib/leave-office'
import { isPasswordPwned, pwnedMessage } from '@/lib/password-check'

export default function SettingsAccountPage() {
  const router = useRouter()
  const supabase = createClient()
  const [user, setUser] = useState<{ id: string; email?: string | null } | null>(null)
  const [profile, setProfile] = useState<{ name?: string; phone?: string; role?: string; created_at?: string } | null>(null)
  const [loading, setLoading] = useState(true)

  // 기본 정보
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  // 비밀번호 변경
  const [pwNew, setPwNew] = useState('')
  const [pwConfirm, setPwConfirm] = useState('')
  const [pwSaving, setPwSaving] = useState(false)
  const [pwMsg, setPwMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  // 회원탈퇴
  const [showWithdraw, setShowWithdraw] = useState(false)
  const [withdrawing, setWithdrawing] = useState(false)
  const [withdrawErr, setWithdrawErr] = useState<string | null>(null)

  // 2FA (TOTP)
  const [mfaFactorId, setMfaFactorId] = useState<string | null>(null)  // null=미등록
  const [mfaStep, setMfaStep] = useState<'idle' | 'enroll' | 'confirm' | 'unenroll'>('idle')
  const [mfaQr, setMfaQr] = useState('')          // SVG QR 코드
  const [mfaSecret, setMfaSecret] = useState('')  // 수동 입력용 base32 secret
  const [_mfaUri, setMfaUri] = useState('')         // otpauth:// URI
  const [mfaEnrollId, setMfaEnrollId] = useState('')
  const [mfaCode, setMfaCode] = useState('')
  const [mfaBusy, setMfaBusy] = useState(false)
  const [mfaMsg, setMfaMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [secretCopied, setSecretCopied] = useState(false)
  const mfaInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    ;(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      setUser({ id: user.id, email: user.email })
      const { data: p } = await supabase.from('profiles').select('name, phone, role, created_at').eq('id', user.id).single()
      if (p) { setProfile(p); setName(p.name ?? ''); setPhone(p.phone ?? '') }
      // 2FA 등록 여부 조회
      const { data: factors } = await supabase.auth.mfa.listFactors()
      const totp = factors?.totp?.find(f => f.status === 'verified')
      if (totp) setMfaFactorId(totp.id)
      setLoading(false)
    })()
  }, [])

  const save = async () => {
    if (!name.trim()) { setMsg({ type: 'err', text: '이름을 입력해주세요.' }); return }
    if (!user) return
    setSaving(true); setMsg(null)
    const { error } = await supabase.from('profiles').update({ name: name.trim(), phone: phone.trim() }).eq('id', user.id)
    setSaving(false)
    if (error) setMsg({ type: 'err', text: '저장 중 오류가 발생했습니다.' })
    else {
      setMsg({ type: 'ok', text: '저장됐습니다.' })
      setTimeout(() => setMsg(null), 3000)
    }
  }

  const changePassword = async () => {
    if (!pwNew || !pwConfirm) { setPwMsg({ type: 'err', text: '새 비밀번호를 입력해주세요.' }); return }
    if (pwNew !== pwConfirm) { setPwMsg({ type: 'err', text: '새 비밀번호가 일치하지 않습니다.' }); return }
    if (pwNew.length < 8) { setPwMsg({ type: 'err', text: '비밀번호는 8자 이상이어야 합니다.' }); return }
    setPwSaving(true); setPwMsg(null)

    // P1-5: 유출된 비밀번호 차단 (HaveIBeenPwned)
    const pwned = await isPasswordPwned(pwNew)
    if (pwned.pwned) {
      setPwSaving(false)
      setPwMsg({ type: 'err', text: pwnedMessage(pwned.count ?? 0) })
      return
    }

    const { error } = await supabase.auth.updateUser({ password: pwNew })
    setPwSaving(false)
    if (error) { setPwMsg({ type: 'err', text: '비밀번호 변경에 실패했습니다.' }); return }
    setPwMsg({ type: 'ok', text: '비밀번호가 변경됐습니다.' })
    setPwNew(''); setPwConfirm('')
    setTimeout(() => setPwMsg(null), 3000)
  }

  const withdraw = async () => {
    setWithdrawing(true); setWithdrawErr(null)

    // 직원이면 사무소 데이터를 대표에게 이전 (법적 책임 보존)
    if (user) {
      const { data: bp } = await supabase.from('broker_profiles')
        .select('id, is_owner, parent_broker_id')
        .eq('user_id', user.id)
        .maybeSingle()
      if (bp && bp.is_owner === false && bp.parent_broker_id) {
        const { error: transferErr } = await transferBrokerData(supabase, bp.id, bp.parent_broker_id)
        if (transferErr) {
          setWithdrawErr(`데이터 이전 실패로 탈퇴를 중단했어요: ${transferErr.message}`)
          setWithdrawing(false)
          return
        }
      }
      // 대표(owner)는 사무소 전체에 영향이 크므로 차단
      if (bp && bp.is_owner === true) {
        setWithdrawErr('대표 회원탈퇴는 직원·매물 정리가 필요합니다. 운영팀에 문의해주세요.')
        setWithdrawing(false)
        return
      }
    }

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

  // 2FA 등록 시작 → QR 코드 표시
  const startEnroll = async () => {
    setMfaBusy(true); setMfaMsg(null)
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', issuer: '빠방', friendlyName: '빠방 TOTP' })
    setMfaBusy(false)
    if (error || !data?.totp) {
      setMfaMsg({ type: 'err', text: '등록 시작에 실패했어요. 다시 시도해주세요.' })
      return
    }
    setMfaEnrollId(data.id)
    setMfaQr(data.totp.qr_code)
    setMfaSecret(data.totp.secret)
    setMfaUri(data.totp.uri)
    setMfaStep('enroll')
    setMfaCode('')
    setTimeout(() => mfaInputRef.current?.focus(), 100)
  }

  // 2FA 등록 확인 (QR 스캔 후 첫 번째 코드 입력)
  const confirmEnroll = async () => {
    if (!mfaEnrollId || mfaCode.length !== 6) return
    setMfaBusy(true); setMfaMsg(null)
    const { data: challenge, error: cErr } = await supabase.auth.mfa.challenge({ factorId: mfaEnrollId })
    if (cErr || !challenge) {
      setMfaMsg({ type: 'err', text: '인증 요청 실패. 다시 시도해주세요.' })
      setMfaBusy(false)
      return
    }
    const { error: vErr } = await supabase.auth.mfa.verify({ factorId: mfaEnrollId, challengeId: challenge.id, code: mfaCode })
    setMfaBusy(false)
    if (vErr) {
      setMfaMsg({ type: 'err', text: '코드가 올바르지 않아요. 인증 앱에서 현재 코드를 다시 확인해주세요.' })
      setMfaCode('')
      mfaInputRef.current?.focus()
      return
    }
    setMfaFactorId(mfaEnrollId)
    setMfaStep('idle')
    setMfaMsg({ type: 'ok', text: '2단계 인증이 활성화됐어요. 다음 로그인부터 적용돼요.' })
    setTimeout(() => setMfaMsg(null), 4000)
  }

  // 2FA 해제
  const unenroll = async () => {
    if (!mfaFactorId) return
    setMfaBusy(true); setMfaMsg(null)
    const { error } = await supabase.auth.mfa.unenroll({ factorId: mfaFactorId })
    setMfaBusy(false)
    if (error) {
      setMfaMsg({ type: 'err', text: '해제에 실패했어요. 다시 시도해주세요.' })
      return
    }
    setMfaFactorId(null)
    setMfaStep('idle')
    setMfaMsg({ type: 'ok', text: '2단계 인증이 해제됐어요.' })
    setTimeout(() => setMfaMsg(null), 3000)
  }

  const copySecret = () => {
    navigator.clipboard.writeText(mfaSecret).then(() => {
      setSecretCopied(true)
      setTimeout(() => setSecretCopied(false), 2000)
    })
  }

  if (loading) return <div className="flex items-center justify-center py-20"><div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" /></div>

  const role = profile?.role ?? 'user'
  const roleLabel = role === 'broker' ? { text: '공인중개사', color: 'bg-blue-100 text-blue-700' }
    : role === 'admin' ? { text: '관리자', color: 'bg-red-100 text-red-700' }
    : { text: '일반 회원', color: 'bg-gray-100 text-gray-600' }

  return (
    <div className="space-y-4">
      {/* 프로필 헤더 */}
      <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6">
        <div className="flex items-center gap-4 pb-5 border-b border-gray-100 dark:border-gray-800">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-blue-100 text-blue-600 text-xl font-bold flex-shrink-0">
            {(name || user?.email || '?')[0].toUpperCase()}
          </div>
          <div>
            <p className="font-bold text-gray-900 dark:text-white text-lg">{name || '이름 없음'}</p>
            <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${roleLabel.color}`}>{roleLabel.text}</span>
          </div>
        </div>
        <div className="divide-y divide-gray-50">
          <div className="flex items-center gap-3 py-3">
            <Mail className="h-4 w-4 text-gray-500 flex-shrink-0" />
            <span className="text-sm text-gray-500 w-20 flex-shrink-0">이메일</span>
            <span className="text-sm text-gray-800 dark:text-gray-100">{user?.email}</span>
          </div>
          <div className="flex items-center gap-3 py-3">
            <Calendar className="h-4 w-4 text-gray-500 flex-shrink-0" />
            <span className="text-sm text-gray-500 w-20 flex-shrink-0">가입일</span>
            <span className="text-sm text-gray-800 dark:text-gray-100">{profile?.created_at ? new Date(profile.created_at).toLocaleDateString('ko-KR') : '—'}</span>
          </div>
        </div>
      </div>

      {/* 정보 수정 */}
      <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6">
        <h2 className="mb-4 font-bold text-gray-900 dark:text-white flex items-center gap-2"><User className="h-4 w-4 text-gray-500" /> 정보 수정</h2>
        <div className="space-y-3">
          <div>
            <label htmlFor="account-name" className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">이름</label>
            <input id="account-name" value={name} onChange={e => setName(e.target.value)} placeholder="이름"
              className="w-full rounded-xl border border-gray-200 dark:border-gray-800 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
          </div>
          <div>
            <label htmlFor="account-phone" className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">전화번호</label>
            <input id="account-phone" type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="010-0000-0000"
              className="w-full rounded-xl border border-gray-200 dark:border-gray-800 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
          </div>
        </div>
        {msg && (
          <div className={`mt-3 flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${msg.type === 'ok' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
            {msg.type === 'ok' ? <Check className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
            {msg.text}
          </div>
        )}
        <button onClick={save} disabled={saving}
          className="mt-4 w-full rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 transition-colors">
          {saving ? '저장 중...' : '저장'}
        </button>
      </div>

      {/* 비밀번호 변경 */}
      <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6">
        <h2 className="mb-4 font-bold text-gray-900 dark:text-white flex items-center gap-2">
          <Lock className="h-4 w-4 text-gray-500" /> 비밀번호 변경
        </h2>
        <div className="space-y-3">
          <div>
            <label htmlFor="account-pw-new" className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">새 비밀번호</label>
            <input id="account-pw-new" type="password" autoComplete="new-password" value={pwNew} onChange={e => setPwNew(e.target.value)} placeholder="8자 이상"
              className="w-full rounded-xl border border-gray-200 dark:border-gray-800 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
          </div>
          <div>
            <label htmlFor="account-pw-confirm" className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">새 비밀번호 확인</label>
            <input id="account-pw-confirm" type="password" autoComplete="new-password" value={pwConfirm} onChange={e => setPwConfirm(e.target.value)} placeholder="비밀번호 재입력"
              className="w-full rounded-xl border border-gray-200 dark:border-gray-800 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
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

      {/* 2단계 인증 (2FA) */}
      <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6">
        <h2 className="mb-1 font-bold text-gray-900 dark:text-white flex items-center gap-2">
          {mfaFactorId
            ? <ShieldCheck className="h-4 w-4 text-green-500" />
            : <Shield className="h-4 w-4 text-gray-500" />}
          2단계 인증 (2FA)
          {mfaFactorId && (
            <span className="ml-1 rounded-full bg-green-100 dark:bg-green-900/30 px-2 py-0.5 text-xs font-semibold text-green-700 dark:text-green-400">활성화</span>
          )}
        </h2>
        <p className="mb-4 text-sm text-gray-500">
          {mfaFactorId
            ? '로그인 시 인증 앱에서 6자리 코드를 추가로 입력해요.'
            : 'Google Authenticator · Authy 등 인증 앱으로 로그인 보안을 강화해요.'}
        </p>

        {/* 등록 플로우 */}
        {mfaStep === 'enroll' && (
          <div className="mb-4 rounded-xl border border-gray-100 dark:border-gray-800 p-4 space-y-4">
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
              1. 인증 앱(Google Authenticator / Authy)으로 아래 QR 코드를 스캔하세요.
            </p>
            {mfaQr && (
              <div className="flex justify-center">
                <div
                  className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white p-3 inline-block"
                  dangerouslySetInnerHTML={{ __html: mfaQr }}
                />
              </div>
            )}
            <div className="rounded-lg bg-gray-50 dark:bg-gray-800 p-3">
              <p className="text-xs text-gray-500 mb-1.5">QR 스캔이 안 되면 아래 키를 직접 입력하세요</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-xs font-mono text-gray-700 dark:text-gray-200 break-all">{mfaSecret}</code>
                <button type="button" onClick={copySecret}
                  className="flex-shrink-0 rounded-lg border border-gray-200 dark:border-gray-700 p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
                  {secretCopied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5 text-gray-500" />}
                </button>
              </div>
            </div>
            <div>
              <p className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                2. 앱에 표시된 6자리 코드를 입력해 등록을 완료하세요.
              </p>
              <input
                ref={mfaInputRef}
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="000000"
                value={mfaCode}
                onChange={e => setMfaCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                maxLength={6}
                className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-3 text-center text-xl font-mono tracking-[0.35em] focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:text-white"
              />
            </div>
            <div className="flex gap-2">
              <button onClick={() => { setMfaStep('idle'); setMfaMsg(null) }}
                className="flex-1 rounded-xl border border-gray-200 dark:border-gray-700 py-2.5 text-sm font-medium text-gray-600 dark:text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                취소
              </button>
              <button onClick={confirmEnroll} disabled={mfaBusy || mfaCode.length !== 6}
                className="flex-1 rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 transition-colors">
                {mfaBusy ? '확인 중...' : '등록 완료'}
              </button>
            </div>
          </div>
        )}

        {mfaMsg && (
          <div className={`mb-4 flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${mfaMsg.type === 'ok' ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400' : 'bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400'}`}>
            {mfaMsg.type === 'ok' ? <Check className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
            {mfaMsg.text}
          </div>
        )}

        {mfaStep === 'idle' && (
          mfaFactorId
            ? <button onClick={unenroll} disabled={mfaBusy}
                className="flex items-center gap-2 rounded-xl border border-red-200 dark:border-red-800 px-4 py-2 text-sm font-medium text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50 transition-colors">
                <ShieldOff className="h-4 w-4" />
                {mfaBusy ? '해제 중...' : '2단계 인증 해제'}
              </button>
            : <button onClick={startEnroll} disabled={mfaBusy}
                className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 transition-colors">
                <Shield className="h-4 w-4" />
                {mfaBusy ? '준비 중...' : '2단계 인증 설정'}
              </button>
        )}
      </div>

      {/* 회원탈퇴 */}
      <div className="rounded-2xl border border-red-100 bg-white dark:bg-gray-900 p-6">
        <h2 className="mb-1 font-bold text-gray-900 dark:text-white flex items-center gap-2">
          <Trash2 className="h-4 w-4 text-red-400" /> 회원탈퇴
        </h2>
        <p className="mb-4 text-sm text-gray-500">탈퇴 시 모든 데이터가 삭제되며 복구할 수 없어요.</p>
        <button onClick={() => { setShowWithdraw(true); setWithdrawErr(null) }}
          className="rounded-xl border border-red-200 px-4 py-2 text-sm font-medium text-red-500 hover:bg-red-50 transition-colors">
          탈퇴하기
        </button>
      </div>

      {showWithdraw && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-gray-900 p-6 shadow-xl">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-100 mx-auto">
              <Trash2 className="h-6 w-6 text-red-500" />
            </div>
            <h3 className="text-center text-lg font-bold text-gray-900 dark:text-white mb-2">정말 탈퇴하시겠어요?</h3>
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
                className="flex-1 rounded-xl border border-gray-200 dark:border-gray-800 py-2.5 text-sm font-medium text-gray-600 dark:text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 dark:bg-gray-950 transition-colors">
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
