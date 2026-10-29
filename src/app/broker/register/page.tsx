'use client'

import { useEffect, useId, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useAuth, type BrokerProfile } from '@/lib/auth-context'
import { Header } from '@/components/layout/header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardBody } from '@/components/ui/card'
import { Spinner } from '@/components/ui/spinner'
import { Shield, CheckCircle, Users, Building2, AlertCircle, ShieldCheck } from 'lucide-react'
import { cn } from '@/lib/utils'
import { seedRegionFromAddress } from '@/lib/region-from-address'
import {
  normalizeOfficeForm, validateOfficeForm, officeSaveError, isBusinessNumber, formatBusinessNumber,
  bizVerifyMessage, verificationState, verificationCopy, NUMBER_TAKEN_MESSAGE, type OfficeForm, type OfficeFormErrors,
} from '@/lib/broker-office'

export default function BrokerRegisterPage() {
  const router = useRouter()
  const supabase = createClient()
  const { loading: authLoading, user: authUser, broker: authBroker, refresh } = useAuth()

  const [joinType, setJoinType] = useState<'owner' | 'employee'>('owner')

  // 대표 폼
  const [form, setForm] = useState<OfficeForm>({
    office_name: '',
    license_number: '',
    office_reg_number: '',
    business_reg_number: '',
    address: '',
  })
  const [fieldErrors, setFieldErrors] = useState<OfficeFormErrors>({})

  // 직원 폼
  const [officeCode, setOfficeCode] = useState('')
  const officeCodeId = useId()
  const [codePreview, setCodePreview] = useState<{ office_name: string; address: string } | null>(null)
  const [codeChecking, setCodeChecking] = useState(false)
  const [codeError, setCodeError] = useState('')

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  // 개설을 마친 사무소 — 대시보드로 말없이 넘기지 않고 완료 안내를 먼저 보여 준다
  const [done, setDone] = useState<{ officeName: string; verified: boolean } | null>(null)

  // 들어올 때 사무소 정보를 한 번 새로 읽는다. 다른 화면이 옛 'broker 없음' 값으로 여기로 보냈을 수 있고,
  // 이미 등록한 사람에게 빈 양식을 다시 보여 주면 같은 값으로 또 신청해 '등록 중 오류'(409)만 봤다.
  const [checked, setChecked] = useState(false)
  const refreshed = useRef(false)
  useEffect(() => {
    if (authLoading || refreshed.current) return
    refreshed.current = true
    if (!authUser) { setChecked(true); return }
    refresh().catch(() => {}).finally(() => setChecked(true))
  }, [authLoading, authUser, refresh])

  // 사무소를 탈퇴한 직원(parent 없음·대표 아님)은 다시 합류해야 하므로 양식을 그대로 보여 준다
  const existing: BrokerProfile | null =
    authBroker && !(authBroker.is_owner === false && !authBroker.parent_broker_id) ? authBroker : null
  // 탈퇴한 직원 — broker_profiles 행이 남아 있어(parent 만 비움) 대표 개설은 user_id 유니크에, 직원 합류는
  // join_office_by_code 의 already_registered 에 막힌다. 양식은 보여 주되 '이미 사무소가 있다'는 거짓말 대신
  // 사실대로 알린다(운영에 4계정). 탈퇴 RPC 가 행을 지우거나 합류 RPC 가 이 행을 재사용하도록 고쳐야 풀린다.
  const leftOffice = !!authBroker && !existing
  const LEFT_OFFICE_MESSAGE = '사무소를 탈퇴한 계정은 지금 바로 다시 등록할 수 없어요. 고객센터로 문의해 주세요.'

  // 사업자번호 검증
  const [bizVerifying, setBizVerifying] = useState(false)
  const [bizResult, setBizResult] = useState<{ ok: boolean; isActive?: boolean; status?: { b_stt?: string }; error?: string } | null>(null)

  const verifyBusiness = async () => {
    if (!isBusinessNumber(form.business_reg_number)) { setBizResult({ ok: false, error: bizVerifyMessage('invalid_business_number') }); return }
    setBizVerifying(true); setBizResult(null)
    try {
      const r = await fetch('/api/brokers/verify-business', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessNumber: form.business_reg_number }),
      })
      const j = await r.json().catch(() => ({}))
      // 서버가 준 코드(config_missing_… 등)는 화면에 그대로 쓰지 않고 다음 할 일로 바꿔 보여 준다
      if (!r.ok) setBizResult({ ok: false, error: bizVerifyMessage(j.error) })
      else setBizResult({ ok: true, isActive: j.isActive, status: j.status })
    } catch {
      setBizResult({ ok: false, error: bizVerifyMessage(null) })
    }
    setBizVerifying(false)
  }

  const update = (key: keyof OfficeForm, value: string) => {
    setForm(prev => ({ ...prev, [key]: value }))
    setFieldErrors(prev => (prev[key] ? { ...prev, [key]: undefined } : prev))
    setError('')
    if (key === 'business_reg_number') setBizResult(null)
  }

  const handleCodeChange = async (val: string) => {
    const v = val.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6)
    setOfficeCode(v)
    setCodeError('')
    setCodePreview(null)
    if (v.length === 6) {
      setCodeChecking(true)
      try {
        // 코드는 정책 없는 office_join_codes 에만 있다(예전처럼 broker_profiles 에서 코드로 찾으면
        // 로그인한 누구나 모든 사무소 코드를 읽을 수 있었다). 맞는 코드일 때만 사무소명·주소가 온다.
        const { data, error } = await supabase.rpc('preview_office_by_code', { p_code: v })
        const office = Array.isArray(data) ? (data[0] as { office_name: string; address: string } | undefined) : undefined
        if (error) {
          setCodeError('조회 중 오류가 발생했습니다.')
        } else if (office) {
          setCodePreview({ office_name: office.office_name, address: office.address })
        } else {
          setCodeError('등록된 사무소 코드가 아닙니다.')
        }
      } catch {
        setCodeError('조회 중 오류가 발생했습니다.')
      }
      setCodeChecking(false)
    }
  }

  // 직원 등록
  const handleEmployeeSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!codePreview) { setError('사무소 코드를 확인해주세요.'); return }
    setLoading(true); setError('')
    try {
      const { data: authData } = await supabase.auth.getUser()
      const user = authData.user
      if (!user) { router.push('/auth/login'); return }

      // 사무소 주소 → 시·군·구 자동 추출해 alert_regions 시드 (실패해도 빈 배열로 진행)
      const seed = await seedRegionFromAddress(codePreview.address)

      // 합류는 원자적 RPC로 처리: 직원 프로필 생성 + 대표 코드 1회용 재발급 + role 전환.
      // (코드 재발급은 남(대표)의 행 UPDATE라 클라이언트 RLS로는 막혀 조용히 실패했었음 → DEFINER로 일원화)
      const { data: joinRes, error: joinError } = await supabase.rpc('join_office_by_code', {
        p_code: officeCode,
        p_alert_regions: seed ? [seed] : [],
      })
      if (joinError || !(joinRes as { ok?: boolean } | null)?.ok) {
        const msg = joinError?.message ?? ''
        if (msg.includes('already_registered')) {
          // 이미 프로필이 있으면 양식 대신 지금 상태를 보여 준다(아래 existing 분기).
          // 탈퇴한 직원은 재조회해도 양식이 남으니 왜 안 되는지와 다음 할 일을 말해 준다.
          await refresh().catch(() => {})
          setError(leftOffice ? LEFT_OFFICE_MESSAGE : '이미 등록된 계정입니다.')
        } else {
          setError(msg.includes('invalid_code') ? '사무소 코드를 다시 확인해주세요.' : '등록 중 오류가 발생했습니다.')
        }
        setLoading(false)
        return
      }
      // 화면에 든 broker=null 을 새 값으로 바꾼 뒤에 이동한다 — 안 그러면 승인 뒤 매물목록 등이 등록 화면으로 튕긴다
      await refresh().catch(() => {})
      router.push('/broker/register/pending')
    } catch {
      setError('오류가 발생했습니다. 잠시 후 다시 시도해주세요.')
      setLoading(false)
    }
  }

  // 빨간 칸으로 데려간다 — 폰에선 오류 칸이 화면 위에 있어, 아래 '빨간 글씨' 안내만 보고 어느 칸인지 몰랐다
  const ownerFormRef = useRef<HTMLFormElement>(null)
  const focusFirstError = () => requestAnimationFrame(() => {
    const el = ownerFormRef.current?.querySelector<HTMLInputElement>('[aria-invalid="true"]')
    el?.scrollIntoView({ block: 'center' })
    el?.focus({ preventScroll: true })
  })

  // 대표 등록
  const handleOwnerSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    // 공백만 넣은 상호명·엉터리 번호·태그 주소가 그대로 저장됐다 → 정리한 값으로 칸별 검사
    const clean = normalizeOfficeForm(form)
    setForm(clean)
    const errs = validateOfficeForm(clean)
    setFieldErrors(errs)
    if (Object.keys(errs).length) { setError('빨간 글씨가 있는 칸을 확인해 주세요.'); focusFirstError(); return }

    setLoading(true); setError('')
    try {
      const { data: authData } = await supabase.auth.getUser()
      const user = authData.user
      if (!user) { router.push('/auth/login'); return }

      // 두 번호의 중복을 한꺼번에 본다 — 등록은 겹치는 첫 칸 하나만 알려 줘서, 사업자번호를 고쳐
      // 다시 내면 그제야 자격증 번호가 걸렸다. 확인이 안 되면(망 오류) 그대로 등록해 409 로 받는다.
      const dup = await fetch('/api/brokers/check-numbers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ license_number: clean.license_number, business_reg_number: clean.business_reg_number }),
      }).then(r => (r.ok ? r.json() : null), () => null) as { taken?: Array<keyof typeof NUMBER_TAKEN_MESSAGE> } | null
      if (dup?.taken?.length) {
        const errs: OfficeFormErrors = {}
        for (const field of dup.taken) errs[field] = NUMBER_TAKEN_MESSAGE[field]
        setFieldErrors(errs)
        setError('빨간 글씨가 있는 칸을 확인해 주세요.')
        setLoading(false)
        focusFirstError()
        return
      }

      // 사무소 주소 → 시·군·구 자동 추출해 alert_regions 시드 (실패해도 빈 배열로 진행)
      const seed = await seedRegionFromAddress(clean.address)

      const { error: insertError } = await supabase.from('broker_profiles').insert({
        user_id: user.id,
        office_name: clean.office_name,
        license_number: clean.license_number,
        office_reg_number: clean.office_reg_number,
        business_reg_number: clean.business_reg_number,
        address: clean.address,
        district: '',
        rating: 0, review_count: 0, deal_count: 0,
        is_verified: false,
        is_owner: true,
        is_approved: true,
        alert_regions: seed ? [seed] : [],
      })
      if (insertError) {
        // 409 를 가려 읽는다 — 이미 등록한 계정 / 남이 쓰는 자격증 번호 / 남이 쓰는 사업자번호
        const m = officeSaveError(insertError)
        if (m.alreadyRegistered) {
          await refresh().catch(() => {})
          // 탈퇴한 직원의 409 는 '이미 사무소가 있다'가 아니다 — 사무소가 없는데 그렇게 말하면 계속 다시 누른다
          if (leftOffice) { setError(LEFT_OFFICE_MESSAGE); setLoading(false); return }
        }
        // 칸 문구와 같은 말을 두 번 띄우지 않는다 — 아래 상자는 어느 칸인지만 가리킨다
        if (m.field) setFieldErrors({ [m.field]: m.message })
        setError(m.field ? '빨간 글씨가 있는 칸을 확인해 주세요.' : m.message)
        setLoading(false)
        if (m.field) focusFirstError()
        return
      }

      await supabase.from('profiles').update({ role: 'broker' }).eq('id', user.id)

      // 자동 인증: 사업자(국세청)+중개사무소 등록번호(국토부) 서버 재검증 → 통과 시 배지 자동 부여.
      // 안 되면(키 미설정·불일치·망 오류) 관리자 수동 인증으로 넘어간다 — 결과는 완료 안내에 그대로 알린다.
      let verified = false
      try {
        const r = await fetch('/api/brokers/auto-verify', { method: 'POST' })
        const j = await r.json().catch(() => null) as { verified?: boolean } | null
        verified = r.ok && j?.verified === true
      } catch {}

      // 화면에 든 'broker 없음'을 새 사무소로 바꾼 뒤에 다음 화면으로 보낸다. 예전엔 바로 대시보드로
      // 넘어가, 매물목록·고객목록·업무일지를 누르면 빈 등록 양식으로 튕겼다(다시 로그인해야 풀림).
      await refresh().catch(() => {})
      setDone({ officeName: clean.office_name, verified })
      setLoading(false)
    } catch {
      setError('오류가 발생했습니다. 잠시 후 다시 시도해주세요.')
      setLoading(false)
    }
  }

  const ownerReady = !!(form.office_name.trim() && form.license_number.trim() && form.office_reg_number.trim()
    && form.business_reg_number.trim() && form.address.trim())
  const bizNumberOk = isBusinessNumber(form.business_reg_number)

  let body: React.ReactNode
  if (authLoading || !checked) {
    body = <div className="flex items-center justify-center py-20"><Spinner size="md" /></div>
  } else if (done) {
    body = <OfficeOpened officeName={done.officeName} verified={done.verified} />
  } else if (existing && !loading) {
    body = <AlreadyRegistered broker={existing} />
  } else {
    body = (
      <>
        <div className="mb-6 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-600">
            <Shield className="h-8 w-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">중개사 등록</h1>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">등록 완료 후 서비스를 이용할 수 있습니다</p>
        </div>

        {/* 탈퇴한 직원은 어느 쪽으로 신청해도 막힌다 — 양식을 다 채운 뒤에야 알게 하지 않는다 */}
        {leftOffice && (
          <div className="mb-4 flex items-start gap-3 rounded-xl border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
            <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-yellow-500" />
            <span>{LEFT_OFFICE_MESSAGE}</span>
          </div>
        )}

        {/* 가입 유형 선택 */}
        <div className="mb-4 grid grid-cols-2 gap-3">
          {[
            { value: 'owner', label: '사무소 대표', icon: Building2, desc: '새 사무소 개설' },
            { value: 'employee', label: '소속 직원', icon: Users, desc: '사무소 코드로 합류' },
          ].map((opt) => (
            <button key={opt.value} type="button"
              onClick={() => { setJoinType(opt.value as 'owner' | 'employee'); setError('') }}
              className={cn('rounded-xl border-2 p-4 text-left transition-all',
                joinType === opt.value ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'
              )}>
              <opt.icon className={cn('mb-2 h-5 w-5', joinType === opt.value ? 'text-blue-600' : 'text-gray-500')} />
              <div className={cn('font-semibold text-sm', joinType === opt.value ? 'text-blue-700' : 'text-gray-700')}>
                {opt.label}
              </div>
              <div className="text-xs text-gray-500 mt-0.5">{opt.desc}</div>
            </button>
          ))}
        </div>

        {/* ── 직원 등록 ── */}
        {joinType === 'employee' && (
          <Card>
            <CardBody>
              <div className="mb-4 flex items-center gap-3 rounded-xl bg-blue-50 px-4 py-3 text-sm text-blue-700">
                <CheckCircle className="h-5 w-5 flex-shrink-0" />
                <span>사무소 대표에게 <strong>6자리 코드</strong>를 받아 입력해주세요</span>
              </div>
              <form onSubmit={handleEmployeeSubmit} className="space-y-4">
                <div>
                  <label htmlFor={officeCodeId} className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">사무소 코드</label>
                  <input id={officeCodeId} type="text" value={officeCode}
                    onChange={(e) => handleCodeChange(e.target.value)}
                    placeholder="예: A1B2C3" maxLength={6}
                    className="w-full rounded-xl border border-gray-200 dark:border-gray-800 px-4 py-3 text-center text-xl font-mono font-bold tracking-widest text-gray-900 dark:text-white focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 uppercase"
                  />
                  {codeChecking && <p className="mt-1.5 text-xs text-gray-500">조회 중...</p>}
                  {codeError && <p className="mt-1.5 text-xs text-red-500">⚠️ {codeError}</p>}
                  {codePreview && (
                    <div className="mt-2 rounded-xl bg-green-50 border border-green-200 px-4 py-3">
                      <div className="flex items-center gap-2 mb-1">
                        <CheckCircle className="h-4 w-4 text-green-600" />
                        <span className="text-sm font-semibold text-green-700">사무소 확인 완료</span>
                      </div>
                      <p className="text-sm font-bold text-gray-900 dark:text-white">{codePreview.office_name}</p>
                      <p className="text-xs text-gray-500">{codePreview.address}</p>
                    </div>
                  )}
                </div>
                {error && <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">⚠️ {error}</div>}
                <Button type="submit" size="lg" className="w-full" loading={loading} disabled={!codePreview}>
                  소속 직원으로 등록 신청
                </Button>
              </form>
            </CardBody>
          </Card>
        )}

        {/* ── 대표 등록 ── */}
        {joinType === 'owner' && (
          <Card>
            <CardBody>
              <p className="mb-4 text-xs text-gray-500">* 표시는 꼭 적어야 하는 칸이에요.</p>
              <form ref={ownerFormRef} onSubmit={handleOwnerSubmit} className="space-y-4" noValidate>
                <Input label="부동산 상호명 *" placeholder="예: 행복부동산" maxLength={50}
                  value={form.office_name} onChange={(e) => update('office_name', e.target.value)}
                  error={fieldErrors.office_name} required />
                <Input label="사무소 주소 *" placeholder="서울시 강남구 역삼동 123-45" maxLength={120}
                  value={form.address} onChange={(e) => update('address', e.target.value)}
                  error={fieldErrors.address} required />
                <Input label="공인중개사 자격증 번호 *" placeholder="예: 제20-XXXXX호" maxLength={40}
                  value={form.license_number} onChange={(e) => update('license_number', e.target.value)}
                  error={fieldErrors.license_number} required />
                <Input label="중개사무소 등록번호 *" placeholder="예: 11680-2024-00123" maxLength={40}
                  value={form.office_reg_number} onChange={(e) => update('office_reg_number', e.target.value)}
                  error={fieldErrors.office_reg_number} required />
                <div>
                  <Input label="사업자등록번호 *" placeholder="예: 123-45-67890" inputMode="numeric" maxLength={14}
                    value={form.business_reg_number} onChange={(e) => update('business_reg_number', e.target.value)}
                    onBlur={() => {
                      const f = formatBusinessNumber(form.business_reg_number)
                      if (f !== form.business_reg_number) update('business_reg_number', f)
                    }}
                    error={fieldErrors.business_reg_number} required />
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {/* 숫자 10자리가 아니면 물어볼 것도 없다 — 버튼을 끈다 */}
                    <button type="button" onClick={verifyBusiness} disabled={bizVerifying || !bizNumberOk}
                      className="min-h-[44px] rounded-lg border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm font-semibold text-blue-700 hover:bg-blue-100 disabled:opacity-50 transition-colors">
                      {bizVerifying ? '확인 중...' : '국세청 사업자 확인 (선택)'}
                    </button>
                    {bizResult && (
                      bizResult.ok
                        ? <span className={`text-xs font-semibold ${bizResult.isActive ? 'text-green-600' : 'text-orange-600'}`}>
                            {bizResult.isActive ? '✅ 계속사업자' : `⚠ ${bizResult.status?.b_stt ?? '확인 필요'}`}
                          </span>
                        : <span className="text-xs text-orange-700">{bizResult.error}</span>
                    )}
                  </div>
                  {!bizResult && (
                    <p className="mt-1 text-xs text-gray-500">확인하지 않아도 신청할 수 있어요. 신청하면 관리자가 확인해요.</p>
                  )}
                </div>

                {error && <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">⚠️ {error}</div>}

                <Button type="submit" size="lg" className="w-full" loading={loading} disabled={!ownerReady}>
                  중개사 등록 신청
                </Button>
              </form>
            </CardBody>
          </Card>
        )}
      </>
    )
  }

  return (
    <div className="bg-gray-50 dark:bg-gray-950">
      <Header />
      <div className="mx-auto max-w-2xl px-4 py-10">{body}</div>
    </div>
  )
}

// 인증 상태 상자 — 설정 > 사무소의 노란·초록 상자와 같은 모양
function VerificationBox({ broker }: { broker: { is_verified?: boolean | null; verification_info?: unknown } }) {
  const copy = verificationCopy(verificationState(broker))
  const ok = copy.tone === 'ok'
  return (
    <div className={cn('flex items-start gap-3 rounded-2xl border px-4 py-3 text-left',
      ok ? 'border-green-200 bg-green-50' : 'border-yellow-200 bg-yellow-50')}>
      {ok
        ? <ShieldCheck className="h-5 w-5 text-green-500 flex-shrink-0 mt-0.5" />
        : <AlertCircle className="h-5 w-5 text-yellow-500 flex-shrink-0 mt-0.5" />}
      <div>
        <p className={cn('text-sm font-bold', ok ? 'text-green-700' : 'text-yellow-800')}>{copy.title}</p>
        <p className={cn('text-xs mt-0.5', ok ? 'text-green-700' : 'text-yellow-700')}>{copy.body}</p>
      </div>
    </div>
  )
}

// 개설 완료 안내 — 예전엔 아무 말 없이 대시보드로 넘어가 '된 건지, 심사 중인지'를 알 수 없었다
function OfficeOpened({ officeName, verified }: { officeName: string; verified: boolean }) {
  // 신청 버튼은 양식 맨 아래라, 그 자리 그대로면 폰에서는 완료 제목이 화면 위로 지나가 있다
  const top = useRef<HTMLDivElement>(null)
  useEffect(() => { top.current?.scrollIntoView({ block: 'start' }) }, [])
  return (
    <div ref={top} className="mx-auto max-w-md scroll-mt-20 text-center">
      <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-green-100">
        <CheckCircle className="h-10 w-10 text-green-500" />
      </div>
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">사무소가 개설됐어요</h1>
      <p className="mb-6 text-sm text-gray-500">{officeName}</p>
      <VerificationBox broker={{ is_verified: verified, verification_info: null }} />
      {!verified && (
        <p className="mt-2 text-left text-xs text-gray-500">자동 확인이 되지 않아 관리자가 직접 확인해요.</p>
      )}
      <div className="mt-6 flex flex-col gap-2">
        <Link href="/broker/properties?new=1">
          <Button size="lg" className="w-full">첫 매물 등록하기</Button>
        </Link>
        <Link href="/dashboard/broker">
          <Button variant="outline" size="lg" className="w-full">대시보드로</Button>
        </Link>
      </div>
    </div>
  )
}

// 이미 등록한 계정 — 같은 값으로 다시 신청해 409 를 보게 하지 않고 지금 상태와 갈 곳을 보여 준다
function AlreadyRegistered({ broker }: { broker: BrokerProfile }) {
  const isOwner = broker.is_owner !== false
  const waitingOwnerApproval = !isOwner && broker.is_approved === false
  return (
    <div className="mx-auto max-w-md">
      <Card>
        <CardBody>
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl bg-blue-100 dark:bg-blue-500/20">
              <Building2 className="h-6 w-6 text-blue-700 dark:text-blue-400" />
            </div>
            <div className="min-w-0">
              <h1 className="text-lg font-bold text-gray-900 dark:text-white">이미 등록된 계정이에요</h1>
              <p className="truncate text-sm text-gray-500">
                {[broker.office_name, isOwner ? '사무소 대표' : '소속 직원'].filter(Boolean).join(' · ')}
              </p>
            </div>
          </div>

          {isOwner ? (
            <VerificationBox broker={broker} />
          ) : (
            // 문구는 대시보드의 직원 배너와 같게
            <div className={cn('rounded-2xl border px-4 py-3',
              waitingOwnerApproval ? 'border-yellow-200 bg-yellow-50' : 'border-green-200 bg-green-50')}>
              <p className={cn('text-sm font-bold', waitingOwnerApproval ? 'text-yellow-800' : 'text-green-700')}>
                {waitingOwnerApproval ? '승인 대기 중' : '소속 사무소 직원'}
              </p>
              {waitingOwnerApproval && (
                <p className="text-xs mt-0.5 text-yellow-700">대표가 아직 등록 신청을 승인하지 않았어요. 대표에게 문의해주세요.</p>
              )}
            </div>
          )}

          <div className="mt-5 flex flex-col gap-2">
            {waitingOwnerApproval ? (
              <Link href="/broker/register/pending">
                <Button size="lg" className="w-full">승인 상태 보기</Button>
              </Link>
            ) : (
              <>
                <Link href="/broker/properties">
                  <Button size="lg" className="w-full">매물목록 열기</Button>
                </Link>
                <Link href="/dashboard/broker">
                  <Button variant="outline" size="lg" className="w-full">대시보드로</Button>
                </Link>
              </>
            )}
            {isOwner && (
              <Link href="/settings/office" className="mt-1 text-center text-sm text-blue-600 hover:underline">
                사무소 정보 보기
              </Link>
            )}
          </div>
        </CardBody>
      </Card>
    </div>
  )
}
