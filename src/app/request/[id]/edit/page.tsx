'use client'

import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Header } from '@/components/layout/header'
import { cn } from '@/lib/utils'
import { CheckCircle, ChevronRight, ChevronLeft, Home } from 'lucide-react'

const DEAL_TYPES = ['매매', '월세', '전세']
const PROPERTY_CATEGORIES = [
  { label: '주거', types: ['원룸', '투룸', '쓰리룸 이상', '아파트', '오피스텔', '빌라/연립', '단독/다가구'] },
  { label: '상업', types: ['상가', '사무실', '건물 전체'] },
  { label: '기타', types: ['토지', '창고/공장', '숙박/여관'] },
]
const REGIONS: Record<string, string[]> = {
  '서울특별시': ['강남구','강동구','강북구','강서구','관악구','광진구','구로구','금천구','노원구','도봉구','동대문구','동작구','마포구','서대문구','서초구','성동구','성북구','송파구','양천구','영등포구','용산구','은평구','종로구','중구','중랑구'],
  '경기도': ['수원시','성남시','고양시','용인시','부천시','안산시','화성시','남양주시','안양시','평택시','의정부시','파주시','시흥시','김포시','광주시','광명시','군포시','하남시','오산시','이천시','안성시','의왕시','양주시','구리시','포천시','여주시','동두천시','과천시','가평군','양평군','연천군'],
  '인천광역시': ['중구','동구','미추홀구','연수구','남동구','부평구','계양구','서구','강화군','옹진군'],
  '부산광역시': ['중구','서구','동구','영도구','부산진구','동래구','남구','북구','해운대구','사하구','금정구','강서구','연제구','수영구','사상구','기장군'],
  '대구광역시': ['중구','동구','서구','남구','북구','수성구','달서구','달성군'],
  '대전광역시': ['동구','중구','서구','유성구','대덕구'],
  '광주광역시': ['동구','서구','남구','북구','광산구'],
  '울산광역시': ['중구','남구','동구','북구','울주군'],
  '세종특별자치시': ['세종시 전체'],
  '강원특별자치도': ['춘천시','원주시','강릉시','동해시','태백시','속초시','삼척시','홍천군','횡성군','영월군','평창군','정선군','철원군','화천군','양구군','인제군','고성군','양양군'],
  '충청북도': ['청주시','충주시','제천시','보은군','옥천군','영동군','증평군','진천군','괴산군','음성군','단양군'],
  '충청남도': ['천안시','공주시','보령시','아산시','서산시','논산시','계룡시','당진시','금산군','부여군','서천군','청양군','홍성군','예산군','태안군'],
  '전북특별자치도': ['전주시','군산시','익산시','정읍시','남원시','김제시','완주군','진안군','무주군','장수군','임실군','순창군','고창군','부안군'],
  '전라남도': ['목포시','여수시','순천시','나주시','광양시','담양군','곡성군','구례군','고흥군','보성군','화순군','장흥군','강진군','해남군','영암군','무안군','함평군','영광군','장성군','완도군','진도군','신안군'],
  '경상북도': ['포항시','경주시','김천시','안동시','구미시','영주시','영천시','상주시','문경시','경산시','의성군','청송군','영양군','영덕군','청도군','고령군','성주군','칠곡군','예천군','봉화군','울진군','울릉군'],
  '경상남도': ['창원시','진주시','통영시','사천시','김해시','밀양시','거제시','양산시','의령군','함안군','창녕군','고성군','남해군','하동군','산청군','함양군','거창군','합천군'],
  '제주특별자치도': ['제주시','서귀포시'],
}
const CITIES = Object.keys(REGIONS)
const STEPS = ['거래·매물 유형', '위치', '예산', '상세 조건']

