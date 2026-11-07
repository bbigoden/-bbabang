'use client'

import { createClient } from '@/lib/supabase/client'

// 사무소 사람 목록(대표 + 직원). 고객·일지·매물·자료실·현황판이 화면마다 따로 받아,
// 화면을 옮길 때마다 같은 왕복이 한 번씩 더 났다. 같은 사무소는 1분 동안 한 번만 받는다.
// 이름은 profiles_visible 로 읽는다 — 직원이 다른 직원 이름을 볼 때 profiles 는 RLS 에 막힐 수 있다.

export interface OfficeMember {
  id: string
  name: string | null
  isOwner: boolean
  /** 대표이거나 승인된 직원 */
  approved: boolean
}

const FRESH_MS = 60_000
const cache = new Map<string, { at: number; value: Promise<OfficeMember[]> }>()

export function getOfficeMembers(officeId: string): Promise<OfficeMember[]> {
  const hit = cache.get(officeId)
  if (hit && Date.now() - hit.at < FRESH_MS) return hit.value
  const value = (async () => {
    const { data, error } = await createClient().from('broker_profiles')
      .select('id, is_approved, profiles:profiles_visible(name)')
      .or(`id.eq.${officeId},parent_broker_id.eq.${officeId}`)
      // 사람 순서는 어디서나 가입일시(11-07 사장님) — 대표가 가장 먼저 가입해 맨 앞에 온다
      .order('created_at', { ascending: true })
    if (error) throw error
    return ((data ?? []) as unknown as { id: string; is_approved: boolean | null; profiles: { name: string | null } | null }[])
      .map(r => ({ id: r.id, name: r.profiles?.name ?? null, isOwner: r.id === officeId, approved: r.id === officeId || r.is_approved === true }))
  })()
  value.catch(() => cache.delete(officeId))
  cache.set(officeId, { at: Date.now(), value })
  return value
}
