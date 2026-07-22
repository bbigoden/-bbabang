'use client'

import { useEffect, useState, useId } from 'react'
import type { User } from '@supabase/supabase-js'
import { useRouter, useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Header } from '@/components/layout/header'
import { useToast } from '@/components/toast'
import { Card, CardBody } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { ArrowLeft, Building2, ImagePlus, X } from 'lucide-react'
import Link from 'next/link'
import { validatePrice, validateArea } from '@/lib/validation'
import { geocodeAddress } from '@/lib/geocode'
import { PROPERTY_CATEGORIES } from '@/lib/property-types'
import { Spinner } from '@/components/ui/spinner'

const DEAL_TYPES = ['매매', '전세', '월세']
const OPTIONS = [
  '풀옵션', '에어컨', '세탁기', '냉장고', '전자레인지', '인터넷',
  '주차 가능', '엘리베이터', '반려동물 허용', 'CCTV', '도시가스', '관리비 포함',
]

export default function EditPropertyPage() {
  const router = useRouter()
  const params = useParams()
  const propertyId = params.id as string
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
  const [selectedOptions, setSelectedOptions] = useState<string[]>([])
  const [assignee, setAssignee] = useState('')
  const [briefMemo, setBriefMemo] = useState('')
  const [memo, setMemo] = useState('')
  const descriptionId = useId()
  const briefMemoId = useId()
  const memoId = useId()
  const [existingImages, setExistingImages] = useState<string[]>([])
  const [originalAddress, setOriginalAddress] = useState('')
  const [originalLat, setOriginalLat] = useState<number | null>(null)
  const [originalLng, setOriginalLng] = useState<number | null>(null)
  const [newImages, setNewImages] = useState<File[]>([])
  const [newImagePreviews, setNewImagePreviews] = useState<string[]>([])
  const [user, setUser] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    loadProperty()
  }, [propertyId])

  const loadProperty = async () => {
    let user: User | null = null
    try {
      const { data } = await supabase.auth.getUser()
      user = data.user
    } catch { router.push('/auth/login'); return }
    if (!user) { router.push('/auth/login'); return }
    setUser(user)

    const { data: broker } = await supabase
      .from('broker_profiles')
      .select('id')
      .eq('user_id', user.id)
      .single()

    if (!broker) { router.push('/broker/register'); return }

    const { data: property, error } = await supabase
      .from('broker_properties')
      .select('deal_type, room_type, address, price, monthly_rent, management_fee, premium, size_pyeong, area_type, area_unit, floor, total_floors, description, options, assignee, brief_memo, memo, images, lat, lng')
      .eq('id', propertyId)
      .eq('broker_id', broker.id)
      .single()

    if (error || !property) {
      router.push('/broker/properties')
      return
    }

    setDealType(property.deal_type ?? '')
    setRoomType(property.room_type ?? '')
    setAddress(property.address ?? '')
    setOriginalAddress(property.address ?? '')
    setOriginalLat((property as any).lat ?? null)
    setOriginalLng((property as any).lng ?? null)
    setPrice(property.price ? String(property.price) : '')
    setMonthlyRent(property.monthly_rent ? String(property.monthly_rent) : '')
    setManagementFee(property.management_fee ? String(property.management_fee) : '')
    setPremium(property.premium ? String(property.premium) : '')
    setSizePyeong(property.size_pyeong ? String(property.size_pyeong) : '')
    setAreaType(property.area_type ?? '전용')
    setAreaUnit(property.area_unit ?? '평')
    setFloor(property.floor ? String(property.floor) : '')
    setTotalFloors(property.total_floors ? String(property.total_floors) : '')
    setDescription(property.description ?? '')
    setSelectedOptions(property.options ?? [])
    setAssignee(property.assignee ?? '')
    setBriefMemo(property.brief_memo ?? '')
    setMemo(property.memo ?? '')
    setExistingImages(property.images ?? [])
    setLoading(false)
  }

  const handleNewImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    const total = existingImages.length + newImages.length + files.length
    if (total > 5) {
      setError('사진은 최대 5장까지 업로드할 수 있어요.')
      return
    }
    setNewImages(prev => [...prev, ...files])
    files.forEach(file => {
      const reader = new FileReader()
      reader.onload = (ev) => {
        setNewImagePreviews(prev => [...prev, ev.target?.result as string])
      }
      reader.readAsDataURL(file)
    })
  }

  const removeExistingImage = (index: number) => {
    setExistingImages(prev => prev.filter((_, i) => i !== index))
  }

  const removeNewImage = (index: number) => {
    setNewImages(prev => prev.filter((_, i) => i !== index))
    setNewImagePreviews(prev => prev.filter((_, i) => i !== index))
  }

  const toggleOption = (opt: string) => {
    setSelectedOptions(prev =>
      prev.includes(opt) ? prev.filter(o => o !== opt) : [...prev, opt]
    )
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

    setSaving(true)
    setError('')

    let user: User | null = null
    try {
      const { data } = await supabase.auth.getUser()
      user = data.user
    } catch { setError('오류가 발생했습니다. 다시 시도해주세요.'); setSaving(false); return }
    if (!user) { router.push('/auth/login'); return }

    // 새 이미지 업로드 (skip 사유 사용자에게 알림)
    const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
    const MAX_SIZE = 10 * 1024 * 1024
    const skipped: string[] = []
    const uploadedUrls: string[] = []
    for (const file of newImages) {
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
    if (skipped.length > 0) toast.error(`일부 이미지가 업로드되지 않았어요:\n${skipped.join('\n')}`)

    const allImages = [...existingImages, ...uploadedUrls]

    // 주소가 바뀌었으면 좌표도 새로 구해 함께 저장 (지도 뷰 캐시 무효화)
    let lat: number | null = originalLat
    let lng: number | null = originalLng
    if (address !== originalAddress) {
      const coords = await geocodeAddress(address)
      lat = coords?.lat ?? null
      lng = coords?.lng ?? null
    }

    const { error: updateError } = await supabase
      .from('broker_properties')
      .update({
        deal_type: dealType,
        room_type: roomType,
        address,
        price: Number(price),
        monthly_rent: monthlyRent ? Number(monthlyRent) : null,
        management_fee: managementFee ? Number(managementFee) : null,
        premium: premium ? Number(premium) : null,
        size_pyeong: sizePyeong ? Number(sizePyeong) : null,
        area_type: areaType,
        area_unit: areaUnit,
        floor: floor ? Number(floor) : null,
        total_floors: totalFloors ? Number(totalFloors) : null,
        description: description || null,
        options: selectedOptions,
        images: allImages,
        assignee: assignee || null,
        brief_memo: briefMemo || null,
        memo: memo || null,
        lat,
        lng,
      })
      .eq('id', propertyId)

    if (updateError) {
      setError('수정 중 오류가 발생했습니다.')
      setSaving(false)
      return
    }

    router.push('/broker/properties')
  }

  const totalImageCount = existingImages.length + newImages.length

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-950">
        <Spinner size="lg" />
      </div>
    )
  }

  return (
    <div className="bg-gray-50 dark:bg-gray-950">
      <Header user={user} role="broker" />

      <div className="mx-auto max-w-2xl px-4 py-8">
        <div className="mb-6 flex items-center gap-3">
          <Link href="/broker/properties" aria-label="매물 목록" className="flex h-9 w-9 items-center justify-center rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 dark:bg-gray-800 transition-colors">
            <ArrowLeft className="h-5 w-5 text-gray-600 dark:text-gray-500" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">매물 수정</h1>
            <p className="text-sm text-gray-600 dark:text-gray-400">매물 정보를 수정할 수 있어요</p>
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="space-y-5">

            {/* 거래 유형 */}
            <Card>
              <CardBody>
                <p className="mb-3 text-sm font-semibold text-gray-700 dark:text-gray-300">거래 유형 <span className="text-red-600">*</span></p>
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

            {/* 옵션 */}
            <Card>
              <CardBody>
                <p className="mb-3 text-sm font-semibold text-gray-700 dark:text-gray-300">옵션 (선택)</p>
                <div className="flex flex-wrap gap-2">
                  {OPTIONS.map(opt => (
                    <button
                      key={opt} type="button"
                      onClick={() => toggleOption(opt)}
                      className={cn(
                        'rounded-full border px-3 py-1.5 text-xs font-medium transition-all',
                        selectedOptions.includes(opt)
                          ? 'border-blue-500 bg-blue-500 text-white'
                          : 'border-gray-200 text-gray-600 hover:border-gray-300'
                      )}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              </CardBody>
            </Card>

            {/* 사진 */}
            <Card>
              <CardBody>
                <p className="mb-3 text-sm font-semibold text-gray-700 dark:text-gray-300">
                  매물 사진 <span className="text-gray-500 font-normal">(선택 · 최대 5장)</span>
                </p>
                <div className="flex flex-wrap gap-3">
                  {/* 기존 이미지 */}
                  {existingImages.map((src, i) => (
                    <div key={`existing-${i}`} className="relative h-24 w-24 rounded-xl overflow-hidden border border-gray-200 dark:border-gray-800">
                      <img src={src} alt="매물 사진" className="h-full w-full object-cover" />
                      <button
                        type="button"
                        onClick={() => removeExistingImage(i)}
                        className="absolute top-1 right-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                  {/* 새 이미지 프리뷰 */}
                  {newImagePreviews.map((src, i) => (
                    <div key={`new-${i}`} className="relative h-24 w-24 rounded-xl overflow-hidden border border-blue-200">
                      <img src={src} alt="매물 사진" className="h-full w-full object-cover" />
                      <button
                        type="button"
                        onClick={() => removeNewImage(i)}
                        className="absolute top-1 right-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                  {totalImageCount < 5 && (
                    <label className="flex h-24 w-24 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-gray-300 dark:border-gray-700 text-gray-500 hover:border-blue-400 hover:text-blue-500 transition-colors">
                      <ImagePlus className="h-6 w-6 mb-1" />
                      <span className="text-xs">사진 추가</span>
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        className="hidden"
                        onChange={handleNewImageChange}
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

            <Button type="submit" size="lg" className="w-full" loading={saving}>
              <Building2 className="mr-2 h-5 w-5" />
              수정 완료
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
