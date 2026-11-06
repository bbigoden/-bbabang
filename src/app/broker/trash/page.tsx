'use client'

import { canManageOffice, isDirector } from '@/lib/office-role'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/lib/auth-context'
import { fetchAllPaged } from '@/lib/fetch-all-paged'
import {
  purgeResourceKeys, restoreResourceKeys, trashTop, RESOURCE_TRASH_DAYS, type TrashFile, type TrashResource,
} from '@/lib/resource-trash'
import { Header } from '@/components/layout/header'
import { PageHeader } from '@/components/layout/page-header'
import { useToast } from '@/components/toast'
import { Trash2, RotateCcw, Building2, Users, FolderOpen, Folder, StickyNote, File as FileIcon } from 'lucide-react'
import { EmptyState } from '@/components/empty-state'

interface TrashProperty {
  id: string; broker_id: string; address: string; deal_type: string; room_type: string
  price: number; monthly_rent: number | null; deleted_at: string
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
  // 자료실 휴지통도 여기 하나로(2026-11-06) — 자료실의 [휴지통]·예전 주소 ?view=trash 는 ?tab=resources 로 온다
  const [tab, setTab] = useState<'properties' | 'customers' | 'resources'>('properties')
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('tab') === 'resources') setTab('resources')
  }, [])
  const [resList, setResList] = useState<TrashResource[]>([])
  const [resFiles, setResFiles] = useState<TrashFile[]>([])
  const [props, setProps] = useState<TrashProperty[]>([])
  const [custs, setCusts] = useState<TrashCustomer[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    if (auth.loading) return
    if (!auth.user || !auth.broker) { router.push('/auth/login'); return }
    // 휴지통은 대표 권한(대표·이사)만 — 메뉴에도 안 보인다(11-06)
    if (!canManageOffice(auth.broker)) { router.replace('/dashboard/broker'); return }
    load()
  }, [auth.loading, auth.user?.id, auth.broker?.id])

  const load = async () => {
    setLoading(true)
    // RLS active 정책이 deleted_at IS NULL만 노출하므로 휴지통은 SECURITY DEFINER 함수로 조회
    // 자료실은 지운 폴더 안의 것까지 함께 지우려고 사무소 자료 전체(폴더·파일 수십 개, 칸 몇 개)를 받는다
    const b = auth.broker!
    const office = b.is_owner !== false ? b.id : (b.parent_broker_id ?? b.id)
    const [{ data: p }, { data: c }, rl, fl] = await Promise.all([
      supabase.rpc('get_trash_properties'),
      supabase.rpc('get_trash_customers'),
      fetchAllPaged<TrashResource>((from, to) => supabase.from('office_resources')
        .select('id, uploader_broker_id, kind, parent_id, title, deleted_at').eq('office_broker_id', office)
        .order('id').range(from, to)).catch(() => [] as TrashResource[]),
      fetchAllPaged<TrashFile>((from, to) => supabase.from('office_resource_files')
        .select('id, resource_id, uploader_broker_id, storage_path, file_name, deleted_at').eq('office_broker_id', office)
        .order('id').range(from, to)).catch(() => [] as TrashFile[]),
    ])
    setProps((p as any[]) ?? [])
    setCusts((c as any[]) ?? [])
    setResList(rl)
    setResFiles(fl)
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

  // 영구삭제는 대표·이사·솔로 중개사만. 직원은 소프트 삭제(휴지통)까지만 가능.
  const canPurge = canManageOffice(auth.broker)

  // ── 자료실 ── 대표·이사는 사무소 것 전부, 직원은 본인이 올린 것만(DB 규칙과 같다).
  // 30일 지난 것은 자료실을 열 때 비워진다.
  const me = auth.broker?.id ?? null
  const officeId = auth.broker ? (auth.broker.is_owner !== false ? auth.broker.id : (auth.broker.parent_broker_id ?? auth.broker.id)) : null
  const canManageRes = (u: string | null) => (!!me && (officeId === me || isDirector(auth.broker))) || (!!u && u === me)
  const resTop = trashTop(resList, resFiles, canManageRes)
  const resItems = [
    ...resTop.res.map(r => ({
      key: `r:${r.id}`, isFolder: r.kind === 'folder', Icon: r.kind === 'folder' ? Folder : StickyNote,
      name: r.title || '(이름 없음)', kind: r.kind === 'folder' ? '폴더' : '메모', deleted_at: r.deleted_at,
    })),
    ...resTop.files.map(f => ({ key: `f:${f.id}`, isFolder: false, Icon: FileIcon, name: f.file_name, kind: '파일', deleted_at: f.deleted_at })),
  ]
  const resDaysLeft = (d: string | null) => Math.max(0, Math.ceil(RESOURCE_TRASH_DAYS - (Date.now() - new Date(d ?? 0).getTime()) / 86400000))
  const restoreRes = async (key: string) => {
    setBusy(key)
    const { error } = await restoreResourceKeys(supabase, [key], resList, resFiles)
    setBusy(null)
    if (error) { toast.error(`복원 실패: ${error.message}`); return }
    toast.success('자료실로 되살렸습니다.')
    void load()
  }
  const purgeRes = async (key: string, isFolder: boolean) => {
    if (!confirm(isFolder ? '폴더와 그 안의 것을 영구 삭제하시겠어요?\n복구할 수 없습니다.' : '영구 삭제하시겠어요?\n복구할 수 없습니다.')) return
    setBusy(key)
    const { error } = await purgeResourceKeys(supabase, [key], resList, resFiles, canManageRes)
    setBusy(null)
    if (error) { toast.error(`영구삭제 실패: ${error.message}`); return }
    void load()
  }

  return (
    <div className="bg-gray-50 dark:bg-gray-950">
      <Header />
      <section className="mx-auto max-w-5xl px-4 py-6">
        <PageHeader title="휴지통" />

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
          <button onClick={() => setTab('resources')}
            className={`flex-1 flex items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-semibold transition-colors ${tab === 'resources' ? 'bg-blue-600 text-white' : 'text-gray-600 dark:text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 dark:bg-gray-950'}`}>
            <FolderOpen className="h-4 w-4" />자료실 {resItems.length > 0 && <span className="ml-1 rounded-full bg-white/20 px-1.5 py-0.5 text-xs">{resItems.length}</span>}
          </button>
        </div>

        {loading ? (
          <div className="py-20 text-center text-sm text-gray-500">불러오는 중...</div>
        ) : tab === 'resources' ? (
          resItems.length === 0 ? (
            <EmptyState variant="full" icon={Trash2} message="휴지통이 비어있습니다." />
          ) : (
            <ul className="space-y-2">
              {resItems.map(x => (
                <li key={x.key} className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 flex flex-col gap-3 sm:flex-row sm:items-center">
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                  <x.Icon className="h-5 w-5 text-gray-500 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm text-gray-900 dark:text-white break-words">{x.name}</p>
                    <p className="text-xs text-gray-500 mt-0.5">자료실 {x.kind}{x.isFolder ? ' · 안에 든 것도 함께' : ''}</p>
                    <p className="text-xs text-amber-700 mt-1">{resDaysLeft(x.deleted_at)}일 후 영구 삭제</p>
                  </div>
                  </div>
                  <div className="flex shrink-0 items-center justify-end gap-6 sm:gap-2">
                  <button onClick={() => restoreRes(x.key)} disabled={busy === x.key}
                    className="flex items-center gap-1 rounded-lg border border-blue-300 px-3 py-2.5 sm:py-1.5 text-xs font-semibold text-blue-600 hover:bg-blue-50 disabled:opacity-50">
                    <RotateCcw className="h-3.5 w-3.5" />복원
                  </button>
                  <button onClick={() => purgeRes(x.key, x.isFolder)} disabled={busy === x.key}
                    className="flex items-center gap-1 rounded-lg border border-red-300 px-3 py-2.5 sm:py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50">
                    <Trash2 className="h-3.5 w-3.5" />영구삭제
                  </button>
                  </div>
                </li>
              ))}
            </ul>
          )
        ) : tab === 'properties' ? (
          props.length === 0 ? (
            <EmptyState variant="full" icon={Trash2} message="휴지통이 비어있습니다." />
          ) : (
            <ul className="space-y-2">
              {props.map(p => (
                <li key={p.id} className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 flex flex-col gap-3 sm:flex-row sm:items-center">
                  {/* 폰에선 이름이 6자에서 잘리고 [영구삭제]가 [복원] 바로 옆이었다(10-30 재점검) — 글은 한 줄 전체, 버튼은 아래 줄에 띄워 둔다 */}
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                  <Building2 className="h-5 w-5 text-gray-500 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm text-gray-900 dark:text-white break-words">{p.address || '주소 없음'}</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {p.deal_type || '-'} · {p.room_type || '-'} · {p.price ? `${p.price.toLocaleString()}만` : ''}{p.monthly_rent ? ` / ${p.monthly_rent.toLocaleString()}만` : ''}
                    </p>
                    <p className="text-xs text-amber-700 mt-1">{daysLeft(p.deleted_at)}일 후 영구 삭제</p>
                  </div>
                  </div>
                  <div className="flex shrink-0 items-center justify-end gap-6 sm:gap-2">
                  <button onClick={() => restoreProperty(p.id)} disabled={busy === p.id}
                    className="flex items-center gap-1 rounded-lg border border-blue-300 px-3 py-2.5 sm:py-1.5 text-xs font-semibold text-blue-600 hover:bg-blue-50 disabled:opacity-50">
                    <RotateCcw className="h-3.5 w-3.5" />복원
                  </button>
                  {canPurge && (
                    <button onClick={() => purgeProperty(p.id)} disabled={busy === p.id}
                      className="flex items-center gap-1 rounded-lg border border-red-300 px-3 py-2.5 sm:py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50">
                      <Trash2 className="h-3.5 w-3.5" />영구삭제
                    </button>
                  )}
                  </div>
                </li>
              ))}
            </ul>
          )
        ) : (
          custs.length === 0 ? (
            <EmptyState variant="full" icon={Trash2} message="휴지통이 비어있습니다." />
          ) : (
            <ul className="space-y-2">
              {custs.map(c => (
                <li key={c.id} className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 flex flex-col gap-3 sm:flex-row sm:items-center">
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                  <Users className="h-5 w-5 text-gray-500 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm text-gray-900 dark:text-white break-words">{c.client_name || c.contact || '이름 없음'}</p>
                    <p className="text-xs text-gray-500 mt-0.5 truncate">{c.request || '-'}</p>
                    <p className="text-xs text-amber-700 mt-1">{daysLeft(c.deleted_at)}일 후 영구 삭제</p>
                  </div>
                  </div>
                  <div className="flex shrink-0 items-center justify-end gap-6 sm:gap-2">
                  <button onClick={() => restoreCustomer(c.id)} disabled={busy === c.id}
                    className="flex items-center gap-1 rounded-lg border border-blue-300 px-3 py-2.5 sm:py-1.5 text-xs font-semibold text-blue-600 hover:bg-blue-50 disabled:opacity-50">
                    <RotateCcw className="h-3.5 w-3.5" />복원
                  </button>
                  {canPurge && (
                    <button onClick={() => purgeCustomer(c.id)} disabled={busy === c.id}
                      className="flex items-center gap-1 rounded-lg border border-red-300 px-3 py-2.5 sm:py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50">
                      <Trash2 className="h-3.5 w-3.5" />영구삭제
                    </button>
                  )}
                  </div>
                </li>
              ))}
            </ul>
          )
        )}
      </section>
    </div>
  )
}
