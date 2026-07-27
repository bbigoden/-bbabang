import type { Metadata } from 'next'
import type { User } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { RequestDetailClient } from './request-detail-client'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const supabase = await createClient()
  const { data } = await supabase
    .from('request_posts')
    .select('city, district, dong, deal_type, room_type, min_price, max_price')
    .eq('id', id)
    .maybeSingle()
  if (!data) return { title: '요청' }
  const region = [data.city, data.district, data.dong].filter(Boolean).join(' ')
  // 루트 layout의 '%s | 빠방' 템플릿이 접미사를 붙이므로 여기선 안 붙임
  const title = `${region} ${data.deal_type ?? ''} ${data.room_type ?? ''} 요청`.replace(/\s+/g, ' ').trim()
  const priceRange = data.min_price && data.max_price ? ` (${data.min_price}~${data.max_price}만원)` : ''
  const description = `${region} ${data.room_type ?? ''} ${data.deal_type ?? ''}${priceRange} — 공인중개사 제안을 받아보세요.`
  return {
    title,
    description,
    alternates: { canonical: `/request/${id}` },
    openGraph: { title, description, url: `/request/${id}` },
  }
}

export default async function RequestDetailPage({ params, searchParams }: { params: Promise<{ id: string }>, searchParams: Promise<{ p?: string }> }) {
  const { id } = await params
  const { p } = await searchParams
  const supabase = await createClient()

  let user: User | null = null
  let userRole: string | null = null
  let request: any = null
  let proposals: any[] = []

  try {
    const { data } = await supabase.auth.getUser()
    user = data.user
  } catch { /* 비로그인 */ }

  try {
    if (user) {
      const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
      userRole = profile?.role ?? null
    }

    // profiles 본체는 컬럼 GRANT로 막혀 있어(email/phone 등) `profiles(*)` 임베딩이
    // 42501로 전체 쿼리를 실패시킴 → 관계 기반 게이팅 뷰 profiles_visible로 읽어야 한다.
    // (bbabang_profiles_visible_pattern — chat/[proposalId]와 동일 패턴)
    // 단 이 페이지는 SEO용 공개 페이지라 비로그인도 들어온다. profiles_visible은
    // can_notify_user()에 의존하는데 anon에는 EXECUTE가 없어 임베딩을 붙이면 쿼리 전체가
    // 42501로 죽고 → request=null → notFound()로 빠진다. 비로그인엔 요청자 정보가
    // 애초에 필요 없으므로 임베딩 없이 본문만 읽는다.
    const { data: req, error: reqErr } = await supabase
      .from('request_posts')
      .select(user ? '*, profiles:profiles_visible(*)' : '*')
      .eq('id', id)
      .single()
    if (reqErr) console.error('[request-detail] 요청 조회 실패', { id, hasUser: !!user, err: reqErr })
    request = req

    // 제안 목록도 broker_profiles가 anon GRANT 대상이 아니라 비로그인에선 조회되지 않는다.
    // 비로그인에게 제안 상세를 노출할 이유도 없으므로 로그인 사용자에게만 읽는다.
    if (user) {
      const { data: pr } = await supabase
        .from('proposals')
        .select('*, broker_profiles(*, profiles:profiles_visible(*))')
        .eq('request_id', id)
        .order('created_at', { ascending: false })
      proposals = pr ?? []
    }
  } catch {
    // 데이터 로드 실패 시 notFound()로 처리
  }

  if (!request) notFound()

  // ?p=<proposalId> 로 들어오면 해당 제안의 대화를 바로 열어줌 (받은 제안·알림에서 진입)
  const initialSelectedId = p && proposals.some((pr: any) => pr.id === p) ? p : null

  return (
    <RequestDetailClient
      request={request}
      proposals={proposals}
      user={user}
      userRole={userRole}
      initialSelectedId={initialSelectedId}
    />
  )
}
