import type { SupabaseClient } from '@supabase/supabase-js'
import { todayKST, hmKST, ymdKST } from '@/lib/date-kst'
import type { BoardRow } from '@/components/broker/pixel-office'

/**
 * 이사실에 앉는 사람(권세현 이사)의 broker_profiles.id.
 * 직급 칸이 따로 없어 여기서 정한다 — 다른 사무소에 팔 때는 사무소 설정으로 옮겨야 한다.
 */
export const DIRECTOR_ID = '6581efd5-6ec9-46ea-a391-7e6537cc6345'

/** ids — 이 줄에 묶인 사람(broker_profiles.id). 일지에서 직원에게 드래곤·자기 줄만 보여 줄 때 쓴다 */
export type OfficeBoardRow = BoardRow & { ids?: string[] }
export interface OfficeBoard { rows: OfficeBoardRow[]; total: OfficeBoardRow; at: string }

interface BoardMember { id: string; profiles: { name: string | null } | null }

/**
 * 현황판 — 사람마다 매물장(등록한 매물, 거래가능)·뱅크(등록매물 탭)·당근. 블로그·카페는 뺐다(2026-10-28 사장님).
 * 뱅크·당근은 뱅크의 '담당자' 이름(ad_listings.manager)으로 사람을 가른다. 매물장은 등록한 사람(broker_id).
 * 매물장은 1000줄 넘게 읽지 않도록 건수만 센다.
 * 가상사무실 상황실 칠판과 업무일지 3번 광고현황이 같은 숫자를 쓴다.
 */
export async function fetchOfficeBoard(supabase: SupabaseClient, officeId: string, members?: BoardMember[]): Promise<OfficeBoard> {
  if (!members) {
    const { data } = await supabase.from('broker_profiles')
      .select('id, is_approved, profiles:profiles_visible(name)')
      .or(`id.eq.${officeId},parent_broker_id.eq.${officeId}`)
    members = ((data as unknown as (BoardMember & { is_approved: boolean | null })[] | null) ?? [])
      .filter(m => m.id === officeId || m.is_approved)
      .sort((a, b) => (a.id === officeId ? -1 : b.id === officeId ? 1 : 0))
  }
  const 건수 = async (q: PromiseLike<{ count: number | null }>) => (await q).count ?? 0
  const 매물 = (id: string | null, avail: boolean) => {
    let q = supabase.from('broker_properties').select('id', { count: 'exact', head: true })
      .eq('office_broker_id', officeId).is('deleted_at', null)
    if (id) q = q.eq('broker_id', id)
    if (avail) q = q.eq('status', 'available')
    return 건수(q)
  }
  const [counts, total, totalAvail, ls, ps] = await Promise.all([
    Promise.all(members.map(async m => [m.id, await 매물(m.id, false), await 매물(m.id, true)] as const)),
    매물(null, false),
    매물(null, true),
    supabase.from('ad_listings').select('manager').eq('broker_id', officeId)
      // 광고관리 [등록매물] 탭·뱅크 화면과 같은 잣대. 상태(서비스중 등)로 세면 '수정실패' 처럼
      // 등록매물에 있는 매물이 빠져 광고관리와 한 건 어긋났다(2026-10-29)
      .eq('bank_tab', '등록매물'),
    supabase.from('ad_posts').select('posted_at, ad_listings!inner(manager, broker_id)')
      .eq('ad_listings.broker_id', officeId).eq('status', 'posted').eq('channel', 'daangn'),
  ])
  const todayYmd = todayKST()
  const empty = (name: string): OfficeBoardRow => ({ name, props: 0, avail: 0, bank: 0, daangn: 0, daangnToday: 0 })
  const byName: Record<string, OfficeBoardRow> = {}
  // 대표·이사는 한 줄 '드래곤'으로 합친다(2026-10-28 사장님) — 같은 줄을 두 이름이 가리킨다
  const 줄이름 = (m: BoardMember) => (m.id === officeId || m.id === DIRECTOR_ID ? '드래곤' : m.profiles?.name ?? '이름 없음')
  const rows: OfficeBoardRow[] = []
  for (const m of members) {
    const c = counts.find(x => x[0] === m.id)!
    const r = rows.find(x => x.name === 줄이름(m)) ?? rows[rows.push(empty(줄이름(m))) - 1]
    r.ids = [...(r.ids ?? []), m.id]
    r.props += c[1]
    r.avail += c[2]
    byName[m.profiles?.name ?? m.id] = r
  }
  const sum = { ...empty('사무실 전체'), props: total, avail: totalAvail }
  for (const l of (ls.data ?? []) as { manager: string | null }[]) {
    sum.bank++
    const r = l.manager && byName[l.manager]
    if (r) r.bank++
  }
  for (const p of (ps.data ?? []) as unknown as { posted_at: string | null; ad_listings: { manager: string | null } }[]) {
    const r = p.ad_listings.manager ? byName[p.ad_listings.manager] : undefined
    for (const t of [sum, r]) {
      if (!t) continue
      t.daangn++
      if (p.posted_at && ymdKST(p.posted_at) === todayYmd) t.daangnToday++
    }
  }
  return { rows: rows.filter(r => r.props + r.bank + r.daangn > 0), total: sum, at: hmKST(new Date().toISOString()) }
}
