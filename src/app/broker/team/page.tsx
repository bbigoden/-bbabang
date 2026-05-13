'use client'

import { useEffect, useState, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Header } from '@/components/layout/header'
import { useRouter } from 'next/navigation'
import { Plus, X, Mail, Shield, Users, Check, Clock, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Permission {
  view: boolean
  edit: boolean
}
interface Permissions {
  customers: Permission
  diary: Permission
  properties: Permission
  can_see_others: boolean
}

const DEFAULT_PERMISSIONS: Permissions = {
  customers:  { view: true, edit: true },
  diary:      { view: true, edit: true },
  properties: { view: true, edit: true },
  can_see_others: true,
}

interface Employee {
  id: string
  user_id: string
  permissions: Permissions | null
  profiles: { name: string; email: string } | null
}

interface Invitation {
  id: string
  email: string
  permissions: Permissions
  status: 'pending' | 'accepted' | 'expired'
  invited_at: string
}

const PAGE_LABELS: Record<string, string> = {
  customers:  '고객목록',
  diary:      '업무일지',
  properties: '매물목록',
}

function PermissionEditor({ perms, onChange }: {
  perms: Permissions
  onChange: (p: Permissions) => void
}) {
  const toggle = (page: 'customers' | 'diary' | 'properties', field: 'view' | 'edit') => {
    const cur = perms[page]
    if (field === 'view' && cur.view) {
      // view 끄면 edit도 끔
      onChange({ ...perms, [page]: { view: false, edit: false } })
    } else if (field === 'edit' && !cur.view) {
      // view 없이 edit 켜면 view도 켬
      onChange({ ...perms, [page]: { view: true, edit: true } })
    } else {
      onChange({ ...perms, [page]: { ...cur, [field]: !cur[field] } })
    }
  }

  return (
    <div className="space-y-2">
      {(['customers', 'diary', 'properties'] as const).map(page => (
        <div key={page} className="flex items-center justify-between">
          <span className="text-xs font-medium text-gray-700">{PAGE_LABELS[page]}</span>
          <div className="flex gap-1.5">
            {(['view', 'edit'] as const).map(field => (
              <button key={field} onClick={() => toggle(page, field)}
                className={cn('rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-colors',
                  perms[page][field]
                    ? field === 'edit' ? 'bg-blue-600 text-white' : 'bg-gray-800 text-white'
                    : 'bg-gray-100 text-gray-400 hover:bg-gray-200'
                )}>
                {field === 'view' ? '조회' : '편집'}
              </button>
            ))}
          </div>
        </div>
      ))}
      <div className="flex items-center justify-between pt-1 border-t border-gray-100">
        <span className="text-xs font-medium text-gray-700">타직원 데이터 공유</span>
        <button onClick={() => onChange({ ...perms, can_see_others: !perms.can_see_others })}
          className={cn('rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-colors',
            perms.can_see_others ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-400 hover:bg-gray-200'
          )}>
          {perms.can_see_others ? '공유' : '비공개'}
        </button>
      </div>
    </div>
  )
}

export default function BrokerTeamPage() {
  const supabase = createClient()
  const router = useRouter()

  const [user, setUser] = useState<any>(null)
  const [broker, setBroker] = useState<any>(null)
  const [employees, setEmployees] = useState<Employee[]>([])
  const [invitations, setInvitations] = useState<Invitation[]>([])
  const [loading, setLoading] = useState(true)
  const [isOwner, setIsOwner] = useState(false)

  // 초대 폼
  const [inviteEmail, setInviteEmail] = useState('')
  const [invitePerms, setInvitePerms] = useState<Permissions>(DEFAULT_PERMISSIONS)
  const [inviting, setInviting] = useState(false)
  const [inviteError, setInviteError] = useState('')
  const [inviteSuccess, setInviteSuccess] = useState(false)
  const [showInviteForm, setShowInviteForm] = useState(false)

  // 편집 중인 직원 권한
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editPerms, setEditPerms] = useState<Permissions>(DEFAULT_PERMISSIONS)
  const [saving, setSaving] = useState(false)

  useEffect(() => { init() }, [])

  const init = async () => {
    const { data: { user: u } } = await supabase.auth.getUser()
    if (!u) { router.push('/auth/login'); return }
    setUser(u)

    const { data: b } = await supabase.from('broker_profiles').select('*').eq('user_id', u.id).single()
    if (!b) { router.push('/broker/register'); return }
    setBroker(b)

    const owner = b.is_owner !== false
    setIsOwner(owner)

    if (!owner) {
      // 직원이면 대표 정보 및 팀원 목록 조회
      const { data: emps } = await supabase
        .from('broker_profiles')
        .select('id, user_id, permissions, profiles(name, email)')
        .eq('parent_broker_id', b.parent_broker_id)
      setEmployees((emps ?? []) as unknown as Employee[])
    } else {
      // 대표이면 직원 목록 + 초대 목록 조회
      const [{ data: emps }, { data: invs }] = await Promise.all([
        supabase.from('broker_profiles')
          .select('id, user_id, permissions, profiles(name, email)')
          .eq('parent_broker_id', b.id),
        supabase.from('employee_invitations')
          .select('id, email, permissions, status, invited_at')
          .eq('owner_broker_id', b.id)
          .order('invited_at', { ascending: false }),
      ])
      setEmployees((emps ?? []) as unknown as Employee[])
      setInvitations((invs ?? []) as unknown as Invitation[])
    }

    setLoading(false)
  }

  const sendInvite = async () => {
    if (!inviteEmail.trim() || !broker) return
    setInviting(true); setInviteError(''); setInviteSuccess(false)
    try {
      const { error } = await supabase.from('employee_invitations').insert({
        owner_broker_id: broker.id,
        email: inviteEmail.trim().toLowerCase(),
        permissions: invitePerms,
      })
      if (error) {
        if (error.code === '23505') setInviteError('이미 초대한 이메일이에요.')
        else setInviteError('초대 중 오류가 발생했어요.')
      } else {
        setInviteSuccess(true)
        setInviteEmail('')
        setInvitePerms(DEFAULT_PERMISSIONS)
        setShowInviteForm(false)
        // 목록 새로고침
        const { data: invs } = await supabase
          .from('employee_invitations')
          .select('id, email, permissions, status, invited_at')
          .eq('owner_broker_id', broker.id)
          .order('invited_at', { ascending: false })
        setInvitations((invs ?? []) as Invitation[])
      }
    } finally {
      setInviting(false)
    }
  }

  const cancelInvite = async (invId: string) => {
    await supabase.from('employee_invitations').delete().eq('id', invId)
    setInvitations(prev => prev.filter(i => i.id !== invId))
  }

  const saveEmployeePerms = async (empId: string) => {
    setSaving(true)
    await supabase.from('broker_profiles').update({ permissions: editPerms }).eq('id', empId)
    setEmployees(prev => prev.map(e => e.id === empId ? { ...e, permissions: editPerms } : e))
    setEditingId(null)
    setSaving(false)
  }

  const removeEmployee = async (empId: string) => {
    if (!confirm('이 직원을 팀에서 제거할까요? 직원의 계정은 유지되지만 공유 데이터 접근이 차단됩니다.')) return
    await supabase.from('broker_profiles').update({ parent_broker_id: null }).eq('id', empId)
    setEmployees(prev => prev.filter(e => e.id !== empId))
  }

  const formatDate = (d: string) => new Date(d).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })

  if (loading) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-gray-400 text-sm">불러오는 중...</div>
    </div>
  )

  if (!isOwner) return (
    <div className="min-h-screen bg-gray-50">
      <Header user={user} role="broker" />
      <div className="mx-auto max-w-2xl px-4 py-12 text-center">
        <Shield className="mx-auto h-12 w-12 text-gray-200 mb-4" />
        <h2 className="text-lg font-bold text-gray-700 mb-2">팀원 관리는 대표 계정에서만 가능해요</h2>
        <p className="text-sm text-gray-400">대표 중개사 계정으로 로그인 후 이용해주세요.</p>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-50">
      <Header user={user} role="broker" />
      <div className="mx-auto max-w-2xl px-4 py-8">

        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-black text-gray-900">팀 관리</h1>
            <p className="text-sm text-gray-400 mt-0.5">직원을 초대하고 접근 권한을 설정해요</p>
          </div>
          <button onClick={() => { setShowInviteForm(true); setInviteSuccess(false) }}
            className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-700 transition-colors">
            <Plus className="h-4 w-4" />직원 초대
          </button>
        </div>

        {/* 초대 성공 알림 */}
        {inviteSuccess && (
          <div className="mb-4 flex items-center gap-2 rounded-xl bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-700">
            <Check className="h-4 w-4 flex-shrink-0" />초대 이메일이 등록됐어요. 해당 이메일로 가입하면 자동으로 팀에 연결돼요.
          </div>
        )}

        {/* 초대 폼 */}
        {showInviteForm && (
          <div className="mb-5 rounded-2xl border border-blue-200 bg-blue-50/30 p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-gray-800">새 직원 초대</h3>
              <button onClick={() => setShowInviteForm(false)}
                className="text-gray-400 hover:text-gray-600 transition-colors">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-gray-600 block mb-1.5">이메일 주소</label>
                <input value={inviteEmail} onChange={e => setInviteEmail(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && sendInvite()}
                  placeholder="직원 이메일 입력"
                  className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-400/20 bg-white" />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-600 block mb-2">권한 설정</label>
                <div className="rounded-xl border border-gray-200 bg-white p-3">
                  <PermissionEditor perms={invitePerms} onChange={setInvitePerms} />
                </div>
              </div>
              {inviteError && <p className="text-xs text-red-500">{inviteError}</p>}
              <div className="flex gap-2">
                <button onClick={() => setShowInviteForm(false)}
                  className="flex-1 rounded-xl border border-gray-200 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50">취소</button>
                <button onClick={sendInvite} disabled={inviting || !inviteEmail.trim()}
                  className="flex-1 rounded-xl bg-blue-600 py-2.5 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50 transition-colors">
                  {inviting ? '초대 중...' : '초대하기'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 현재 팀원 */}
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <Users className="h-4 w-4 text-gray-400" />
            <h2 className="text-sm font-bold text-gray-700">현재 팀원 ({employees.length}명)</h2>
          </div>
          {employees.length === 0 ? (
            <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center">
              <Users className="mx-auto h-8 w-8 text-gray-200 mb-3" />
              <p className="text-sm text-gray-400">아직 팀원이 없어요</p>
              <p className="text-xs text-gray-300 mt-1">직원을 초대해 팀을 구성해보세요</p>
            </div>
          ) : (
            <div className="space-y-2">
              {employees.map(emp => (
                <div key={emp.id} className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
                  <div className="flex items-center gap-3 p-4">
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gray-100 text-sm font-bold text-gray-600 flex-shrink-0">
                      {emp.profiles?.name?.[0] ?? '?'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-gray-800">{emp.profiles?.name ?? '—'}</div>
                      <div className="text-xs text-gray-400">{emp.profiles?.email}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={() => {
                        if (editingId === emp.id) { setEditingId(null) }
                        else { setEditingId(emp.id); setEditPerms(emp.permissions ?? DEFAULT_PERMISSIONS) }
                      }}
                        className={cn('rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors',
                          editingId === emp.id ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200')}>
                        권한 설정
                      </button>
                      <button onClick={() => removeEmployee(emp.id)}
                        className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-300 hover:bg-red-50 hover:text-red-400 transition-colors">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                  {editingId === emp.id && (
                    <div className="border-t border-gray-100 p-4">
                      <PermissionEditor perms={editPerms} onChange={setEditPerms} />
                      <div className="flex gap-2 mt-3">
                        <button onClick={() => setEditingId(null)}
                          className="flex-1 rounded-xl border border-gray-200 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50">취소</button>
                        <button onClick={() => saveEmployeePerms(emp.id)} disabled={saving}
                          className="flex-1 rounded-xl bg-blue-600 py-2 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-50">
                          {saving ? '저장 중...' : '저장'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 대기 중인 초대 */}
        {invitations.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Clock className="h-4 w-4 text-gray-400" />
              <h2 className="text-sm font-bold text-gray-700">대기 중인 초대 ({invitations.filter(i => i.status === 'pending').length}건)</h2>
            </div>
            <div className="space-y-2">
              {invitations.map(inv => (
                <div key={inv.id} className="flex items-center gap-3 rounded-2xl border border-gray-200 bg-white px-4 py-3">
                  <Mail className="h-4 w-4 text-gray-300 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-700 truncate">{inv.email}</div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className={cn('text-[10px] font-semibold rounded-md px-1.5 py-0.5',
                        inv.status === 'pending' ? 'bg-yellow-100 text-yellow-700' :
                        inv.status === 'accepted' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500')}>
                        {inv.status === 'pending' ? '대기중' : inv.status === 'accepted' ? '수락됨' : '만료'}
                      </span>
                      <span className="text-[10px] text-gray-300">{formatDate(inv.invited_at)} 초대</span>
                    </div>
                  </div>
                  {inv.status === 'pending' && (
                    <button onClick={() => cancelInvite(inv.id)}
                      className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-300 hover:bg-red-50 hover:text-red-400 transition-colors flex-shrink-0">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 초대 안내 */}
        <div className="mt-6 rounded-2xl bg-blue-50 border border-blue-100 p-4">
          <h3 className="text-xs font-bold text-blue-700 mb-1">초대 방법 안내</h3>
          <ol className="text-xs text-blue-600 space-y-0.5 list-decimal list-inside leading-relaxed">
            <li>직원 이메일 주소를 입력하고 권한을 설정해요</li>
            <li>직원이 해당 이메일로 빠방에 가입하면 자동으로 팀에 연결돼요</li>
            <li>이미 가입된 계정도 동일하게 연결할 수 있어요</li>
          </ol>
        </div>
      </div>
    </div>
  )
}
