'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/lib/auth-context'
import { Header } from '@/components/layout/header'
import { formatDate } from '@/lib/utils'
import { Bookmark, Trash2, Building2, FileText, Home, ExternalLink } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'

interface SavedSearch {
  id: string
  target: 'broker' | 'request' | 'property'
  label: string | null
  filters: Record<string, any>
  last_checked_at: string
  created_at: string
}

const TARGET_META: Record<SavedSearch['target'], { label: string; icon: any; color: string; basePath: string; param: (f: Record<string, any>) => string }> = {
  broker:   { label: '중개사', icon: Building2, color: 'bg-purple-50 text-purple-600 border-purple-200', basePath: '/brokers', param: f => buildQS({ sido: f.sido, sigungu: f.sigungu, verified: f.verified ? '1' : '' }) },
  request:  { label: '요청', icon: FileText, color: 'bg-blue-50 text-blue-600 border-blue-200', basePath: '/explore/requests', param: f => buildQS({ city: f.city, district: f.district, dong: f.dong, deal_type: f.deal_type }) },
  property: { label: '매물', icon: Home, color: 'bg-emerald-50 text-emerald-600 border-emerald-200', basePath: '/search', param: f => buildQS({ q: f.q }) },
}

function buildQS(params: Record<string, any>): string {
  const usp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== null && v !== undefined && v !== '' && v !== false) usp.set(k, String(v))
  }
  const s = usp.toString()
  return s ? '?' + s : ''
}

export default function SavedSearchesPage() {
  const router = useRouter()
  const supabaseRef = useRef(createClient())
  const supabase = supabaseRef.current
  const auth = useAuth()

  const [items, setItems] = useState<SavedSearch[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (auth.loading) return
    if (!auth.user) router.push('/auth/login?redirect=/saved-searches')
  }, [auth.loading, auth.user, router])

  const load = useCallback(async () => {
    if (!auth.user) return
    setLoading(true)
    const { data } = await supabase
      .from('saved_searches')
      .select('id, target, label, filters, last_checked_at, created_at')
      .eq('user_id', auth.user.id)
      .order('created_at', { ascending: false })
    setItems((data ?? []) as SavedSearch[])
    setLoading(false)
  }, [auth.user, supabase])

  useEffect(() => {
    if (auth.user) load()
  }, [auth.user, load])

  const remove = async (id: string) => {
    if (!confirm('이 저장된 검색을 삭제할까요?')) return
    await supabase.from('saved_searches').delete().eq('id', id)
    setItems(prev => prev.filter(s => s.id !== id))
  }

  if (auth.loading || !auth.user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-950">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <Header />

      <div className="mx-auto max-w-5xl px-4 py-8">
        <PageHeader
          icon={Bookmark}
          iconColor="text-blue-500"
          title="저장한 검색"
          description="조건에 맞는 새 데이터가 등록되면 알림으로 알려드려요"
        />

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 py-16 text-center">
            <Bookmark className="mx-auto mb-3 h-12 w-12 text-gray-200" />
            <p className="font-semibold text-gray-500">저장한 검색이 없어요</p>
            <p className="mt-1 text-sm text-gray-500">중개사·요청 페이지에서 필터 + &apos;조건 저장&apos; 버튼을 사용해보세요</p>
            <div className="mt-5 flex justify-center gap-2">
              <Link href="/brokers" className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700">
                중개사 찾기
              </Link>
              <Link href="/explore/requests" className="rounded-xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 py-2.5 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 dark:bg-gray-950">
                요청 둘러보기
              </Link>
            </div>
          </div>
        ) : (
          <ul className="space-y-3">
            {items.map(s => {
              const meta = TARGET_META[s.target]
              const Icon = meta.icon
              const link = meta.basePath + meta.param(s.filters)
              return (
                <li key={s.id} className="rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 hover:border-blue-300 transition-colors">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap mb-2">
                        <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-bold ${meta.color}`}>
                          <Icon className="h-3 w-3" /> {meta.label}
                        </span>
                        <span className="text-[11px] text-gray-500">저장 {formatDate(s.created_at)}</span>
                      </div>
                      <p className="text-base font-bold text-gray-900 dark:text-white">{s.label || '(이름 없음)'}</p>

                      {/* 필터 칩 */}
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {Object.entries(s.filters).filter(([_, v]) => v !== null && v !== undefined && v !== '' && v !== false).map(([k, v]) => (
                          <span key={k} className="inline-flex items-center gap-1 rounded-md bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 px-2 py-0.5 text-[11px] font-medium text-gray-700 dark:text-gray-300">
                            <span className="text-gray-500">{k}:</span> {String(v)}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className="flex flex-col gap-1 flex-shrink-0">
                      <Link href={link}
                        className="inline-flex items-center justify-center gap-1 rounded-lg bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-600 hover:bg-blue-100">
                        <ExternalLink className="h-3 w-3" /> 열기
                      </Link>
                      <button onClick={() => remove(s.id)}
                        className="inline-flex items-center justify-center gap-1 rounded-lg border border-gray-200 dark:border-gray-800 px-3 py-1.5 text-xs font-medium text-gray-500 hover:bg-red-50 hover:text-red-500 hover:border-red-200">
                        <Trash2 className="h-3 w-3" /> 삭제
                      </button>
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
