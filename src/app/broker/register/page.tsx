'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Header } from '@/components/layout/header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardBody } from '@/components/ui/card'
import { Shield, CheckCircle, Users, Building2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { seedRegionFromAddress } from '@/lib/region-from-address'

export default function BrokerRegisterPage() {
  const router = useRouter()
  const supabase = createClient()

  const [joinType, setJoinType] = useState<'owner' | 'employee'>('owner')

  // 대표 폼
  const [form, setForm] = useState({
    office_name: '',
    license_number: '',
    office_reg_number: '',
    business_reg_number: '',
    address: '',
  })

  // 직원 폼
  const [officeCode, setOfficeCode] = useState('')
  const [codePreview, setCodePreview] = useState<{ office_name: string; address: string } | null>(null)
  const [codeChecking, setCodeChecking] = useState(false)
  const [codeError, setCodeError] = useState('')

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // 사업자번호 검증
  const [bizVerifying, setBizVerifying] = useState(false)
  const [bizResult, setBizResult] = useState<{ ok: boolean; isActive?: boolean; status?: { b_stt?: string }; error?: string } | null>(null)

  const verifyBusiness = async () => {
    if (!form.business_reg_number) { setBizResult({ ok: false, error: '사업자등록번호를 먼저 입력해주세요' }); return }
    setBizVerifying(true); setBizResult(null)
    try {
      const r = await fetch('/api/brokers/verify-business', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessNumber: form.business_reg_number }),
      })
      const j = await r.json()
      if (!r.ok) setBizResult({ ok: false, error: j.error ?? '검증 실패' })
      else setBizResult({ ok: true, isActive: j.isActive, status: j.status })
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '네트워크 오류'
      setBizResult({ ok: false, error: msg })
    }
    setBizVerifying(false)
  }

  const update = (key: string, value: string) => setForm(prev => ({ ...prev, [key]: value }))

  const handleCodeChange = async (val: string) => {
    const v = val.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6)
    setOfficeCode(v)
    setCodeError('')
    setCodePreview(null)
    if (v.length === 6) {
      setCodeChecking(true)
      try {
        const { data } = await supabase
          .from('broker_profiles')
          .select('id, office_name, address')
          .eq('office_code', v)
          .eq('is_owner', true)
          .single()
        if (data) {
          setCodePreview({ office_name: data.office_name, address: data.address })
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

      const { data: parentBroker } = await supabase
        .from('broker_profiles')
        .select('id, office_name, address, district')
        .eq('office_code', officeCode)
        .single()
      if (!parentBroker) { setError('사무소 코드를 다시 확인해주세요.'); setLoading(false); return }

      // 사무소 주소 → 시·군·구 자동 추출해 alert_regions 시드 (실패해도 빈 배열로 진행)
      const seed = await seedRegionFromAddress(parentBroker.address)

      const { error: insertError } = await supabase.from('broker_profiles').insert({
        user_id: user.id,
        office_name: parentBroker.office_name,
        address: parentBroker.address,
        district: parentBroker.district,
        license_number: '',
        rating: 0, review_count: 0, deal_count: 0,
        is_verified: false, is_owner: false,
        parent_broker_id: parentBroker.id,
        permissions: null,
        is_approved: false,
        alert_regions: seed ? [seed] : [],
      })
      if (insertError) { setError('등록 중 오류가 발생했습니다.'); setLoading(false); return }

      // 코드 1회용 — 사용 후 자동 재발급
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
      const newCode = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
      await supabase.from('broker_profiles').update({ office_code: newCode }).eq('id', parentBroker.id)

      await supabase.from('profiles').update({ role: 'broker' }).eq('id', user.id)
      router.push('/broker/register/pending')
    } catch {
      setError('오류가 발생했습니다. 잠시 후 다시 시도해주세요.')
      setLoading(false)
    }
  }

  // 대표 등록
  const handleOwnerSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true); setError('')
    try {
      const { data: authData } = await supabase.auth.getUser()
      const user = authData.user
      if (!user) { router.push('/auth/login'); return }

      // 사무소 주소 → 시·군·구 자동 추출해 alert_regions 시드 (실패해도 빈 배열로 진행)
      const seed = await seedRegionFromAddress(form.address)

      const { error: insertError } = await supabase.from('broker_profiles').insert({
        user_id: user.id,
        office_name: form.office_name,
        license_number: form.license_number,
        office_reg_number: form.office_reg_number,
        business_reg_number: form.business_reg_number,
        address: form.address,
        district: '',
        rating: 0, review_count: 0, deal_count: 0,
        is_verified: false,
        is_owner: true,
        is_approved: true,
        alert_regions: seed ? [seed] : [],
      })
      if (insertError) { setError('등록 중 오류가 발생했습니다.'); setLoading(false); return }

      await supabase.from('profiles').update({ role: 'broker' }).eq('id', user.id)
      router.push('/dashboard/broker')
    } catch {
      setError('오류가 발생했습니다. 잠시 후 다시 시도해주세요.')
      setLoading(false)
    }
  }

  const ownerReady = !!(form.office_name && form.license_number && form.office_reg_number && form.business_reg_number && form.address)

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <Header />
      <div className="mx-auto max-w-xl px-4 py-10">

        <div className="mb-6 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-600">
            <Shield className="h-8 w-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">중개사 등록</h1>
          <p className="mt-2 text-sm text-gray-500">등록 완료 후 서비스를 이용할 수 있습니다</p>
        </div>

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
              <opt.icon className={cn('mb-2 h-5 w-5', joinType === opt.value ? 'text-blue-600' : 'text-gray-400')} />
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
                  <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">사무소 코드</label>
                  <input type="text" value={officeCode}
                    onChange={(e) => handleCodeChange(e.target.value)}
                    placeholder="예: A1B2C3" maxLength={6}
                    className="w-full rounded-xl border border-gray-200 dark:border-gray-800 px-4 py-3 text-center text-xl font-mono font-bold tracking-widest text-gray-900 dark:text-white focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 uppercase"
                  />
                  {codeChecking && <p className="mt-1.5 text-xs text-gray-400">조회 중...</p>}
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
              <form onSubmit={handleOwnerSubmit} className="space-y-4">
                <Input label="부동산 상호명" placeholder="예: 행복부동산"
                  value={form.office_name} onChange={(e) => update('office_name', e.target.value)} required />
                <Input label="사무소 주소" placeholder="서울시 강남구 역삼동 123-45"
                  value={form.address} onChange={(e) => update('address', e.target.value)} required />
                <Input label="공인중개사 자격증 번호" placeholder="예: 제20-XXXXX호"
                  value={form.license_number} onChange={(e) => update('license_number', e.target.value)} required />
                <Input label="중개사무소 등록번호" placeholder="예: 11680-2024-00123"
                  value={form.office_reg_number} onChange={(e) => update('office_reg_number', e.target.value)} required />
                <div>
                  <Input label="사업자등록번호" placeholder="예: 123-45-67890"
                    value={form.business_reg_number} onChange={(e) => update('business_reg_number', e.target.value)} required />
                  <div className="mt-2 flex items-center gap-2">
                    <button type="button" onClick={verifyBusiness} disabled={bizVerifying || !form.business_reg_number}
                      className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100 disabled:opacity-50 transition-colors">
                      {bizVerifying ? '검증 중...' : '국세청 사업자 검증'}
                    </button>
                    {bizResult && (
                      bizResult.ok
                        ? <span className={`text-xs font-semibold ${bizResult.isActive ? 'text-green-600' : 'text-orange-600'}`}>
                            {bizResult.isActive ? '✅ 계속사업자' : `⚠ ${bizResult.status?.b_stt ?? '확인 필요'}`}
                          </span>
                        : <span className="text-xs text-red-500">⚠ {bizResult.error}</span>
                    )}
                  </div>
                </div>

                {error && <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">⚠️ {error}</div>}

                <Button type="submit" size="lg" className="w-full" loading={loading} disabled={!ownerReady}>
                  중개사 등록 신청
                </Button>
              </form>
            </CardBody>
          </Card>
        )}
      </div>
    </div>
  )
}
