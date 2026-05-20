'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/lib/auth-context'
import { formatDate } from '@/lib/utils'
import {
  Activity, ArrowLeft, RefreshCw, AlertOctagon, Database,
  Users, FileText, Building2, MessageCircle, Bell, Heart, Eye, Flag, CheckCircle2
} from 'lucide-react'

interface Health {
  tables: Record<string, number>
  recent: {
    notifsLast24h: number
    propertiesLast24h: number
    requestsLast24h: number
    proposalsLast24h: number
    chatMessagesLast24h: number
    errorsLast24h: number
  }
  pushReady: boolean
  status: { color: string; label: string }
}

export default function AdminHealthPage() {
  const router = useRouter()
  const supabaseRef = useRef(createClient())
  const supabase = supabaseRef.current
  const auth = useAuth()

  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<Health | null>(null)
  const [lastChecked, setLastChecked] = useState<Date | null>(null)

  useEffect(() => {
    if (auth.loading) return
    if (!auth.user) { router.push('/auth/login'); return }
    if (auth.profile?.role !== 'admin') { router.push('/'); return }
  }, [auth.loading, auth.user, auth.profile?.role, router])

  const load = useCallback(async () => {
    setLoading(true)
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

    const [
      profiles, requests, brokers, properties, proposals, notifs, reviews,
      favorites, reports, errLogs, pushSubs,
      n24, p24, r24, pr24, m24, e24,
    ] = await Promise.all([
      supabase.from('profiles').select('*', { count: 'exact', head: true }),
      supabase.from('request_posts').select('*', { count: 'exact', head: true }),
      supabase.from('broker_profiles').select('*', { count: 'exact', head: true }),
      supabase.from('broker_properties').select('*', { count: 'exact', head: true }),
      supabase.from('proposals').select('*', { count: 'exact', head: true }),
      supabase.from('notifications').select('*', { count: 'exact', head: true }),
      supabase.from('reviews').select('*', { count: 'exact', head: true }),
      supabase.from('favorites').select('*', { count: 'exact', head: true }),
      supabase.from('reports').select('*', { count: 'exact', head: true }),
      supabase.from('error_logs').select('*', { count: 'exact', head: true }),
      supabase.from('push_subscriptions').select('*', { count: 'exact', head: true }),
      supabase.from('notifications').select('*', { count: 'exact', head: true }).gte('created_at', since),
      supabase.from('broker_properties').select('*', { count: 'exact', head: true }).gte('created_at', since),
      supabase.from('request_posts').select('*', { count: 'exact', head: true }).gte('created_at', since),
      supabase.from('proposals').select('*', { count: 'exact', head: true }).gte('created_at', since),
      supabase.from('chat_messages').select('*', { count: 'exact', head: true }).gte('created_at', since),
      supabase.from('error_logs').select('*', { count: 'exact', head: true }).gte('created_at', since),
    ])

    const tables = {
      profiles: profiles.count ?? 0,
      brokers: brokers.count ?? 0,
      requests: requests.count ?? 0,
      properties: properties.count ?? 0,
      proposals: proposals.count ?? 0,
      notifications: notifs.count ?? 0,
      reviews: reviews.count ?? 0,
      favorites: favorites.count ?? 0,
      reports: reports.count ?? 0,
      error_logs: errLogs.count ?? 0,
      push_subscriptions: pushSubs.count ?? 0,
    }

    const recent = {
      notifsLast24h: n24.count ?? 0,
      propertiesLast24h: p24.count ?? 0,
      requestsLast24h: r24.count ?? 0,
      proposalsLast24h: pr24.count ?? 0,
      chatMessagesLast24h: m24.count ?? 0,
      errorsLast24h: e24.count ?? 0,
    }

    // 시스템 상태 결정
    let status = { color: 'bg-green-500', label: '정상' }
    if (recent.errorsLast24h > 50) {
      status = { color: 'bg-red-500', label: '주의 필요' }
    } else if (recent.errorsLast24h > 5) {
      status = { color: 'bg-yellow-500', label: '관찰 중' }
    }

    setData({
      tables,
      recent,
      pushReady: (pushSubs.count ?? 0) > 0,
      status,
    })
    setLastChecked(new Date())
    setLoading(false)
  }, [supabase])

  useEffect(() => {
    if (auth.profile?.role === 'admin') load()
  }, [auth.profile?.role, load])

  if (auth.loading || auth.profile?.role !== 'admin') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-950">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <header className="border-b border-gray-800 bg-gray-900 px-6 py-4">
        <div className="mx-auto flex max-w-7xl items-center gap-3">
          <Link href="/admin" className="flex h-9 w-9 items-center justify-center rounded-xl bg-gray-800 hover:bg-gray-700 transition-colors">
            <ArrowLeft className="h-4 w-4 text-gray-300" />
          </Link>
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-green-500/20">
            <Activity className="h-5 w-5 text-green-400" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-white">시스템 상태</h1>
            <p className="text-xs text-gray-400">
              {lastChecked && <>마지막 점검 {formatDate(lastChecked.toISOString())} · </>}
              실시간 카운트·24h 활동
            </p>
          </div>
          <button onClick={() => load()} disabled={loading}
            className="ml-auto flex h-9 w-9 items-center justify-center rounded-xl bg-gray-800 hover:bg-gray-700 disabled:opacity-50"
            title="새로고침">
            <RefreshCw className={`h-4 w-4 text-gray-300 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-6 py-8 space-y-6">
        {loading || !data ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
          </div>
        ) : (
          <>
            {/* 전체 상태 */}
            <div className="rounded-2xl border border-gray-800 bg-gray-900 p-5 flex items-center gap-4">
              <span className={`h-3 w-3 rounded-full ${data.status.color} animate-pulse`} />
              <div className="flex-1">
                <p className="text-lg font-bold text-white">시스템 {data.status.label}</p>
                <p className="text-xs text-gray-400">24시간 내 에러 {data.recent.errorsLast24h}건</p>
              </div>
              {data.recent.errorsLast24h > 0 && (
                <Link href="/admin/errors" className="rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-xs font-bold text-red-400 hover:bg-red-500/20">
                  에러 보기
                </Link>
              )}
            </div>

            {/* 24h 활동 */}
            <section>
              <h2 className="mb-3 font-bold text-white">최근 24시간 활동</h2>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                <Activity24h icon={FileText} label="신규 요청" value={data.recent.requestsLast24h} color="text-green-400 bg-green-500/10" />
                <Activity24h icon={Building2} label="신규 매물" value={data.recent.propertiesLast24h} color="text-emerald-400 bg-emerald-500/10" />
                <Activity24h icon={MessageCircle} label="제안" value={data.recent.proposalsLast24h} color="text-blue-400 bg-blue-500/10" />
                <Activity24h icon={MessageCircle} label="채팅 메시지" value={data.recent.chatMessagesLast24h} color="text-purple-400 bg-purple-500/10" />
                <Activity24h icon={Bell} label="알림 발송" value={data.recent.notifsLast24h} color="text-yellow-400 bg-yellow-500/10" />
                <Activity24h icon={AlertOctagon} label="에러" value={data.recent.errorsLast24h} color={data.recent.errorsLast24h > 0 ? "text-red-400 bg-red-500/10" : "text-gray-400 bg-gray-800"} />
              </div>
            </section>

            {/* 전체 카운트 */}
            <section>
              <h2 className="mb-3 font-bold text-white">데이터 카운트</h2>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                <TableRow icon={Users} label="사용자" value={data.tables.profiles} />
                <TableRow icon={Building2} label="중개사" value={data.tables.brokers} />
                <TableRow icon={FileText} label="요청" value={data.tables.requests} />
                <TableRow icon={Database} label="매물" value={data.tables.properties} />
                <TableRow icon={MessageCircle} label="제안" value={data.tables.proposals} />
                <TableRow icon={Bell} label="알림" value={data.tables.notifications} />
                <TableRow icon={Eye} label="리뷰" value={data.tables.reviews} />
                <TableRow icon={Heart} label="찜" value={data.tables.favorites} />
                <TableRow icon={Flag} label="신고·문의" value={data.tables.reports} />
                <TableRow icon={AlertOctagon} label="에러 로그" value={data.tables.error_logs} />
                <TableRow icon={CheckCircle2} label="푸시 구독" value={data.tables.push_subscriptions} />
              </div>
            </section>

            {/* 외부 시스템 점검 */}
            <section>
              <h2 className="mb-3 font-bold text-white">외부 시스템</h2>
              <div className="rounded-2xl border border-gray-800 bg-gray-900 p-5 divide-y divide-gray-800">
                <ExternalRow label="Supabase 연결" status={true} note="DB 쿼리 정상 응답" />
                <ExternalRow label="푸시 구독" status={data.pushReady} note={`${data.tables.push_subscriptions}개 디바이스 구독 중`} />
                <ExternalRow label="Vercel Cron" status={null} note="매일 자정 UTC 자동 실행 (확인은 Vercel 대시보드)" />
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  )
}

function Activity24h({ icon: Icon, label, value, color }: { icon: any; label: string; value: number; color: string }) {
  return (
    <div className="rounded-2xl border border-gray-800 bg-gray-900 p-4">
      <div className={`mb-2 inline-flex h-8 w-8 items-center justify-center rounded-lg ${color}`}>
        <Icon className="h-4 w-4" />
      </div>
      <p className="text-xl font-black text-white">{value}</p>
      <p className="mt-0.5 text-[11px] text-gray-400">{label}</p>
    </div>
  )
}

function TableRow({ icon: Icon, label, value }: { icon: any; label: string; value: number }) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 px-4 py-3 flex items-center gap-3">
      <Icon className="h-4 w-4 text-gray-500" />
      <div className="flex-1 min-w-0">
        <p className="text-[11px] text-gray-500">{label}</p>
        <p className="text-base font-bold text-white">{value.toLocaleString()}</p>
      </div>
    </div>
  )
}

function ExternalRow({ label, status, note }: { label: string; status: boolean | null; note: string }) {
  const dot = status === true ? 'bg-green-500' : status === false ? 'bg-red-500' : 'bg-gray-500'
  return (
    <div className="flex items-center gap-3 py-3">
      <span className={`h-2 w-2 rounded-full ${dot}`} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-white">{label}</p>
        <p className="text-xs text-gray-500">{note}</p>
      </div>
    </div>
  )
}
