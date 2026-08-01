import Link from 'next/link'
import { Header } from '@/components/layout/header'
import { createClient } from '@/lib/supabase/server'
import { Briefcase, MapPin, Building2, BadgeCheck } from 'lucide-react'

// 구인 게시판 공개 목록 — 인증 사무소만 등록 가능, 열람은 로그인 불요
export const revalidate = 60

export const metadata = {
  title: '중개사무소 구인 게시판',
  description:
    '인증된 중개사무소가 직접 올리는 소속공인중개사·중개보조원·실장 채용 공고. 지역과 직급, 급여 방식까지 확인하고 바로 연락하세요.',
}

const ROLES = ['전체', '소속공인중개사', '중개보조원', '실장', '기타'] as const

function relTime(iso: string) {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
  if (days <= 0) return '오늘'
  if (days < 7) return `${days}일 전`
  if (days < 30) return `${Math.floor(days / 7)}주 전`
  return `${Math.floor(days / 30)}달 전`
}

export default async function JobsPage({ searchParams }: { searchParams: Promise<{ role?: string }> }) {
  const { role } = await searchParams
  const activeRole = ROLES.includes(role as (typeof ROLES)[number]) ? role! : '전체'

  const supabase = await createClient()
  let q = supabase
    .from('job_posts')
    .select('id, office_name, title, job_role, pay_type, pay_detail, region, weekend_work, created_at')
    .eq('status', 'open')
    .order('created_at', { ascending: false })
    .limit(100)
  if (activeRole !== '전체') q = q.eq('job_role', activeRole)
  const { data: posts } = await q

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <Header />
      <main className="mx-auto max-w-3xl px-4 py-8">
        <div className="mb-6">
          <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900 dark:text-white">
            <Briefcase className="h-6 w-6 text-blue-600" /> 구인 게시판
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            인증된 중개사무소가 직접 올리는 채용 공고입니다. 마음에 드는 공고에 바로 전화하세요.
          </p>
        </div>

        <div className="mb-5 flex flex-wrap gap-2">
          {ROLES.map(r => (
            <Link key={r} href={r === '전체' ? '/jobs' : `/jobs?role=${encodeURIComponent(r)}`}
              className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                activeRole === r
                  ? 'bg-blue-600 text-white'
                  : 'border border-gray-200 bg-white text-gray-600 hover:bg-gray-100 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400'
              }`}>
              {r}
            </Link>
          ))}
        </div>

        {(!posts || posts.length === 0) ? (
          <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-10 text-center dark:border-gray-800 dark:bg-gray-900">
            <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">아직 올라온 공고가 없어요</p>
            <p className="mt-1 text-xs text-gray-500">사무소 대표님이라면 첫 공고를 올려보세요.</p>
            <Link href="/broker/jobs" className="mt-4 inline-block rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700">
              공고 등록하기
            </Link>
          </div>
        ) : (
          <ul className="space-y-3">
            {posts.map(p => (
              <li key={p.id}>
                <Link href={`/jobs/${p.id}`}
                  className="block rounded-2xl border border-gray-200 bg-white p-4 transition-colors hover:border-blue-300 dark:border-gray-800 dark:bg-gray-900 dark:hover:border-blue-800">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-gray-900 dark:text-white">{p.title}</p>
                      <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
                        <span className="inline-flex items-center gap-1">
                          <Building2 className="h-3.5 w-3.5" /> {p.office_name}
                          <BadgeCheck className="h-3.5 w-3.5 text-blue-500" />
                        </span>
                        <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" /> {p.region}</span>
                      </p>
                    </div>
                    <span className="flex-shrink-0 text-[11px] text-gray-400">{relTime(p.created_at)}</span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    <span className="rounded-md bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700 dark:bg-blue-950 dark:text-blue-300">{p.job_role}</span>
                    <span className="rounded-md bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                      {p.pay_type}{p.pay_detail ? ` · ${p.pay_detail}` : ''}
                    </span>
                    {p.weekend_work != null && (
                      <span className="rounded-md bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                        주말 {p.weekend_work ? '근무' : '휴무'}
                      </span>
                    )}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}

        <p className="mt-8 text-center text-xs text-gray-400">
          사무소 대표님이신가요?{' '}
          <Link href="/broker/jobs" className="font-semibold text-blue-600 hover:underline">공고 등록</Link>
          {' '}· 부소장이 처음이라면{' '}
          <Link href="/office-intro" className="font-semibold text-blue-600 hover:underline">사무소 소개 보기</Link>
        </p>
      </main>
    </div>
  )
}
