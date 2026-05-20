'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { User, Mail, Calendar, Check, AlertCircle, Gift, Copy, Share2, Users } from 'lucide-react'

export default function SettingsAccountPage() {
  const supabase = createClient()
  const [user, setUser] = useState<{ id: string; email?: string | null } | null>(null)
  const [profile, setProfile] = useState<{ name?: string; phone?: string; role?: string; created_at?: string; referral_code?: string } | null>(null)
  const [referredCount, setReferredCount] = useState(0)
  const [copied, setCopied] = useState(false)
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

      // 내 추천으로 가입한 사람 수
      const { count } = await supabase
        .from('profiles')
        .select('*', { count: 'exact', head: true })
        .eq('referred_by', user.id)
      setReferredCount(count ?? 0)

      setLoading(false)
    })()
  }, [])

  const copyReferralLink = async () => {
    if (!profile?.referral_code) return
    const link = `https://bbabang.vercel.app/auth/signup?ref=${profile.referral_code}`
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {}
  }

  const shareReferral = async () => {
    if (!profile?.referral_code) return
    const link = `https://bbabang.vercel.app/auth/signup?ref=${profile.referral_code}`
    const text = `빠방에서 부동산 매물 찾는 거 추천! 내 코드로 가입하면 시작이 쉬워요.\n${link}`
    if (navigator.share) {
      try { await navigator.share({ title: '빠방 추천', text, url: link }) } catch {}
    } else {
      copyReferralLink()
    }
  }

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

      {/* 추천 코드 (admin은 제외) */}
      {role !== 'admin' && profile?.referral_code && (
        <div className="rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 to-yellow-50 p-6">
          <h2 className="mb-1 flex items-center gap-2 font-bold text-gray-900">
            <Gift className="h-4 w-4 text-amber-500" />
            내 추천 코드
          </h2>
          <p className="text-xs text-gray-500 mb-4">친구·동료에게 공유하면 빠방을 더 빠르게 사용하실 수 있어요</p>

          <div className="mb-3 rounded-xl border-2 border-dashed border-amber-300 bg-white px-4 py-4 text-center">
            <p className="font-mono text-2xl font-black tracking-widest text-amber-700">
              {profile.referral_code}
            </p>
          </div>

          <div className="flex gap-2">
            <button onClick={copyReferralLink}
              className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-white border border-amber-300 px-3 py-2.5 text-sm font-bold text-amber-700 hover:bg-amber-100 transition-colors">
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied ? '복사됨' : '링크 복사'}
            </button>
            <button onClick={shareReferral}
              className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-amber-500 px-3 py-2.5 text-sm font-bold text-white hover:bg-amber-600 transition-colors">
              <Share2 className="h-4 w-4" />
              공유하기
            </button>
          </div>

          {referredCount > 0 && (
            <div className="mt-3 rounded-xl bg-white/60 px-4 py-3 flex items-center gap-2.5">
              <Users className="h-4 w-4 text-amber-500" />
              <p className="text-sm text-gray-700">
                <span className="font-bold text-amber-600">{referredCount}명</span>이 회원님의 추천으로 가입했어요 🎉
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