export default function RequestEditPage() {
  const router = useRouter()
  const params = useParams()
  const id = params.id as string
  const supabase = createClient()

  const [step, setStep] = useState(0)
  const [loading, setLoading] = useState(false)
  const [initialLoading, setInitialLoading] = useState(true)
  const [error, setError] = useState('')

  const [dealTypes, setDealTypes] = useState<string[]>([])
  const [propertyTypes, setPropertyTypes] = useState<string[]>([])
  const [form, setForm] = useState({
    city: '서울특별시', district: '',
    min_price: '', max_price: '',
    min_monthly: '', max_monthly: '',
    min_size: '', max_size: '',
    move_in_date: '', description: '',
  })

  useEffect(() => {
    const load = async () => {
      let user: any = null
      try {
        const { data } = await supabase.auth.getUser()
        user = data.user
      } catch { router.push('/auth/login'); return }
      if (!user) { router.push('/auth/login'); return }

      const { data, error } = await supabase
        .from('request_posts')
        .select('*')
        .eq('id', id)
        .single()

      if (error || !data) { router.push('/dashboard/user'); return }
      if (data.user_id !== user.id) { router.push('/dashboard/user'); return }

      setDealTypes(data.deal_type ? data.deal_type.split(',').map((s: string) => s.trim()) : [])
      setPropertyTypes(data.room_type ? data.room_type.split(',').map((s: string) => s.trim()) : [])
      setForm({
        city: data.city ?? '서울특별시',
        district: data.district ?? '',
        min_price: data.min_price?.toString() ?? '',
        max_price: data.max_price?.toString() ?? '',
        min_monthly: data.min_monthly?.toString() ?? '',
        max_monthly: data.max_monthly?.toString() ?? '',
        min_size: data.min_size?.toString() ?? '',
        max_size: data.max_size?.toString() ?? '',
        move_in_date: data.move_in_date ?? '',
        description: data.description ?? '',
      })
      setInitialLoading(false)
    }
    load()
  }, [id])

  const update = (key: string, value: string) => setForm(prev => ({ ...prev, [key]: value }))
  const toggleDealType = (type: string) => setDealTypes(prev => prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type])
  const togglePropertyType = (type: string) => setPropertyTypes(prev => prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type])
  const handleCityChange = (city: string) => setForm(prev => ({ ...prev, city, district: '' }))
  const currentDistricts = REGIONS[form.city] ?? []

  const canNext = () => {
    if (step === 0) return dealTypes.length > 0 && propertyTypes.length > 0
    if (step === 1) return form.district !== ''
    if (step === 2) return form.min_price !== '' && form.max_price !== ''
    return true
  }

  const handleSubmit = async () => {
    setLoading(true)
    setError('')

    const { error: updateError } = await supabase
      .from('request_posts')
      .update({
        deal_type: dealTypes.join(', '),
        room_type: propertyTypes.join(', '),
        city: form.city,
        district: form.district,
        min_price: Number(form.min_price),
        max_price: Number(form.max_price),
        min_size: form.min_size ? Number(form.min_size) : null,
        max_size: form.max_size ? Number(form.max_size) : null,
        move_in_date: form.move_in_date || null,
        description: form.description || null,
      })
      .eq('id', id)

    if (updateError) {
      setError('수정 중 오류가 발생했습니다.')
      setLoading(false)
      return
    }

    router.push(`/request/${id}`)
  }

  if (initialLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-400">불러오는 중...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      <div className="mx-auto max-w-xl px-4 py-10">
        {/* 스텝 인디케이터 */}
        <div className="mb-8">
          <div className="flex items-center">
            {STEPS.map((s, i) => (
              <div key={s} className="flex items-center">
                <div className={cn(
                  'flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold transition-all',
                  i < step ? 'bg-blue-600 text-white' : i === step ? 'bg-blue-600 text-white ring-4 ring-blue-100' : 'bg-gray-200 text-gray-400'
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
            <p className="text-xs text-gray-400">Step {step + 1} / {STEPS.length} · 요청 수정</p>
            <h2 className="mt-1 text-xl font-bold text-gray-900">{STEPS[step]}</h2>
          </div>
        </div>

        <div className="rounded-2xl bg-white p-6 shadow-sm border border-gray-100">
          {/* Step 0 */}
          {step === 0 && (
            <div className="space-y-6">
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-sm font-medium text-gray-700">거래 유형</p>
                  <span className="text-xs text-gray-400">중복 선택 가능</span>
                </div>
                <div className="flex gap-3">
                  {DEAL_TYPES.map((type) => (
                    <button key={type} onClick={() => toggleDealType(type)}
                      className={cn('flex-1 rounded-xl border-2 py-3 text-sm font-semibold transition-all',
                        dealTypes.includes(type) ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600 hover:border-gray-300')}>
                      {dealTypes.includes(type) && '✓ '}{type}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-sm font-medium text-gray-700">매물 유형</p>
                  <span className="text-xs text-gray-400">중복 선택 가능</span>
                </div>
                <div className="space-y-3">
                  {PROPERTY_CATEGORIES.map((cat) => (
                    <div key={cat.label}>
                      <p className="mb-1.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">{cat.label}</p>
                      <div className="flex flex-wrap gap-2">
                        {cat.types.map((type) => (
                          <button key={type} onClick={() => togglePropertyType(type)}
                            className={cn('rounded-xl border-2 px-3 py-2 text-sm font-medium transition-all',
                              propertyTypes.includes(type) ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600 hover:border-gray-300')}>
                            {propertyTypes.includes(type) && '✓ '}{type}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Step 1 */}
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <p className="mb-2 text-sm font-medium text-gray-700">시 / 도</p>
                <select value={form.city} onChange={(e) => handleCityChange(e.target.value)}
                  className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20">
                  {CITIES.map((city) => <option key={city} value={city}>{city}</option>)}
                </select>
              </div>
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-sm font-medium text-gray-700">구 / 군 / 시</p>
                  {form.district && <span className="text-xs font-semibold text-blue-600">✓ {form.district} 선택됨</span>}
                </div>
                <div className="grid grid-cols-3 gap-2 max-h-56 overflow-y-auto pr-1">
                  {currentDistricts.map((d) => (
                    <button key={d} onClick={() => update('district', d)}
                      className={cn('rounded-xl border-2 py-2 text-xs font-medium transition-all',
                        form.district === d ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600 hover:border-gray-300')}>
                      {d}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Step 2 */}
          {step === 2 && (
            <div className="space-y-5">
              <p className="text-sm text-gray-500">희망 예산 범위를 입력해주세요 <span className="text-gray-400">(단위: 만원)</span></p>
              {(dealTypes.includes('전세') || dealTypes.includes('매매')) && (
                <div className="grid grid-cols-2 gap-3">
                  <Input label="최소값 (만원)" type="number" placeholder="20000" value={form.min_price} onChange={(e) => update('min_price', e.target.value)} />
                  <Input label="최대값 (만원)" type="number" placeholder="50000" value={form.max_price} onChange={(e) => update('max_price', e.target.value)} />
                </div>
              )}
              {dealTypes.includes('월세') && (
                <div className="space-y-3 rounded-xl border border-gray-100 bg-gray-50 p-4">
                  <p className="text-xs font-semibold text-gray-500">월세 보증금</p>
                  <div className="grid grid-cols-2 gap-3">
                    <Input label="보증금 최소 (만원)" type="number" placeholder="500" value={form.min_price} onChange={(e) => update('min_price', e.target.value)} />
                    <Input label="보증금 최대 (만원)" type="number" placeholder="3000" value={form.max_price} onChange={(e) => update('max_price', e.target.value)} />
                  </div>
                  <p className="text-xs font-semibold text-gray-500 mt-2">월세 금액</p>
                  <div className="grid grid-cols-2 gap-3">
                    <Input label="월세 최소 (만원)" type="number" placeholder="30" value={form.min_monthly} onChange={(e) => update('min_monthly', e.target.value)} />
                    <Input label="월세 최대 (만원)" type="number" placeholder="80" value={form.max_monthly} onChange={(e) => update('max_monthly', e.target.value)} />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Step 3 */}
          {step === 3 && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <Input label="최소 면적" type="number" placeholder="10" value={form.min_size} onChange={(e) => update('min_size', e.target.value)} hint="평 단위" />
                <Input label="최대 면적" type="number" placeholder="30" value={form.max_size} onChange={(e) => update('max_size', e.target.value)} hint="평 단위" />
              </div>
              <Input label="입주 희망일" type="date" value={form.move_in_date} onChange={(e) => update('move_in_date', e.target.value)} />
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700">추가 요청사항 <span className="text-gray-400 font-normal">(선택)</span></label>
                <textarea placeholder="예: 반려동물 가능, 주차 필수, 역세권 선호" value={form.description}
                  onChange={(e) => update('description', e.target.value)} rows={4}
                  className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 resize-none" />
              </div>
              <div className="rounded-xl bg-gray-50 p-4 text-sm space-y-1">
                <p className="font-semibold text-gray-700 mb-2">수정 요약</p>
                <p className="text-gray-600">📋 거래: <span className="font-medium">{dealTypes.join(', ')}</span></p>
                <p className="text-gray-600">🏠 매물: <span className="font-medium">{propertyTypes.join(', ')}</span></p>
                <p className="text-gray-600">📍 위치: <span className="font-medium">{form.city} {form.district}</span></p>
                <p className="text-gray-600">💰 예산: <span className="font-medium">{Number(form.min_price).toLocaleString()}만 ~ {Number(form.max_price).toLocaleString()}만원</span></p>
              </div>
            </div>
          )}

          {error && <div className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>}
        </div>

        <div className="mt-6 flex gap-3">
          {step > 0 && (
            <Button variant="secondary" size="lg" className="flex-1" onClick={() => setStep(step - 1)}>
              <ChevronLeft className="mr-1 h-4 w-4" /> 이전
            </Button>
          )}
          {step < STEPS.length - 1 ? (
            <Button variant="primary" size="lg" className="flex-1" disabled={!canNext()} onClick={() => setStep(step + 1)}>
              다음 <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          ) : (
            <Button variant="primary" size="lg" className="flex-1" loading={loading} disabled={!canNext()} onClick={handleSubmit}>
              <Home className="mr-2 h-4 w-4" /> 수정 완료
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
