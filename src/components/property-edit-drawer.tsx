'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { X, Building2, ImagePlus, Check } from 'lucide-react'

const DEAL_TYPES = ['매매', '전세', '월세']
const ROOM_TYPES = ['원룸', '투룸', '쓰리룸 이상', '아파트', '오피스텔', '빌라/연립', '상가', '사무실', '창고/공장', '토지', '기타']
const OPTIONS = ['풀옵션', '에어컨', '세탁기', '냉장고', '전자레인지', '인터넷', '주차 가능', '엘리베이터', '반려동물 허용', 'CCTV', '도시가스', '관리비 포함']

interface Property {
  id: string
  deal_type: string
  room_type: string
  address: string
  price: number
  monthly_rent: number | null
  management_fee: number | null
  premium: number | null
  size_pyeong: number | null
  floor: number | null
  total_floors: number | null
  options: string[]
  images: string[]
  brief_memo: string | null
  description: string | null
  memo: string | null
  assignee: string | null
  status: 'available' | 'contracted' | 'hidden'
}

interface Props {
  property: Property | null
  onClose: () => void
  onSaved: (updated: Property) => void
}

export function PropertyEditDrawer({ property, onClose, onSaved }: Props) {
  const supabase = createClient()

  const [dealType, setDealType] = useState('')
  const [roomType, setRoomType] = useState('')
  const [address, setAddress] = useState('')
  const [price, setPrice] = useState('')
  const [monthlyRent, setMonthlyRent] = useState('')
  const [managementFee, setManagementFee] = useState('')
  const [premium, setPremium] = useState('')
  const [sizePyeong, setSizePyeong] = useState('')
  const [floor, setFloor] = useState('')
  const [totalFloors, setTotalFloors] = useState('')
  const [description, setDescription] = useState('')
  const [selectedOptions, setSelectedOptions] = useState<string[]>([])
  const [assignee, setAssignee] = useState('')
  const [briefMemo, setBriefMemo] = useState('')
  const [memo, setMemo] = useState('')
  const [existingImages, setExistingImages] = useState<string[]>([])
  const [newImages, setNewImages] = useState<File[]>([])
  const [newImagePreviews, setNewImagePreviews] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!property) return
    setDealType(property.deal_type ?? '')
    setRoomType(property.room_type ?? '')
    setAddress(property.address ?? '')
    setPrice(property.price ? String(property.price) : '')
    setMonthlyRent(property.monthly_rent ? String(property.monthly_rent) : '')
    setManagementFee(property.management_fee ? String(property.management_fee) : '')
    setPremium(property.premium ? String(property.premium) : '')
    setSizePyeong(property.size_pyeong ? String(property.size_pyeong) : '')
    setFloor(property.floor ? String(property.floor) : '')
    setTotalFloors(property.total_floors ? String(property.total_floors) : '')
    setDescription(property.description ?? '')
    setSelectedOptions(property.options ?? [])
    setAssignee(property.assignee ?? '')
    setBriefMemo(property.brief_memo ?? '')
    setMemo(property.memo ?? '')
    setExistingImages(property.images ?? [])
    setNewImages([])
    setNewImagePreviews([])
    setError('')
    setSaved(false)
  }, [property?.id])

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    const total = existingImages.length + newImages.length + files.length
    if (total > 5) { setError('사진은 최대 5장까지 가능합니다.'); return }
    setNewImages(prev => [...prev, ...files])
    files.forEach(file => {
      const reader = new FileReader()
      reader.onload = ev => setNewImagePreviews(prev => [...prev, ev.target?.result as string])
      reader.readAsDataURL(file)
    })
  }

  const handleSubmit = async () => {
    if (!property || !dealType || !roomType || !address || !price) {
      setError('거래유형, 매물유형, 주소, 가격은 필수입니다.')
      return
    }
    setSaving(true)
    setError('')

    let user: any = null
    try {
      const { data } = await supabase.auth.getUser()
      user = data.user
    } catch { setError('인증 오류가 발생했습니다.'); setSaving(false); return }

    // 새 이미지 업로드
    const uploadedUrls: string[] = []
    for (const file of newImages) {
      const ext = file.name.split('.').pop()
      const path = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
      const { error: uploadError } = await supabase.storage.from('property-images').upload(path, file, { upsert: false })
      if (!uploadError) {
        const { data: { publicUrl } } = supabase.storage.from('property-images').getPublicUrl(path)
        uploadedUrls.push(publicUrl)
      }
    }

    const allImages = [...existingImages, ...uploadedUrls]

    const updateData = {
      deal_type: dealType,
      room_type: roomType,
      address,
      price: Number(price),
      monthly_rent: monthlyRent ? Number(monthlyRent) : null,
      management_fee: managementFee ? Number(managementFee) : null,
      premium: premium ? Number(premium) : null,
      size_pyeong: sizePyeong ? Number(sizePyeong) : null,
      floor: floor ? Number(floor) : null,
      total_floors: totalFloors ? Number(totalFloors) : null,
      description: description || null,
      options: selectedOptions,
      images: allImages,
      assignee: assignee || null,
      brief_memo: briefMemo || null,
      memo: memo || null,
    }

    const { data: updated, error: updateError } = await supabase
      .from('broker_properties')
      .update(updateData)
      .eq('id', property.id)
      .select()
      .single()

    if (updateError) { setError('저장 중 오류가 발생했습니다.'); setSaving(false); return }

    setSaving(false)
    setSaved(true)
    onSaved(updated)
    setTimeout(() => setSaved(false), 2000)
  }

  const open = !!property

  return (
    <>
      {/* 오버레이 */}
      {open && (
        <div className="fixed inset-0 z-30 bg-black/20" onClick={onClose} />
      )}

      {/* 드로어 */}
      <div className={cn(
        'fixed right-0 top-0 z-40 h-full w-full max-w-md bg-white shadow-2xl transition-transform duration-300 flex flex-col',
        open ? 'translate-x-0' : 'translate-x-full'
      )}>
        {/* 헤더 */}
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <div>
            <h2 className="font-bold text-gray-900">매물 수정</h2>
            <p className="text-xs text-gray-400 truncate max-w-[280px]">{property?.address}</p>
          </div>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-gray-100 transition-colors">
            <X className="h-4 w-4 text-gray-500" />
          </button>
        </div>

        {/* 폼 내용 */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">

          {/* 거래유형 */}
          <div>
            <p className="mb-2 text-sm font-semibold text-gray-700">거래 유형 <span className="text-red-500">*</span></p>
            <div className="flex gap-2">
              {DEAL_TYPES.map(t => (
                <button key={t} type="button" onClick={() => setDealType(t)}
                  className={cn('flex-1 rounded-xl border-2 py-2 text-sm font-semibold transition-all',
                    dealType === t ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600 hover:border-gray-300'
                  )}
                >{t}</button>
              ))}
            </div>
          </div>

          {/* 매물유형 */}
          <div>
            <p className="mb-2 text-sm font-semibold text-gray-700">매물 유형 <span className="text-red-500">*</span></p>
            <div className="grid grid-cols-4 gap-1.5">
              {ROOM_TYPES.map(t => (
                <button key={t} type="button" onClick={() => setRoomType(t)}
                  className={cn('rounded-xl border-2 py-1.5 text-xs font-medium transition-all',
                    roomType === t ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600 hover:border-gray-300'
                  )}
                >{t}</button>
              ))}
            </div>
          </div>

          {/* 주소 */}
          <Input label="주소 *" value={address} onChange={e => setAddress(e.target.value)} placeholder="서울시 강남구 역삼동 123" />

          {/* 가격 */}
          <div className="space-y-3">
            <Input
              label={dealType === '월세' ? '보증금 (만원) *' : dealType === '전세' ? '전세금 (만원) *' : '매매가 (만원) *'}
              type="number" value={price} onChange={e => setPrice(e.target.value)}
            />
            {dealType === '월세' && (
              <Input label="월세 (만원)" type="number" value={monthlyRent} onChange={e => setMonthlyRent(e.target.value)} placeholder="80" />
            )}
            <div className="grid grid-cols-2 gap-3">
              <Input label="관리비 (만원)" type="number" value={managementFee} onChange={e => setManagementFee(e.target.value)} placeholder="10" />
              <Input label="권리금 (만원)" type="number" value={premium} onChange={e => setPremium(e.target.value)} placeholder="500" />
            </div>
          </div>

          {/* 크기·층수 */}
          <div className="grid grid-cols-3 gap-2">
            <Input label="평수" type="number" value={sizePyeong} onChange={e => setSizePyeong(e.target.value)} placeholder="25" />
            <Input label="층" type="number" value={floor} onChange={e => setFloor(e.target.value)} placeholder="3" />
            <Input label="총층수" type="number" value={totalFloors} onChange={e => setTotalFloors(e.target.value)} placeholder="10" />
          </div>

          {/* 옵션 */}
          <div>
            <p className="mb-2 text-sm font-semibold text-gray-700">옵션</p>
            <div className="flex flex-wrap gap-1.5">
              {OPTIONS.map(opt => (
                <button key={opt} type="button"
                  onClick={() => setSelectedOptions(prev => prev.includes(opt) ? prev.filter(o => o !== opt) : [...prev, opt])}
                  className={cn('rounded-full border px-3 py-1 text-xs font-medium transition-all',
                    selectedOptions.includes(opt) ? 'border-blue-500 bg-blue-500 text-white' : 'border-gray-200 text-gray-600 hover:border-gray-300'
                  )}
                >{opt}</button>
              ))}
            </div>
          </div>

          {/* 사진 */}
          <div>
            <p className="mb-2 text-sm font-semibold text-gray-700">사진 <span className="text-gray-400 font-normal text-xs">(최대 5장)</span></p>
            <div className="flex flex-wrap gap-2">
              {existingImages.map((src, i) => (
                <div key={`e-${i}`} className="relative h-16 w-16 overflow-hidden rounded-lg border border-gray-200">
                  <img src={src} alt="" className="h-full w-full object-cover" />
                  <button type="button" onClick={() => setExistingImages(prev => prev.filter((_, idx) => idx !== i))}
                    className="absolute top-0.5 right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-black/50 text-white text-[10px]"
                  >✕</button>
                </div>
              ))}
              {newImagePreviews.map((src, i) => (
                <div key={`n-${i}`} className="relative h-16 w-16 overflow-hidden rounded-lg border border-blue-200">
                  <img src={src} alt="" className="h-full w-full object-cover" />
                  <button type="button" onClick={() => { setNewImages(p => p.filter((_, idx) => idx !== i)); setNewImagePreviews(p => p.filter((_, idx) => idx !== i)) }}
                    className="absolute top-0.5 right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-black/50 text-white text-[10px]"
                  >✕</button>
                </div>
              ))}
              {existingImages.length + newImages.length < 5 && (
                <label className="flex h-16 w-16 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 text-gray-400 hover:border-blue-400 hover:text-blue-500 transition-colors">
                  <ImagePlus className="h-5 w-5" />
                  <input type="file" accept="image/*" multiple className="hidden" onChange={handleImageChange} />
                </label>
              )}
            </div>
          </div>

          {/* 매물 설명 */}
          <div>
            <label className="mb-1.5 block text-sm font-semibold text-gray-700">매물 설명</label>
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3}
              placeholder="매물 특징, 장점 등"
              className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 resize-none"
            />
          </div>

          {/* 담당자 + 간단메모 */}
          <div className="rounded-xl border border-gray-100 bg-gray-50 p-4 space-y-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">🔒 내부 정보 (고객 비공개)</p>
            <Input label="담당자" value={assignee} onChange={e => setAssignee(e.target.value)} placeholder="홍길동" />
            <div>
              <label className="mb-1.5 block text-sm font-semibold text-gray-700">간단메모</label>
              <input type="text" value={briefMemo} onChange={e => setBriefMemo(e.target.value)}
                placeholder="목록에서 바로 보이는 짧은 메모"
                className="w-full rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-semibold text-gray-700">상세 메모</label>
              <textarea value={memo} onChange={e => setMemo(e.target.value)} rows={3}
                placeholder="집주인 연락처, 특이사항 등"
                className="w-full rounded-xl border border-orange-200 bg-orange-50 px-4 py-3 text-sm placeholder-gray-400 focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-400/20 resize-none"
              />
            </div>
          </div>

          {error && <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>}
        </div>

        {/* 하단 버튼 */}
        <div className="border-t border-gray-100 px-5 py-4">
          <Button onClick={handleSubmit} size="lg" className="w-full" loading={saving}>
            {saved ? <><Check className="mr-2 h-4 w-4" />저장됨</> : '저장하기'}
          </Button>
        </div>
      </div>
    </>
  )
}
