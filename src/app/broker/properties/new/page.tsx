'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Header } from '@/components/layout/header'
import { Card, CardBody } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { ArrowLeft, Building2, ImagePlus, X } from 'lucide-react'
import Link from 'next/link'

const DEAL_TYPES = ['매매', '전세', '월세']
const ROOM_TYPES = ['원룸', '투룸', '쓰리룸 이상', '아파트', '오피스텔', '빌라/연립', '상가', '사무실']
const OPTIONS_GROUPS = [
  { label: '가전', items: ['풀옵션', '에어컨', '냉장고', '세탁기', '건조기', '전자레인지', '인덕션', '가스레인지', '식기세척기', 'TV'] },
  { label: '가구', items: ['침대', '소파', '책상', '옷장', '붙박이장', '신발장'] },
  { label: '시설', items: ['주차 가능', '엘리베이터', '도시가스', '인터넷', '반려동물 허용', 'CCTV'] },
]
const OPTIONS = OPTIONS_GROUPS.flatMap(g => g.items)

export default function NewPropertyPage() {
  const router = useRouter()
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
  const [images, setImages] = useState<File[]>([])
  const [imagePreviews, setImagePreviews] = useState<string[]>([])
  const [user, setUser] = useState<any>(null)
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

    setLoading(true)
    setError('')

    let user: any = null
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

    // 이미지 업로드
    const uploadedUrls: string[] = []
    for (const file of images) {
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

    const { error: insertError } = await supabase.from('broker_properties').insert({
      broker_id: broker.id,
      deal_type: dealType,
      room_type: roomType,
      address,
      price: Number(price),
      monthly_rent: monthlyRent ? Number(monthlyRent) : null,
      size_pyeong: sizePyeong ? Number(sizePyeong) : null,
      floor: floor ? Number(floor) : null,
      total_floors: totalFloors ? Number(totalFloors) : null,
      description: description || null,
      options: selectedOptions,
      images: uploadedUrls,
      assignee: assignee || null,
      brief_memo: briefMemo || null,
      management_fee: managementFee ? Number(managementFee) : null,
      premium: premium ? Number(premium) : null,
      memo: memo || null,
      status: 'available',
    })

    if (insertError) {
      setError('등록 중 오류가 발생했습니다.')
      setLoading(false)
      return
    }

    router.push('/broker/properties')
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Header user={user} role="broker" />

      <div className="mx-auto max-w-xl px-4 py-8">
        <div className="mb-6 flex items-center gap-3">
          <Link href="/broker/properties" className="flex h-9 w-9 items-center justify-center rounded-xl hover:bg-gray-100 transition-colors">
            <ArrowLeft className="h-5 w-5 text-gray-600" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">매물 등록</h1>
            <p className="text-sm text-gray-500">채팅에서 바로 공유할 수 있어요</p>
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="space-y-5">

            {/* 거래 유형 */}
            <Card>
              <CardBody>
                <p className="mb-3 text-sm font-semibold text-gray-700">거래 유형 <span className="text-red-500">*</span></p>
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

            {/* 매물 유형 */}
            <Card>
              <CardBody>
                <p className="mb-3 text-sm font-semibold text-gray-700">매물 유형 <span className="text-red-500">*</span></p>
                <div className="grid grid-cols-4 gap-2">
                  {ROOM_TYPES.map(t => (
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
                <p className="text-sm font-semibold text-gray-700">
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
                <p className="mb-3 text-sm font-semibold text-gray-700">크기 / 층수 (선택)</p>
                <div className="grid grid-cols-3 gap-3">
                  <Input
                    label="평수"
                    type="number"
                    placeholder="25"
                    value={sizePyeong}
                    onChange={e => setSizePyeong(e.target.value)}
                  />
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
              </CardBody>
            </Card>

            {/* 옵션 */}
            <Card>
              <CardBody>
                <p className="mb-1 text-sm font-semibold text-gray-700">옵션 <span className="text-xs font-normal text-gray-400">(입주 시 제공되는 가전·가구)</span></p>
                <div className="space-y-3 mt-3">
                  {OPTIONS_GROUPS.map(group => (
                    <div key={group.label}>
                      <p className="mb-1.5 text-xs font-semibold text-gray-400">{group.label}</p>
                      <div className="flex flex-wrap gap-2">
                        {group.items.map(opt => (
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
                    </div>
                  ))}
                </div>
              </CardBody>
            </Card>

            {/* 사진 업로드 */}
            <Card>
              <CardBody>
                <p className="mb-3 text-sm font-semibold text-gray-700">
                  매물 사진 <span className="text-gray-400 font-normal">(선택 · 최대 5장)</span>
                </p>
                <div className="flex flex-wrap gap-3">
                  {imagePreviews.map((src, i) => (
                    <div key={i} className="relative h-24 w-24 rounded-xl overflow-hidden border border-gray-200">
                      <img src={src} alt="" className="h-full w-full object-cover" />
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
                    <label className="flex h-24 w-24 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-gray-300 text-gray-400 hover:border-blue-400 hover:text-blue-500 transition-colors">
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
                <label className="mb-2 block text-sm font-semibold text-gray-700">매물 설명 (선택)</label>
                <textarea
                  placeholder="매물의 특징, 장점 등을 자유롭게 적어주세요&#10;예: 역세권 도보 5분, 채광 좋음, 신축"
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  rows={4}
                  className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 resize-none"
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
                  <label className="mb-1.5 block text-sm font-semibold text-gray-700">간단메모</label>
                  <input
                    type="text"
                    placeholder="목록에서 바로 보이는 짧은 메모"
                    value={briefMemo}
                    onChange={e => setBriefMemo(e.target.value)}
                    className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>
                <p className="text-xs text-gray-400">🔒 고객에게 노출되지 않습니다</p>
              </CardBody>
            </Card>

            {/* 중개사 메모 */}
            <Card>
              <CardBody>
                <label className="mb-2 block text-sm font-semibold text-gray-700">
                  중개사 메모
                  <span className="ml-2 text-xs font-normal text-orange-500">🔒 나만 볼 수 있어요</span>
                </label>
                <textarea
                  placeholder="내부 메모, 집주인 연락처, 특이사항 등 개인 메모를 남기세요"
                  value={memo}
                  onChange={e => setMemo(e.target.value)}
                  rows={3}
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
