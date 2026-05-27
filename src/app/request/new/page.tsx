'use client'

import { useState, useEffect, Suspense } from 'react'
import type { User } from '@supabase/supabase-js'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Header } from '@/components/layout/header'
import { cn } from '@/lib/utils'
import { validateBudgetRange, validateArea } from '@/lib/validation'
import { CheckCircle, ChevronRight, ChevronLeft, Home } from 'lucide-react'
import { RegionPicker, type RegionValue } from '@/components/region-picker'
import { PROPERTY_CATEGORIES } from '@/lib/property-types'

// ─── 거래 유형 ───
const DEAL_TYPES = ['매매', '월세', '전세']

const STEPS = ['거래·매물 유형', '위치', '예산', '상세 조건']

function RequestNewPageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const isCoBroker = searchParams.get('co_broker') === 'true'
  const supabase = createClient()
  const [step, setStep] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

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
  const [form, setForm] = useState({
    min_price: '',       // 전세/매매: 금액 / 월세: 보증금
    max_price: '',
    min_monthly: '',     // 월세 전용: 월세 최소
    max_monthly: '',     // 월세 전용: 월세 최대
    min_size: '',
    max_size: '',
    move_in_date: '',
    description: '',
  })

  const update = (key: string, value: string) =>
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

  const canNext = () => {
    if (step === 0) return dealTypes.length > 0 && propertyTypes.length > 0
    if (step === 1) return region !== null
    if (step === 2) return form.min_price !== '' && form.max_price !== ''
    return true
  }

  const handleSubmit = async () => {
    // 예산·월세·평수 음수·역전 검증
    const budgetCheck = validateBudgetRange(form.min_price, form.max_price)
    if (!budgetCheck.valid) { setError(budgetCheck.error); return }
    if (dealTypes.includes('월세')) {
      const monthlyCheck = validateBudgetRange(form.min_monthly, form.max_monthly)
      if (!monthlyCheck.valid) { setError(monthlyCheck.error); return }
    }
    if (form.min_size) {
      const sizeCheck = validateArea(form.min_size, '최소 평수')
      if (!sizeCheck.valid) { setError(sizeCheck.error); return }
    }
    if (form.max_size) {
      const sizeCheck = validateArea(form.max_size, '최대 평수')
      if (!sizeCheck.valid) { setError(sizeCheck.error); return }
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
          deal_type: dealTypes.join(', '),
          room_type: propertyTypes.join(', '),
          city: region!.sido,
          district: region!.sigungu,
          dong: region!.dong,
          min_price: Number(form.min_price),
          max_price: Number(form.max_price),
          min_monthly: dealTypes.includes('월세') && form.min_monthly ? Number(form.min_monthly) : null,
          max_monthly: dealTypes.includes('월세') && form.max_monthly ? Number(form.max_monthly) : null,
          min_size: form.min_size ? Number(form.min_size) : null,
          max_size: form.max_size ? Number(form.max_size) : null,
          move_in_date: form.move_in_date || null,
          description: form.description || null,
          status: 'active',
          proposal_count: 0,
          is_co_broker: isCoBroker,
        })
        .select()
        .single()

      if (insertError) {
        setError('등록 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.')
        setLoading(false)
        return
      }

      // 매칭 중개사에게 알림 발송 (실패는 페이지 이동 막지 않음)
      fetch('/api/requests/notify-brokers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: data.id }),
      }).catch(() => {})

      router.push(`/request/${data.id}`)
    } catch {
      setError('등록 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <Header />

      <div className="mx-auto max-w-xl px-4 py-10">
        {/* 공동중개 배너 */}
        {isCoBroker && (
          <div className="mb-6 flex items-center gap-3 rounded-xl border border-purple-200 bg-purple-50 px-4 py-3">
            <span className="whitespace-nowrap rounded-full bg-purple-600 px-2.5 py-0.5 text-xs font-bold text-white">공동중개 요청</span>
            <p className="text-sm text-purple-800">다른 중개사에게 발송되는 공동중개 요청입니다.</p>
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
                      : 'bg-gray-200 text-gray-400'
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
            <p className="text-xs text-gray-400">Step {step + 1} / {STEPS.length}</p>
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
                  <span className="text-xs text-gray-400">중복 선택 가능</span>
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
                  <span className="text-xs text-gray-400">중복 선택 가능</span>
                </div>
                <div className="space-y-3">
                  {PROPERTY_CATEGORIES.map((cat) => (
                    <div key={cat.label}>
                      <p className="mb-1.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">
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
                <div className="rounded-xl bg-gray-50 dark:bg-gray-950 p-3 text-xs text-gray-600 dark:text-gray-400">
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
                희망 예산 범위를 입력해주세요 <span className="text-gray-400">(단위: 만원)</span>
              </p>

              {/* 전세 / 매매 */}
              {(dealTypes.includes('전세') || dealTypes.includes('매매')) && (
                <div className="space-y-3">
                  {dealTypes.length > 1 && (
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      {dealTypes.filter(d => d !== '월세').join(' / ')} 금액
                    </p>
                  )}
                  <div className="grid grid-cols-2 gap-3">
                    <Input
                      label="최소값 (만원)"
                      type="number"
                      placeholder={dealTypes.includes('매매') ? '50000' : '20000'}
                      value={form.min_price}
                      onChange={(e) => update('min_price', e.target.value)}
                    />
                    <Input
                      label="최대값 (만원)"
                      type="number"
                      placeholder={dealTypes.includes('매매') ? '80000' : '50000'}
                      value={form.max_price}
                      onChange={(e) => update('max_price', e.target.value)}
                    />
                  </div>
                  {form.min_price && form.max_price && Number(form.min_price) > Number(form.max_price) && (
                    <p className="text-xs text-red-500">최소값이 최대값보다 클 수 없습니다</p>
                  )}
                </div>
              )}

              {/* 월세 */}
              {dealTypes.includes('월세') && (
                <div className="space-y-3 rounded-xl border border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-950 p-4">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">월세 보증금</p>
                  <div className="grid grid-cols-2 gap-3">
                    <Input
                      label="보증금 최소값 (만원)"
                      type="number"
                      placeholder="500"
                      value={dealTypes.filter(d => d !== '월세').length > 0 ? form.min_price : form.min_price}
                      onChange={(e) => update('min_price', e.target.value)}
                    />
                    <Input
                      label="보증금 최대값 (만원)"
                      type="number"
                      placeholder="3000"
                      value={form.max_price}
                      onChange={(e) => update('max_price', e.target.value)}
                    />
                  </div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mt-2">월세 금액</p>
                  <div className="grid grid-cols-2 gap-3">
                    <Input
                      label="월세 최소값 (만원)"
                      type="number"
                      placeholder="30"
                      value={form.min_monthly}
                      onChange={(e) => update('min_monthly', e.target.value)}
                    />
                    <Input
                      label="월세 최대값 (만원)"
                      type="number"
                      placeholder="80"
                      value={form.max_monthly}
                      onChange={(e) => update('max_monthly', e.target.value)}
                    />
                  </div>
                  {form.min_monthly && form.max_monthly && Number(form.min_monthly) > Number(form.max_monthly) && (
                    <p className="text-xs text-red-500">월세 최소값이 최대값보다 클 수 없습니다</p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── Step 3: 상세 조건 ── */}
          {step === 3 && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <Input
                  label="최소 면적"
                  type="number"
                  placeholder="10"
                  value={form.min_size}
                  onChange={(e) => update('min_size', e.target.value)}
                  hint="평 단위"
                />
                <Input
                  label="최대 면적"
                  type="number"
                  placeholder="30"
                  value={form.max_size}
                  onChange={(e) => update('max_size', e.target.value)}
                  hint="평 단위"
                />
              </div>
              <Input
                label="입주 희망일"
                type="date"
                value={form.move_in_date}
                onChange={(e) => update('move_in_date', e.target.value)}
              />
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
                  추가 요청사항{' '}
                  <span className="text-gray-400 font-normal">(선택)</span>
                </label>
                <textarea
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
                <p className="text-gray-600 dark:text-gray-400">📋 거래: <span className="font-medium">{dealTypes.join(', ')}</span></p>
                <p className="text-gray-600 dark:text-gray-400">🏠 매물: <span className="font-medium">{propertyTypes.join(', ')}</span></p>
                <p className="text-gray-600 dark:text-gray-400">📍 위치: <span className="font-medium">{region ? `${region.sido} ${region.sigungu}${region.dong ? ` ${region.dong}` : ''}` : '-'}</span></p>
                <p className="text-gray-600 dark:text-gray-400">💰 예산:&nbsp;
                  <span className="font-medium">
                    {Number(form.min_price).toLocaleString()}만 ~ {Number(form.max_price).toLocaleString()}만원
                    {dealTypes.includes('월세') && form.min_monthly && ` / 월세 ${Number(form.min_monthly).toLocaleString()}만~${Number(form.max_monthly).toLocaleString()}만`}
                  </span>
                </p>
              </div>
            </div>
          )}

          {error && (
            <div role="alert" aria-live="polite" className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">
              {error}
            </div>
          )}
        </div>

        {/* 네비게이션 버튼 */}
        <div className="mt-6 flex gap-3">
          {step > 0 && (
            <Button
              variant="secondary"
              size="lg"
              className="flex-1"
              onClick={() => setStep(step - 1)}
            >
              <ChevronLeft className="mr-1 h-4 w-4" /> 이전
            </Button>
          )}
          {step < STEPS.length - 1 ? (
            <Button
              variant="primary"
              size="lg"
              className="flex-1"
              disabled={!canNext()}
              onClick={() => setStep(step + 1)}
            >
              다음 <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          ) : (
            <Button
              variant="primary"
              size="lg"
              className="flex-1"
              loading={loading}
              disabled={!canNext()}
              onClick={handleSubmit}
            >
              <Home className="mr-2 h-4 w-4" />
              조건 등록 완료
            </Button>
          )}
        </div>
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
