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

export default async function RequestDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
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

    const { data: req } = await supabase
      .from('request_posts')
      .select('*, profiles(*)')
      .eq('id', id)
      .single()
    request = req

    const { data: pr } = await supabase
      .from('proposals')
      .select('*, broker_profiles(*, profiles(*))')
      .eq('request_id', id)
      .order('created_at', { ascending: false })
    proposals = pr ?? []
  } catch {
    // 데이터 로드 실패 시 notFound()로 처리
  }

  if (!request) notFound()

  return (
    <RequestDetailClient
      request={request}
      proposals={proposals}
      user={user}
      userRole={userRole}
    />
  )
}
