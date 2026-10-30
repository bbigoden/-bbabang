'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/lib/auth-context'
import { Building2, AlertCircle, CheckCircle, ShieldCheck } from 'lucide-react'
import { Spinner } from '@/components/ui/spinner'
import {
  normalizeOfficeForm, validateOfficeForm, officeSaveError, verificationState, verificationCopy,
  type OfficeFormErrors,
} from '@/lib/broker-office'

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
  verification_info: unknown
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
  const { refresh } = useAuth()

  const [loading, setLoading] = useState(true)
  const [forbidden, setForbidden] = useState<string | null>(null)
  const [broker, setBroker] = useState<Broker | null>(null)
  const [form, setForm] = useState<Form>(EMPTY)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [fieldErrors, setFieldErrors] = useState<OfficeFormErrors>({})

  useEffect(() => {
    ;(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/auth/login'); return }
      const { data: b } = await supabase.from('broker_profiles').select('id, user_id, office_name, address, license_number, office_reg_number, business_reg_number, is_owner, is_verified, verification_info').eq('user_id', user.id).single()
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

  const update = (k: keyof Form, v: string) => {
    setForm(prev => ({ ...prev, [k]: v }))
    setFieldErrors(prev => (prev[k] ? { ...prev, [k]: undefined } : prev))
  }

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!broker) return
    // 등록 화면과 같은 검사 — 공백만 넣은 상호명·엉터리 번호를 그대로 저장하지 않는다
    const clean = normalizeOfficeForm(form)
    setForm(clean)
    const errs = validateOfficeForm(clean)
    setFieldErrors(errs)
    if (Object.keys(errs).length) { setMsg({ type: 'err', text: '빨간 글씨가 있는 칸을 확인해 주세요.' }); return }
    setSaving(true); setMsg(null)
    const { data: saved, error } = await supabase.from('broker_profiles').update({
      ...clean,
      is_verified: false,
    }).eq('id', broker.id).select('is_verified, verification_info').maybeSingle()
    setSaving(false)
    if (error) {
      // 409 를 가려 읽는다 — 남이 쓰는 자격증 번호·사업자번호면 그 칸에 이유를 띄운다
      const m = officeSaveError(error)
      if (m.field) setFieldErrors({ [m.field]: m.message })
      setMsg({ type: 'err', text: m.field ? '빨간 글씨가 있는 칸을 확인해 주세요.' : m.message })
      return
    }
    // 오류 없이 0행이면(권한·이미 지워진 행) 바뀐 게 없다 — '저장됐습니다'라고 하지 않는다
    if (!saved) { setMsg({ type: 'err', text: '저장하지 못했어요. 새로고침한 뒤 다시 시도해 주세요.' }); return }
    // is_verified 는 DB 트리거(guard_broker_is_verified)가 관리자 말고는 못 바꾸게 원래 값으로 되돌린다.
    // 그래서 '재승인 대기'라고 단정하지 않고 실제로 저장된 상태를 그대로 보여 준다.
    const next: Broker = {
      ...broker, ...clean,
      is_verified: saved.is_verified,
      verification_info: saved.verification_info,
    }
    setBroker(next)
    setMsg({ type: 'ok', text: next.is_verified ? '저장됐습니다.' : '저장됐습니다. 관리자 검토가 끝나면 인증 뱃지가 붙어요.' })
    setTimeout(() => setMsg(null), 3000)
    // 사이드바·다른 화면이 쓰는 사무소 정보(상호 등)도 새 값으로
    refresh().catch(() => {})
  }

  const verify = broker ? verificationCopy(verificationState(broker)) : null

  if (loading) return <div className="flex items-center justify-center py-20"><Spinner size="md" /></div>

  if (forbidden) return (
    <div className="rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 p-6">
      <div className="flex items-start gap-3">
        <AlertCircle className="h-5 w-5 text-gray-500 flex-shrink-0 mt-0.5" />
        <p className="text-sm text-gray-600 dark:text-gray-500">{forbidden}</p>
      </div>
    </div>
  )

  return (
    <div className="space-y-4">
      {/* 처음 등록한 사람에게도 '재승인 대기 — 뱃지가 복구돼요'가 나왔다 → 처음/반려/취소를 갈라 말한다 */}
      {verify && verify.tone !== 'ok' && (
        <div className="flex items-start gap-3 rounded-2xl border border-yellow-200 bg-yellow-50 px-4 py-3">
          <AlertCircle className="h-5 w-5 text-yellow-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-bold text-yellow-800">{verify.title}</p>
            {/* yellow-50 위 yellow-600은 대비 2.84:1 — AA(4.5:1) 미달이라 700으로 */}
            <p className="text-xs text-yellow-700 mt-0.5">{verify.body}</p>
          </div>
        </div>
      )}

      {verify?.tone === 'ok' && (
        <div className="flex items-start gap-3 rounded-2xl border border-green-200 bg-green-50 px-4 py-3">
          <ShieldCheck className="h-5 w-5 text-green-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-bold text-green-700">{verify.title}</p>
            <p className="text-xs text-green-700 mt-0.5">{verify.body}</p>
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 p-6">
        <h2 className="mb-1 font-bold text-gray-900 dark:text-white flex items-center gap-2">
          <Building2 className="h-4 w-4 text-gray-500" /> 사무소 정보
        </h2>
        <p className="text-xs text-gray-500 mb-4">등록증·사업자등록증에 적힌 그대로 적어 주세요</p>

        <form onSubmit={save} className="space-y-3">
          <Field label="부동산 상호명" value={form.office_name} onChange={v => update('office_name', v)} error={fieldErrors.office_name} />
          <Field label="사무소 주소" value={form.address} onChange={v => update('address', v)} error={fieldErrors.address} />
          <Field label="공인중개사 자격증 번호" value={form.license_number} onChange={v => update('license_number', v)} error={fieldErrors.license_number} />
          <Field label="중개사무소 등록번호" value={form.office_reg_number} onChange={v => update('office_reg_number', v)} error={fieldErrors.office_reg_number} />
          <Field label="사업자등록번호" value={form.business_reg_number} onChange={v => update('business_reg_number', v)} error={fieldErrors.business_reg_number} />

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

function Field({ label, value, onChange, error }: { label: string; value: string; onChange: (v: string) => void; error?: string }) {
  const id = `office-field-${label.replace(/\s+/g, '-')}`
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">{label}</label>
      <input id={id} value={value} onChange={e => onChange(e.target.value)} required aria-label={label}
        aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-error` : undefined}
        className={`w-full rounded-xl border px-4 py-2.5 text-sm focus:outline-none focus:ring-2 ${error ? 'border-red-400 focus:border-red-500 focus:ring-red-500/20' : 'border-gray-200 dark:border-gray-800 focus:border-blue-500 focus:ring-blue-500/20'}`} />
      {error && <p id={`${id}-error`} className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  )
}
