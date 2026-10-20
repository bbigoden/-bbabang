'use client'

import { useState, useEffect, useId, useRef, useCallback } from 'react'
import type { User } from '@supabase/supabase-js'
import { useRouter, useParams } from 'next/navigation'
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
  readStepHistory, withStepHistory, makeSavedFlash, splitTypes,
  type RequestForm,
} from '@/lib/request-validation'
import { CheckCircle, ChevronRight, ChevronLeft, Home, AlertCircle } from 'lucide-react'
import { RegionPicker, type RegionValue } from '@/components/region-picker'
import { CUSTOMER_PROPERTY_CATEGORIES, toCustomerRoomTypes } from '@/lib/property-types'

export default function RequestEditPage() {
  const router = useRouter()
  const params = useParams()
  const id = params.id as string
  const supabase = createClient()

  const [step, setStep] = useState(0)
  const [loading, setLoading] = useState(false)
  const [initialLoading, setInitialLoading] = useState(true)
  const [error, setError] = useState('')
  // 이 단계에서 '다음'을 한 번 눌러 봤는가 — 빈칸 경고는 그 뒤에만 띄운다
  const [attempted, setAttempted] = useState(false)

  const [dealTypes, setDealTypes] = useState<string[]>([])
  const [propertyTypes, setPropertyTypes] = useState<string[]>([])
  // 등록 화면과 같은 동 단위 검색 — 예전 시·구 버튼 방식은 저장된 동(불당동)을 읽지도, 지키지도 못했다
  const [region, setRegion] = useState<RegionValue | null>(null)
  const descriptionId = useId()
  const [form, setForm] = useState<RequestForm>(EMPTY_REQUEST_FORM)
  // 저장돼 있던 입주일 — 그 사이 지난 날짜가 됐어도 다른 칸만 고치는 것은 막지 않는다
  const [savedMoveIn, setSavedMoveIn] = useState<string | null>(null)

  const today = todayKST()
  const draft = { dealTypes, propertyTypes, region, form }
  const stepOpts = { keepMoveInDate: savedMoveIn }
  const latestDraft = useRef({ draft, stepOpts })
  latestDraft.current = { draft, stepOpts }
  const savedRef = useRef(false) // 저장이 끝나 상세로 넘어가는 중 — 기록을 되감아도 단계를 다시 그리지 않는다

  useEffect(() => {
    const load = async () => {
      let user: User | null = null
      // 로그인하고 나면 이 수정 화면으로 돌아오게. 비로그인은 proxy 가 먼저 redirect 를 담아
      // 보내지만, 그 뒤 세션이 끊겨 여기서 튕기면 어느 요청을 고치던 중이었는지 잃었다.
      const loginHref = `/auth/login?redirect=${encodeURIComponent(`/request/${id}/edit`)}`
      try {
        const { data } = await supabase.auth.getUser()
        user = data.user
      } catch { router.push(loginHref); return }
      if (!user) { router.push(loginHref); return }

      const { data, error } = await supabase
        .from('request_posts')
        .select('user_id, deal_type, room_type, city, district, dong, min_price, max_price, min_monthly, max_monthly, min_size, max_size, move_in_date, description')
        .eq('id', id)
        .single()

      if (error || !data) { router.push('/dashboard/user'); return }
      if (data.user_id !== user.id) { router.push('/dashboard/user'); return }

      const loaded = {
        dealTypes: splitTypes(data.deal_type).filter(t => DEAL_TYPES.includes(t)),
        propertyTypes: data.room_type ? toCustomerRoomTypes(data.room_type.split(',').map((s: string) => s.trim())) : [],
        region: data.city && data.district ? { sido: data.city, sigungu: data.district, dong: data.dong ?? null } : null,
        form: {
          min_price: data.min_price?.toString() ?? '',
          max_price: data.max_price?.toString() ?? '',
          min_monthly: data.min_monthly?.toString() ?? '',
          max_monthly: data.max_monthly?.toString() ?? '',
          min_size: data.min_size?.toString() ?? '',
          max_size: data.max_size?.toString() ?? '',
          move_in_date: data.move_in_date ?? '',
          description: data.description ?? '',
        },
      }
      setDealTypes(loaded.dealTypes)
      setPropertyTypes(loaded.propertyTypes)
      setRegion(loaded.region)
      setForm(loaded.form)
      setSavedMoveIn(data.move_in_date ?? null)

      // 새로고침해도 보던 단계로(history.state 는 남는다). 값은 DB 에서 다시 읽은 것이다.
      const hist = readStepHistory(window.history.state)
      const s = clampStep(hist.step ?? 0, loaded, todayKST(), { keepMoveInDate: data.move_in_date ?? null })
      setStep(s)
      window.history.replaceState(withStepHistory(window.history.state, s, Math.min(hist.base ?? s, s)), '')
      setInitialLoading(false)
    }
    load()
  }, [id])

  // 브라우저 '뒤로' = 이전 단계 (등록 화면과 같은 방식)
  useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      if (savedRef.current) return
      const { step: s } = readStepHistory(e.state)
      if (s == null) return
      const { draft: d, stepOpts: o } = latestDraft.current
      const safe = clampStep(s, d, todayKST(), o)
      setStep(safe)
      setAttempted(false)
      if (safe !== s) window.history.replaceState(withStepHistory(window.history.state, safe), '')
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const update = (key: keyof RequestForm, value: string) => setForm(prev => ({ ...prev, [key]: value }))
  const toggleDealType = (type: string) => setDealTypes(prev => prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type])
  const togglePropertyType = (type: string) => setPropertyTypes(prev => prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type])

  const issues = stepIssues(step, draft, today, stepOpts)
  const budgetErr = budgetErrors(form, dealTypes, { requireFilled: attempted })
  const sizeErr = sizeErrors(form)
  const dateErr = moveInDateError(form.move_in_date, today, savedMoveIn)
  const pricePh = pricePlaceholders(dealTypes)

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
    setStep(next)
    window.history.pushState(withStepHistory(window.history.state, next), '')
  }

  const goPrev = () => {
    if (step === 0) return
    const hist = readStepHistory(window.history.state)
    if (hist.step === step && hist.base != null && step > hist.base) { window.history.back(); return }
    setAttempted(false)
    setStep(step - 1)
    window.history.replaceState(withStepHistory(window.history.state, step - 1, step - 1), '')
  }

  // 단계마다 쌓은 pushState 를 처음 들어온 자리까지 되감는다 (등록 화면과 같게) — 그대로 replace 하면
  // 상세 화면에서 '뒤로'가 수정 화면 중간 단계에 떨어지고, 그다음 몇 번은 아무 일도 없이 먹혔다.
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
    const bad = firstIssueStep(draft, today, stepOpts)
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

    // 동·월세도 함께 저장 — 예전엔 둘 다 빠져 수정 화면에서 고쳐도 저장되지 않았다
    const { error: updateError } = await supabase
      .from('request_posts')
      .update(toRequestPayload({ dealTypes, propertyTypes, region, form }))
      .eq('id', id)

    if (updateError) {
      console.error('[request-edit] 수정 실패', updateError)
      setError(describeSaveError(updateError, '수정'))
      setLoading(false)
      return
    }

    try { window.sessionStorage.setItem(REQUEST_SAVED_FLASH_KEY, makeSavedFlash(id, 'edit')) } catch { /* 안내만 빠진다 */ }
    savedRef.current = true
    await collapseStepHistory()
    router.replace(`/request/${id}`)
  }

  if (initialLoading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center">
        <div className="text-gray-500">불러오는 중...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <Header />
      <div className="mx-auto max-w-2xl px-4 py-10">
        <h1 className="sr-only">요청 수정</h1>
        {/* 스텝 인디케이터 */}
        <div className="mb-8">
          <div className="flex items-center">
            {STEPS.map((s, i) => (
              <div key={s} className="flex items-center">
                <div className={cn(
                  'flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold transition-all',
                  i < step ? 'bg-blue-600 text-white' : i === step ? 'bg-blue-600 text-white ring-4 ring-blue-100' : 'bg-gray-200 text-gray-500'
                )}>
                  {i < step ? <CheckCircle className="h-4 w-4" /> : i + 1}
                </div>
                {i < STEPS.length - 1 && (
                  <div className={cn('mx-2 h-0.5 w-10 md:w-14', i < step ? 'bg-blue-600' : 'bg-gray-200')} />
                )}
              </div>
            ))}
          </div>
          <div className="mt-4">
            <p className="text-xs text-gray-500">Step {step + 1} / {STEPS.length} · 요청 수정</p>
            <h2 className="mt-1 text-xl font-bold text-gray-900 dark:text-white">{STEPS[step]}</h2>
          </div>
        </div>

        <div className="rounded-2xl bg-white dark:bg-gray-900 p-6 shadow-sm border border-gray-100 dark:border-gray-800">
          {/* Step 0 */}
          {step === 0 && (
            <div className="space-y-6">
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-sm font-medium text-gray-700 dark:text-gray-300">거래 유형</p>
                  <span className="text-xs text-gray-500">중복 선택 가능</span>
                </div>
                <div className="flex gap-3">
                  {DEAL_TYPES.map((type) => (
                    <button key={type} type="button" aria-pressed={dealTypes.includes(type)} onClick={() => toggleDealType(type)}
                      className={cn('flex-1 rounded-xl border-2 py-3 text-sm font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2',
                        dealTypes.includes(type) ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600 hover:border-gray-300')}>
                      {dealTypes.includes(type) && '✓ '}{type}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-sm font-medium text-gray-700 dark:text-gray-300">매물 유형</p>
                  <span className="text-xs text-gray-500">중복 선택 가능</span>
                </div>
                <div className="space-y-3">
                  {CUSTOMER_PROPERTY_CATEGORIES.map((cat) => (
                    <div key={cat.label}>
                      <p className="mb-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">{cat.label}</p>
                      <div className="flex flex-wrap gap-2">
                        {cat.types.map((type) => (
                          <button key={type} type="button" aria-pressed={propertyTypes.includes(type)} onClick={() => togglePropertyType(type)}
                            className={cn('rounded-xl border-2 px-3 py-2 text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2',
                              propertyTypes.includes(type) ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600 hover:border-gray-300')}>
                            {propertyTypes.includes(type) && '✓ '}{type}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              {/* 선택 요약 — 등록 화면과 같게 */}
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

          {/* Step 1 — 등록 화면과 같은 지역 검색 */}
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

          {/* Step 2 — DB 에 금액 칸이 한 쌍뿐이라 유형을 여럿 골라도 한 범위로 받는다 */}
          {step === 2 && (
            <div className="space-y-5">
              <p className="text-sm text-gray-500">희망 예산 범위를 입력해 주세요 <span className="text-gray-500">(단위: 만원)</span></p>
              <div className="space-y-3">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{priceLabel(dealTypes)}</p>
                {isMixedPrice(dealTypes) && (
                  <p className="text-xs text-gray-500">
                    거래 유형을 여러 개 고르셔서 금액은 한 범위로 받아요. 가장 낮은 금액부터 가장 높은 금액까지 넉넉히 적어 주세요.
                  </p>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <Input label="최소값 (만원)" type="number" inputMode="numeric" min={0} step={1} placeholder={pricePh.min}
                    value={form.min_price} onChange={(e) => update('min_price', e.target.value)} error={budgetErr.min_price} />
                  <Input label="최대값 (만원)" type="number" inputMode="numeric" min={1} step={1} placeholder={pricePh.max}
                    value={form.max_price} onChange={(e) => update('max_price', e.target.value)} error={budgetErr.max_price} />
                </div>
              </div>
              {dealTypes.includes('월세') && (
                <div className="space-y-3 rounded-xl border border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-950 p-4">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    월세 금액 <span className="font-normal normal-case">(선택)</span>
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <Input label="월세 최소값 (만원)" type="number" inputMode="numeric" min={0} step={1} placeholder="예: 30"
                      value={form.min_monthly} onChange={(e) => update('min_monthly', e.target.value)} error={budgetErr.min_monthly} />
                    <Input label="월세 최대값 (만원)" type="number" inputMode="numeric" min={1} step={1} placeholder="예: 80"
                      value={form.max_monthly} onChange={(e) => update('max_monthly', e.target.value)} error={budgetErr.max_monthly} />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Step 3 */}
          {step === 3 && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <Input label="최소 면적" type="number" inputMode="numeric" min={1} step={1} placeholder="예: 10" value={form.min_size}
                  onChange={(e) => update('min_size', e.target.value)} hint="평 단위 · 정수" error={sizeErr.min_size} />
                <Input label="최대 면적" type="number" inputMode="numeric" min={1} step={1} placeholder="예: 30" value={form.max_size}
                  onChange={(e) => update('max_size', e.target.value)} hint="평 단위 · 정수" error={sizeErr.max_size} />
              </div>
              <Input label="입주 희망일" type="date" min={savedMoveIn && savedMoveIn < today ? savedMoveIn : today} value={form.move_in_date}
                onChange={(e) => update('move_in_date', e.target.value)} error={dateErr ?? undefined} />
              <div>
                <label htmlFor={descriptionId} className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">추가 요청사항 <span className="text-gray-500 font-normal">(선택)</span></label>
                <textarea id={descriptionId} placeholder="예: 반려동물 가능, 주차 필수, 역세권 선호" value={form.description}
                  onChange={(e) => update('description', e.target.value)} rows={4}
                  maxLength={1000}
                  className="w-full rounded-xl border border-gray-200 dark:border-gray-800 px-4 py-3 text-sm placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 resize-none" />
              </div>
              <div className="rounded-xl bg-gray-50 dark:bg-gray-950 p-4 text-sm space-y-1">
                <p className="font-semibold text-gray-700 dark:text-gray-300 mb-2">수정 요약</p>
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

        {/* 네비게이션 버튼 — 폰에선 하단 탭바 바로 위에 고정하고, 못 넘어가는 이유를 버튼 위에 (등록 화면과 같게) */}
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
                <Button variant="secondary" size="lg" className="flex-1" onClick={goPrev}>
                  <ChevronLeft className="mr-1 h-4 w-4" /> 이전
                </Button>
              )}
              {step < STEPS.length - 1 ? (
                <Button variant="primary" size="lg" className="flex-1" onClick={goNext}>
                  다음 <ChevronRight className="ml-1 h-4 w-4" />
                </Button>
              ) : (
                <Button variant="primary" size="lg" className="flex-1" loading={loading} onClick={handleSubmit}>
                  <Home className="mr-2 h-4 w-4" /> 수정 완료
                </Button>
              )}
            </div>
          </div>
        </div>
        <div aria-hidden className="md:hidden" style={{ height: barHeight }} />
      </div>
    </div>
  )
}
