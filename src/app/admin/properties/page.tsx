'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/lib/auth-context'
import { useToast } from '@/components/toast'
import { logAdminAction } from '@/lib/audit'
import { formatDate, formatPrice } from '@/lib/utils'
import {
  Home, ArrowLeft, Search, X, MapPin, Building2, Flag,
  EyeOff, Eye, Trash2, AlertTriangle, ExternalLink, StickyNote, Calendar, Hash
} from 'lucide-react'

interface Property {
  id: string
  broker_id: string
  deal_type: string | null
  room_type: string | null
  address: string
  price: number | null
  monthly_rent: number | null
  size_pyeong: string | null
  floor: number | null
  total_floors: string | null
  status: 'available' | 'contracted' | 'hidden'
  images: string[] | null
  description: string | null
  memo: string | null
  created_at: string
  broker_profiles: {
    id: string
    user_id: string | null
    office_name: string | null
    is_verified: boolean | null
    profiles: { name: string | null } | null
  } | null
  reportCount?: number
}

type StatusFilter = 'all' | 'available' | 'contracted' | 'hidden'

const STATUS_META: Record<Property['status'], { label: string; color: string }> = {
  available: { label: '매물있음', color: 'bg-green-500/20 text-green-400 border-green-500/30' },
  contracted: { label: '계약완료', color: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
  hidden: { label: '숨김', color: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' },
}

const PAGE_SIZE = 50

export default function AdminPropertiesPage() {
  const router = useRouter()
  const supabaseRef = useRef(createClient())
  const supabase = supabaseRef.current
  const auth = useAuth()
  const toast = useToast()

  const [items, setItems] = useState<Property[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [page, setPage] = useState(0)
  const [status, setStatus] = useState<StatusFilter>('all')
  const [search, setSearch] = useState('')
  const [showReportedOnly, setShowReportedOnly] = useState(false)
  const [reportedIds, setReportedIds] = useState<Set<string>>(new Set())
  const [reportCounts, setReportCounts] = useState<Map<string, number>>(new Map())
  const [selected, setSelected] = useState<Property | null>(null)

  useEffect(() => {
    if (auth.loading) return
    if (!auth.user) { router.push('/auth/login'); return }
    if (auth.profile?.role !== 'admin') { router.push('/'); return }
  }, [auth.loading, auth.user, auth.profile?.role, router])

  // 신고된 매물 id Set 미리 로드 (전체)
  const loadReportedIds = useCallback(async () => {
    const { data } = await supabase
      .from('reports')
      .select('target_id, status')
      .eq('target_type', 'property')
    const counts = new Map<string, number>()
    const openIds = new Set<string>()
    ;(data ?? []).forEach(r => {
      if (!r.target_id) return
      counts.set(r.target_id, (counts.get(r.target_id) ?? 0) + 1)
      if (r.status === 'open' || r.status === 'in_progress') openIds.add(r.target_id)
    })
    setReportedIds(openIds)
    setReportCounts(counts)
  }, [supabase])

  const load = useCallback(async (reset = false) => {
    const targetPage = reset ? 0 : page
    if (reset) setLoading(true)
    else setLoadingMore(true)

    let q = supabase
      .from('broker_properties')
      .select('*, broker_profiles(id, user_id, office_name, is_verified, profiles(name))')
      .order('created_at', { ascending: false })

    if (status !== 'all') q = q.eq('status', status)
    if (search.trim()) q = q.ilike('address', `%${search.trim()}%`)
    if (showReportedOnly) {
      const ids = Array.from(reportedIds)
      if (ids.length === 0) {
        setItems([])
        setHasMore(false)
        if (reset) setLoading(false); else setLoadingMore(false)
        return
      }
      q = q.in('id', ids)
    }

    q = q.range(targetPage * PAGE_SIZE, targetPage * PAGE_SIZE + PAGE_SIZE - 1)

    const { data } = await q
    const rows = ((data ?? []) as any as Property[]).map(p => ({
      ...p,
      reportCount: reportCounts.get(p.id) ?? 0,
    }))
    setItems(prev => reset ? rows : [...prev, ...rows])
    setHasMore(rows.length === PAGE_SIZE)
    setPage(targetPage + 1)
    if (reset) setLoading(false); else setLoadingMore(false)
  }, [supabase, page, status, search, showReportedOnly, reportedIds, reportCounts])

  useEffect(() => {
    if (auth.profile?.role === 'admin') loadReportedIds()
  }, [auth.profile?.role, loadReportedIds])

  useEffect(() => {
    if (auth.profile?.role === 'admin') {
      setPage(0); setHasMore(true)
      load(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.profile?.role, status, showReportedOnly, reportedIds.size])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setPage(0); setHasMore(true)
    load(true)
  }

  const updateStatus = async (id: string, newStatus: Property['status']) => {
    const target = items.find(p => p.id === id)
    const prev = target?.status
    if (prev === newStatus) return
    const { error } = await supabase.from('broker_properties').update({ status: newStatus }).eq('id', id)
    if (error) {
      toast.error('상태 변경 실패: ' + error.message)
      return
    }
    setItems(prev => prev.map(p => p.id === id ? { ...p, status: newStatus } : p))
    if (selected?.id === id) setSelected({ ...selected, status: newStatus })
    toast.success('상태 변경됨')
    if (auth.user) {
      void logAdminAction(supabase, auth.user.id, {
        action: 'property.status_change',
        targetType: 'property',
        targetId: id,
        metadata: { prev, next: newStatus },
      })
    }
    // 중개사에게 알림 (왜 바뀌었는지 알 수 있도록)
    const brokerUserId = target?.broker_profiles?.user_id
    if (brokerUserId) {
      const nextLabel = STATUS_META[newStatus].label
      const addr = target?.address ?? '매물'
      void supabase.from('notifications').insert({
        user_id: brokerUserId,
        type: 'admin_property_status_changed',
        title: `관리자가 매물 상태를 변경했어요`,
        body: `${addr} → ${nextLabel}${newStatus === 'hidden' ? ' (공개 페이지에서 숨겨짐)' : ''}`,
        link: '/broker/properties',
      })
    }
  }

  const deleteProperty = async (id: string) => {
    const target = items.find(p => p.id === id)
    const label = target?.address ? `"${target.address}"` : '이 매물'
    if (!window.confirm(`${label}을(를) 영구 삭제할까요?\n복구할 수 없습니다.`)) return false
    const { error } = await supabase.from('broker_properties').delete().eq('id', id)
    if (error) {
      toast.error('삭제 실패: ' + error.message)
      return false
    }
    setItems(prev => prev.filter(p => p.id !== id))
    toast.success('매물 삭제됨')
    if (auth.user) {
      void logAdminAction(supabase, auth.user.id, {
        action: 'property.delete',
        targetType: 'property',
        targetId: id,
        metadata: { address: target?.address },
      })
    }
    return true
  }

  if (auth.loading || auth.profile?.role !== 'admin') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-950">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
      </div>
    )
  }

  const reportedCount = reportedIds.size

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <header className="border-b border-gray-800 bg-gray-900 px-6 py-4">
        <div className="mx-auto flex max-w-7xl items-center gap-3">
          <Link href="/admin" className="flex h-9 w-9 items-center justify-center rounded-xl bg-gray-800 hover:bg-gray-700 transition-colors">
            <ArrowLeft className="h-4 w-4 text-gray-300" />
          </Link>
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/20">
            <Home className="h-5 w-5 text-emerald-400" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-white">매물 검수</h1>
            <p className="text-xs text-gray-400">전체 매물 모니터링·강제 숨김·삭제</p>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-6 py-8 space-y-5">
        {/* 검색·필터 */}
        <div className="flex flex-wrap gap-3">
          <form onSubmit={handleSearch} className="flex-1 min-w-[280px] flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="주소로 검색"
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
              { key: 'available', label: '매물있음' },
              { key: 'contracted', label: '계약완료' },
              { key: 'hidden', label: '숨김' },
            ] as const).map(t => (
              <button key={t.key} onClick={() => setStatus(t.key)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                  status === t.key ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'
                }`}>
                {t.label}
              </button>
            ))}
          </div>

          <button onClick={() => setShowReportedOnly(v => !v)}
            className={`flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition-all ${
              showReportedOnly
                ? 'border-red-500/40 bg-red-500/10 text-red-400'
                : 'border-gray-700 bg-gray-900 text-gray-400 hover:bg-gray-800'
            }`}>
            <Flag className="h-3.5 w-3.5" />
            신고된 매물만 {reportedCount > 0 && <span className="ml-1 rounded-md bg-red-500/30 px-1.5 text-[10px]">{reportedCount}</span>}
          </button>

          {(search || status !== 'all' || showReportedOnly) && (
            <button
              type="button"
              onClick={() => { setSearch(''); setStatus('all'); setShowReportedOnly(false) }}
              className="flex items-center gap-1.5 rounded-xl border border-gray-700 bg-gray-900 px-3 py-2 text-xs font-semibold text-gray-400 hover:bg-gray-800"
            >
              필터 초기화
            </button>
          )}
        </div>

        {/* 목록 */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-2xl border border-gray-800 bg-gray-900 py-20 text-center">
            <Home className="mx-auto mb-3 h-12 w-12 text-gray-700 dark:text-gray-300" />
            <p className="font-semibold text-gray-400">조건에 맞는 매물이 없어요</p>
            {(search || status !== 'all' || showReportedOnly) && (
              <button
                onClick={() => { setSearch(''); setStatus('all'); setShowReportedOnly(false) }}
                className="mt-4 rounded-xl border border-gray-700 bg-gray-800 px-4 py-2 text-xs font-semibold text-gray-300 hover:bg-gray-700"
              >
                필터 초기화
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="overflow-hidden rounded-2xl border border-gray-800 bg-gray-900">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-800 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">
                    <th className="px-5 py-3">매물</th>
                    <th className="px-5 py-3 hidden md:table-cell">중개사</th>
                    <th className="px-5 py-3 hidden lg:table-cell">상태</th>
                    <th className="px-5 py-3 hidden lg:table-cell">신고</th>
                    <th className="px-5 py-3 hidden sm:table-cell">등록일</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map(p => {
                    const meta = STATUS_META[p.status]
                    return (
                      <tr key={p.id} onClick={() => setSelected(p)}
                        className="border-b border-gray-800/50 hover:bg-gray-800/50 cursor-pointer transition-colors">
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-3">
                            {p.images?.[0] && (
                              <div className="relative h-12 w-12 flex-shrink-0 overflow-hidden rounded-lg">
                                <Image src={p.images[0]} alt="" fill className="object-cover" sizes="48px" />
                              </div>
                            )}
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                {p.deal_type && <span className="rounded-md bg-gray-800 px-1.5 py-0.5 text-[10px] font-bold text-gray-300">{p.deal_type}</span>}
                                {p.room_type && <span className="rounded-md bg-gray-800 px-1.5 py-0.5 text-[10px] font-medium text-gray-400">{p.room_type}</span>}
                              </div>
                              <p className="mt-1 text-sm font-semibold text-white truncate">{p.address || '주소 없음'}</p>
                              <p className="text-xs text-blue-400">
                                {!p.price ? '가격 협의'
                                  : p.deal_type === '월세' ? `${formatPrice(p.price)} / 월 ${formatPrice(p.monthly_rent ?? 0)}`
                                  : formatPrice(p.price)}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="px-5 py-3.5 hidden md:table-cell">
                          <p className="text-sm text-white truncate max-w-[160px]">{p.broker_profiles?.profiles?.name ?? '—'}</p>
                          <p className="text-xs text-gray-500 truncate max-w-[160px]">{p.broker_profiles?.office_name ?? ''}</p>
                        </td>
                        <td className="px-5 py-3.5 hidden lg:table-cell">
                          <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-bold ${meta.color}`}>
                            {meta.label}
                          </span>
                        </td>
                        <td className="px-5 py-3.5 hidden lg:table-cell">
                          {(p.reportCount ?? 0) > 0 ? (
                            <span className="inline-flex items-center gap-1 rounded-md bg-red-500/20 px-1.5 py-0.5 text-xs font-bold text-red-400">
                              <Flag className="h-3 w-3" /> {p.reportCount}
                            </span>
                          ) : (
                            <span className="text-xs text-gray-600 dark:text-gray-400">—</span>
                          )}
                        </td>
                        <td className="px-5 py-3.5 hidden sm:table-cell">
                          <span className="text-xs text-gray-400">{formatDate(p.created_at)}</span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

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
        <PropertyDetailModal
          property={selected}
          reportCount={reportCounts.get(selected.id) ?? 0}
          onClose={() => setSelected(null)}
          onStatusChange={(s) => updateStatus(selected.id, s)}
          onDelete={async () => {
            const ok = await deleteProperty(selected.id)
            if (ok) setSelected(null)
          }}
        />
      )}
    </div>
  )
}

