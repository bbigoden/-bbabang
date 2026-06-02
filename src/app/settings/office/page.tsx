'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Building2, AlertCircle, CheckCircle, ShieldCheck } from 'lucide-react'

type Broker = {
  id: string
  user_id: string
  office_name: string | null
  address: string | null
  license_number: string | null
  office_reg_number: string | null
  business_reg_number: string | null
  is_owner: boolean | null
  is_verified: boolean | null
}

type Form = {
  office_name: string
  address: string
  license_number: string
  office_reg_number: string
  business_reg_number: string
}

const EMPTY: Form = {
  office_name: '',
  address: '',
  license_number: '',
  office_reg_number: '',
  business_reg_number: '',
}

export default function SettingsOfficePage() {
  const router = useRouter()
  const supabase = createClient()

  const [loading, setLoading] = useState(true)
  const [forbidden, setForbidden] = useState<string | null>(null)
  const [broker, setBroker] = useState<Broker | null>(null)
  const [form, setForm] = useState<Form>(EMPTY)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  useEffect(() => {
    ;(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/auth/login'); return }
      const { data: b } = await supabase.from('broker_profiles').select('id, user_id, office_name, address, license_number, office_reg_number, business_reg_number, is_owner, is_verified').eq('user_id', user.id).single()
      if (!b) { setForbidden('중개사 프로필이 없어요. 중개사 등록을 먼저 진행해주세요.'); setLoading(false); return }
      if (b.is_owner === false) { setForbidden('소속 직원은 사무소 정보를 수정할 수 없어요. 사장님께 문의해주세요.'); setLoading(false); return }
      setBroker(b)
      setForm({
        office_name: b.office_name ?? '',
        address: b.address ?? '',
        license_number: b.license_number ?? '',
        office_reg_number: b.office_reg_number ?? '',
        business_reg_number: b.business_reg_number ?? '',
      })
      setLoading(false)
    })()
  }, [])

  const update = (k: keyof Form, v: string) => setForm(prev => ({ ...prev, [k]: v }))

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!broker) return
    setSaving(true); setMsg(null)
    const { error } = await supabase.from('broker_profiles').update({
      office_name: form.office_name,
      address: form.address,
      license_number: form.license_number,
      office_reg_number: form.office_reg_number,
      business_reg_number: form.business_reg_number,
      is_verified: false,
    }).eq('id', broker.id)
    setSaving(false)
    if (error) { setMsg({ type: 'err', text: '저장 중 오류가 발생했습니다.' }); return }
    setBroker({ ...broker, ...form, is_verified: false })
    setMsg({ type: 'ok', text: '저장됐습니다. 어드민 재승인 대기 중이에요.' })
    setTimeout(() => setMsg(null), 3000)
  }

  if (loading) return <div className="flex items-center justify-center py-20"><div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" /></div>

  if (forbidden) return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6">
      <div className="flex items-start gap-3">
        <AlertCircle className="h-5 w-5 text-gray-500 flex-shrink-0 mt-0.5" />
        <p className="text-sm text-gray-600 dark:text-gray-500">{forbidden}</p>
      </div>
    </div>
  )

  return (
    <div className="space-y-4">
      {broker?.is_verified === false && (
        <div className="flex items-start gap-3 rounded-2xl border border-yellow-200 bg-yellow-50 px-4 py-3">
          <AlertCircle className="h-5 w-5 text-yellow-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-bold text-yellow-800">재승인 대기 중</p>
            <p className="text-xs text-yellow-600 mt-0.5">어드민 검토가 끝나면 인증 뱃지가 복구돼요.</p>
          </div>
        </div>
      )}

      {broker?.is_verified === true && (
        <div className="flex items-start gap-3 rounded-2xl border border-green-200 bg-green-50 px-4 py-3">
          <ShieldCheck className="h-5 w-5 text-green-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-bold text-green-700">인증된 사무소</p>
            <p className="text-xs text-green-600 mt-0.5">정보를 수정하면 재승인이 필요해요.</p>
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6">
        <h2 className="mb-1 font-bold text-gray-900 dark:text-white flex items-center gap-2">
          <Building2 className="h-4 w-4 text-gray-500" /> 사무소 정보
        </h2>
        <p className="text-xs text-gray-500 mb-4">정보 변경 시 어드민 재승인이 필요해요</p>

        <form onSubmit={save} className="space-y-3">
          <Field label="부동산 상호명" value={form.office_name} onChange={v => update('office_name', v)} />
          <Field label="사무소 주소" value={form.address} onChange={v => update('address', v)} />
          <Field label="공인중개사 자격증 번호" value={form.license_number} onChange={v => update('license_number', v)} />
          <Field label="중개사무소 등록번호" value={form.office_reg_number} onChange={v => update('office_reg_number', v)} />
          <Field label="사업자등록번호" value={form.business_reg_number} onChange={v => update('business_reg_number', v)} />

          {msg && (
            <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${msg.type === 'ok' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
              {msg.type === 'ok' ? <CheckCircle className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
              {msg.text}
            </div>
          )}

          <button type="submit" disabled={saving}
            className="mt-2 w-full rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 transition-colors">
            {saving ? '저장 중...' : '저장'}
          </button>
        </form>
      </div>
    </div>
  )
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const id = `office-field-${label.replace(/\s+/g, '-')}`
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">{label}</label>
      <input id={id} value={value} onChange={e => onChange(e.target.value)} required aria-label={label}
        className="w-full rounded-xl border border-gray-200 dark:border-gray-800 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
    </div>
  )
}
