'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Header } from '@/components/layout/header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardBody } from '@/components/ui/card'
import { Shield, CheckCircle, X } from 'lucide-react'
import { cn } from '@/lib/utils'

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

export default function BrokerRegisterPage() {
  const router = useRouter()
  const supabase = createClient()

  const [selectedCity, setSelectedCity] = useState('서울특별시')
  const [selectedDistricts, setSelectedDistricts] = useState<string[]>([]) // 복수 선택
  const [form, setForm] = useState({ office_name: '', license_number: '', address: '', bio: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const update = (key: string, value: string) => setForm(prev => ({ ...prev, [key]: value }))

  const toggleDistrict = (d: string) => {
    setSelectedDistricts(prev =>
      prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d]
    )
  }

  const removeDistrict = (d: string) =>
    setSelectedDistricts(prev => prev.filter(x => x !== d))

  const handleCityChange = (city: string) => {
    setSelectedCity(city)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (selectedDistricts.length === 0) { setError('활동 지역을 최소 1개 선택해주세요.'); return }
    setLoading(true)
    setError('')

    let user: any = null
    try {
      const { data } = await supabase.auth.getUser()
      user = data.user
    } catch { setError('오류가 발생했습니다. 다시 시도해주세요.'); setLoading(false); return }
    if (!user) { router.push('/auth/login'); return }

    const { error: insertError } = await supabase.from('broker_profiles').insert({
      user_id: user.id,
      office_name: form.office_name,
      license_number: form.license_number,
      address: form.address,
      district: selectedDistricts.join(','), // 복수 지역 콤마 구분
      bio: form.bio || null,
      rating: 0,
      review_count: 0,
      deal_count: 0,
      is_verified: false,
    })

    if (insertError) {
      setError('등록 중 오류가 발생했습니다.')
      setLoading(false)
      return
    }

    // profiles.role을 'broker'로 업데이트
    await supabase.from('profiles').update({ role: 'broker' }).eq('id', user.id)

    router.push('/dashboard/broker')
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      <div className="mx-auto max-w-xl px-4 py-10">

        {/* 타이틀 */}
        <div className="mb-6 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-600">
            <Shield className="h-8 w-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">중개사 등록</h1>
          <p className="mt-2 text-sm text-gray-500">인증 완료 후 고객 요청에 제안할 수 있습니다</p>
        </div>

        {/* 인증 안내 */}
        <div className="mb-4 flex items-center gap-3 rounded-xl bg-blue-50 px-4 py-3 text-sm text-blue-700">
          <CheckCircle className="h-5 w-5 flex-shrink-0" />
          <span>자격증 번호 인증 후 <strong>빠방 인증 뱃지</strong>가 부여됩니다</span>
        </div>

        <Card>
          <CardBody>
            <form onSubmit={handleSubmit} className="space-y-5">
              <Input label="부동산 상호명" placeholder="예: 행복부동산" value={form.office_name} onChange={(e) => update('office_name', e.target.value)} required />
              <Input label="공인중개사 자격증 번호" placeholder="예: 제20-XXXXX호" value={form.license_number} onChange={(e) => update('license_number', e.target.value)} required hint="자격증 번호로 인증 검토 후 뱃지가 발급됩니다" />
              <Input label="사무소 주소" placeholder="서울시 강남구 역삼동 123-45" value={form.address} onChange={(e) => update('address', e.target.value)} required />

              {/* 활동 지역 선택 - 전국 + 복수 선택 */}
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <label className="text-sm font-medium text-gray-700">주요 활동 지역</label>
                  <span className="text-xs text-gray-400">중복 선택 가능</span>
                </div>

                {/* 선택된 지역 태그 */}
                {selectedDistricts.length > 0 && (
                  <div className="mb-3 flex flex-wrap gap-2">
                    {selectedDistricts.map(d => (
                      <span key={d} className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-3 py-1 text-xs font-medium text-blue-700">
                        {d}
                        <button type="button" onClick={() => removeDistrict(d)}>
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}

                {/* 시/도 선택 */}
                <select
                  value={selectedCity}
                  onChange={(e) => handleCityChange(e.target.value)}
                  className="mb-3 w-full rounded-xl border border-gray-200 px-4 py-3 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                >
                  {CITIES.map(city => <option key={city} value={city}>{city}</option>)}
                </select>

                {/* 구/군 선택 */}
                <div className="grid grid-cols-3 gap-2 max-h-48 overflow-y-auto pr-1">
                  {(REGIONS[selectedCity] ?? []).map(d => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => toggleDistrict(d)}
                      className={cn(
                        'rounded-xl border-2 py-2 text-xs font-medium transition-all',
                        selectedDistricts.includes(d)
                          ? 'border-blue-500 bg-blue-50 text-blue-700'
                          : 'border-gray-200 text-gray-600 hover:border-gray-300'
                      )}
                    >
                      {selectedDistricts.includes(d) && '✓ '}
                      {d}
                    </button>
                  ))}
                </div>
                {selectedDistricts.length === 0 && (
                  <p className="mt-1.5 text-xs text-gray-400">* 활동할 지역을 선택해주세요</p>
                )}
              </div>

              {/* 자기소개 */}
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700">
                  자기소개 <span className="font-normal text-gray-400">(선택)</span>
                </label>
                <textarea
                  placeholder="경력, 전문 분야, 고객에게 전하고 싶은 말 등을 적어주세요&#10;예: 강남 10년 경력, 아파트 전문, 친절한 상담"
                  value={form.bio}
                  onChange={(e) => update('bio', e.target.value)}
                  rows={4}
                  className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 resize-none"
                />
              </div>

              {error && (
                <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">⚠️ {error}</div>
              )}

              <Button
                type="submit"
                size="lg"
                className="w-full"
                loading={loading}
                disabled={!form.office_name || !form.license_number || !form.address || selectedDistricts.length === 0}
              >
                중개사 등록 신청
              </Button>
            </form>
          </CardBody>
        </Card>
      </div>
    </div>
  )
}
