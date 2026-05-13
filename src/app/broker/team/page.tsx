'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Header } from '@/components/layout/header'
import { useRouter } from 'next/navigation'
import { X, Shield, Users, Clock } from 'lucide-react'
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
  is_approved: boolean
  profiles: { name: string; email: string } | null
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
      onChange({ ...perms, [page]: { view: false, edit: false } })
    } else if (field === 'edit' && !cur.view) {
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
  const [approved, setApproved] = useState<Employee[]>([])
  const [pending, setPending] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [isOwner, setIsOwner] = useState(false)

  // 승인 폼
  const [approvingId, setApprovingId] = useState<string | null>(null)
  const [approvePerms, setApprovePerms] = useState<Permissions>(DEFAULT_PERMISSIONS)
  const [approving, setApproving] = useState(false)

  // 권한 편집
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

    if (owner) {
      const { data: emps } = await supabase
        .from('broker_profiles')
        .select('id, user_id, permissions, is_approved, profiles(name, email)')
        .eq('parent_broker_id', b.id)

      const list = (emps ?? []) as unknown as Employee[]
      setApproved(list.filter(e => e.is_approved))
      setPending(list.filter(e => !e.is_approved))
    }

    setLoading(false)
  }

  const approveEmployee = async (empId: string) => {
    setApproving(true)
    await supabase.from('broker_profiles')
      .update({ is_approved: true, permissions: approvePerms })
      .eq('id', empId)
    const emp = pending.find(e => e.id === empId)
    if (emp) {
      setApproved(prev => [...prev, { ...emp, is_approved: true, permissions: approvePerms }])
      setPending(prev => prev.filter(e => e.id !== empId))
    }
    setApprovingId(null)
    setApproving(false)
  }

  const rejectEmployee = async (empId: string) => {
    if (!confirm('이 신청을 거절할까요? 직원의 계정 자체는 유지됩니다.')) return
    await supabase.from('broker_profiles').delete().eq('id', empId)
    setPending(prev => prev.filter(e => e.id !== empId))
  }

  const saveEmployeePerms = async (empId: string) => {
    setSaving(true)
    await supabase.from('broker_profiles').update({ permissions: editPerms }).eq('id', empId)
    setApproved(prev => prev.map(e => e.id === empId ? { ...e, permissions: editPerms } : e))
    setEditingId(null)
    setSaving(false)
  }

  const removeEmployee = async (empId: string) => {
    if (!confirm('이 직원을 팀에서 제거할까요?\n직원이 입력한 고객·매물·업무일지 데이터는 사무소에 귀속됩니다.')) return
    if (!broker) return

    // 직원 데이터를 대표 broker_id로 이전
    await Promise.all([
      supabase.from('broker_customers').update({ broker_id: broker.id }).eq('broker_id', empId),
      supabase.from('broker_properties').update({ broker_id: broker.id }).eq('broker_id', empId),
      supabase.from('broker_consultations').update({ broker_id: broker.id }).eq('broker_id', empId),
    ])

    // 직원 프로필 사무소 연결 해제
    await supabase.from('broker_profiles').update({ parent_broker_id: null, is_approved: false }).eq('id', empId)
    setApproved(prev => prev.filter(e => e.id !== empId))
  }

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

        <div className="mb-6">
          <h1 className="text-2xl font-black text-gray-900">팀 관리</h1>
          <p className="text-sm text-gray-400 mt-0.5">직원 등록 신청을 승인하고 권한을 설정해요</p>
        </div>

        {/* 사무소 코드 안내 */}
        {broker?.office_code && (
          <div className="mb-6 rounded-2xl bg-blue-50 border border-blue-200 p-4">
            <p className="text-xs font-bold text-blue-700 mb-1">직원에게 이 코드를 알려주세요</p>
            <div className="flex items-center gap-3">
              <span className="text-2xl font-black font-mono tracking-widest text-blue-900">{broker.office_code}</span>
              <span className="text-xs text-blue-500">직원이 이 코드로 등록 신청하면 여기서 승인할 수 있어요</span>
            </div>
          </div>
        )}

        {/* 승인 대기 */}
        {pending.length > 0 && (
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-3">
              <Clock className="h-4 w-4 text-yellow-500" />
              <h2 className="text-sm font-bold text-gray-700">승인 대기 ({pending.length}명)</h2>
            </div>
            <div className="space-y-2">
              {pending.map(emp => (
                <div key={emp.id} className="rounded-2xl border border-yellow-200 bg-yellow-50/40 overflow-hidden">
                  <div className="flex items-center gap-3 p-4">
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-yellow-100 text-sm font-bold text-yellow-700 flex-shrink-0">
                      {emp.profiles?.name?.[0] ?? '?'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-gray-800">{emp.profiles?.name ?? '—'}</div>
                      <div className="text-xs text-gray-400">{emp.profiles?.email}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={() => {
                        if (approvingId === emp.id) { setApprovingId(null) }
                        else { setApprovingId(emp.id); setApprovePerms(DEFAULT_PERMISSIONS) }
                      }}
                        className={cn('rounded-xl px-3 py-1.5 text-xs font-bold transition-colors',
                          approvingId === emp.id ? 'bg-blue-600 text-white' : 'bg-green-600 text-white hover:bg-green-700')}>
                        승인
                      </button>
                      <button onClick={() => rejectEmployee(emp.id)}
                        className="rounded-xl px-3 py-1.5 text-xs font-bold bg-red-50 text-red-500 hover:bg-red-100 transition-colors">
                        거절
                      </button>
                    </div>
                  </div>
                  {approvingId === emp.id && (
                    <div className="border-t border-yellow-200 bg-white p-4">
                      <p className="text-xs font-semibold text-gray-600 mb-2">권한 설정 후 승인</p>
                      <PermissionEditor perms={approvePerms} onChange={setApprovePerms} />
                      <div className="flex gap-2 mt-3">
                        <button onClick={() => setApprovingId(null)}
                          className="flex-1 rounded-xl border border-gray-200 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50">취소</button>
                        <button onClick={() => approveEmployee(emp.id)} disabled={approving}
                          className="flex-1 rounded-xl bg-blue-600 py-2 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-50">
                          {approving ? '승인 중...' : '승인 완료'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 현재 팀원 */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Users className="h-4 w-4 text-gray-400" />
            <h2 className="text-sm font-bold text-gray-700">현재 팀원 ({approved.length}명)</h2>
          </div>
          {approved.length === 0 ? (
            <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center">
              <Users className="mx-auto h-8 w-8 text-gray-200 mb-3" />
              <p className="text-sm text-gray-400">아직 팀원이 없어요</p>
              <p className="text-xs text-gray-300 mt-1">직원에게 사무소 코드를 알려주세요</p>
            </div>
          ) : (
            <div className="space-y-2">
              {approved.map(emp => (
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

      </div>
    </div>
  )
}
