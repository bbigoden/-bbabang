'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/lib/auth-context'
import { Header } from '@/components/layout/header'
import { ArrowLeft, Archive, ChevronDown, ChevronRight, FileText, Users } from 'lucide-react'

interface DiaryRow {
  id: string
  author_name: string | null
  date: string
  work_summary: string | null
  ad_status: string | null
  suggestions: string | null
  delivery_notes: string | null
  sections_content: Record<string, string> | null
  archived_at: string
}
interface CustRow {
  id: string
  author_name: string | null
  diary_date: string
  customer_name: string | null
  customer_contact: string | null
  proposed_property_ids: string[] | null
}

export default function ArchivePage() {
  const router = useRouter()
  const auth = useAuth()
  const supabase = createClient()
  const [loading, setLoading] = useState(true)
  const [diaries, setDiaries] = useState<DiaryRow[]>([])
  const [custs, setCusts] = useState<CustRow[]>([])
  const [filterAuthor, setFilterAuthor] = useState<string>('all')
  const [openId, setOpenId] = useState<string | null>(null)

  useEffect(() => {
    if (auth.loading) return
    if (!auth.user || !auth.broker) { router.push('/auth/login'); return }
    // 대표만 접근
    if (auth.broker.is_owner === false) { router.push('/dashboard/broker'); return }
    load()
  }, [auth.loading, auth.user?.id, auth.broker?.id])

  const load = async () => {
    if (!auth.broker?.id) return
    setLoading(true)
    const [{ data: d }, { data: c }] = await Promise.all([
      supabase.from('broker_diary_archive')
        .select('id, author_name, date, work_summary, ad_status, suggestions, delivery_notes, sections_content, archived_at')
        .eq('office_broker_id', auth.broker.id)
        .order('date', { ascending: false }),
      supabase.from('broker_diary_customers_archive')
        .select('id, author_name, diary_date, customer_name, customer_contact, proposed_property_ids')
        .eq('office_broker_id', auth.broker.id)
        .order('diary_date', { ascending: false }),
    ])
    setDiaries(d ?? [])
    setCusts(c ?? [])
    setLoading(false)
  }

  // 작성자 목록
  const authors = Array.from(new Set(diaries.map(d => d.author_name).filter(Boolean) as string[]))
  const filteredDiaries = filterAuthor === 'all'
    ? diaries
    : diaries.filter(d => d.author_name === filterAuthor)

  // 같은 일지(date+author)에 묶인 customers
  const custsByDiary = (date: string, author: string | null) => custs.filter(c =>
    c.diary_date === date && c.author_name === author
  )

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <Header />
      <main className="mx-auto max-w-4xl px-4 py-6">
        <div className="mb-4 flex items-center gap-2">
          <Link href="/dashboard/broker" className="flex h-9 w-9 items-center justify-center rounded-xl text-gray-500 hover:bg-white dark:bg-gray-900">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Archive className="h-5 w-5 text-gray-500" />퇴사자 일지
          </h1>
        </div>

        <div className="mb-3 flex items-start gap-2 rounded-xl bg-blue-50 border border-blue-200 p-3 text-xs text-blue-800">
          <FileText className="h-4 w-4 flex-shrink-0 mt-0.5" />
          <p>퇴사한 직원이 작성했던 일지입니다. 사무소 자산으로 영구 보관됩니다 (법적 추적용). 평소 일지 페이지에는 안 보입니다.</p>
        </div>

        {/* 작성자 필터 */}
        {authors.length > 0 && (
          <div className="mb-4 flex items-center gap-2 flex-wrap">
            <span className="text-xs text-gray-500">작성자:</span>
            <button onClick={() => setFilterAuthor('all')}
              className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${filterAuthor === 'all' ? 'bg-blue-600 text-white' : 'bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 dark:bg-gray-950'}`}>
              전체
            </button>
            {authors.map(a => (
              <button key={a} onClick={() => setFilterAuthor(a)}
                className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${filterAuthor === a ? 'bg-blue-600 text-white' : 'bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 dark:bg-gray-950'}`}>
                {a}
              </button>
            ))}
          </div>
        )}

        {loading ? (
          <div className="py-20 text-center text-sm text-gray-400">불러오는 중...</div>
        ) : filteredDiaries.length === 0 ? (
          <div className="py-20 text-center text-sm text-gray-400">
            {filterAuthor === 'all' ? '아카이브된 일지가 없습니다.' : `${filterAuthor}의 일지가 없습니다.`}
          </div>
        ) : (
          <ul className="space-y-2">
            {filteredDiaries.map(d => {
              const isOpen = openId === d.id
              const dcusts = custsByDiary(d.date, d.author_name)
              return (
                <li key={d.id} className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden">
                  <button onClick={() => setOpenId(isOpen ? null : d.id)}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800 dark:bg-gray-950 transition-colors">
                    {isOpen ? <ChevronDown className="h-4 w-4 text-gray-400" /> : <ChevronRight className="h-4 w-4 text-gray-400" />}
                    <FileText className="h-4 w-4 text-gray-400" />
                    <div className="flex-1 text-left">
                      <p className="text-sm font-semibold text-gray-900 dark:text-white">{d.date}</p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        작성자 <span className="font-semibold text-gray-700 dark:text-gray-300">{d.author_name || '—'}</span>
                        {dcusts.length > 0 && (
                          <span className="ml-2 inline-flex items-center gap-1 text-blue-600">
                            <Users className="h-3 w-3" />{dcusts.length}건 상담
                          </span>
                        )}
                      </p>
                    </div>
                    <span className="text-xs text-gray-400">archive {new Date(d.archived_at).toLocaleDateString('ko-KR')}</span>
                  </button>
                  {isOpen && (
                    <div className="border-t border-gray-100 dark:border-gray-800 px-4 py-3 space-y-3">
                      {d.work_summary && <Section title="업무요약" text={d.work_summary} />}
                      {d.ad_status && <Section title="광고현황" text={d.ad_status} />}
                      {d.suggestions && <Section title="건의사항" text={d.suggestions} />}
                      {d.delivery_notes && <Section title="전달사항" text={d.delivery_notes} />}
                      {d.sections_content && Object.entries(d.sections_content as Record<string, string>).map(([k, v]) => v && (
                        <Section key={k} title={k} text={v} />
                      ))}
                      {dcusts.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold text-gray-500 mb-1.5">상담 고객 ({dcusts.length})</p>
                          <ul className="space-y-1">
                            {dcusts.map(c => (
                              <li key={c.id} className="text-xs text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-950 rounded-lg px-3 py-2">
                                <span className="font-semibold">{c.customer_name || '이름 없음'}</span>
                                {c.customer_contact && <span className="text-gray-500"> · {c.customer_contact}</span>}
                                {c.proposed_property_ids && c.proposed_property_ids.length > 0 && (
                                  <span className="text-blue-600"> · 매물 {c.proposed_property_ids.length}건 제안</span>
                                )}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </main>
    </div>
  )
}

function Section({ title, text }: { title: string; text: string }) {
  return (
    <div>
      <p className="text-xs font-semibold text-gray-500 mb-1">{title}</p>
      <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-line">{text}</p>
    </div>
  )
}
