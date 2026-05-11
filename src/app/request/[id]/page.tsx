import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { RequestDetailClient } from './request-detail-client'

export default async function RequestDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  let user: any = null
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
  } catch (e: any) {
    if (e?.digest?.startsWith('NEXT_REDIRECT')) throw e
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
