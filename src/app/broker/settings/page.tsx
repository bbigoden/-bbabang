'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Header } from '@/components/layout/header'
import { useRouter } from 'next/navigation'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { CheckCircle, AlertCircle } from 'lucide-react'

export default function BrokerSettingsPage() {
  const supabase = createClient()
  const router = useRouter()

  const [user, setUser] = useState<any>(null)
  const [broker, setBroker] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  const [form, setForm] = useState({
    office_name: '',
    address: '',
    license_number: '',
    office_reg_number: '',
    business_reg_number: '',
  })

  useEffect(() => { init() }, [])

  const init = async () => {
    const { data: { user: u } } = await supabase.auth.getUser()
    if (!u) { router.push('/auth/login'); return }
    setUser(u)

    const { data: b } = await supabase.from('broker_profiles').select('*').eq('user_id', u.id).single()
    if (!b) { router.push('/broker/register'); return }
    if (b.is_owner === false) { router.push('/dashboard/broker'); return }

    setBroker(b)
    setForm({
      office_name: b.office_name ?? '',
      address: b.address ?? '',
      license_number: b.license_number ?? '',
      office_reg_number: b.office_reg_number ?? '',
      business_reg_number: b.business_reg_number ?? '',
    })
    setLoading(false)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true); setError(''); setSaved(false)

    const { error: updateError } = await supabase.from('broker_profiles').update({
      office_name: form.office_name,
      address: form.address,
      license_number: form.license_number,
      office_reg_number: form.office_reg_number,
      business_reg_number: form.business_reg_number,
      is_verified: false, // 정보 변경 시 재승인 필요
    }).eq('id', broker.id)

    if (updateError) {
      setError('저장 중 오류가 발생했습니다.')
    } else {
      setSaved(true)
      setBroker((prev: any) => ({ ...prev, ...form, is_verified: false }))
    }
    setSaving(false)
  }

  const update = (key: string, value: string) => setForm(prev => ({ ...prev, [key]: value }))

  if (loading) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-gray-400 text-sm">불러오는 중...</div>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-50">
      <Header user={user} role="broker" />
      <div className="mx-auto max-w-xl px-4 py-8">

        <div className="mb-6">
          <h1 className="text-2xl font-black text-gray-900">사무소 정보 수정</h1>
          <p className="text-sm text-gray-400 mt-0.5">정보 변경 시 어드민 재승인이 필요합니다</p>
        </div>

        {/* 재승인 대기 안내 */}
        {broker && broker.is_verified === false && (
          <div className="mb-5 flex items-start gap-3 rounded-2xl bg-yellow-50 border border-yellow-200 px-4 py-3">
            <AlertCircle className="h-5 w-5 text-yellow-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-bold text-yellow-800">재승인 대기 중</p>
              <p className="text-xs text-yellow-600 mt-0.5">어드민 검토 후 인증 뱃지가 복구됩니다.</p>
            </div>
          </div>
        )}

        {saved && (
          <div className="mb-5 flex items-center gap-2 rounded-2xl bg-green-50 border border-green-200 px-4 py-3">
            <CheckCircle className="h-5 w-5 text-green-500" />
            <p className="text-sm font-semibold text-green-700">저장됐습니다. 어드민 재승인 대기 중입니다.</p>
          </div>
        )}

        <div className="rounded-2xl border border-gray-200 bg-white p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input label="부동산 상호명" value={form.office_name}
              onChange={(e) => update('office_name', e.target.value)} required />
            <Input label="사무소 주소" value={form.address}
              onChange={(e) => update('address', e.target.value)} required />
            <Input label="공인중개사 자격증 번호" value={form.license_number}
              onChange={(e) => update('license_number', e.target.value)} required />
            <Input label="중개사무소 등록번호" value={form.office_reg_number}
              onChange={(e) => update('office_reg_number', e.target.value)} required />
            <Input label="사업자등록번호" value={form.business_reg_number}
              onChange={(e) => update('business_reg_number', e.target.value)} required />

            {error && <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">⚠️ {error}</div>}

            <div className="flex gap-3 pt-2">
              <button type="button" onClick={() => router.push('/dashboard/broker')}
                className="flex-1 rounded-xl border border-gray-200 py-3 text-sm font-medium text-gray-600 hover:bg-gray-50">
                취소
              </button>
              <Button type="submit" className="flex-1" loading={saving}>
                저장
              </Button>
            </div>
          </form>
        </div>

      </div>
    </div>
  )
}
