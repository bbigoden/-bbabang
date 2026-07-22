'use client'

import { useState, useEffect, useId } from 'react'
import type { User } from '@supabase/supabase-js'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Header } from '@/components/layout/header'
import { Card, CardBody } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { ArrowLeft, Building2, ImagePlus, X } from 'lucide-react'
import Link from 'next/link'
import { validatePrice, validateArea } from '@/lib/validation'
import { notifyOwnerOfBrokerAction } from '@/lib/notify-owner'
import { geocodeAddress } from '@/lib/geocode'
import { useToast } from '@/components/toast'
import { PROPERTY_CATEGORIES } from '@/lib/property-types'

const DEAL_TYPES = ['매매', '전세', '월세']

export default function NewPropertyPage() {
  const router = useRouter()
  const supabase = createClient()
  const toast = useToast()

  const [dealType, setDealType] = useState('')
  const [roomType, setRoomType] = useState('')
  const [address, setAddress] = useState('')
  const [price, setPrice] = useState('')
  const [monthlyRent, setMonthlyRent] = useState('')
  const [managementFee, setManagementFee] = useState('')
  const [premium, setPremium] = useState('')
  const [sizePyeong, setSizePyeong] = useState('')
  const [areaType, setAreaType] = useState<'전용' | '공급'>('전용')
  const [areaUnit, setAreaUnit] = useState<'평' | 'm²'>('평')
  const [floor, setFloor] = useState('')
  const [totalFloors, setTotalFloors] = useState('')
  const [description, setDescription] = useState('')
  const [assignee, setAssignee] = useState('')
  const [briefMemo, setBriefMemo] = useState('')
  const [memo, setMemo] = useState('')
  const descriptionId = useId()
  const briefMemoId = useId()
  const memoId = useId()
  const [images, setImages] = useState<File[]>([])
  const [imagePreviews, setImagePreviews] = useState<string[]>([])
  const [_user, setUser] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user ?? null)).catch(() => {})
  }, [])

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    if (images.length + files.length > 5) {
      setError('사진은 최대 5장까지 업로드할 수 있어요.')
      return
    }
    setImages(prev => [...prev, ...files])
    files.forEach(file => {
      const reader = new FileReader()
      reader.onload = (ev) => {
        setImagePreviews(prev => [...prev, ev.target?.result as string])
      }
      reader.readAsDataURL(file)
    })
  }

  const removeImage = (index: number) => {
    setImages(prev => prev.filter((_, i) => i !== index))
    setImagePreviews(prev => prev.filter((_, i) => i !== index))
  }


  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!dealType || !roomType || !address || !price) {
      setError('거래유형, 매물유형, 주소, 가격은 필수입니다.')
      return
    }
    const priceCheck = validatePrice(price, '가격')
    if (!priceCheck.valid) { setError(priceCheck.error); return }
    if (dealType === '월세' && monthlyRent) {
      const rentCheck = validatePrice(monthlyRent, '월세')
      if (!rentCheck.valid) { setError(rentCheck.error); return }
    }
    const areaCheck = validateArea(sizePyeong)
    if (!areaCheck.valid) { setError(areaCheck.error); return }

    setLoading(true)
    setError('')

    let user: User | null = null
    try {
      const { data } = await supabase.auth.getUser()
      user = data.user
    } catch { setError('오류가 발생했습니다. 다시 시도해주세요.'); setLoading(false); return }
    if (!user) { router.push('/auth/login'); return }

    const { data: broker } = await supabase
      .from('broker_profiles')
      .select('id')
      .eq('user_id', user.id)
      .single()

    if (!broker) {
      setError('중개사 등록이 필요합니다.')
      setLoading(false)
      return
    }

    // 이미지 업로드 (잘못된 형식/크기/0바이트 파일 사용자에게 알림)
    const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
    const MAX_SIZE = 10 * 1024 * 1024
    const skipped: string[] = []
    const uploadedUrls: string[] = []
    for (const file of images) {
      if (!ALLOWED_TYPES.includes(file.type)) { skipped.push(`${file.name}: 지원 안 함`); continue }
      if (file.size > MAX_SIZE) { skipped.push(`${file.name}: 10MB 초과`); continue }
      if (file.size === 0) { skipped.push(`${file.name}: 빈 파일`); continue }
      const ext = file.name.split('.').pop()
      const path = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
      const { error: uploadError } = await supabase.storage
        .from('property-images')
        .upload(path, file, { upsert: false })
      if (!uploadError) {
        const { data: { publicUrl } } = supabase.storage
          .from('property-images')
          .getPublicUrl(path)
        uploadedUrls.push(publicUrl)
      }
    }

    // 주소 → 좌표 변환 (지도 뷰에서 카카오 OVER_QUERY_LIMIT 회피용 캐싱).
    // 실패해도 매물 등록 자체는 진행 — 좌표는 다음 지도 뷰 진입 시 보충됨.
    const coords = await geocodeAddress(address)

    const { data: inserted, error: insertError } = await supabase.from('broker_properties').insert({
      broker_id: broker.id,
      deal_type: dealType,
      room_type: roomType,
      address,
      price: Number(price),
      monthly_rent: monthlyRent ? Number(monthlyRent) : null,
      size_pyeong: sizePyeong ? Number(sizePyeong) : null,
      area_type: areaType,
      area_unit: areaUnit,
      floor: floor ? Number(floor) : null,
      total_floors: totalFloors ? Number(totalFloors) : null,
      description: description || null,
      options: [],
      images: uploadedUrls,
      assignee: assignee || null,
      brief_memo: briefMemo || null,
      management_fee: managementFee ? Number(managementFee) : null,
      premium: premium ? Number(premium) : null,
      memo: memo || null,
      status: 'available',
      lat: coords?.lat ?? null,
      lng: coords?.lng ?? null,
    }).select('id').single()

    if (insertError) {
      setError('등록 중 오류가 발생했습니다.')
      setLoading(false)
      return
    }

    if (skipped.length > 0) {
      toast.error(`일부 이미지가 업로드되지 않았어요:\n${skipped.join('\n')}`)
    }

    // 매칭 고객에게 푸시 발송 (트리거가 DB notifications는 이미 채움, 푸시만 추가)
    if (inserted?.id) {
      try {
        await fetch('/api/properties/notify-matches', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ propertyId: inserted.id }),
        })
      } catch { /* 푸시 실패는 무시 */ }
    }

    // 사무소 대표에게 알림 (직원이 등록한 경우)
    const propLink = inserted?.id ? `/broker/properties?focus=${inserted.id}` : undefined
    notifyOwnerOfBrokerAction(broker.id, 'property', propLink)
    // 담당자 배정 알림은 DB 트리거(notify_assignee_change)가 처리

    router.push('/broker/properties')
  }

  return (
    <div className="bg-gray-50 dark:bg-gray-950">
      <Header role="broker" />

      <div className="mx-auto max-w-2xl px-4 py-8">
        <div className="mb-6 flex items-center gap-3">
          <Link href="/broker/properties" aria-label="매물 목록" className="flex h-9 w-9 items-center justify-center rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 dark:bg-gray-800 transition-colors">
            <ArrowLeft className="h-5 w-5 text-gray-600 dark:text-gray-500" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">매물 등록</h1>
            <p className="text-sm text-gray-600 dark:text-gray-400">채팅에서 바로 공유할 수 있어요</p>
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="space-y-5">

            {/* 거래 유형 */}
            <Card>
              <CardBody>
                <p className="mb-3 text-sm font-semibold text-gray-700 dark:text-gray-300">거래 유형 <span className="text-red-500">*</span></p>
                <div className="flex gap-2">
                  {DEAL_TYPES.map(t => (
                    <button
                      key={t} type="button"
                      onClick={() => setDealType(t)}
                      className={cn(
                        'flex-1 rounded-xl border-2 py-2.5 text-sm font-semibold transition-all',
                        dealType === t
                          ? 'border-blue-500 bg-blue-50 text-blue-700'
                          : 'border-gray-200 text-gray-600 hover:border-gray-300'
                      )}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </CardBody>
            </Card>

            {/* 매물 유형 — 주거/비주거 카테고리별 */}
            <Card>
              <CardBody>
                <p className="mb-3 text-sm font-semibold text-gray-700 dark:text-gray-300">매물 유형 <span className="text-red-500">*</span></p>
                <div className="space-y-3">
                  {PROPERTY_CATEGORIES.map(cat => (
                    <div key={cat.label}>
                      <p className="mb-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">{cat.label}</p>
                      <div className="grid grid-cols-4 gap-2">
                        {cat.types.map(t => (
                          <button
                            key={t} type="button"
                            onClick={() => setRoomType(t)}
                            className={cn(
                              'rounded-xl border-2 py-2 text-xs font-medium transition-all',
                              roomType === t
                                ? 'border-blue-500 bg-blue-50 text-blue-700'
                                : 'border-gray-200 text-gray-600 hover:border-gray-300'
                            )}
                          >
                            {t}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </CardBody>
            </Card>

            {/* 주소 */}
            <Card>
              <CardBody>
                <Input
                  label="매물 주소 *"
                  placeholder="서울시 강남구 역삼동 123-45"
                  value={address}
                  onChange={e => setAddress(e.target.value)}
                  required
                />
              </CardBody>
            </Card>

            {/* 가격 */}
            <Card>
              <CardBody className="space-y-3">
                <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                  {dealType === '월세' ? '보증금 (만원)' : dealType === '전세' ? '전세금 (만원)' : '매매가 (만원)'}
                  <span className="text-red-500"> *</span>
                </p>
                <Input
                  type="number"
                  placeholder={dealType === '매매' ? '50000' : dealType === '전세' ? '30000' : '5000'}
                  value={price}
                  onChange={e => setPrice(e.target.value)}
                  required
                />
                {dealType === '월세' && (
                  <Input
                    label="월세 금액 (만원)"
                    type="number"
                    placeholder="80"
                    value={monthlyRent}
                    onChange={e => setMonthlyRent(e.target.value)}
                  />
                )}
                <div className="grid grid-cols-2 gap-3">
                  <Input
                    label="관리비 (만원, 선택)"
                    type="number"
                    placeholder="10"
                    value={managementFee}
                    onChange={e => setManagementFee(e.target.value)}
                  />
                  <Input
                    label="권리금 (만원, 선택)"
                    type="number"
                    placeholder="500"
                    value={premium}
                    onChange={e => setPremium(e.target.value)}
                  />
                </div>
              </CardBody>
            </Card>

            {/* 크기·층수 */}
            <Card>
              <CardBody>
                <p className="mb-3 text-sm font-semibold text-gray-700 dark:text-gray-300">크기 / 층수 (선택)</p>
                <div className="space-y-3">
                  {/* 면적 입력 + 단위/구분 토글 */}
                  <div>
                    <p className="mb-1.5 text-xs text-gray-500">면적</p>
                    <div className="flex gap-2 items-center">
                      <Input
                        type="number"
                        placeholder={areaUnit === '평' ? '25' : '82'}
                        value={sizePyeong}
                        onChange={e => setSizePyeong(e.target.value)}
                        className="flex-1"
                      />
                      {/* 단위 토글: 평 / m² */}
                      <div className="flex rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden flex-shrink-0">
                        {(['평', 'm²'] as const).map(u => (
                          <button key={u} type="button" onClick={() => setAreaUnit(u)}
                            className={cn('px-3 py-2 text-xs font-semibold transition-colors',
                              areaUnit === u ? 'bg-blue-500 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'
                            )}>
                            {u}
                          </button>
                        ))}
                      </div>
                      {/* 전용/공급 토글 */}
                      <div className="flex rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden flex-shrink-0">
                        {(['전용', '공급'] as const).map(t => (
                          <button key={t} type="button" onClick={() => setAreaType(t)}
                            className={cn('px-3 py-2 text-xs font-semibold transition-colors',
                              areaType === t ? 'bg-blue-500 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'
                            )}>
                            {t}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                  {/* 층수 */}
                  <div className="grid grid-cols-2 gap-3">
                    <Input
                      label="층"
                      type="number"
                      placeholder="3"
                      value={floor}
                      onChange={e => setFloor(e.target.value)}
                    />
                    <Input
                      label="건물 총 층"
                      type="number"
                      placeholder="10"
                      value={totalFloors}
                      onChange={e => setTotalFloors(e.target.value)}
                    />
                  </div>
                </div>
              </CardBody>
            </Card>


            {/* 사진 업로드 */}
            <Card>
              <CardBody>
                <p className="mb-3 text-sm font-semibold text-gray-700 dark:text-gray-300">
                  매물 사진 <span className="text-gray-500 font-normal">(선택 · 최대 5장)</span>
                </p>
                <div className="flex flex-wrap gap-3">
                  {imagePreviews.map((src, i) => (
                    <div key={i} className="relative h-24 w-24 rounded-xl overflow-hidden border border-gray-200 dark:border-gray-800">
                      <img src={src} alt="매물 사진" className="h-full w-full object-cover" />
                      <button
                        type="button"
                        onClick={() => removeImage(i)}
                        className="absolute top-1 right-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                  {images.length < 5 && (
                    <label className="flex h-24 w-24 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-gray-300 dark:border-gray-700 text-gray-500 hover:border-blue-400 hover:text-blue-500 transition-colors">
                      <ImagePlus className="h-6 w-6 mb-1" />
                      <span className="text-xs">사진 추가</span>
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        className="hidden"
                        onChange={handleImageChange}
                      />
                    </label>
                  )}
                </div>
              </CardBody>
            </Card>

            {/* 설명 */}
            <Card>
              <CardBody>
                <label htmlFor={descriptionId} className="mb-2 block text-sm font-semibold text-gray-700 dark:text-gray-300">매물 설명 (선택)</label>
                <textarea
                  id={descriptionId}
                  placeholder="매물의 특징, 장점 등을 자유롭게 적어주세요&#10;예: 역세권 도보 5분, 채광 좋음, 신축"
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  rows={4}
                  maxLength={2000}
                  className="w-full rounded-xl border border-gray-200 dark:border-gray-800 px-4 py-3 text-sm placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 resize-none"
                />
              </CardBody>
            </Card>

            {/* 담당자 + 간단메모 */}
            <Card>
              <CardBody className="space-y-3">
                <Input
                  label="담당자"
                  placeholder="홍길동"
                  value={assignee}
                  onChange={e => setAssignee(e.target.value)}
                />
                <div>
                  <label htmlFor={briefMemoId} className="mb-1.5 block text-sm font-semibold text-gray-700 dark:text-gray-300">간단메모</label>
                  <input
                    id={briefMemoId}
                    type="text"
                    placeholder="목록에서 바로 보이는 짧은 메모"
                    value={briefMemo}
                    onChange={e => setBriefMemo(e.target.value)}
                    className="w-full rounded-xl border border-gray-200 dark:border-gray-800 px-4 py-2.5 text-sm placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>
                <p className="text-xs text-gray-500">🔒 고객에게 노출되지 않습니다</p>
              </CardBody>
            </Card>

            {/* 중개사 메모 */}
            <Card>
              <CardBody>
                <label htmlFor={memoId} className="mb-2 block text-sm font-semibold text-gray-700 dark:text-gray-300">
                  중개사 메모
                  <span className="ml-2 text-xs font-normal text-orange-500">🔒 나만 볼 수 있어요</span>
                </label>
                <textarea
                  id={memoId}
                  placeholder="내부 메모, 집주인 연락처, 특이사항 등 개인 메모를 남기세요"
                  value={memo}
                  onChange={e => setMemo(e.target.value)}
                  rows={3}
                  maxLength={2000}
                  className="w-full rounded-xl border border-orange-200 bg-orange-50 px-4 py-3 text-sm placeholder-gray-400 focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-400/20 resize-none"
                />
              </CardBody>
            </Card>

            {error && (
              <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>
            )}

            <Button type="submit" size="lg" className="w-full" loading={loading}>
              <Building2 className="mr-2 h-5 w-5" />
              매물 등록 완료
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
