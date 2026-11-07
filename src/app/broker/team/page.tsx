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
import { useToast } from '@/components/toast'

interface Employee {
  id: string
  user_id: string
  is_approved: boolean
  permissions: Record<string, unknown> | null
  profiles: { name: string; email: string } | null
}

/**
 * 사무소 안 등급 — 대표가 정한다(2026-11-05 사장님). permissions.grade 에 담는다.
 * 대표는 is_owner 로 따로 정해지므로 여기서 고르는 건 이사·직원 둘. 값이 없으면 직원.
 * 이사 = 대표와 같은 권한(lib/office-role.ts, supabase/migrations/director_same_as_owner.sql).
 */
type Grade = 'director' | 'staff'
const GRADES: { key: Grade; label: string }[] = [
  { key: 'director', label: '이사' },
  { key: 'staff', label: '직원' },
]
const gradeOf = (e: Employee): Grade => (e.permissions?.grade === 'director' ? 'director' : 'staff')

export default function BrokerTeamPage() {
  const supabase = createClient()
  const router = useRouter()
  const auth = useAuth()
  const toast = useToast()

  const [user, setUser] = useState<any>(null)
  const [broker, setBroker] = useState<any>(null)
  const [approved, setApproved] = useState<Employee[]>([])
  const [pending, setPending] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [isOwner, setIsOwner] = useState(false)
  const [approvingId, setApprovingId] = useState<string | null>(null)

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
        .select('id, user_id, is_approved, permissions, profiles:profiles_visible(name, email)')
        .eq('parent_broker_id', b.id)
        .order('created_at', { ascending: true })  // 가입일시 순(11-07 사장님)

      const list = (emps ?? []) as unknown as Employee[]
      setApproved(list.filter(e => e.is_approved))
      setPending(list.filter(e => !e.is_approved))
    }

    setLoading(false)
  }

  const approveEmployee = async (empId: string) => {
    setApprovingId(empId)
    const { error } = await supabase.from('broker_profiles')
      .update({ is_approved: true })
      .eq('id', empId)
    if (error) {
      toast.error('승인 중 오류가 발생했습니다: ' + error.message)
      setApprovingId(null)
      return
    }
    const emp = pending.find(e => e.id === empId)
    if (emp) {
      setApproved(prev => [...prev, { ...emp, is_approved: true }])
      setPending(prev => prev.filter(e => e.id !== empId))
    }
    setApprovingId(null)
  }

  const [gradingId, setGradingId] = useState<string | null>(null)
  const setGrade = async (emp: Employee, grade: Grade) => {
    if (gradeOf(emp) === grade) return
    setGradingId(emp.id)
    // 다른 권한 값(can_see_others 등)은 그대로 두고 grade 만 바꾼다
    const permissions = { ...(emp.permissions ?? {}), grade }
    const { error } = await supabase.from('broker_profiles').update({ permissions }).eq('id', emp.id)
    setGradingId(null)
    if (error) { toast.error('등급 저장 실패: ' + error.message); return }
    setApproved(prev => prev.map(e => (e.id === emp.id ? { ...e, permissions } : e)))
    toast.success(`${emp.profiles?.name ?? '직원'} — ${GRADES.find(g => g.key === grade)!.label}(으)로 바꿨어요`)
  }

  const rejectEmployee = async (empId: string) => {
    if (!confirm('이 신청을 거절할까요? 직원의 계정 자체는 유지됩니다.')) return
    const { error } = await supabase.rpc('reject_employee_application', { emp_broker_id: empId })
    if (error) {
      console.error('[team] reject failed', error)
      toast.error(`거절 실패: ${error.message}`)
      return
    }
    setPending(prev => prev.filter(e => e.id !== empId))
  }

  const removeEmployee = async (empId: string) => {
    if (!confirm('이 직원을 사무소에서 제거할까요?\n직원이 입력한 고객·매물·업무일지·채팅·제안·리뷰 등 모든 영업 기록은 사무소(대표)에 귀속됩니다.')) return
    if (!broker) return

    const { error: transferErr } = await transferBrokerData(supabase, empId, broker.id)
    if (transferErr) {
      console.error('[team] data transfer failed', transferErr)
      toast.error(`데이터 이전 실패로 제거를 중단했어요: ${transferErr.message}`)
      return
    }

    const { error } = await supabase.rpc('remove_employee_from_office', { emp_broker_id: empId })
    if (error) {
      console.error('[team] detach failed', error)
      toast.error(`직원 분리 실패: ${error.message}`)
      return
    }
    setApproved(prev => prev.filter(e => e.id !== empId))
  }

  if (loading) return (
    <div className="bg-gray-50 dark:bg-gray-950 flex items-center justify-center">
      <div className="text-gray-500 text-sm">불러오는 중...</div>
    </div>
  )

  if (!isOwner) return (
    <div className="bg-gray-50 dark:bg-gray-950">
      <Header user={user} role="broker" />
      <div className="mx-auto max-w-2xl px-4 py-12 text-center">
        <Shield className="mx-auto h-12 w-12 text-gray-200 mb-4" />
        <h2 className="text-lg font-bold text-gray-700 dark:text-gray-300 mb-2">직원 관리는 대표 계정에서만 가능해요</h2>
        <p className="text-sm text-gray-500">대표 중개사 계정으로 로그인 후 이용해주세요.</p>
      </div>
    </div>
  )

  return (
    <div className="bg-gray-50 dark:bg-gray-950">
      <Header user={user} role="broker" />
      <div className="mx-auto max-w-2xl px-4 py-6">
        <h1 className="mb-4 text-2xl font-bold text-gray-900 dark:text-white">직원</h1>

        {broker && (
          <div className="mb-6">
            <OfficeCodeCard />
          </div>
        )}

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
                      <div className="text-xs text-gray-500">{emp.profiles?.email}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={() => approveEmployee(emp.id)} disabled={approvingId === emp.id}
                        className="rounded-xl px-3 py-1.5 text-xs font-bold bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 transition-colors">
                        {approvingId === emp.id ? '승인 중...' : '승인'}
                      </button>
                      <button onClick={() => rejectEmployee(emp.id)}
                        className="rounded-xl px-3 py-1.5 text-xs font-bold bg-red-50 text-red-600 hover:bg-red-100 transition-colors">
                        거절
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div>
          <div className="flex items-center gap-2 mb-3">
            <Users className="h-4 w-4 text-gray-500" />
            <h2 className="text-sm font-bold text-gray-700 dark:text-gray-300">직원 ({approved.length}명)</h2>
          </div>
          {approved.length > 0 && (
            <p className="text-xs text-gray-500 mb-3">이사는 대표와 같은 권한으로 사무소 전체를 보고 고쳐요. 직원 승인·등급·사무소 정보만 대표가 해요.</p>
          )}
          {approved.length === 0 ? (
            <div className="rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 p-8 text-center">
              <Users className="mx-auto h-8 w-8 text-gray-200 mb-3" />
              <p className="text-sm text-gray-500">아직 직원이 없어요</p>
              <p className="text-xs text-gray-500 mt-1">직원에게 사무소 코드를 알려주세요</p>
            </div>
          ) : (
            <div className="space-y-2">
              {approved.map(emp => (
                <div key={emp.id} className="rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden">
                  <div className="flex items-center gap-3 p-4">
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gray-100 dark:bg-gray-800 text-sm font-bold text-gray-600 dark:text-gray-500 flex-shrink-0">
                      {emp.profiles?.name?.[0] ?? '?'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-gray-800 dark:text-gray-100">{emp.profiles?.name ?? '—'}</div>
                      <div className="text-xs text-gray-500">{emp.profiles?.email}</div>
                    </div>
                    <select aria-label={`${emp.profiles?.name ?? '직원'} 등급`} value={gradeOf(emp)}
                      onChange={e => setGrade(emp, e.target.value as Grade)} disabled={gradingId === emp.id}
                      className="flex-shrink-0 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-xs font-bold text-gray-700 dark:text-gray-200 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-400/20 disabled:opacity-50">
                      {GRADES.map(g => <option key={g.key} value={g.key}>{g.label}</option>)}
                    </select>
                    <button onClick={() => removeEmployee(emp.id)} aria-label="직원 제거" title="직원 제거"
                      className={cn('flex h-7 w-7 items-center justify-center rounded-lg text-gray-300 hover:bg-red-50 hover:text-red-400 transition-colors')}>
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  )
}
