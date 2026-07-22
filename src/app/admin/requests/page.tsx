import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import Link from 'next/link'
import { Header } from '@/components/layout/header'
import { PageHeader } from '@/components/layout/page-header'
import { formatDate, formatPrice } from '@/lib/utils'
import { logAdminAction } from '@/lib/audit'
import { MapPin, MessageCircle, Flag, Archive, Trash2, ExternalLink, Search as SearchIcon, X } from 'lucide-react'

export const dynamic = 'force-dynamic'

type Search = {
  status?: 'all' | 'active' | 'closed'
  q?: string
  page?: string
  reported?: '1'
}

const PAGE_SIZE = 50

export default async function AdminRequestsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin') redirect('/')

  const sp = await searchParams
  const status = sp.status ?? 'all'
  const q = (sp.q ?? '').trim()
  const reportedOnly = sp.reported === '1'
  const page = Math.max(0, parseInt(sp.page ?? '0', 10) || 0)
  const from = page * PAGE_SIZE
  const to = from + PAGE_SIZE - 1

  // 신고된 요청 id 집계 (target_type='request')
  const { data: reportRows } = await supabase
    .from('reports')
    .select('target_id, status')
    .eq('target_type', 'request')

  const reportCounts = new Map<string, number>()
  const openReportIds = new Set<string>()
  for (const r of reportRows ?? []) {
    if (!r.target_id) continue
    reportCounts.set(r.target_id, (reportCounts.get(r.target_id) ?? 0) + 1)
    if (r.status === 'open' || r.status === 'in_progress') openReportIds.add(r.target_id)
  }

  // 본 목록 조회
  let query = supabase
    .from('request_posts')
    .select('id, user_id, deal_type, room_type, city, district, dong, min_price, max_price, status, proposal_count, created_at, closed_at, description', { count: 'exact' })
    .order('created_at', { ascending: false })

  if (status !== 'all') query = query.eq('status', status)
  if (q) {
    query = query.or(`city.ilike.%${q}%,district.ilike.%${q}%,dong.ilike.%${q}%,description.ilike.%${q}%`)
  }
  if (reportedOnly) {
    const ids = Array.from(openReportIds)
    if (ids.length === 0) {
      // 신고된 요청이 없는 경우 비어있게
      query = query.eq('id', '00000000-0000-0000-0000-000000000000')
    } else {
      query = query.in('id', ids)
    }
  }

  const { data: rows, count } = await query.range(from, to)

  // 사용자 프로필 한 번에 조회
  const userIds = Array.from(new Set((rows ?? []).map(r => r.user_id).filter(Boolean) as string[]))
  const userMap = new Map<string, { name: string | null; phone: string | null }>()
  if (userIds.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles_visible')
      .select('id, name, phone')
      .in('id', userIds)
    for (const p of profiles ?? []) {
      userMap.set(p.id, { name: p.name, phone: p.phone })
    }
  }

  const total = count ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  // ─── Server Actions ────────────────────────────────
  async function forceCloseAction(formData: FormData) {
    'use server'
    const id = String(formData.get('id') ?? '')
    if (!id) return
    const supa = await createClient()
    const { data: { user } } = await supa.auth.getUser()
    if (!user) return
    const { data: pf } = await supa.from('profiles').select('role').eq('id', user.id).single()
    if (pf?.role !== 'admin') return
    const { error } = await supa
      .from('request_posts')
      .update({ status: 'closed', closed_at: new Date().toISOString() })
      .eq('id', id)
    if (!error) {
      await logAdminAction(supa, user.id, {
        action: 'request.force_close',
        targetType: 'request',
        targetId: id,
      })
      revalidatePath('/admin/requests')
    }
  }

  async function deleteAction(formData: FormData) {
    'use server'
    const id = String(formData.get('id') ?? '')
    if (!id) return
    const supa = await createClient()
    const { data: { user } } = await supa.auth.getUser()
    if (!user) return
    const { data: pf } = await supa.from('profiles').select('role').eq('id', user.id).single()
    if (pf?.role !== 'admin') return
    const { error } = await supa.from('request_posts').delete().eq('id', id)
    if (!error) {
      await logAdminAction(supa, user.id, {
        action: 'request.delete',
        targetType: 'request',
        targetId: id,
      })
      revalidatePath('/admin/requests')
    }
  }

  const buildHref = (overrides: Partial<Search>) => {
    const next = { ...sp, ...overrides }
    const qs = new URLSearchParams()
    if (next.status && next.status !== 'all') qs.set('status', next.status)
    if (next.q) qs.set('q', next.q)
    if (next.reported === '1') qs.set('reported', '1')
    if (next.page && next.page !== '0') qs.set('page', String(next.page))
    const s = qs.toString()
    return s ? `/admin/requests?${s}` : '/admin/requests'
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <Header />
      <div className="mx-auto max-w-6xl px-4 py-8">
        <PageHeader
          title="요청 관리"
          description="고객이 등록한 매물 요청을 점검·정리합니다"
        />

        {/* 필터 바 */}
        <form action="/admin/requests" method="GET" className="mb-5 rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[180px]">
            <label className="mb-1 block text-xs font-semibold text-gray-500">검색</label>
            <div className="relative">
              <SearchIcon className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
              <input
                name="q"
                defaultValue={q}
                placeholder="지역·설명 검색"
                className="w-full rounded-lg border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 pl-9 pr-3 py-1.5 text-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-400/20"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-gray-500">상태</label>
            <select name="status" defaultValue={status} className="rounded-lg border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm">
              <option value="all">전체</option>
              <option value="active">모집 중</option>
              <option value="closed">마감</option>
            </select>
          </div>

          <label className="flex items-center gap-1.5 text-sm">
            <input
              type="checkbox"
              name="reported"
              value="1"
              defaultChecked={reportedOnly}
              className="rounded"
            />
            <Flag className="h-3.5 w-3.5 text-red-500" />
            <span>신고된 것만</span>
          </label>

          <button type="submit" className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-blue-700">
            적용
          </button>
          {(q || status !== 'all' || reportedOnly) && (
            <Link href="/admin/requests" className="rounded-lg border border-gray-200 dark:border-gray-800 px-3 py-1.5 text-sm text-gray-600 dark:text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 flex items-center gap-1">
              <X className="h-3.5 w-3.5" /> 초기화
            </Link>
          )}
        </form>

        <p className="mb-3 text-sm text-gray-500">총 <span className="font-bold text-gray-800 dark:text-gray-100">{total.toLocaleString()}</span>건</p>

        {(rows ?? []).length === 0 ? (
          <div className="rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 p-10 text-center text-sm text-gray-500">
            조건에 맞는 요청이 없습니다
          </div>
        ) : (
          <div className="space-y-3">
            {(rows ?? []).map((r: any) => {
              const reportCount = reportCounts.get(r.id) ?? 0
              const hasOpenReport = openReportIds.has(r.id)
              const owner = userMap.get(r.user_id)
              return (
                <div key={r.id} className="rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${r.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300'}`}>
                          {r.status === 'active' ? '모집 중' : '마감'}
                        </span>
                        {r.deal_type && (
                          <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-bold text-blue-700">{r.deal_type}</span>
                        )}
                        {r.room_type && (
                          <span className="rounded-full bg-gray-100 dark:bg-gray-800 px-2 py-0.5 text-xs text-gray-600 dark:text-gray-500">{r.room_type}</span>
                        )}
                        {hasOpenReport && (
                          <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-700 inline-flex items-center gap-1">
                            <Flag className="h-3 w-3" /> 신고 {reportCount}건
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 text-sm font-semibold text-gray-900 dark:text-white">
                        <MapPin className="h-3.5 w-3.5 text-gray-500" />
                        {[r.city, r.district, r.dong].filter(Boolean).join(' ') || '지역 미지정'}
                      </div>
                      <div className="mt-1 text-sm text-gray-700 dark:text-gray-300">
                        {r.min_price != null && r.max_price != null
                          ? <>{formatPrice(r.min_price)} ~ {formatPrice(r.max_price)}</>
                          : <span className="text-gray-500">가격 미지정</span>}
                      </div>
                      {r.description && (
                        <p className="mt-1 text-xs text-gray-500 line-clamp-2">{r.description}</p>
                      )}
                      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-gray-500">
                        <span className="inline-flex items-center gap-1">
                          <MessageCircle className="h-3 w-3" /> 제안 {r.proposal_count ?? 0}건
                        </span>
                        <span>등록 {formatDate(r.created_at)}</span>
                        {r.status === 'closed' && r.closed_at && (
                          <span>마감 {formatDate(r.closed_at)}</span>
                        )}
                        {owner && (
                          <span>· 작성자: {owner.name ?? '이름없음'}{owner.phone ? ` (${owner.phone})` : ''}</span>
                        )}
                      </div>
                    </div>

                    {/* 액션 버튼 */}
                    <div className="flex flex-col gap-1.5 items-end flex-shrink-0">
                      <Link
                        href={`/request/${r.id}`}
                        className="inline-flex items-center gap-1 rounded-lg border border-gray-200 dark:border-gray-800 px-2.5 py-1 text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
                      >
                        <ExternalLink className="h-3 w-3" /> 보기
                      </Link>
                      {r.status === 'active' && (
                        <form action={forceCloseAction}>
                          <input type="hidden" name="id" value={r.id} />
                          <button
                            type="submit"
                            className="inline-flex items-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700 hover:bg-amber-100"
                          >
                            <Archive className="h-3 w-3" /> 강제 마감
                          </button>
                        </form>
                      )}
                      <form action={deleteAction}>
                        <input type="hidden" name="id" value={r.id} />
                        <button
                          type="submit"
                          className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-100"
                        >
                          <Trash2 className="h-3 w-3" /> 삭제
                        </button>
                      </form>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* 페이지네이션 */}
        {totalPages > 1 && (
          <div className="mt-6 flex items-center justify-center gap-2">
            {page > 0 && (
              <Link href={buildHref({ page: String(page - 1) })} className="rounded-lg border border-gray-200 dark:border-gray-800 px-3 py-1.5 text-sm hover:bg-gray-50 dark:hover:bg-gray-800">
                ← 이전
              </Link>
            )}
            <span className="text-sm text-gray-500">{page + 1} / {totalPages}</span>
            {page + 1 < totalPages && (
              <Link href={buildHref({ page: String(page + 1) })} className="rounded-lg border border-gray-200 dark:border-gray-800 px-3 py-1.5 text-sm hover:bg-gray-50 dark:hover:bg-gray-800">
                다음 →
              </Link>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
