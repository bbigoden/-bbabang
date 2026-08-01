'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Briefcase, Plus, ExternalLink, BadgeCheck } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/lib/auth-context'
import { useToast } from '@/components/toast'

// 사무소용 구인 공고 관리 — 등록·마감·재게시·삭제는 대표(is_owner)만, 등록은 인증 사무소만(RLS 강제)
interface JobPost {
  id: string
  title: string
  job_role: string
  pay_type: string
  pay_detail: string | null
  region: string
  weekend_work: boolean | null
  description: string
  contact_phone: string
  status: 'open' | 'closed'
  created_at: string
}

const ROLES = ['중개보조원', '소속공인중개사', '실장', '기타']
const PAY_TYPES = ['협의', '기본급', '비율제', '기본급+비율제']

const EMPTY_FORM = {
  title: '', job_role: '중개보조원', pay_type: '협의', pay_detail: '',
  region: '', weekend_work: '' as '' | 'true' | 'false', description: '', contact_phone: '',
}

export default function BrokerJobsPage() {
  const { broker, loading } = useAuth()
  const toast = useToast()
  const supabase = createClient()

  const [posts, setPosts] = useState<JobPost[]>([])
  const [fetched, setFetched] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)

  const isOwner = broker?.is_owner !== false
  const officeId = broker?.parent_broker_id ?? broker?.id ?? null

  const load = useCallback(async () => {
    if (!officeId) return
    const { data } = await supabase
      .from('job_posts')
      .select('*')
      .eq('office_broker_id', officeId)
      .order('created_at', { ascending: false })
    setPosts((data ?? []) as JobPost[])
    setFetched(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [officeId])

  useEffect(() => { load() }, [load])

  const submit = async () => {
    if (!broker) return
    if (form.title.trim().length < 2) return toast.error('제목을 2자 이상 입력해주세요')
    if (form.region.trim().length < 2) return toast.error('근무 지역을 입력해주세요 (예: 천안시 서북구)')
    if (form.contact_phone.trim().length < 8) return toast.error('연락처를 입력해주세요')
    if (form.description.trim().length < 10) return toast.error('상세 내용을 10자 이상 적어주세요')

    setSaving(true)
    const { error } = await supabase.from('job_posts').insert({
      office_broker_id: broker.id,
      office_name: broker.office_name ?? '중개사무소',
      title: form.title.trim(),
      job_role: form.job_role,
      pay_type: form.pay_type,
      pay_detail: form.pay_detail.trim() || null,
      region: form.region.trim(),
      weekend_work: form.weekend_work === '' ? null : form.weekend_work === 'true',
      description: form.description.trim(),
      contact_phone: form.contact_phone.trim(),
    })
    setSaving(false)
    if (error) {
      // RLS 위반(42501) = 미인증·비대표 — 안내 문구로 변환
      toast.error(error.code === '42501'
        ? '공고 등록은 인증 완료된 사무소의 대표 계정만 가능해요'
        : `등록 실패: ${error.message}`)
      return
    }
    toast.success('공고가 게시됐어요')
    setForm(EMPTY_FORM)
    setShowForm(false)
    load()
  }

  const toggleStatus = async (post: JobPost) => {
    const next = post.status === 'open' ? 'closed' : 'open'
    const { error } = await supabase.from('job_posts')
      .update({ status: next, updated_at: new Date().toISOString() })
      .eq('id', post.id)
    if (error) return toast.error(`변경 실패: ${error.message}`)
    toast.success(next === 'closed' ? '공고를 마감했어요' : '공고를 다시 게시했어요')
    load()
  }

  const remove = async (post: JobPost) => {
    if (!confirm(`'${post.title}' 공고를 삭제할까요?`)) return
    const { error } = await supabase.from('job_posts').delete().eq('id', post.id)
    if (error) return toast.error(`삭제 실패: ${error.message}`)
    toast.success('삭제했어요')
    load()
  }

  if (loading) return null

  if (!broker || !isOwner) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-12 text-center">
        <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">구인 공고 관리는 사무소 대표 계정에서만 가능해요</p>
        <Link href="/jobs" className="mt-3 inline-block text-xs font-semibold text-blue-600 hover:underline">공개 게시판 보러 가기</Link>
      </div>
    )
  }

  const inputCls = 'w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none dark:border-gray-800 dark:bg-gray-950 dark:text-white'

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <div className="mb-5 flex items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-gray-900 dark:text-white">
            <Briefcase className="h-5 w-5 text-blue-600" /> 구인 공고
          </h1>
          <p className="mt-0.5 text-xs text-gray-500">
            공고는 <Link href="/jobs" className="font-semibold text-blue-600 hover:underline">공개 게시판</Link>에 사무소명과 함께 노출됩니다
          </p>
        </div>
        <button onClick={() => setShowForm(v => !v)}
          className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-bold text-white transition-colors hover:bg-blue-700">
          <Plus className="h-4 w-4" /> 새 공고
        </button>
      </div>

      {broker.is_verified === false && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
          사무소 인증이 완료되면 공고를 올릴 수 있어요. 설정 → 사무소에서 인증 상태를 확인해주세요.
        </div>
      )}

      {showForm && (
        <div className="mb-6 space-y-3 rounded-2xl border border-blue-200 bg-white p-4 dark:border-blue-900 dark:bg-gray-900">
          <input className={inputCls} placeholder="공고 제목 (예: 원룸·투룸 전담 중개보조원 모집)" maxLength={100}
            value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold text-gray-500">모집 직급</span>
              <select className={inputCls} value={form.job_role} onChange={e => setForm(f => ({ ...f, job_role: e.target.value }))}>
                {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold text-gray-500">급여 방식</span>
              <select className={inputCls} value={form.pay_type} onChange={e => setForm(f => ({ ...f, pay_type: e.target.value }))}>
                {PAY_TYPES.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </label>
          </div>
          <input className={inputCls} placeholder="급여 상세 (선택, 예: 기본급 150 + 매출 40%)" maxLength={200}
            value={form.pay_detail} onChange={e => setForm(f => ({ ...f, pay_detail: e.target.value }))} />
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold text-gray-500">근무 지역</span>
              <input className={inputCls} placeholder="예: 천안시 서북구" maxLength={60}
                value={form.region} onChange={e => setForm(f => ({ ...f, region: e.target.value }))} />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold text-gray-500">주말 근무</span>
              <select className={inputCls} value={form.weekend_work}
                onChange={e => setForm(f => ({ ...f, weekend_work: e.target.value as typeof f.weekend_work }))}>
                <option value="">협의</option>
                <option value="true">있음</option>
                <option value="false">없음</option>
              </select>
            </label>
          </div>
          <input className={inputCls} placeholder="지원 연락처 (예: 041-000-0000)" maxLength={20}
            value={form.contact_phone} onChange={e => setForm(f => ({ ...f, contact_phone: e.target.value }))} />
          <textarea className={`${inputCls} min-h-28 resize-y`} maxLength={4000}
            placeholder="업무 내용, 근무 시간, 우대 사항 등을 자유롭게 적어주세요"
            value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
          <div className="flex gap-2">
            <button onClick={submit} disabled={saving}
              className="flex-1 rounded-lg bg-blue-600 py-2 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-50">
              {saving ? '게시 중...' : '게시하기'}
            </button>
            <button onClick={() => setShowForm(false)}
              className="rounded-lg border border-gray-200 px-4 text-xs font-semibold text-gray-600 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-400 dark:hover:bg-gray-800">
              취소
            </button>
          </div>
        </div>
      )}

      {fetched && posts.length === 0 && !showForm && (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-10 text-center dark:border-gray-800 dark:bg-gray-900">
          <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">아직 올린 공고가 없어요</p>
          <p className="mt-1 text-xs text-gray-500">첫 공고를 올리면 공개 게시판에 사무소 인증 배지와 함께 노출됩니다</p>
        </div>
      )}

      <ul className="space-y-3">
        {posts.map(p => (
          <li key={p.id} className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-sm font-bold text-gray-900 dark:text-white">
                  <span className="truncate">{p.title}</span>
                  {p.status === 'open'
                    ? <span className="flex-shrink-0 rounded-md bg-green-100 px-1.5 py-0.5 text-[10px] font-bold text-green-700 dark:bg-green-950 dark:text-green-400">게시 중</span>
                    : <span className="flex-shrink-0 rounded-md bg-gray-100 px-1.5 py-0.5 text-[10px] font-bold text-gray-500 dark:bg-gray-800">마감</span>}
                </p>
                <p className="mt-1 text-xs text-gray-500">
                  {p.job_role} · {p.pay_type}{p.pay_detail ? ` (${p.pay_detail})` : ''} · {p.region}
                </p>
              </div>
              {p.status === 'open' && (
                <Link href={`/jobs/${p.id}`} target="_blank" className="flex-shrink-0 text-gray-400 hover:text-blue-600" aria-label="공개 페이지 열기">
                  <ExternalLink className="h-4 w-4" />
                </Link>
              )}
            </div>
            <div className="mt-3 flex gap-2">
              <button onClick={() => toggleStatus(p)}
                className="rounded-lg border border-gray-200 px-3 py-1.5 text-[11px] font-semibold text-gray-600 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-400 dark:hover:bg-gray-800">
                {p.status === 'open' ? '마감하기' : '다시 게시'}
              </button>
              <button onClick={() => remove(p)}
                className="rounded-lg border border-red-200 px-3 py-1.5 text-[11px] font-semibold text-red-600 hover:bg-red-50 dark:border-red-900 dark:hover:bg-red-950">
                삭제
              </button>
            </div>
          </li>
        ))}
      </ul>

      <p className="mt-8 flex items-center justify-center gap-1 text-center text-[11px] text-gray-400">
        <BadgeCheck className="h-3.5 w-3.5 text-blue-500" /> 공고에는 인증 사무소 배지가 함께 표시됩니다
      </p>
    </div>
  )
}
