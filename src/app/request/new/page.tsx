'use client'

import { useState, useEffect, useId, useRef, useCallback, Suspense } from 'react'
import type { User } from '@supabase/supabase-js'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Header } from '@/components/layout/header'
import { cn } from '@/lib/utils'
import { todayKST } from '@/lib/date-kst'
import {
  DEAL_TYPES, REQUEST_STEPS as STEPS, EMPTY_REQUEST_FORM, REQUEST_SAVED_FLASH_KEY,
  priceLabel, isMixedPrice, pricePlaceholders, budgetErrors, sizeErrors, moveInDateError,
  stepIssues, clampStep, firstIssueStep, toRequestPayload, describeSaveError, rangeText,
  serializeDraft, parseDraft, hasDraftContent, readStepHistory, withStepHistory, makeSavedFlash,
  type RequestForm,
} from '@/lib/request-validation'
import { CheckCircle, ChevronRight, ChevronLeft, Home, AlertCircle, RotateCcw } from 'lucide-react'
import { RegionPicker, type RegionValue } from '@/components/region-picker'
import { CUSTOMER_PROPERTY_CATEGORIES } from '@/lib/property-types'

function RequestNewPageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const isCoBroker = searchParams.get('co_broker') === 'true'
  const supabase = createClient()
  const [step, setStep] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  // 이 단계에서 '다음'을 한 번 눌러 봤는가 — 빈칸 경고는 그 뒤에만 띄운다
  const [attempted, setAttempted] = useState(false)

  // 역할 체크 — 중개사/관리자는 일반 요청 등록 불가 (공동중개 요청은 중개사도 허용)
  useEffect(() => {
    if (isCoBroker) return  // 공동중개 요청은 중개사 본인이 작성하는 게 정상
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return
      supabase.from('profiles').select('role').eq('id', user.id).single().then(({ data }) => {
        if (data?.role === 'broker') router.replace('/dashboard/broker')
        else if (data?.role === 'admin') router.replace('/admin')
      })
    })
  }, [isCoBroker])

  // 다중 선택
  const [dealTypes, setDealTypes] = useState<string[]>([])
  const [propertyTypes, setPropertyTypes] = useState<string[]>([])

  const [region, setRegion] = useState<RegionValue | null>(null)
  const descriptionId = useId()
  // min_price/max_price 는 DB 에 한 쌍뿐 — 고른 거래 유형에 따라 매매가·전세금·보증금을 뜻한다(priceLabel)
  const [form, setForm] = useState<RequestForm>(EMPTY_REQUEST_FORM)

  const update = (key: keyof RequestForm, value: string) =>
    setForm(prev => ({ ...prev, [key]: value }))

  // 다중 선택 토글
  const toggleDealType = (type: string) =>
    setDealTypes(prev =>
      prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]
    )

  const togglePropertyType = (type: string) =>
    setPropertyTypes(prev =>
      prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]
    )

  const today = todayKST()
  const draft = { dealTypes, propertyTypes, region, form }
  const issues = stepIssues(step, draft, today)
  const budgetErr = budgetErrors(form, dealTypes, { requireFilled: attempted })
  const sizeErr = sizeErrors(form)
  const dateErr = moveInDateError(form.move_in_date, today)
  const pricePh = pricePlaceholders(dealTypes)

  // ── 작성 중 임시 저장 + 브라우저 '뒤로' = 이전 단계 ──
  // 새로고침하면 고른 것이 다 사라지고, '뒤로'는 대시보드로 나갔다.
  const draftKey = isCoBroker ? 'request-new-draft:co-broker' : 'request-new-draft'
  const [restored, setRestored] = useState(false) // 복원 전에 저장하면 빈 값으로 덮어쓴다
  const [resumed, setResumed] = useState(false)
  const submittedRef = useRef(false)
  const latestDraft = useRef(draft)
  latestDraft.current = draft

  useEffect(() => {
    let saved = null
    try { saved = parseDraft(window.sessionStorage.getItem(draftKey)) } catch { /* 저장소가 막힌 브라우저 — 새로 쓴다 */ }
    // 새로고침해도 history.state 는 남아 있어, 보던 단계를 거기서 읽는다
    const hist = readStepHistory(window.history.state)
    let s = 0
    if (saved) {
      setDealTypes(saved.dealTypes)
      setPropertyTypes(saved.propertyTypes)
      setRegion(saved.region)
      setForm(saved.form)
      s = clampStep(hist.step ?? saved.step, saved, todayKST())
      setResumed(hasDraftContent(saved))
    }
    setStep(s)
    window.history.replaceState(withStepHistory(window.history.state, s, Math.min(hist.base ?? s, s)), '')
    setRestored(true)
  }, [draftKey])

  useEffect(() => {
    if (!restored || submittedRef.current) return
    try {
      window.sessionStorage.setItem(draftKey, serializeDraft({ step, dealTypes, propertyTypes, region, form }))
    } catch { /* 저장 못 해도 작성은 계속 */ }
  }, [restored, draftKey, step, dealTypes, propertyTypes, region, form])

  useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      // 저장 뒤 기록을 되감는 중(collapseStepHistory) — 상세로 가기 직전에 이전 단계를 그리지 않는다
      if (submittedRef.current) return
      const { step: s } = readStepHistory(e.state)
      if (s == null) return
      // 앞으로 가기로 빈 단계를 건너뛰지 않게(예: 2단계에서 지역을 지우고 앞으로 가기)
      const safe = clampStep(s, latestDraft.current, todayKST())
      setStep(safe)
      setAttempted(false)
      if (safe !== s) window.history.replaceState(withStepHistory(window.history.state, safe), '')
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  // 폰에서 고정한 버튼 바만큼 본문 아래를 비운다 — 이유 문구가 뜨면 바가 커져서 높이를 잰다
  const [barHeight, setBarHeight] = useState(0)
  const barRef = useCallback((el: HTMLDivElement | null) => {
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => setBarHeight(el.offsetHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const goNext = () => {
    if (issues.length > 0) { setAttempted(true); return }
    const next = step + 1
    setAttempted(false)
    setResumed(false)
    setStep(next)
    window.history.pushState(withStepHistory(window.history.state, next), '')
  }

  const goPrev = () => {
    if (step === 0) return
    const hist = readStepHistory(window.history.state)
    // 이 화면에서 쌓은 기록이면 브라우저 뒤로와 같은 길로 — 그래야 앞으로 가기도 맞는다
    if (hist.step === step && hist.base != null && step > hist.base) { window.history.back(); return }
    setAttempted(false)
    setStep(step - 1)
    window.history.replaceState(withStepHistory(window.history.state, step - 1, step - 1), '')
  }

  const startOver = () => {
    setDealTypes([])
    setPropertyTypes([])
    setRegion(null)
    setForm(EMPTY_REQUEST_FORM)
    setStep(0)
    setAttempted(false)
    setResumed(false)
    setError('')
    window.history.replaceState(withStepHistory(window.history.state, 0, 0), '')
  }

  // 단계마다 쌓은 pushState 를 처음 들어온 자리까지 되감는다. 그대로 replace 하면 상세 화면에서
  // '뒤로'가 비워진 작성 화면(new#2)에 떨어지고, 그다음 두 번은 아무 일도 없이 먹혔다.
  const collapseStepHistory = () =>
    new Promise<void>((resolve) => {
      const { step: s, base } = readStepHistory(window.history.state)
      const n = s != null && base != null ? s - base : 0
      if (n <= 0) { resolve(); return }
      const done = () => { clearTimeout(timer); resolve() }
      // popstate 가 안 오는 경우가 있어도 저장 뒤 이동은 막지 않는다
      const timer = setTimeout(done, 1000)
      window.addEventListener('popstate', done, { once: true })
      window.history.go(-n)
    })

  const handleSubmit = async () => {
    // 예산·면적·입주일은 각 단계에서 이미 막지만, 복원·앞으로 가기로 비어 있는 단계가 있으면 그리로 돌려보낸다
    const bad = firstIssueStep(draft, today)
    if (bad != null || !region) {
      const s = bad ?? 1
      setAttempted(true)
      if (s !== step) {
        setStep(s)
        window.history.replaceState(withStepHistory(window.history.state, s, s), '')
      }
      return
    }
    setLoading(true)
    setError('')

    let user: User | null = null
    try {
      const { data } = await supabase.auth.getUser()
      user = data.user
    } catch {
      router.push('/auth/login?redirect=/request/new')
      return
    }
    if (!user) {
      router.push('/auth/login?redirect=/request/new')
      return
    }

    try {
      const { data, error: insertError } = await supabase
        .from('request_posts')
        .insert({
          user_id: user.id,
          ...toRequestPayload({ dealTypes, propertyTypes, region, form }),
          status: 'active',
          proposal_count: 0,
          is_co_broker: isCoBroker,
        })
        .select('id')
        .single()

      if (insertError || !data) {
        console.error('[request-new] 등록 실패', insertError)
        setError(describeSaveError(insertError, '등록'))
        setLoading(false)
        return
      }

      // 임시 저장은 비우고, 상세 화면이 '등록됐어요'를 한 번 띄우게 표식을 남긴다
      submittedRef.current = true
      try {
        window.sessionStorage.removeItem(draftKey)
        window.sessionStorage.setItem(REQUEST_SAVED_FLASH_KEY, makeSavedFlash(data.id, 'new'))
      } catch { /* 안내만 빠진다 */ }

      // 매칭 중개사에게 알림 발송 (실패는 페이지 이동 막지 않음)
      fetch('/api/requests/notify-brokers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: data.id }),
      }).catch(() => {})

      // replace — 등록을 마친 작성 화면으로 '뒤로' 돌아와 같은 요청을 또 올리지 않게
      await collapseStepHistory()
      router.replace(`/request/${data.id}`)
    } catch {
      setError(describeSaveError(null, '등록'))
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <Header />

      <div className="mx-auto max-w-2xl px-4 py-10">
        <h1 className="sr-only">새 요청 작성</h1>
        {/* 공동중개 배너 */}
        {isCoBroker && (
          <div className="mb-6 flex items-center gap-3 rounded-xl border border-purple-200 bg-purple-50 px-4 py-3">
            <span className="whitespace-nowrap rounded-full bg-purple-600 px-2.5 py-0.5 text-xs font-bold text-white">공동중개 요청</span>
            <p className="text-sm text-purple-800">다른 중개사에게 발송되는 공동중개 요청입니다.</p>
          </div>
        )}

        {/* 이어 쓰기 안내 — 새로고침·뒤로 갔다 와도 고른 값이 남아 있다 */}
        {resumed && (
          <div className="mb-6 flex items-center justify-between gap-3 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 dark:border-blue-500/30 dark:bg-blue-500/10">
            <p className="text-sm text-blue-800 dark:text-blue-200">작성하던 내용을 불러왔어요</p>
            <button
              type="button"
              onClick={startOver}
              className="flex items-center gap-1 whitespace-nowrap text-xs font-semibold text-blue-700 hover:underline dark:text-blue-300"
            >
              <RotateCcw className="h-3.5 w-3.5" />처음부터 다시
            </button>
          </div>
        )}

        {/* 스텝 인디케이터 */}
        <div className="mb-8">
          <div className="flex items-center">
            {STEPS.map((s, i) => (
              <div key={s} className="flex items-center">
                <div
                  className={cn(
                    'flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold transition-all',
                    i < step
                      ? 'bg-blue-600 text-white'
                      : i === step
                      ? 'bg-blue-600 text-white ring-4 ring-blue-100'
                      : 'bg-gray-200 text-gray-500'
                  )}
                >
                  {i < step ? <CheckCircle className="h-4 w-4" /> : i + 1}
                </div>
                {i < STEPS.length - 1 && (
                  <div
                    className={cn(
                      'mx-2 h-0.5 w-10 md:w-14',
                      i < step ? 'bg-blue-600' : 'bg-gray-200'
                    )}
                  />
                )}
              </div>
            ))}
          </div>
          <div className="mt-4">
            <p className="text-xs text-gray-500">Step {step + 1} / {STEPS.length}</p>
            <h2 className="mt-1 text-xl font-bold text-gray-900 dark:text-white">{STEPS[step]}</h2>
          </div>
        </div>

        {/* 스텝 컨텐츠 */}
        <div className="rounded-2xl bg-white dark:bg-gray-900 p-6 shadow-sm border border-gray-100 dark:border-gray-800">

          {/* ── Step 0: 거래·매물 유형 ── */}
          {step === 0 && (
            <div className="space-y-6">
              {/* 거래 유형 - 중복 선택 */}
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-sm font-medium text-gray-700 dark:text-gray-300">거래 유형</p>
                  <span className="text-xs text-gray-500">중복 선택 가능</span>
                </div>
                <div className="flex gap-3">
                  {DEAL_TYPES.map((type) => (
                    <button
                      key={type}
                      type="button"
                      aria-pressed={dealTypes.includes(type)}
                      onClick={() => toggleDealType(type)}
                      className={cn(
                        'flex-1 rounded-xl border-2 py-3 text-sm font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2',
                        dealTypes.includes(type)
                          ? 'border-blue-500 bg-blue-50 text-blue-700'
                          : 'border-gray-200 text-gray-600 hover:border-gray-300'
                      )}
                    >
                      {dealTypes.includes(type) && '✓ '}
                      {type}
                    </button>
                  ))}
                </div>
              </div>

              {/* 매물 유형 - 카테고리별 중복 선택 */}
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-sm font-medium text-gray-700 dark:text-gray-300">매물 유형</p>
                  <span className="text-xs text-gray-500">중복 선택 가능</span>
                </div>
                <div className="space-y-3">
                  {CUSTOMER_PROPERTY_CATEGORIES.map((cat) => (
                    <div key={cat.label}>
                      <p className="mb-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                        {cat.label}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {cat.types.map((type) => (
                          <button
                            key={type}
                            type="button"
                            aria-pressed={propertyTypes.includes(type)}
                            onClick={() => togglePropertyType(type)}
                            className={cn(
                              'rounded-xl border-2 px-3 py-2 text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2',
                              propertyTypes.includes(type)
                                ? 'border-blue-500 bg-blue-50 text-blue-700'
                                : 'border-gray-200 text-gray-600 hover:border-gray-300'
                            )}
                          >
                            {propertyTypes.includes(type) && '✓ '}
                            {type}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* 선택 요약 */}
              {(dealTypes.length > 0 || propertyTypes.length > 0) && (
                <div className="rounded-xl bg-gray-50 dark:bg-gray-950 p-3 text-xs text-gray-600 dark:text-gray-500">
                  {dealTypes.length > 0 && (
                    <p>거래: <span className="font-semibold text-blue-600">{dealTypes.join(' · ')}</span></p>
                  )}
                  {propertyTypes.length > 0 && (
                    <p className="mt-0.5">매물: <span className="font-semibold text-blue-600">{propertyTypes.join(' · ')}</span></p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── Step 1: 위치 ── */}
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <p className="mb-1.5 text-sm font-medium text-gray-700 dark:text-gray-300">관심 지역</p>
                <p className="mb-3 text-xs text-gray-500">
                  동·읍·면 단위까지 검색할 수 있어요. 예: <span className="font-medium text-gray-700 dark:text-gray-300">불당동</span>, <span className="font-medium text-gray-700 dark:text-gray-300">강남</span>, <span className="font-medium text-gray-700 dark:text-gray-300">수원 영통</span>
                </p>
                <RegionPicker
                  value={region}
                  onPick={r => setRegion(r)}
                  onClear={() => setRegion(null)}
                  autoFocus
                />
              </div>
            </div>
          )}

          {/* ── Step 2: 예산 ── */}
          {step === 2 && (
            <div className="space-y-5">
              <p className="text-sm text-gray-500">
                희망 예산 범위를 입력해 주세요 <span className="text-gray-500">(단위: 만원)</span>
              </p>

              {/* 매매가·전세금·보증금 — DB 에 금액 칸이 한 쌍뿐이라 유형을 여럿 골라도 한 범위로 받는다.
                  예전엔 '매매/전세 금액'과 '월세 보증금' 칸을 따로 그려 놓고 같은 값에 묶어,
                  한쪽을 고치면 다른 쪽이 말없이 같이 바뀌었다. */}
              <div className="space-y-3">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{priceLabel(dealTypes)}</p>
                {isMixedPrice(dealTypes) && (
                  <p className="text-xs text-gray-500">
                    거래 유형을 여러 개 고르셔서 금액은 한 범위로 받아요. 가장 낮은 금액부터 가장 높은 금액까지 넉넉히 적어 주세요.
                  </p>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <Input
                    label="최소값 (만원)"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    step={1}
                    placeholder={pricePh.min}
                    value={form.min_price}
                    onChange={(e) => update('min_price', e.target.value)}
                    error={budgetErr.min_price}
                  />
                  <Input
                    label="최대값 (만원)"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    step={1}
                    placeholder={pricePh.max}
                    value={form.max_price}
                    onChange={(e) => update('max_price', e.target.value)}
                    error={budgetErr.max_price}
                  />
                </div>
              </div>

              {/* 월세 */}
              {dealTypes.includes('월세') && (
                <div className="space-y-3 rounded-xl border border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-950 p-4">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    월세 금액 <span className="font-normal normal-case">(선택)</span>
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <Input
                      label="월세 최소값 (만원)"
                      type="number"
                      inputMode="numeric"
                      min={0}
                      step={1}
                      placeholder="예: 30"
                      value={form.min_monthly}
                      onChange={(e) => update('min_monthly', e.target.value)}
                      error={budgetErr.min_monthly}
                    />
                    <Input
                      label="월세 최대값 (만원)"
                      type="number"
                      inputMode="numeric"
                      min={1}
                      step={1}
                      placeholder="예: 80"
                      value={form.max_monthly}
                      onChange={(e) => update('max_monthly', e.target.value)}
                      error={budgetErr.max_monthly}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Step 3: 상세 조건 ── */}
          {step === 3 && (
            <div className="space-y-4">
              {/* 면적 칸은 DB 가 정수라 소수(24.5평)는 여기서 막는다 — 예전엔 서버 400 뒤 '잠시 후 다시'만 떴다 */}
              <div className="grid grid-cols-2 gap-4">
                <Input
                  label="최소 면적"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  step={1}
                  placeholder="예: 10"
                  value={form.min_size}
                  onChange={(e) => update('min_size', e.target.value)}
                  hint="평 단위 · 정수"
                  error={sizeErr.min_size}
                />
                <Input
                  label="최대 면적"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  step={1}
                  placeholder="예: 30"
                  value={form.max_size}
                  onChange={(e) => update('max_size', e.target.value)}
                  hint="평 단위 · 정수"
                  error={sizeErr.max_size}
                />
              </div>
              <Input
                label="입주 희망일"
                type="date"
                min={today}
                value={form.move_in_date}
                onChange={(e) => update('move_in_date', e.target.value)}
                error={dateErr ?? undefined}
              />
              <div>
                <label htmlFor={descriptionId} className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
                  추가 요청사항{' '}
                  <span className="text-gray-500 font-normal">(선택)</span>
                </label>
                <textarea
                  id={descriptionId}
                  placeholder="예: 반려동물 가능, 주차 필수, 역세권 선호, 1층 제외 등"
                  value={form.description}
                  onChange={(e) => update('description', e.target.value)}
                  rows={4}
                  maxLength={1000}
                  className="w-full rounded-xl border border-gray-200 dark:border-gray-800 px-4 py-3 text-sm placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 resize-none"
                />
              </div>

              {/* 최종 요약 */}
              <div className="rounded-xl bg-gray-50 dark:bg-gray-950 p-4 text-sm space-y-1">
                <p className="font-semibold text-gray-700 dark:text-gray-300 mb-2">등록 요약</p>
                <p className="text-gray-600 dark:text-gray-500">📋 거래: <span className="font-medium">{dealTypes.join(', ')}</span></p>
                <p className="text-gray-600 dark:text-gray-500">🏠 매물: <span className="font-medium">{propertyTypes.join(', ')}</span></p>
                <p className="text-gray-600 dark:text-gray-500">📍 위치: <span className="font-medium">{region ? `${region.sido} ${region.sigungu}${region.dong ? ` ${region.dong}` : ''}` : '-'}</span></p>
                <p className="text-gray-600 dark:text-gray-500">💰 예산:&nbsp;
                  <span className="font-medium">
                    {priceLabel(dealTypes)} {rangeText(form.min_price, form.max_price) ?? '-'}
                    {dealTypes.includes('월세') && rangeText(form.min_monthly, form.max_monthly) && ` / 월세 ${rangeText(form.min_monthly, form.max_monthly)}`}
                  </span>
                </p>
              </div>
            </div>
          )}

          {/* 폰에선 카드가 접힌 화면 아래로 길어 여기 적힌 에러가 고정 바 뒤에 숨는다 — 폰은 바 안에만 띄운다 */}
          {error && (
            <div role="alert" aria-live="polite" className="mt-4 hidden rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600 dark:bg-red-500/10 dark:text-red-300 md:block">
              {error}
            </div>
          )}
        </div>

        {/* 네비게이션 버튼 — 폰에선 하단 탭바 바로 위에 고정한다(상세 화면 비교 바와 같은 방식).
            맨 아래에 두기만 하면 첫 화면에서 탭바에 반쯤 가려져 눌러도 되는 버튼인지 알 수 없었다.
            sticky 는 html·body 의 overflow-x:hidden 때문에 body 가 스크롤 상자가 돼 붙지 않는다.
            못 넘어가는 이유도 버튼 바로 위에 — 예전엔 버튼만 회색으로 꺼서 왜 안 눌리는지 몰랐다. */}
        <div
          ref={barRef}
          className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-30 border-t border-gray-200 bg-gray-50 px-4 py-3 dark:border-gray-800 dark:bg-gray-950 md:static md:mt-6 md:border-0 md:bg-transparent md:p-0 md:dark:bg-transparent"
        >
          <div className="mx-auto max-w-2xl">
            {/* ul 자체에 role=alert 를 주면 목록 역할이 사라져 li 가 고아가 된다 — 감싸는 div 에 둔다 */}
            {attempted && issues.length > 0 && (
              <div role="alert" className="mb-3 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600 dark:bg-red-500/10 dark:text-red-300">
                <ul className="space-y-1">
                  {issues.map((m) => (
                    <li key={m} className="flex items-start gap-1.5">
                      <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                      {m}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {/* 저장 에러 — 폰에선 버튼 바로 위(위 이유 문구와 같은 자리). md 이상은 카드 안 것이 보인다 */}
            {error && (
              <div role="alert" aria-live="polite" className="mb-3 flex items-start gap-1.5 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600 dark:bg-red-500/10 dark:text-red-300 md:hidden">
                <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                {error}
              </div>
            )}
            <div className="flex gap-3">
              {step > 0 && (
                <Button
                  variant="secondary"
                  size="lg"
                  className="flex-1"
                  onClick={goPrev}
                >
                  <ChevronLeft className="mr-1 h-4 w-4" /> 이전
                </Button>
              )}
              {step < STEPS.length - 1 ? (
                <Button
                  variant="primary"
                  size="lg"
                  className="flex-1"
                  onClick={goNext}
                >
                  다음 <ChevronRight className="ml-1 h-4 w-4" />
                </Button>
              ) : (
                <Button
                  variant="primary"
                  size="lg"
                  className="flex-1"
                  loading={loading}
                  onClick={handleSubmit}
                >
                  <Home className="mr-2 h-4 w-4" />
                  조건 등록 완료
                </Button>
              )}
            </div>
          </div>
        </div>
        {/* 고정 바에 가려지는 만큼 아래를 비운다(이유 문구가 뜨면 바가 커진다) */}
        <div aria-hidden className="md:hidden" style={{ height: barHeight }} />
      </div>
    </div>
  )
}

export default function RequestNewPage() {
  return (
    <Suspense>
      <RequestNewPageInner />
    </Suspense>
  )
}
