'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/lib/auth-context'
import { Header } from '@/components/layout/header'
import { useRouter } from 'next/navigation'
import { X, Shield, Users, Clock } from 'lucide-react'
import { cn } from '@/lib/utils'
import { transferBrokerData } from '@/lib/leave-office'
import { OfficeCodeCard } from '@/components/office-code-card'

interface Permission {
  view: boolean
  edit: boolean
}
interface Permissions {
  customers: Permission
  diary: Permission
  properties: Permission
}

const DEFAULT_PERMISSIONS: Permissions = {
  customers:  { view: true, edit: true },
  diary:      { view: true, edit: true },
  properties: { view: true, edit: true },
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
          <span className="text-xs font-medium text-gray-700 dark:text-gray-300">{PAGE_LABELS[page]}</span>
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
    </div>
  )
}

export default function BrokerTeamPage() {
  const supabase = createClient()
  const router = useRouter()
  const auth = useAuth()

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

  useEffect(() => {
    if (auth.loading) return
    if (!auth.user) { router.push('/auth/login'); return }
    if (!auth.broker) { router.push('/broker/register'); return }
    init()
  }, [auth.loading, auth.user?.id, auth.broker?.id])

  const init = async () => {
    const u = auth.user!
    const b = auth.broker!
    setUser(u)
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
    const { error } = await supabase.from('broker_profiles')
      .update({ is_approved: true, permissions: approvePerms })
      .eq('id', empId)
    if (error) {
      alert('승인 중 오류가 발생했습니다: ' + error.message)
      setApproving(false)
      return
    }
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
    const { error } = await supabase.rpc('reject_employee_application', { emp_broker_id: empId })
    if (error) {
      console.error('[team] reject failed', error)
      alert(`거절 실패: ${error.message}`)
      return
    }
    setPending(prev => prev.filter(e => e.id !== empId))
  }

  const saveEmployeePerms = async (empId: string) => {
    setSaving(true)
    const { error } = await supabase.from('broker_profiles').update({ permissions: editPerms }).eq('id', empId)
    if (error) {
      console.error('[team] update perms failed', error)
      alert(`권한 저장 실패: ${error.message}`)
      setSaving(false)
      return
    }
    setApproved(prev => prev.map(e => e.id === empId ? { ...e, permissions: editPerms } : e))
    setEditingId(null)
    setSaving(false)
  }

  const removeEmployee = async (empId: string) => {
    if (!confirm('이 직원을 팀에서 제거할까요?\n직원이 입력한 고객·매물·업무일지·채팅·제안·리뷰 등 모든 영업 기록은 사무소(대표)에 귀속됩니다.')) return
    if (!broker) return

    // 모든 영업 기록을 대표 broker_id로 이전 (법적 책임 보존)
    const { error: transferErr } = await transferBrokerData(supabase, empId, broker.id)
    if (transferErr) {
      console.error('[team] data transfer failed', transferErr)
      alert(`데이터 이전 실패로 제거를 중단했어요: ${transferErr.message}`)
      return
    }

    // 직원 프로필 사무소 연결 해제 (SECURITY DEFINER RPC — RLS WITH CHECK 우회)
    const { error } = await supabase.rpc('remove_employee_from_office', { emp_broker_id: empId })
    if (error) {
      console.error('[team] detach failed', error)
      alert(`직원 분리 실패: ${error.message}`)
      return
    }
    setApproved(prev => prev.filter(e => e.id !== empId))
  }

  if (loading) return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center">
      <div className="text-gray-400 text-sm">불러오는 중...</div>
    </div>
  )

  if (!isOwner) return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <Header user={user} role="broker" />
      <div className="mx-auto max-w-2xl px-4 py-12 text-center">
        <Shield className="mx-auto h-12 w-12 text-gray-200 mb-4" />
        <h2 className="text-lg font-bold text-gray-700 dark:text-gray-300 mb-2">팀원 관리는 대표 계정에서만 가능해요</h2>
        <p className="text-sm text-gray-400">대표 중개사 계정으로 로그인 후 이용해주세요.</p>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <Header user={user} role="broker" />
      <div className="mx-auto max-w-2xl px-4 py-8">

        <div className="mb-6">
          <h1 className="text-2xl font-black text-gray-900 dark:text-white">팀 관리</h1>
          <p className="text-sm text-gray-400 mt-0.5">직원 등록 신청을 승인하고 권한을 설정해요</p>
        </div>

        {/* 사무소 코드 */}
        {broker && (
          <div className="mb-6">
            <OfficeCodeCard brokerId={broker.id} initialCode={broker.office_code ?? null} />
          </div>
        )}

        {/* 승인 대기 */}
        {pending.length > 0 && (
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-3">
              <Clock className="h-4 w-4 text-yellow-500" />
              <h2 className="text-sm font-bold text-gray-700 dark:text-gray-300">승인 대기 ({pending.length}명)</h2>
            </div>
            <div className="space-y-2">
              {pending.map(emp => (
                <div key={emp.id} className="rounded-2xl border border-yellow-200 bg-yellow-50/40 overflow-hidden">
                  <div className="flex items-center gap-3 p-4">
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-yellow-100 text-sm font-bold text-yellow-700 flex-shrink-0">
                      {emp.profiles?.name?.[0] ?? '?'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-gray-800 dark:text-gray-100">{emp.profiles?.name ?? '—'}</div>
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
                    <div className="border-t border-yellow-200 bg-white dark:bg-gray-900 p-4">
                      <p className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-2">권한 설정 후 승인</p>
                      <PermissionEditor perms={approvePerms} onChange={setApprovePerms} />
                      <div className="flex gap-2 mt-3">
                        <button onClick={() => setApprovingId(null)}
                          className="flex-1 rounded-xl border border-gray-200 dark:border-gray-800 py-2 text-xs font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 dark:bg-gray-950">취소</button>
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
            <h2 className="text-sm font-bold text-gray-700 dark:text-gray-300">현재 팀원 ({approved.length}명)</h2>
          </div>
          {approved.length === 0 ? (
            <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-8 text-center">
              <Users className="mx-auto h-8 w-8 text-gray-200 mb-3" />
              <p className="text-sm text-gray-400">아직 팀원이 없어요</p>
              <p className="text-xs text-gray-300 mt-1">직원에게 사무소 코드를 알려주세요</p>
            </div>
          ) : (
            <div className="space-y-2">
              {approved.map(emp => (
                <div key={emp.id} className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden">
                  <div className="flex items-center gap-3 p-4">
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gray-100 dark:bg-gray-800 text-sm font-bold text-gray-600 dark:text-gray-400 flex-shrink-0">
                      {emp.profiles?.name?.[0] ?? '?'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-gray-800 dark:text-gray-100">{emp.profiles?.name ?? '—'}</div>
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
                    <div className="border-t border-gray-100 dark:border-gray-800 p-4">
                      <PermissionEditor perms={editPerms} onChange={setEditPerms} />
                      <div className="flex gap-2 mt-3">
                        <button onClick={() => setEditingId(null)}
                          className="flex-1 rounded-xl border border-gray-200 dark:border-gray-800 py-2 text-xs font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 dark:bg-gray-950">취소</button>
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
