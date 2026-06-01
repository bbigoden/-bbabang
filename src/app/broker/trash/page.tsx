'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/lib/auth-context'
import { Header } from '@/components/layout/header'
import { useToast } from '@/components/toast'
import { ArrowLeft, Trash2, RotateCcw, AlertTriangle, Building2, Users } from 'lucide-react'

interface TrashProperty {
  id: string; broker_id: string; address: string; deal_type: string; room_type: string
  price: number; deleted_at: string
}
interface TrashCustomer {
  id: string; broker_id: string; client_name: string; contact: string | null
  request: string | null; deleted_at: string
}

export default function TrashPage() {
  const router = useRouter()
  const auth = useAuth()
  const supabase = createClient()
  const toast = useToast()
  const [tab, setTab] = useState<'properties' | 'customers'>('properties')
  const [props, setProps] = useState<TrashProperty[]>([])
  const [custs, setCusts] = useState<TrashCustomer[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    if (auth.loading) return
    if (!auth.user || !auth.broker) { router.push('/auth/login'); return }
    load()
  }, [auth.loading, auth.user?.id, auth.broker?.id])

  const load = async () => {
    setLoading(true)
    // RLS active 정책이 deleted_at IS NULL만 노출하므로 휴지통은 SECURITY DEFINER 함수로 조회
    const [{ data: p }, { data: c }] = await Promise.all([
      supabase.rpc('get_trash_properties'),
      supabase.rpc('get_trash_customers'),
    ])
    setProps((p as any[]) ?? [])
    setCusts((c as any[]) ?? [])
    setLoading(false)
  }

  // 며칠 후 영구삭제 표시 (30일 - 경과일)
  const daysLeft = (deletedAt: string): number => {
    const elapsed = (Date.now() - new Date(deletedAt).getTime()) / (1000 * 60 * 60 * 24)
    return Math.max(0, Math.ceil(30 - elapsed))
  }

  // SELECT RLS가 deleted_at IS NULL을 강제하므로 PostgREST의 DELETE/UPDATE RETURNING이 막힘.
  // 휴지통 작업은 SECURITY DEFINER RPC로 우회.
  const restoreProperty = async (id: string) => {
    setBusy(id)
    const { error } = await supabase.rpc('restore_property', { prop_id: id })
    setBusy(null)
    if (error) { toast.error(`복원 실패: ${error.message}`); return }
    setProps(prev => prev.filter(p => p.id !== id))
  }
  const purgeProperty = async (id: string) => {
    if (!confirm('영구 삭제하시겠어요?\n복구할 수 없습니다.')) return
    setBusy(id)
    const { error } = await supabase.rpc('purge_property', { prop_id: id })
    setBusy(null)
    if (error) { toast.error(`영구삭제 실패: ${error.message}`); return }
    setProps(prev => prev.filter(p => p.id !== id))
  }
  const restoreCustomer = async (id: string) => {
    setBusy(id)
    const { error } = await supabase.rpc('restore_customer', { cust_id: id })
    setBusy(null)
    if (error) { toast.error(`복원 실패: ${error.message}`); return }
    setCusts(prev => prev.filter(c => c.id !== id))
  }
  const purgeCustomer = async (id: string) => {
    if (!confirm('영구 삭제하시겠어요?\n복구할 수 없습니다.')) return
    setBusy(id)
    const { error } = await supabase.rpc('purge_customer', { cust_id: id })
    setBusy(null)
    if (error) { toast.error(`영구삭제 실패: ${error.message}`); return }
    setCusts(prev => prev.filter(c => c.id !== id))
  }

  return (
    <div className="bg-gray-50 dark:bg-gray-950">
      <Header />
      <main className="mx-auto max-w-4xl px-4 py-6">
        <div className="mb-4 flex items-center gap-2">
          <Link href="/dashboard/broker" aria-label="사무소 대시보드" className="flex h-9 w-9 items-center justify-center rounded-xl text-gray-500 hover:bg-white dark:bg-gray-900">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Trash2 className="h-5 w-5 text-red-500" />휴지통
          </h1>
        </div>

        <div className="mb-3 flex items-start gap-2 rounded-xl bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800">
          <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
          <p>삭제된 매물·고객은 <b>30일 동안</b> 휴지통에 보관되고 자동으로 영구 삭제됩니다. 그 전엔 언제든 복원 가능합니다.</p>
        </div>

        {/* 탭 */}
        <div className="mb-4 flex rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-1">
          <button onClick={() => setTab('properties')}
            className={`flex-1 flex items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-semibold transition-colors ${tab === 'properties' ? 'bg-blue-600 text-white' : 'text-gray-600 dark:text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 dark:bg-gray-950'}`}>
            <Building2 className="h-4 w-4" />매물 {props.length > 0 && <span className="ml-1 rounded-full bg-white/20 px-1.5 py-0.5 text-xs">{props.length}</span>}
          </button>
          <button onClick={() => setTab('customers')}
            className={`flex-1 flex items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-semibold transition-colors ${tab === 'customers' ? 'bg-blue-600 text-white' : 'text-gray-600 dark:text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 dark:bg-gray-950'}`}>
            <Users className="h-4 w-4" />고객 {custs.length > 0 && <span className="ml-1 rounded-full bg-white/20 px-1.5 py-0.5 text-xs">{custs.length}</span>}
          </button>
        </div>

        {loading ? (
          <div className="py-20 text-center text-sm text-gray-500">불러오는 중...</div>
        ) : tab === 'properties' ? (
          props.length === 0 ? (
            <div className="py-20 text-center text-sm text-gray-500">휴지통이 비어있습니다.</div>
          ) : (
            <ul className="space-y-2">
              {props.map(p => (
                <li key={p.id} className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 flex items-center gap-3">
                  <Building2 className="h-5 w-5 text-gray-500 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm text-gray-900 dark:text-white truncate">{p.address || '주소 없음'}</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {p.deal_type || '-'} · {p.room_type || '-'} · {p.price ? `${p.price.toLocaleString()}만` : ''}
                    </p>
                    <p className="text-xs text-amber-700 mt-1">{daysLeft(p.deleted_at)}일 후 영구 삭제</p>
                  </div>
                  <button onClick={() => restoreProperty(p.id)} disabled={busy === p.id}
                    className="flex items-center gap-1 rounded-lg border border-blue-300 px-3 py-1.5 text-xs font-semibold text-blue-600 hover:bg-blue-50 disabled:opacity-50">
                    <RotateCcw className="h-3.5 w-3.5" />복원
                  </button>
                  <button onClick={() => purgeProperty(p.id)} disabled={busy === p.id}
                    className="flex items-center gap-1 rounded-lg border border-red-300 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50">
                    <Trash2 className="h-3.5 w-3.5" />영구삭제
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : (
          custs.length === 0 ? (
            <div className="py-20 text-center text-sm text-gray-500">휴지통이 비어있습니다.</div>
          ) : (
            <ul className="space-y-2">
              {custs.map(c => (
                <li key={c.id} className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 flex items-center gap-3">
                  <Users className="h-5 w-5 text-gray-500 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm text-gray-900 dark:text-white truncate">{c.client_name || c.contact || '이름 없음'}</p>
                    <p className="text-xs text-gray-500 mt-0.5 truncate">{c.request || '-'}</p>
                    <p className="text-xs text-amber-700 mt-1">{daysLeft(c.deleted_at)}일 후 영구 삭제</p>
                  </div>
                  <button onClick={() => restoreCustomer(c.id)} disabled={busy === c.id}
                    className="flex items-center gap-1 rounded-lg border border-blue-300 px-3 py-1.5 text-xs font-semibold text-blue-600 hover:bg-blue-50 disabled:opacity-50">
                    <RotateCcw className="h-3.5 w-3.5" />복원
                  </button>
                  <button onClick={() => purgeCustomer(c.id)} disabled={busy === c.id}
                    className="flex items-center gap-1 rounded-lg border border-red-300 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50">
                    <Trash2 className="h-3.5 w-3.5" />영구삭제
                  </button>
                </li>
              ))}
            </ul>
          )
        )}
      </main>
    </div>
  )
}
