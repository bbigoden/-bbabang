'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { User, Mail, Calendar, Check, AlertCircle } from 'lucide-react'

export default function SettingsAccountPage() {
  const supabase = createClient()
  const [user, setUser] = useState<{ id: string; email?: string | null } | null>(null)
  const [profile, setProfile] = useState<{ name?: string; phone?: string; role?: string; created_at?: string } | null>(null)
  const [loading, setLoading] = useState(true)

  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  useEffect(() => {
    ;(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      setUser({ id: user.id, email: user.email })
      const { data: p } = await supabase.from('profiles').select('*').eq('id', user.id).single()
      if (p) { setProfile(p); setName(p.name ?? ''); setPhone(p.phone ?? '') }
      setLoading(false)
    })()
  }, [])

  const save = async () => {
    if (!name.trim()) { setMsg({ type: 'err', text: '이름을 입력해주세요.' }); return }
    if (!user) return
    setSaving(true); setMsg(null)
    const { error } = await supabase.from('profiles').update({ name: name.trim(), phone: phone.trim() }).eq('id', user.id)
    setSaving(false)
    if (error) setMsg({ type: 'err', text: '저장 중 오류가 발생했습니다.' })
    else {
      setMsg({ type: 'ok', text: '저장됐습니다.' })
      setTimeout(() => setMsg(null), 3000)
    }
  }

  if (loading) return <div className="flex items-center justify-center py-20"><div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" /></div>

  const role = profile?.role ?? 'user'
  const roleLabel = role === 'broker' ? { text: '공인중개사', color: 'bg-blue-100 text-blue-700' }
    : role === 'admin' ? { text: '관리자', color: 'bg-red-100 text-red-700' }
    : { text: '일반 회원', color: 'bg-gray-100 text-gray-600' }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-gray-200 bg-white p-6">
        <div className="flex items-center gap-4 pb-5 border-b border-gray-100">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-blue-100 text-blue-600 text-xl font-bold flex-shrink-0">
            {(name || user?.email || '?')[0].toUpperCase()}
          </div>
          <div>
            <p className="font-bold text-gray-900 text-lg">{name || '이름 없음'}</p>
            <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${roleLabel.color}`}>{roleLabel.text}</span>
          </div>
        </div>
        <div className="divide-y divide-gray-50">
          <div className="flex items-center gap-3 py-3">
            <Mail className="h-4 w-4 text-gray-400 flex-shrink-0" />
            <span className="text-sm text-gray-500 w-20 flex-shrink-0">이메일</span>
            <span className="text-sm text-gray-800">{user?.email}</span>
          </div>
          <div className="flex items-center gap-3 py-3">
            <Calendar className="h-4 w-4 text-gray-400 flex-shrink-0" />
            <span className="text-sm text-gray-500 w-20 flex-shrink-0">가입일</span>
            <span className="text-sm text-gray-800">{profile?.created_at ? new Date(profile.created_at).toLocaleDateString('ko-KR') : '—'}</span>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-6">
        <h2 className="mb-4 font-bold text-gray-900 flex items-center gap-2"><User className="h-4 w-4 text-gray-400" /> 정보 수정</h2>
        <div className="space-y-3">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">이름</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="이름"
              className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">전화번호</label>
            <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="010-0000-0000"
              className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
          </div>
        </div>
        {msg && (
          <div className={`mt-3 flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${msg.type === 'ok' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
            {msg.type === 'ok' ? <Check className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
            {msg.text}
          </div>
        )}
        <button onClick={save} disabled={saving}
          className="mt-4 w-full rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 transition-colors">
          {saving ? '저장 중...' : '저장'}
        </button>
      </div>
    </div>
  )
}
