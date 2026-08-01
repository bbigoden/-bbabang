import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Header } from '@/components/layout/header'
import { createClient } from '@/lib/supabase/server'
import { Building2, MapPin, BadgeCheck, Phone, ArrowLeft } from 'lucide-react'

// 구인 공고 상세 — 마감(closed) 공고는 RLS에서 비노출 → notFound
type Props = { params: Promise<{ id: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params
  const supabase = await createClient()
  const { data } = await supabase
    .from('job_posts')
    .select('title, office_name, region, job_role')
    .eq('id', id)
    .maybeSingle()
  if (!data) return { title: '구인 공고' }
  return {
    title: `${data.title} — ${data.office_name}`,
    description: `${data.region} ${data.job_role} 채용 · 인증 중개사무소 ${data.office_name}의 구인 공고`,
  }
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })
}

export default async function JobDetailPage({ params }: Props) {
  const { id } = await params
  const supabase = await createClient()
  const { data: post } = await supabase
    .from('job_posts')
    .select('*')
    .eq('id', id)
    .eq('status', 'open')
    .maybeSingle()
  if (!post) notFound()

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <Header />
      <main className="mx-auto max-w-3xl px-4 py-8">
        <Link href="/jobs" className="mb-4 inline-flex items-center gap-1 text-xs font-semibold text-gray-500 hover:text-blue-600">
          <ArrowLeft className="h-3.5 w-3.5" /> 구인 게시판
        </Link>

        <article className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">{post.title}</h1>
          <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-500">
            <span className="inline-flex items-center gap-1">
              <Building2 className="h-4 w-4" /> {post.office_name}
              <BadgeCheck className="h-4 w-4 text-blue-500" aria-label="인증 사무소" />
            </span>
            <span className="inline-flex items-center gap-1"><MapPin className="h-4 w-4" /> {post.region}</span>
            <span className="text-xs text-gray-400">{fmtDate(post.created_at)} 등록</span>
          </p>

          <dl className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="rounded-xl bg-gray-50 p-3 dark:bg-gray-950">
              <dt className="text-[11px] font-semibold text-gray-400">모집 직급</dt>
              <dd className="mt-0.5 text-sm font-bold text-gray-900 dark:text-white">{post.job_role}</dd>
            </div>
            <div className="rounded-xl bg-gray-50 p-3 dark:bg-gray-950">
              <dt className="text-[11px] font-semibold text-gray-400">급여 방식</dt>
              <dd className="mt-0.5 text-sm font-bold text-gray-900 dark:text-white">
                {post.pay_type}
                {post.pay_detail && <span className="block text-xs font-medium text-gray-500">{post.pay_detail}</span>}
              </dd>
            </div>
            <div className="rounded-xl bg-gray-50 p-3 dark:bg-gray-950">
              <dt className="text-[11px] font-semibold text-gray-400">주말 근무</dt>
              <dd className="mt-0.5 text-sm font-bold text-gray-900 dark:text-white">
                {post.weekend_work == null ? '협의' : post.weekend_work ? '있음' : '없음'}
              </dd>
            </div>
          </dl>

          <div className="mt-5 whitespace-pre-wrap text-sm leading-relaxed text-gray-700 dark:text-gray-300">
            {post.description}
          </div>

          <a href={`tel:${post.contact_phone}`}
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-3 text-sm font-bold text-white transition-colors hover:bg-blue-700">
            <Phone className="h-4 w-4" /> 전화 문의 {post.contact_phone}
          </a>
          <p className="mt-2 text-center text-[11px] text-gray-400">
            부소장은 공고 게시만 제공하며, 채용 과정에는 관여하지 않습니다.
          </p>
        </article>
      </main>
    </div>
  )
}
