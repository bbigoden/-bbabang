import { createClient } from '@/lib/supabase/server'
import { Header } from '@/components/layout/header'
import { redirect } from 'next/navigation'
import { formatDate, formatPrice } from '@/lib/utils'
import Link from 'next/link'
import { MessageCircle, MapPin, Star, ChevronRight } from 'lucide-react'

const statusLabel: Record<string, string> = { pending: '대기 중', accepted: '수락됨', rejected: '거절됨' }
const statusColor: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-700',
  accepted: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-500',
}

export default async function BrokerCustomersPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (!profile || profile.role !== 'broker') redirect('/dashboard/user')

  const { data: broker } = await supabase.from('broker_profiles').select('*').eq('user_id', user.id).single()
  if (!broker) redirect('/broker/register')

  // 내 제안 전체 — 고객 정보 포함
  const { data: proposals } = await supabase
    .from('proposals')
    .select('*, request_posts(*, profiles(id, name, email))')
    .eq('broker_id', broker.id)
    .order('created_at', { ascending: false })

  const all = proposals ?? []

  // 고객별로 그룹핑 (최신 제안 기준)
  const customerMap = new Map<string, {
    profile: any
    proposals: any[]
    latestProposal: any
  }>()

  for (const p of all) {
    const req = p.request_posts
    const profile = req?.profiles
    if (!profile) continue
    const uid = profile.id
    if (!customerMap.has(uid)) {
      customerMap.set(uid, { profile, proposals: [], latestProposal: p })
    }
    customerMap.get(uid)!.proposals.push(p)
  }

  const customers = Array.from(customerMap.values())

  return (
    <div className="min-h-screen bg-gray-50">
      <Header user={user} role="broker" />

      <div className="mx-auto max-w-3xl px-4 py-8">
        {/* 헤더 */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">고객목록</h1>
            <p className="mt-0.5 text-sm text-gray-500">제안을 보낸 고객 {customers.length}명</p>
          </div>
        </div>

        {customers.length === 0 ? (
          <div className="rounded-2xl bg-white border border-gray-100 py-20 text-center shadow-sm">
            <div className="mb-3 text-4xl">👤</div>
            <p className="font-semibold text-gray-600">아직 제안을 보낸 고객이 없어요</p>
            <p className="mt-1 text-sm text-gray-400">매물 요청에 제안을 보내면 여기에 표시됩니다</p>
            <Link
              href="/dashboard/broker"
              className="mt-6 inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 transition-colors"
            >
              요청 보러 가기
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {customers.map(({ profile, proposals, latestProposal }) => {
              const req = latestProposal.request_posts
              const acceptedCount = proposals.filter(p => p.status === 'accepted').length
              const chatProposal = proposals.find(p => p.status === 'accepted') ?? latestProposal

              return (
                <div key={profile.id} className="rounded-2xl bg-white border border-gray-100 shadow-sm overflow-hidden">
                  {/* 고객 정보 */}
                  <div className="flex items-center gap-4 px-5 py-4 border-b border-gray-50">
                    <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-700 text-lg font-black">
                      {profile.name?.[0] ?? '?'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-gray-900">{profile.name ?? '이름 없음'}</span>
                        {acceptedCount > 0 && (
                          <span className="flex items-center gap-0.5 rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700">
                            <Star className="h-3 w-3 fill-green-500" /> 성사
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-400 truncate">{profile.email}</p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-xs text-gray-400">제안 {proposals.length}건</span>
                      <Link
                        href={`/request/${chatProposal.request_posts?.id}`}
                        className="flex items-center gap-1.5 rounded-xl bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700 transition-colors"
                      >
                        <MessageCircle className="h-3.5 w-3.5" />
                        대화
                      </Link>
                    </div>
                  </div>

                  {/* 제안 목록 */}
                  <div className="divide-y divide-gray-50">
                    {proposals.slice(0, 3).map(p => {
                      const r = p.request_posts
                      return (
                        <Link key={p.id} href={`/request/${p.request_posts?.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-gray-50 transition-colors">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${statusColor[p.status] ?? 'bg-gray-100 text-gray-500'}`}>
                                {statusLabel[p.status] ?? p.status}
                              </span>
                              {r && (
                                <span className="flex items-center gap-1 text-xs text-gray-500">
                                  <MapPin className="h-3 w-3" />
                                  {r.district} · {r.deal_type}
                                </span>
                              )}
                              {p.price && (
                                <span className="text-xs font-semibold text-blue-600">{formatPrice(p.price)}</span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <span className="text-xs text-gray-400">{formatDate(p.created_at)}</span>
                            <ChevronRight className="h-3.5 w-3.5 text-gray-300" />
                          </div>
                        </Link>
                      )
                    })}
                    {proposals.length > 3 && (
                      <div className="px-5 py-2.5 text-xs text-gray-400 text-center">
                        +{proposals.length - 3}건 더 있음
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
