import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Header } from '@/components/layout/header'
import { PageHeader } from '@/components/layout/page-header'
import { formatDate, formatPrice } from '@/lib/utils'
import { MapPin, MessageCircle, Home as HomeIcon, Inbox, ExternalLink, Star, CheckCircle, XCircle, Clock } from 'lucide-react'

export const dynamic = 'force-dynamic'

type Search = { status?: 'all' | 'pending' | 'accepted' | 'rejected' }

const STATUS_META: Record<string, { label: string; cls: string; icon: any }> = {
  pending:  { label: '대기 중', cls: 'bg-blue-100 text-blue-700',   icon: Clock },
  accepted: { label: '수락',    cls: 'bg-green-100 text-green-700', icon: CheckCircle },
  rejected: { label: '거절',    cls: 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-500', icon: XCircle },
}

export default async function MyProposalsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login?redirect=/my/proposals')

  const sp = await searchParams
  const status = sp.status ?? 'all'

  // 내 모든 요청 id
  const { data: myRequests } = await supabase
    .from('request_posts')
    .select('id, city, district, dong, deal_type, room_type, status, min_price, max_price')
    .eq('user_id', user.id)

  const requestMap = new Map<string, any>()
  for (const r of myRequests ?? []) requestMap.set(r.id, r)
  const requestIds = Array.from(requestMap.keys())

  let proposals: any[] = []
  if (requestIds.length > 0) {
    let q = supabase
      .from('proposals')
      .select('id, request_id, broker_id, price, description, property_address, property_images, status, stage, reject_reason, created_at, broker_profiles(id, office_name, address, is_verified, profiles(name, avatar_url))')
      .in('request_id', requestIds)
      .order('created_at', { ascending: false })
    if (status !== 'all') q = q.eq('status', status)
    const { data } = await q
    proposals = data ?? []
  }

  // 카운트 집계
  const counts = { all: 0, pending: 0, accepted: 0, rejected: 0 }
  if (requestIds.length > 0) {
    const { data: all } = await supabase
      .from('proposals')
      .select('status')
      .in('request_id', requestIds)
    for (const p of all ?? []) {
      counts.all++
      if (p.status === 'pending') counts.pending++
      else if (p.status === 'accepted') counts.accepted++
      else if (p.status === 'rejected') counts.rejected++
    }
  }

  const filterBtn = (key: 'all' | 'pending' | 'accepted' | 'rejected', label: string, count: number) => {
    const href = key === 'all' ? '/my/proposals' : `/my/proposals?status=${key}`
    const active = status === key
    return (
      <Link
        key={key}
        href={href}
        className={`rounded-full border px-3 py-1 text-sm font-medium transition-colors ${
          active
            ? 'border-blue-500 bg-blue-50 text-blue-700'
            : 'border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800'
        }`}
      >
        {label} <span className="ml-1 text-xs">({count})</span>
      </Link>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <Header />
      <div className="mx-auto max-w-5xl px-4 py-8">
        <PageHeader
          title="받은 제안"
          description="내가 등록한 요청에 들어온 모든 제안을 한곳에서 확인"
        />

        {requestIds.length === 0 ? (
          <div className="rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 p-10 text-center">
            <Inbox className="mx-auto h-10 w-10 text-gray-400" />
            <p className="mt-3 text-sm font-semibold text-gray-700 dark:text-gray-300">아직 등록한 요청이 없어요</p>
            <p className="mt-1 text-xs text-gray-500">매물 요청을 등록하면 중개사들의 제안을 받을 수 있어요</p>
            <Link href="/request/new" className="mt-4 inline-block rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700">
              매물 요청 등록하기
            </Link>
          </div>
        ) : (
          <>
            {/* 상태 필터 */}
            <div className="mb-5 flex flex-wrap gap-2">
              {filterBtn('all',      '전체',  counts.all)}
              {filterBtn('pending',  '대기',  counts.pending)}
              {filterBtn('accepted', '수락',  counts.accepted)}
              {filterBtn('rejected', '거절',  counts.rejected)}
            </div>

            {proposals.length === 0 ? (
              <div className="rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 p-10 text-center text-sm text-gray-500">
                {status === 'all' ? '아직 받은 제안이 없어요' : '해당 상태의 제안이 없어요'}
              </div>
            ) : (
              <ul className="space-y-3">
                {proposals.map((p: any) => {
                  const req = requestMap.get(p.request_id)
                  const meta = STATUS_META[p.status] ?? STATUS_META.pending
                  const StatusIcon = meta.icon
                  const office = p.broker_profiles
                  const brokerName = office?.profiles?.name ?? '중개사'
                  const reqRegion = req ? [req.city, req.district, req.dong].filter(Boolean).join(' ') : ''
                  const cover = (p.property_images && p.property_images[0]) || null

                  return (
                    <li key={p.id}>
                      <Link
                        href={`/request/${p.request_id}?p=${p.id}`}
                        className="block rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 hover:border-blue-300 hover:shadow-sm transition-all"
                      >
                        <div className="flex gap-3">
                          {cover && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={cover} alt="" className="h-20 w-20 flex-shrink-0 rounded-lg object-cover" />
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="mb-1.5 flex flex-wrap items-center gap-2">
                              <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold ${meta.cls}`}>
                                <StatusIcon className="h-3 w-3" />
                                {meta.label}
                              </span>
                              {office?.is_verified && (
                                <span className="inline-flex items-center gap-0.5 rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
                                  <Star className="h-3 w-3" />
                                  인증
                                </span>
                              )}
                              <span className="text-xs text-gray-500">{formatDate(p.created_at)}</span>
                            </div>
                            <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">
                              {office?.office_name ?? brokerName}
                            </p>
                            <div className="mt-1 flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-500">
                              <HomeIcon className="h-3 w-3" />
                              {p.property_address || '주소 미입력'}
                              {p.price != null && <span className="font-semibold text-gray-900 dark:text-white ml-1">· {formatPrice(p.price)}</span>}
                            </div>
                            {req && (
                              <div className="mt-1 flex items-center gap-1 text-xs text-gray-500">
                                <MapPin className="h-3 w-3" />
                                <span className="truncate">내 요청: {reqRegion} · {req.deal_type}</span>
                              </div>
                            )}
                            {p.description && (
                              <p className="mt-1.5 text-xs text-gray-600 dark:text-gray-500 line-clamp-2">{p.description}</p>
                            )}
                            {p.status === 'rejected' && p.reject_reason && (
                              <p className="mt-1.5 text-[11px] text-gray-500 italic">거절 사유: &quot;{p.reject_reason}&quot;</p>
                            )}
                          </div>
                          <div className="flex flex-col items-end justify-between flex-shrink-0">
                            <ExternalLink className="h-4 w-4 text-gray-400" />
                            <MessageCircle className="h-4 w-4 text-blue-500" />
                          </div>
                        </div>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  )
}
