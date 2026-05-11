'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Header } from '@/components/layout/header'
import { User, Mail, Phone, ShieldCheck, Calendar, Lock, ChevronRight, Check, AlertCircle } from 'lucide-react'

export default function ProfilePage() {
  const router = useRouter()
  const supabase = createClient()

  const [user, setUser] = useState<any>(null)
  const [profile, setProfile] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  // 이름/전화번호 수정
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  // 비밀번호 변경
  const [pwCurrent, setPwCurrent] = useState('')
  const [pwNew, setPwNew] = useState('')
  const [pwConfirm, setPwConfirm] = useState('')
  const [pwSaving, setPwSaving] = useState(false)
  const [pwMsg, setPwMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  useEffect(() => {
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/auth/login'); return }
      setUser(user)
      const { data: p } = await supabase.from('profiles').select('*').eq('id', user.id).single()
      if (p) {
        setProfile(p)
        setName(p.name ?? '')
        setPhone(p.phone ?? '')
      }
      setLoading(false)
    }
    init()
  }, [])

  const saveProfile = async () => {
    setSaving(true)
    setSaveMsg(null)
    const { error } = await supabase.from('profiles').update({ name: name.trim(), phone: phone.trim() }).eq('id', user.id)
    setSaving(false)
    if (error) {
      setSaveMsg({ type: 'err', text: '저장 중 오류가 발생했습니다.' })
    } else {
      setProfile((p: any) => ({ ...p, name: name.trim(), phone: phone.trim() }))
      setSaveMsg({ type: 'ok', text: '저장됐습니다.' })
      setTimeout(() => setSaveMsg(null), 3000)
    }
  }

  const changePassword = async () => {
    if (!pwNew || !pwConfirm) { setPwMsg({ type: 'err', text: '새 비밀번호를 입력해주세요.' }); return }
    if (pwNew !== pwConfirm) { setPwMsg({ type: 'err', text: '새 비밀번호가 일치하지 않습니다.' }); return }
    if (pwNew.length < 6) { setPwMsg({ type: 'err', text: '비밀번호는 6자 이상이어야 합니다.' }); return }
    setPwSaving(true)
    setPwMsg(null)
    const { error } = await supabase.auth.updateUser({ password: pwNew })
    setPwSaving(false)
    if (error) {
      setPwMsg({ type: 'err', text: '비밀번호 변경에 실패했습니다.' })
    } else {
      setPwMsg({ type: 'ok', text: '비밀번호가 변경됐습니다.' })
      setPwCurrent(''); setPwNew(''); setPwConfirm('')
      setTimeout(() => setPwMsg(null), 3000)
    }
  }

  const roleLabel = (role: string) => {
    if (role === 'broker') return { text: '공인중개사', color: 'bg-blue-100 text-blue-700' }
    if (role === 'admin') return { text: '관리자', color: 'bg-red-100 text-red-700' }
    return { text: '일반 회원', color: 'bg-gray-100 text-gray-600' }
  }

  if (loading) return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
    </div>
  )

  const rl = roleLabel(profile?.role ?? '')

  return (
    <div className="min-h-screen bg-gray-50">
      <Header user={user} role={profile?.role} />

      <div className="mx-auto max-w-lg px-4 py-10">
        <h1 className="mb-6 text-2xl font-bold text-gray-900">내 계정</h1>

        {/* 기본 정보 카드 */}
        <div className="mb-4 rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
          {/* 헤더 */}
          <div className="flex items-center gap-4 px-6 py-5 border-b border-gray-100">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-blue-100 text-blue-600 text-xl font-bold flex-shrink-0">
              {(name || profile?.email || '?')[0].toUpperCase()}
            </div>
            <div>
              <p className="font-bold text-gray-900 text-lg">{name || '이름 없음'}</p>
              <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${rl.color}`}>{rl.text}</span>
            </div>
          </div>

          {/* 읽기 전용 정보 */}
          <div className="divide-y divide-gray-50">
            <div className="flex items-center gap-3 px-6 py-3.5">
              <Mail className="h-4 w-4 text-gray-400 flex-shrink-0" />
              <span className="text-sm text-gray-500 w-20 flex-shrink-0">이메일</span>
              <span className="text-sm text-gray-800">{user?.email}</span>
            </div>
            <div className="flex items-center gap-3 px-6 py-3.5">
              <Calendar className="h-4 w-4 text-gray-400 flex-shrink-0" />
              <span className="text-sm text-gray-500 w-20 flex-shrink-0">가입일</span>
              <span className="text-sm text-gray-800">
                {profile?.created_at ? new Date(profile.created_at).toLocaleDateString('ko-KR') : '—'}
              </span>
            </div>
          </div>
        </div>

        {/* 정보 수정 */}
        <div className="mb-4 rounded-2xl border border-gray-200 bg-white shadow-sm p-6">
          <h2 className="mb-4 font-bold text-gray-900 flex items-center gap-2">
            <User className="h-4 w-4 text-gray-400" /> 정보 수정
          </h2>
          <div className="space-y-3">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">이름</label>
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="이름을 입력하세요"
                className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">전화번호</label>
              <input
                value={phone}
                onChange={e => setPhone(e.target.value)}
                placeholder="010-0000-0000"
                className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            </div>
          </div>
          {saveMsg && (
            <div className={`mt-3 flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${saveMsg.type === 'ok' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
              {saveMsg.type === 'ok' ? <Check className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
              {saveMsg.text}
            </div>
          )}
          <button
            onClick={saveProfile}
            disabled={saving}
            className="mt-4 w-full rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {saving ? '저장 중...' : '저장'}
          </button>
        </div>

        {/* 비밀번호 변경 */}
        <div className="mb-4 rounded-2xl border border-gray-200 bg-white shadow-sm p-6">
          <h2 className="mb-4 font-bold text-gray-900 flex items-center gap-2">
            <Lock className="h-4 w-4 text-gray-400" /> 비밀번호 변경
          </h2>
          <div className="space-y-3">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">새 비밀번호</label>
              <input
                type="password"
                value={pwNew}
                onChange={e => setPwNew(e.target.value)}
                placeholder="6자 이상"
                className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">새 비밀번호 확인</label>
              <input
                type="password"
                value={pwConfirm}
                onChange={e => setPwConfirm(e.target.value)}
                placeholder="비밀번호 재입력"
                className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            </div>
          </div>
          {pwMsg && (
            <div className={`mt-3 flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${pwMsg.type === 'ok' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
              {pwMsg.type === 'ok' ? <Check className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
              {pwMsg.text}
            </div>
          )}
          <button
            onClick={changePassword}
            disabled={pwSaving}
            className="mt-4 w-full rounded-xl bg-gray-800 py-2.5 text-sm font-semibold text-white hover:bg-gray-900 disabled:opacity-50 transition-colors"
          >
            {pwSaving ? '변경 중...' : '비밀번호 변경'}
          </button>
        </div>

        {/* 중개사 프로필 바로가기 */}
        {profile?.role === 'broker' && (
          <button
            onClick={() => router.push('/dashboard/broker')}
            className="w-full flex items-center justify-between rounded-2xl border border-gray-200 bg-white px-6 py-4 shadow-sm hover:bg-gray-50 transition-colors"
          >
            <div className="flex items-center gap-3">
              <ShieldCheck className="h-5 w-5 text-blue-500" />
              <span className="font-medium text-gray-800">중개사 대시보드</span>
            </div>
            <ChevronRight className="h-5 w-5 text-gray-400" />
          </button>
        )}
      </div>
    </div>
  )
}
