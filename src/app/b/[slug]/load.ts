import { createClient as createServiceClient } from '@supabase/supabase-js'

/** 공유 미리보기(카톡·인스타)용 — 서버에서 예약 페이지 제목·안내만 읽는다. 없으면 null */
export async function loadBookingMeta(slug: string): Promise<{ title: string; intro: string | null } | null> {
  if (!/^[a-z0-9][a-z0-9-]{2,39}$/.test(slug)) return null
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  const supa = createServiceClient(url, key, { auth: { persistSession: false } })
  const { data } = await supa.from('office_booking_pages').select('title, intro').eq('slug', slug).eq('active', true).maybeSingle()
  return data ?? null
}
