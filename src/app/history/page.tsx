'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/lib/auth-context'
import { Header } from '@/components/layout/header'
import { formatDate, formatPrice } from '@/lib/utils'
import { Clock, Building2, FileText, ShieldCheck, MapPin, Star, Trash2, X } from 'lucide-react'
import { EmptyState } from '@/components/empty-state'

type Tab = 'broker' | 'request'

interface HistoryRow {
  id: string
  target_type: Tab
  target_id: string
  viewed_at: string
}

export default function HistoryPage() {
  const router = useRouter()
  const supabaseRef = useRef(createClient())
  const supabase = supabaseRef.current
  const auth = useAuth()

  const [tab, setTab] = useState<Tab>('broker')
  const [history, setHistory] = useState<HistoryRow[]>([])
  const [brokers, setBrokers] = useState<Record<string, any>>({})
  const [requests, setRequests] = useState<Record<string, any>>({})
  const [loading, setLoading] = useState(true)
  const [clearing, setClearing] = useState(false)

  useEffect(() => {
    if (auth.loading) return
    if (!auth.user) router.push('/auth/login?redirect=/history')
  }, [auth.loading, auth.user, router])

  const load = useCallback(async () => {
    if (!auth.user) return
    setLoading(true)
    const { data: rows } = await supabase
      .from('view_history')
      .select('id, target_type, target_id, viewed_at')
      .eq('user_id', auth.user.id)
      .order('viewed_at', { ascending: false })
      .limit(200)
    const list = (rows ?? []) as HistoryRow[]
    setHistory(list)

    const brokerIds = list.filter(r => r.target_type === 'broker').map(r => r.target_id)
    const requestIds = list.filter(r => r.target_type === 'request').map(r => r.target_id)

    const [bRes, rRes] = await Promise.all([
      brokerIds.length
        ? supabase.from('broker_profiles').select('id, office_name, address, rating, review_count, is_verified, profiles(name)').in('id', brokerIds)
        : Promise.resolve({ data: [] as any[] }),
      requestIds.length
        ? supabase.from('request_posts').select('id, city, district, dong, deal_type, room_type, min_price, max_price, status, proposal_count').in('id', requestIds)
        : Promise.resolve({ data: [] as any[] }),
    ])
    const bMap: Record<string, any> = {}; (bRes.data ?? []).forEach((x: any) => { bMap[x.id] = x })
    const rMap: Record<string, any> = {}; (rRes.data ?? []).forEach((x: any) => { rMap[x.id] = x })
    setBrokers(bMap); setRequests(rMap)
    setLoading(false)
  }, [auth.user, supabase])

  useEffect(() => {
    if (auth.user) load()
  }, [auth.user, load])

  const removeOne = async (id: string) => {
    await supabase.from('view_history').delete().eq('id', id)
    setHistory(prev => prev.filter(h => h.id !== id))
  }

  const clearAll = async () => {
    if (!auth.user) return
    if (!confirm('전체 기록을 삭제할까요? 되돌릴 수 없어요.')) return
    setClearing(true)
    await supabase.from('view_history').delete().eq('user_id', auth.user.id)
    setHistory([])
    setClearing(false)
  }

  if (auth.loading || !auth.user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-950">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
      </div>
    )
  }

  const counts = {
    broker: history.filter(h => h.target_type === 'broker').length,
    request: history.filter(h => h.target_type === 'request').length,
  }
  const tabRows = history.filter(h => h.target_type === tab)

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <Header />

      <div className="mx-auto max-w-3xl px-4 py-8">
        <div className="mb-6 flex items-start justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900 dark:text-white">
              <Clock className="h-6 w-6 text-blue-500" />
              최근 본 항목
            </h1>
            <p className="mt-1 text-sm text-gray-500">최근에 본 중개사·요청을 모아봐요</p>
          </div>
          {history.length > 0 && (
            <button onClick={clearAll} disabled={clearing}
              className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-3 py-2 text-xs font-medium text-gray-600 dark:text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 dark:bg-gray-950 disabled:opacity-50 transition-colors">
              <Trash2 className="h-3.5 w-3.5" />
              {clearing ? '삭제 중...' : '전체 삭제'}
            </button>
          )}
        </div>

        <div className="mb-6 flex gap-2" role="tablist" aria-label="최근 본 기록 카테고리">
          {([
            { key: 'broker', label: '중개사', icon: Building2 },
            { key: 'request', label: '요청', icon: FileText },
          ] as const).map(t => (
            <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold transition-all ${
                tab === t.key ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
              }`}>
              <t.icon className="h-4 w-4" />
              {t.label} {counts[t.key] > 0 && <span className={`ml-0.5 text-xs ${tab === t.key ? 'text-blue-100' : 'text-gray-500'}`}>{counts[t.key]}</span>}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
          </div>
        ) : tabRows.length === 0 ? (
          <EmptyState
            variant="full"
            icon={Clock}
            message="최근 본 기록이 없어요"
            description="중개사 또는 요청 페이지를 방문하면 여기에 기록돼요"
            darkBg
          />
        ) : (
          <ul className="space-y-2">
            {tabRows.map(h => {
              if (h.target_type === 'broker') {
                const b = brokers[h.target_id]
                if (!b) return <DeletedItem key={h.id} label="중개사" onRemove={() => removeOne(h.id)} />
                return (
                  <li key={h.id} className="relative">
                    <Link href={`/broker/${b.id}`}
                      className="block rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 hover:border-blue-300 hover:shadow-sm transition-all">
                      <div className="flex-1 min-w-0 pr-8">
                        <div className="flex items-center gap-1.5 mb-1">
                          <p className="text-base font-bold text-gray-900 dark:text-white truncate">{b.profiles?.name ?? '(이름 없음)'}</p>
                          {b.is_verified && <ShieldCheck className="h-3.5 w-3.5 text-blue-500 flex-shrink-0" />}
                        </div>
                        <p className="text-xs text-gray-500 truncate">{b.office_name ?? '—'}</p>
                        <div className="mt-1.5 flex items-center gap-2 text-xs text-gray-500">
                          <span className="flex items-center gap-0.5 text-amber-600 font-semibold">
                            <Star className="h-3 w-3 fill-current" /> {Number(b.rating ?? 0).toFixed(1)}
                          </span>
                          <span>후기 {b.review_count ?? 0}</span>
                          <span className="ml-auto">{formatDate(h.viewed_at)}</span>
                        </div>
                      </div>
                    </Link>
                    <button onClick={() => removeOne(h.id)} title="기록 삭제"
                      className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 dark:bg-gray-800 hover:text-gray-700 dark:text-gray-300 transition-colors">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </li>
                )
              } else {
                const r = requests[h.target_id]
                if (!r) return <DeletedItem key={h.id} label="요청" onRemove={() => removeOne(h.id)} />
                return (
                  <li key={h.id} className="relative">
                    <Link href={`/request/${r.id}`}
                      className="block rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 hover:border-blue-300 hover:shadow-sm transition-all">
                      <div className="flex-1 min-w-0 pr-8">
                        <div className="mb-1.5 flex items-center gap-1.5 flex-wrap">
                          {r.deal_type && <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-700">{r.deal_type}</span>}
                          {r.room_type && <span className="rounded-full bg-gray-100 dark:bg-gray-800 px-2 py-0.5 text-[10px] font-medium text-gray-600 dark:text-gray-500">{r.room_type}</span>}
                          {r.status === 'closed' && <span className="rounded-full bg-gray-200 px-2 py-0.5 text-[10px] font-medium text-gray-500">마감</span>}
                        </div>
                        <p className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-1">
                          <MapPin className="h-3.5 w-3.5 text-gray-500" />
                          {[r.city, r.district, r.dong].filter(Boolean).join(' ') || '지역 미지정'}
                        </p>
                        {r.min_price != null && r.max_price != null && (
                          <p className="mt-0.5 text-sm text-blue-600 font-semibold">
                            {formatPrice(r.min_price)} ~ {formatPrice(r.max_price)}
                          </p>
                        )}
                        <div className="mt-1.5 flex items-center justify-between text-xs text-gray-500">
                          <span className="text-blue-500 font-medium">{r.proposal_count ?? 0}개 제안</span>
                          <span>{formatDate(h.viewed_at)}</span>
                        </div>
                      </div>
                    </Link>
                    <button onClick={() => removeOne(h.id)} title="기록 삭제"
                      className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 dark:bg-gray-800 hover:text-gray-700 dark:text-gray-300 transition-colors">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </li>
                )
              }
            })}
          </ul>
        )}
      </div>
    </div>
  )
}

function DeletedItem({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <li className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-950 p-4 flex items-center justify-between">
      <p className="text-sm text-gray-500">삭제된 {label}</p>
      <button onClick={onRemove}
        className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-3 py-1 text-xs font-medium text-gray-600 dark:text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 dark:bg-gray-800">
        목록에서 빼기
      </button>
    </li>
  )
}
