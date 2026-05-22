'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/lib/auth-context'
import { formatDate } from '@/lib/utils'
import {
  Megaphone, ArrowLeft, Send, X, AlertCircle, Check, Users, Building2,
  Globe, Trash2, ExternalLink, Eye, EyeOff
} from 'lucide-react'

type Audience = 'all' | 'user' | 'broker'

interface Announcement {
  id: string
  user_id: string
  title: string
  body: string | null
  link: string | null
  is_read: boolean
  created_at: string
}

const AUDIENCE_META: Record<Audience, { label: string; icon: any; color: string }> = {
  all: { label: '전체', icon: Globe, color: 'bg-blue-500/20 text-blue-400' },
  user: { label: '고객', icon: Users, color: 'bg-emerald-500/20 text-emerald-400' },
  broker: { label: '중개사', icon: Building2, color: 'bg-purple-500/20 text-purple-400' },
}

export default function AdminAnnouncementsPage() {
  const router = useRouter()
  const supabaseRef = useRef(createClient())
  const supabase = supabaseRef.current
  const auth = useAuth()

  const [audience, setAudience] = useState<Audience>('all')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [link, setLink] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [okMsg, setOkMsg] = useState<string | null>(null)
  const [confirm, setConfirm] = useState(false)
  const [targetCount, setTargetCount] = useState<number | null>(null)

  const [recent, setRecent] = useState<{ created_at: string; title: string; body: string | null; link: string | null; count: number }[]>([])
  const [loadingRecent, setLoadingRecent] = useState(true)

  useEffect(() => {
    if (auth.loading) return
    if (!auth.user) { router.push('/auth/login'); return }
    if (auth.profile?.role !== 'admin') { router.push('/'); return }
  }, [auth.loading, auth.user, auth.profile?.role, router])

  // 발행 시 대상 사용자 수 미리 계산
  const refreshTargetCount = useCallback(async () => {
    let q = supabase.from('profiles').select('id', { count: 'exact', head: true })
    if (audience === 'user') q = q.eq('role', 'user')
    else if (audience === 'broker') q = q.eq('role', 'broker')
    const { count } = await q
    setTargetCount(count ?? 0)
  }, [supabase, audience])

  useEffect(() => {
    if (auth.profile?.role === 'admin') refreshTargetCount()
  }, [auth.profile?.role, refreshTargetCount])

  // 최근 발행 이력 — type='announcement' 그룹별 집계
  const loadRecent = useCallback(async () => {
    setLoadingRecent(true)
    const { data } = await supabase
      .from('notifications')
      .select('created_at, title, body, link')
      .eq('type', 'announcement')
      .order('created_at', { ascending: false })
      .limit(300)
    // 같은 created_at(±2초)·title 묶음을 한 발행으로 간주
    const groups = new Map<string, { created_at: string; title: string; body: string | null; link: string | null; count: number }>()
    ;(data ?? []).forEach(n => {
      const bucket = new Date(n.created_at).toISOString().slice(0, 16) + '|' + n.title
      const g = groups.get(bucket)
      if (g) g.count += 1
      else groups.set(bucket, { created_at: n.created_at, title: n.title, body: n.body, link: n.link, count: 1 })
    })
    setRecent(Array.from(groups.values()).slice(0, 20))
    setLoadingRecent(false)
  }, [supabase])

  useEffect(() => {
    if (auth.profile?.role === 'admin') loadRecent()
  }, [auth.profile?.role, loadRecent])

  const validate = () => {
    if (!title.trim()) { setErr('제목을 입력해주세요'); return false }
    if (title.length > 100) { setErr('제목은 100자 이내로 입력해주세요'); return false }
    if (body.length > 500) { setErr('본문은 500자 이내로 입력해주세요'); return false }
    if (link && !/^(https?:\/\/|\/)/.test(link)) { setErr('링크는 / 또는 http(s)://로 시작해야 해요'); return false }
    return true
  }

  const publish = async () => {
    if (!validate()) return
    setBusy(true); setErr(null); setOkMsg(null)

    // 1) 대상 user_id 목록
    let q = supabase.from('profiles').select('id, notification_preferences')
    if (audience === 'user') q = q.eq('role', 'user')
    else if (audience === 'broker') q = q.eq('role', 'broker')
    const { data: profiles, error: pErr } = await q
    if (pErr) {
      setErr('대상 조회 실패: ' + pErr.message)
      setBusy(false); setConfirm(false); return
    }

    // 2) announcements 동의 사용자만 (기본값 true, false인 경우만 제외)
    const targets = (profiles ?? []).filter(p => {
      const prefs = p.notification_preferences as Record<string, boolean> | null
      return !prefs || prefs.announcements !== false
    })

    if (targets.length === 0) {
      setErr('대상자가 없습니다')
      setBusy(false); setConfirm(false); return
    }

    // 3) batch insert
    const rows = targets.map(t => ({
      user_id: t.id,
      type: 'announcement',
      title: title.trim(),
      body: body.trim() || null,
      link: link.trim() || null,
    }))
    const { error } = await supabase.from('notifications').insert(rows)
    setBusy(false); setConfirm(false)
    if (error) { setErr('발행 실패: ' + error.message); return }

    setOkMsg(`${targets.length}명에게 발행됐어요`)
    setTitle(''); setBody(''); setLink('')
    await loadRecent()
    setTimeout(() => setOkMsg(null), 5000)
  }

  if (auth.loading || auth.profile?.role !== 'admin') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-950">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <header className="border-b border-gray-800 bg-gray-900 px-6 py-4">
        <div className="mx-auto flex max-w-5xl items-center gap-3">
          <Link href="/admin" className="flex h-9 w-9 items-center justify-center rounded-xl bg-gray-800 hover:bg-gray-700 transition-colors">
            <ArrowLeft className="h-4 w-4 text-gray-300" />
          </Link>
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500/20">
            <Megaphone className="h-5 w-5 text-amber-400" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-white">공지 발행</h1>
            <p className="text-xs text-gray-400">알림함 카테고리: 공지·이벤트</p>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-6 py-8 grid gap-6 lg:grid-cols-2">
        {/* 발행 폼 */}
        <div className="space-y-5">
          <div className="rounded-2xl border border-gray-800 bg-gray-900 p-5">
            <h2 className="mb-4 font-bold text-white">새 공지 작성</h2>

            <div className="mb-4">
              <p className="mb-2 text-xs font-semibold text-gray-400">대상</p>
              <div className="grid grid-cols-3 gap-2">
                {(['all', 'user', 'broker'] as Audience[]).map(a => {
                  const m = AUDIENCE_META[a]
                  const active = audience === a
                  return (
                    <button key={a} onClick={() => setAudience(a)}
                      className={`flex flex-col items-center gap-1 rounded-xl border px-3 py-3 text-xs font-semibold transition-all ${
                        active ? `${m.color} border-current` : 'border-gray-700 bg-transparent text-gray-400 hover:bg-gray-800'
                      }`}>
                      <m.icon className="h-4 w-4" />
                      {m.label}
                    </button>
                  )
                })}
              </div>
              <p className="mt-2 text-xs text-gray-500">
                대상자 약 <span className="font-bold text-white">{targetCount ?? '...'}</span>명
                <span className="text-gray-600 dark:text-gray-400"> (공지 알림을 끈 사용자는 자동 제외)</span>
              </p>
            </div>

            <div className="space-y-3">
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-gray-400">제목 *</label>
                <input type="text" value={title} onChange={e => setTitle(e.target.value)} maxLength={100}
                  placeholder="공지 제목"
                  className="w-full rounded-xl border border-gray-700 bg-gray-800 px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
                <p className="mt-1 text-right text-xs text-gray-500">{title.length}/100</p>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-gray-400">본문 (선택)</label>
                <textarea value={body} onChange={e => setBody(e.target.value)} maxLength={500} rows={5}
                  placeholder="공지 내용"
                  className="w-full rounded-xl border border-gray-700 bg-gray-800 px-4 py-3 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 resize-none" />
                <p className="mt-1 text-right text-xs text-gray-500">{body.length}/500</p>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-gray-400">링크 (선택)</label>
                <input type="text" value={link} onChange={e => setLink(e.target.value)}
                  placeholder="/event/2026 또는 https://..."
                  className="w-full rounded-xl border border-gray-700 bg-gray-800 px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
              </div>
            </div>

            {err && (
              <div className="mt-4 flex items-center gap-2 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400">
                <AlertCircle className="h-4 w-4 flex-shrink-0" /> {err}
              </div>
            )}
            {okMsg && (
              <div className="mt-4 flex items-center gap-2 rounded-lg bg-green-500/10 px-3 py-2 text-sm text-green-400">
                <Check className="h-4 w-4 flex-shrink-0" /> {okMsg}
              </div>
            )}

            <button onClick={() => { if (validate()) setConfirm(true) }}
              disabled={busy || !title.trim()}
              className="mt-5 w-full inline-flex items-center justify-center gap-1.5 rounded-xl bg-blue-600 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 transition-colors">
              <Send className="h-4 w-4" />
              발행하기
            </button>
          </div>

          {/* 미리보기 */}
          <div className="rounded-2xl border border-gray-800 bg-gray-900 p-5">
            <h2 className="mb-3 flex items-center gap-2 font-bold text-white">
              <Eye className="h-4 w-4 text-gray-400" /> 알림 미리보기
            </h2>
            {title.trim() ? (
              <div className="rounded-xl border border-gray-700 bg-gray-800/50 p-4">
                <div className="flex items-start gap-3">
                  <span className="text-xl flex-shrink-0">📢</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-white">{title.trim()}</p>
                    {body.trim() && <p className="mt-1 text-xs text-gray-400 whitespace-pre-line">{body.trim()}</p>}
                    {link.trim() && (
                      <p className="mt-1.5 inline-flex items-center gap-1 text-xs text-blue-400">
                        <ExternalLink className="h-3 w-3" /> {link.trim()}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-gray-700 bg-gray-800/30 py-8 text-center">
                <EyeOff className="mx-auto mb-2 h-6 w-6 text-gray-600 dark:text-gray-400" />
                <p className="text-xs text-gray-500">제목을 입력하면 미리 볼 수 있어요</p>
              </div>
            )}
          </div>
        </div>

        {/* 최근 발행 이력 */}
        <div className="rounded-2xl border border-gray-800 bg-gray-900 p-5">
          <h2 className="mb-3 font-bold text-white">최근 발행 이력</h2>
          {loadingRecent ? (
            <div className="flex items-center justify-center py-10">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
            </div>
          ) : recent.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-500">아직 발행한 공지가 없어요</p>
          ) : (
            <ul className="space-y-2 max-h-[600px] overflow-y-auto pr-1">
              {recent.map((a, i) => (
                <li key={i} className="rounded-xl border border-gray-800 bg-gray-800/40 p-3.5">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-semibold text-white truncate flex-1">{a.title}</p>
                    <span className="text-[11px] text-gray-500 flex-shrink-0">{formatDate(a.created_at)}</span>
                  </div>
                  {a.body && <p className="mt-1 text-xs text-gray-400 line-clamp-2">{a.body}</p>}
                  <div className="mt-1.5 flex items-center gap-2 text-[11px] text-gray-500">
                    <span className="inline-flex items-center gap-0.5 rounded-md bg-gray-700/60 px-1.5 py-0.5">
                      <Users className="h-3 w-3" /> {a.count}명
                    </span>
                    {a.link && <span className="inline-flex items-center gap-0.5 text-blue-400 truncate"><ExternalLink className="h-3 w-3" /> {a.link}</span>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {confirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          onClick={() => !busy && setConfirm(false)}>
          <div className="w-full max-w-sm rounded-2xl border border-gray-700 bg-gray-900 p-6 shadow-xl"
            onClick={e => e.stopPropagation()}>
            <div className="flex flex-col items-center text-center">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/20">
                <Megaphone className="h-6 w-6 text-amber-400" />
              </div>
              <h3 className="text-lg font-bold text-white">공지를 발행할까요?</h3>
              <p className="mt-2 text-sm text-gray-400 leading-relaxed">
                <span className="font-bold text-white">{AUDIENCE_META[audience].label}</span> 대상 약 <span className="font-bold text-white">{targetCount ?? '...'}</span>명에게<br />
                푸시·알림함으로 전달됩니다.
              </p>
            </div>
            <div className="mt-5 flex gap-2">
              <button onClick={() => setConfirm(false)} disabled={busy}
                className="flex-1 rounded-xl border border-gray-700 py-2.5 text-sm font-medium text-gray-300 hover:bg-gray-800 disabled:opacity-50">
                취소
              </button>
              <button onClick={publish} disabled={busy}
                className="flex-1 rounded-xl bg-amber-500 py-2.5 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-50">
                {busy ? '발행 중...' : '발행'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
