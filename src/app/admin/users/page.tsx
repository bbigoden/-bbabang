'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/lib/auth-context'
import { formatDate } from '@/lib/utils'
import {
  Users, ArrowLeft, Search, X, ShieldCheck, Shield, Ban,
  CheckCircle2, AlertCircle, Mail, Phone, Calendar, Building2,
  Pencil, Save, FileText
} from 'lucide-react'

type AccountStatus = 'active' | 'suspended' | 'banned'
type Role = 'user' | 'broker' | 'admin'
type RoleFilter = 'all' | Role
type StatusFilter = 'all' | AccountStatus

interface UserRow {
  id: string
  email: string | null
  name: string | null
  phone: string | null
  role: Role
  account_status: AccountStatus
  suspended_until: string | null
  admin_note: string | null
  created_at: string | null
}

const STATUS_META: Record<AccountStatus, { label: string; color: string; icon: any }> = {
  active: { label: '활성', color: 'bg-green-500/20 text-green-400 border-green-500/30', icon: CheckCircle2 },
  suspended: { label: '일시 정지', color: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30', icon: AlertCircle },
  banned: { label: '영구 차단', color: 'bg-red-500/20 text-red-400 border-red-500/30', icon: Ban },
}

const ROLE_META: Record<Role, { label: string; color: string }> = {
  user: { label: '고객', color: 'bg-blue-500/20 text-blue-400' },
  broker: { label: '중개사', color: 'bg-purple-500/20 text-purple-400' },
  admin: { label: '관리자', color: 'bg-red-500/20 text-red-400' },
}

const PAGE_SIZE = 50

export default function AdminUsersPage() {
  const router = useRouter()
  const supabaseRef = useRef(createClient())
  const supabase = supabaseRef.current
  const auth = useAuth()

  const [items, setItems] = useState<UserRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [page, setPage] = useState(0)
  const [role, setRole] = useState<RoleFilter>('all')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<UserRow | null>(null)

  useEffect(() => {
    if (auth.loading) return
    if (!auth.user) { router.push('/auth/login'); return }
    if (auth.profile?.role !== 'admin') { router.push('/'); return }
  }, [auth.loading, auth.user, auth.profile?.role, router])

  const load = useCallback(async (reset = false) => {
    const targetPage = reset ? 0 : page
    if (reset) setLoading(true)
    else setLoadingMore(true)

    let q = supabase
      .from('profiles')
      .select('id, email, name, phone, role, account_status, suspended_until, admin_note, created_at')
      .order('created_at', { ascending: false })

    if (role !== 'all') q = q.eq('role', role)
    if (status !== 'all') q = q.eq('account_status', status)
    if (search.trim()) {
      const s = search.trim()
      q = q.or(`name.ilike.%${s}%,email.ilike.%${s}%,phone.ilike.%${s}%`)
    }

    q = q.range(targetPage * PAGE_SIZE, targetPage * PAGE_SIZE + PAGE_SIZE - 1)

    const { data } = await q
    const rows = (data ?? []) as UserRow[]
    setItems(prev => reset ? rows : [...prev, ...rows])
    setHasMore(rows.length === PAGE_SIZE)
    setPage(targetPage + 1)
    if (reset) setLoading(false); else setLoadingMore(false)
  }, [supabase, page, role, status, search])

  useEffect(() => {
    if (auth.profile?.role === 'admin') {
      setPage(0); setHasMore(true)
      load(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.profile?.role, role, status])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setPage(0); setHasMore(true)
    load(true)
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
        <div className="mx-auto flex max-w-7xl items-center gap-3">
          <Link href="/admin" className="flex h-9 w-9 items-center justify-center rounded-xl bg-gray-800 hover:bg-gray-700 transition-colors">
            <ArrowLeft className="h-4 w-4 text-gray-300" />
          </Link>
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-500/20">
            <Users className="h-5 w-5 text-blue-400" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-white">사용자 관리</h1>
            <p className="text-xs text-gray-400">계정 상태·역할 변경, 관리자 메모</p>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-6 py-8 space-y-5">
        <div className="flex flex-wrap gap-3">
          <form onSubmit={handleSearch} className="flex-1 min-w-[280px] flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="이름·이메일·전화번호 검색"
                className="w-full rounded-xl border border-gray-700 bg-gray-900 pl-9 pr-3 py-2 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            </div>
            <button type="submit" className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">
              검색
            </button>
          </form>

          <div className="flex items-center gap-1 rounded-xl border border-gray-800 bg-gray-900 p-1">
            {([
              { key: 'all', label: '전체' },
              { key: 'user', label: '고객' },
              { key: 'broker', label: '중개사' },
              { key: 'admin', label: '관리자' },
            ] as const).map(t => (
              <button key={t.key} onClick={() => setRole(t.key)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                  role === t.key ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'
                }`}>
                {t.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1 rounded-xl border border-gray-800 bg-gray-900 p-1">
            {([
              { key: 'all', label: '상태 전체' },
              { key: 'active', label: '활성' },
              { key: 'suspended', label: '정지' },
              { key: 'banned', label: '차단' },
            ] as const).map(t => (
              <button key={t.key} onClick={() => setStatus(t.key)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                  status === t.key ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'
                }`}>
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-2xl border border-gray-800 bg-gray-900 py-20 text-center">
            <Users className="mx-auto mb-3 h-12 w-12 text-gray-700" />
            <p className="font-semibold text-gray-400">조건에 맞는 사용자가 없어요</p>
          </div>
        ) : (
          <>
            <ul className="rounded-2xl border border-gray-800 bg-gray-900 overflow-hidden divide-y divide-gray-800">
              {items.map(u => {
                const sm = STATUS_META[u.account_status]
                const rm = ROLE_META[u.role]
                const SIcon = sm.icon
                return (
                  <li key={u.id}>
                    <button onClick={() => setSelected(u)}
                      className="w-full flex items-center gap-3 px-5 py-3.5 text-left hover:bg-gray-800/60 transition-colors">
                      <div className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                        u.role === 'admin' ? 'bg-red-500/20 text-red-400'
                          : u.role === 'broker' ? 'bg-purple-500/20 text-purple-400'
                          : 'bg-gray-700 text-gray-300'
                      }`}>
                        {(u.name || u.email || '?')[0]?.toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <p className="text-sm font-semibold text-white truncate">{u.name || '(이름 없음)'}</p>
                          <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold ${rm.color}`}>{rm.label}</span>
                          {u.account_status !== 'active' && (
                            <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-bold ${sm.color}`}>
                              <SIcon className="h-3 w-3" /> {sm.label}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-400 truncate">{u.email}</p>
                      </div>
                      <span className="text-xs text-gray-500 flex-shrink-0">{u.created_at && formatDate(u.created_at)}</span>
                    </button>
                  </li>
                )
              })}
            </ul>

            {hasMore && (
              <div className="flex justify-center">
                <button onClick={() => load(false)} disabled={loadingMore}
                  className="rounded-xl border border-gray-700 bg-gray-900 px-5 py-2.5 text-sm font-medium text-gray-300 hover:bg-gray-800 disabled:opacity-50">
                  {loadingMore ? '불러오는 중...' : '더 보기'}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {selected && (
        <UserDetailModal
          user={selected}
          adminId={auth.user!.id}
          onClose={() => setSelected(null)}
          onUpdated={async (updated) => {
            setItems(prev => prev.map(p => p.id === updated.id ? updated : p))
            setSelected(updated)
          }}
        />
      )}
    </div>
  )
}

function UserDetailModal({ user, adminId, onClose, onUpdated }: {
  user: UserRow
  adminId: string
  onClose: () => void
  onUpdated: (u: UserRow) => Promise<void>
}) {
  const supabaseRef = useRef(createClient())
  const supabase = supabaseRef.current
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [okMsg, setOkMsg] = useState<string | null>(null)
  const [editingNote, setEditingNote] = useState(false)
  const [note, setNote] = useState(user.admin_note ?? '')
  const [suspendDays, setSuspendDays] = useState(7)

  const isSelf = user.id === adminId

  const update = async (patch: Partial<UserRow>) => {
    if (busy) return
    setBusy(true); setErr(null); setOkMsg(null)
    const { data, error } = await supabase
      .from('profiles')
      .update(patch as any)
      .eq('id', user.id)
      .select('id, email, name, phone, role, account_status, suspended_until, admin_note, created_at')
      .single()
    setBusy(false)
    if (error || !data) {
      setErr('변경 실패: ' + (error?.message ?? 'unknown'))
      return
    }
    await onUpdated(data as UserRow)
    setOkMsg('저장됐어요')
    setTimeout(() => setOkMsg(null), 2500)
  }

  const setStatus = (s: AccountStatus) => {
    if (isSelf && s !== 'active') { setErr('본인 계정의 상태는 변경할 수 없어요'); return }
    const patch: Partial<UserRow> = { account_status: s }
    if (s === 'suspended') {
      const until = new Date(Date.now() + suspendDays * 24 * 60 * 60 * 1000).toISOString()
      patch.suspended_until = until
    } else {
      patch.suspended_until = null
    }
    update(patch)
  }

  const setRole = (r: Role) => {
    if (isSelf && r !== 'admin') { setErr('본인의 admin 권한은 해제할 수 없어요'); return }
    update({ role: r })
  }

  const saveNote = () => {
    update({ admin_note: note || null }).then(() => setEditingNote(false))
  }

  const sm = STATUS_META[user.account_status]
  const rm = ROLE_META[user.role]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={() => !busy && onClose()}>
      <div className="w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-2xl border border-gray-700 bg-gray-900 shadow-2xl"
        onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-800 bg-gray-900 px-6 py-4">
          <div className="flex items-center gap-2">
            <h3 className="font-bold text-white">사용자 상세</h3>
            {isSelf && <span className="rounded-md bg-yellow-500/20 px-1.5 py-0.5 text-[10px] font-bold text-yellow-400">본인</span>}
          </div>
          <button onClick={onClose} disabled={busy}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-800 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {/* 헤더 */}
          <div className="flex items-center gap-4">
            <div className={`flex h-14 w-14 items-center justify-center rounded-2xl text-2xl font-black ${
              user.role === 'admin' ? 'bg-red-500/20 text-red-400'
                : user.role === 'broker' ? 'bg-purple-500/20 text-purple-400'
                : 'bg-gray-700 text-gray-200'
            }`}>
              {(user.name || user.email || '?')[0]?.toUpperCase()}
            </div>
            <div>
              <p className="text-lg font-bold text-white">{user.name || '(이름 없음)'}</p>
              <div className="mt-1 flex items-center gap-1.5">
                <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold ${rm.color}`}>{rm.label}</span>
                <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-bold ${sm.color}`}>
                  <sm.icon className="h-3 w-3" /> {sm.label}
                </span>
              </div>
            </div>
          </div>

          {/* 기본 정보 */}
          <div className="rounded-xl border border-gray-800 bg-gray-800/40 px-4 py-1 divide-y divide-gray-800/50">
            <InfoRow icon={Mail} label="이메일" value={user.email} />
            <InfoRow icon={Phone} label="연락처" value={user.phone || '미등록'} />
            <InfoRow icon={Calendar} label="가입일" value={user.created_at ? formatDate(user.created_at) : '—'} />
            {user.suspended_until && (
              <InfoRow icon={AlertCircle} label="정지 해제일" value={
                <span className="text-yellow-400">{new Date(user.suspended_until).toLocaleString('ko-KR')}</span>
              } />
            )}
          </div>

          {/* 상태 변경 */}
          <div className="rounded-xl border border-gray-800 bg-gray-800/50 p-4">
            <p className="mb-3 text-xs font-semibold text-gray-400">계정 상태</p>
            <div className="grid grid-cols-3 gap-2">
              {(['active', 'suspended', 'banned'] as const).map(s => {
                const m = STATUS_META[s]
                const active = user.account_status === s
                return (
                  <button key={s} onClick={() => setStatus(s)} disabled={busy || active}
                    className={`flex flex-col items-center gap-1 rounded-lg border px-2 py-2.5 text-xs font-semibold transition-all ${
                      active ? `${m.color} border-current` : 'border-gray-700 bg-transparent text-gray-400 hover:bg-gray-700'
                    } disabled:opacity-50`}>
                    <m.icon className="h-4 w-4" />
                    {m.label}
                  </button>
                )
              })}
            </div>

            {user.account_status !== 'suspended' && (
              <div className="mt-3">
                <p className="mb-1.5 text-[11px] font-semibold text-gray-500">정지 기간 (일)</p>
                <div className="flex items-center gap-2">
                  {[1, 7, 30, 90].map(d => (
                    <button key={d} onClick={() => setSuspendDays(d)}
                      className={`rounded-md px-3 py-1 text-xs font-semibold transition-colors ${
                        suspendDays === d ? 'bg-yellow-500/20 text-yellow-400' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                      }`}>
                      {d}일
                    </button>
                  ))}
                </div>
                <p className="mt-1.5 text-[11px] text-gray-500">'일시 정지' 클릭 시 위에서 선택한 기간만큼 정지됩니다</p>
              </div>
            )}
          </div>

          {/* 역할 변경 */}
          <div className="rounded-xl border border-gray-800 bg-gray-800/50 p-4">
            <p className="mb-3 text-xs font-semibold text-gray-400">역할</p>
            <div className="grid grid-cols-3 gap-2">
              {(['user', 'broker', 'admin'] as const).map(r => {
                const m = ROLE_META[r]
                const active = user.role === r
                return (
                  <button key={r} onClick={() => setRole(r)} disabled={busy || active}
                    className={`flex items-center justify-center gap-1 rounded-lg border px-2 py-2 text-xs font-semibold transition-all ${
                      active ? `${m.color} border-current` : 'border-gray-700 bg-transparent text-gray-400 hover:bg-gray-700'
                    } disabled:opacity-50`}>
                    {r === 'admin' && <Shield className="h-3 w-3" />}
                    {r === 'broker' && <Building2 className="h-3 w-3" />}
                    {r === 'user' && <Users className="h-3 w-3" />}
                    {m.label}
                  </button>
                )
              })}
            </div>
            <p className="mt-2 text-[11px] text-gray-500">
              ⚠️ 역할 변경은 신중히. broker는 broker_profiles 별도 필요.
            </p>
          </div>

          {/* 관리자 메모 */}
          <div className="rounded-xl border border-gray-800 bg-gray-800/50 p-4">
            <div className="mb-2 flex items-center justify-between">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-gray-400">
                <FileText className="h-3.5 w-3.5" /> 관리자 메모 (내부용)
              </p>
              {!editingNote ? (
                <button onClick={() => { setEditingNote(true); setNote(user.admin_note ?? '') }}
                  className="inline-flex items-center gap-1 text-[11px] text-blue-400 hover:text-blue-300">
                  <Pencil className="h-3 w-3" /> 수정
                </button>
              ) : (
                <button onClick={saveNote} disabled={busy}
                  className="inline-flex items-center gap-1 text-[11px] text-green-400 hover:text-green-300">
                  <Save className="h-3 w-3" /> 저장
                </button>
              )}
            </div>
            {editingNote ? (
              <textarea
                value={note}
                onChange={e => setNote(e.target.value)}
                rows={3}
                placeholder="제재 사유·관찰 사항 등"
                className="w-full rounded-xl border border-gray-700 bg-gray-900 px-3 py-2.5 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 resize-none"
              />
            ) : user.admin_note ? (
              <p className="text-sm text-gray-200 whitespace-pre-line">{user.admin_note}</p>
            ) : (
              <p className="text-xs text-gray-500">메모 없음</p>
            )}
          </div>

          {err && (
            <div className="flex items-center gap-2 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400">
              <AlertCircle className="h-4 w-4 flex-shrink-0" /> {err}
            </div>
          )}
          {okMsg && (
            <div className="flex items-center gap-2 rounded-lg bg-green-500/10 px-3 py-2 text-sm text-green-400">
              <CheckCircle2 className="h-4 w-4 flex-shrink-0" /> {okMsg}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function InfoRow({ icon: Icon, label, value }: { icon: any; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-2.5">
      <Icon className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-500" />
      <div className="flex-1 min-w-0">
        <p className="text-[11px] text-gray-500 mb-0.5">{label}</p>
        <div className="text-sm text-gray-200">{value}</div>
      </div>
    </div>
  )
}