function PropertyDetailModal({ property, reportCount, onClose, onStatusChange, onDelete }: {
  property: Property
  reportCount: number
  onClose: () => void
  onStatusChange: (status: Property['status']) => Promise<void>
  onDelete: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const meta = STATUS_META[property.status]

  const handleStatus = async (s: Property['status']) => {
    setBusy(true)
    await onStatusChange(s)
    setBusy(false)
  }

  const handleDelete = async () => {
    setBusy(true)
    await onDelete()
    setBusy(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={() => !busy && onClose()}>
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl border border-gray-700 bg-gray-900 shadow-2xl"
        onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-800 bg-gray-900 px-6 py-4">
          <div className="flex items-center gap-2">
            <h3 className="font-bold text-white">매물 상세</h3>
            <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-bold ${meta.color}`}>
              {meta.label}
            </span>
            {reportCount > 0 && (
              <span className="inline-flex items-center gap-1 rounded-md bg-red-500/20 px-1.5 py-0.5 text-[10px] font-bold text-red-400">
                <Flag className="h-3 w-3" /> 신고 {reportCount}건
              </span>
            )}
          </div>
          <button onClick={onClose} disabled={busy}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-800 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {property.images && property.images.length > 0 && (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {property.images.map((url, i) => (
                <div key={i} className="relative h-36 w-44 flex-shrink-0 overflow-hidden rounded-xl">
                  <Image src={url} alt="" fill className="object-cover" sizes="176px" />
                </div>
              ))}
            </div>
          )}

          <div className="rounded-xl bg-gray-800/50 p-4">
            <div className="flex items-center gap-2 mb-1">
              <Building2 className="h-4 w-4 text-blue-400" />
              <p className="font-semibold text-white">{property.broker_profiles?.profiles?.name}</p>
              <span className="text-xs text-gray-500">{property.broker_profiles?.office_name}</span>
            </div>
            <Link href={`/broker/${property.broker_id}`} target="_blank"
              className="inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300">
              <ExternalLink className="h-3 w-3" /> 중개사 프로필 열기
            </Link>
          </div>

          <div className="rounded-xl border border-gray-800 bg-gray-800/40 px-4 py-1 divide-y divide-gray-800/50">
            <Row icon={MapPin} label="주소" value={property.address} />
            <Row icon={Home} label="거래/매물" value={`${property.deal_type ?? '—'} · ${property.room_type ?? '—'}`} />
            <Row icon={Hash} label="가격" value={
              !property.price ? '가격 협의'
                : property.deal_type === '월세' ? `보증금 ${formatPrice(property.price)} / 월 ${formatPrice(property.monthly_rent ?? 0)}`
                : formatPrice(property.price)
            } />
            {property.size_pyeong && <Row icon={Hash} label="면적" value={`${property.size_pyeong}평`} />}
            {property.floor != null && <Row icon={Building2} label="층" value={`${property.floor}층${property.total_floors ? ` / 총 ${property.total_floors}층` : ''}`} />}
            <Row icon={Calendar} label="등록일" value={formatDate(property.created_at)} />
          </div>

          {property.description && (
            <div className="rounded-xl border border-gray-800 bg-gray-800/40 p-4">
              <p className="mb-1.5 text-xs font-semibold text-gray-400">매물 설명</p>
              <p className="text-sm text-gray-200 whitespace-pre-line">{property.description}</p>
            </div>
          )}

          {property.memo && (
            <div className="rounded-xl border border-orange-500/30 bg-orange-500/10 p-4">
              <p className="mb-1.5 flex items-center gap-1 text-xs font-semibold text-orange-400">
                <StickyNote className="h-3.5 w-3.5" /> 중개사 메모
              </p>
              <p className="text-sm text-orange-200 whitespace-pre-line">{property.memo}</p>
            </div>
          )}

          {/* 운영 액션 */}
          <div className="rounded-xl border border-gray-800 bg-gray-800/50 p-4">
            <p className="mb-3 text-xs font-semibold text-gray-400">상태 변경</p>
            <div className="grid grid-cols-3 gap-2">
              {(['available', 'contracted', 'hidden'] as const).map(s => {
                const m = STATUS_META[s]
                const active = property.status === s
                return (
                  <button key={s} onClick={() => handleStatus(s)} disabled={busy || active}
                    className={`flex items-center justify-center gap-1 rounded-lg border px-2 py-2 text-xs font-semibold transition-all ${
                      active ? `${m.color} border-current` : 'border-gray-700 bg-transparent text-gray-400 hover:bg-gray-700'
                    } disabled:opacity-50`}>
                    {s === 'hidden' ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                    {m.label}
                  </button>
                )
              })}
            </div>
            <p className="mt-3 text-[11px] text-gray-500">
              ⚠️ &apos;숨김&apos;으로 변경하면 공개 페이지에서 보이지 않아요. 중개사 본인 매물장에는 계속 표시됩니다.
            </p>
          </div>

          {!confirmDelete ? (
            <button onClick={() => setConfirmDelete(true)} disabled={busy}
              className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl border border-red-500/40 bg-red-500/5 py-2.5 text-sm font-semibold text-red-400 hover:bg-red-500/10 disabled:opacity-50">
              <Trash2 className="h-4 w-4" />
              매물 영구 삭제
            </button>
          ) : (
            <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-4">
              <div className="flex items-start gap-2 mb-3">
                <AlertTriangle className="h-5 w-5 text-red-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-red-400">정말 삭제할까요?</p>
                  <p className="mt-1 text-xs text-red-300">복구할 수 없습니다. 보통은 &apos;숨김&apos; 처리가 안전해요.</p>
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setConfirmDelete(false)} disabled={busy}
                  className="flex-1 rounded-lg border border-gray-700 py-2 text-xs font-medium text-gray-300 hover:bg-gray-800 disabled:opacity-50">
                  취소
                </button>
                <button onClick={handleDelete} disabled={busy}
                  className="flex-1 rounded-lg bg-red-500 py-2 text-xs font-semibold text-white hover:bg-red-600 disabled:opacity-50">
                  {busy ? '삭제 중...' : '영구 삭제'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Row({ icon: Icon, label, value }: { icon: any; label: string; value: React.ReactNode }) {
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
