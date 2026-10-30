import type { SupabaseClient } from '@supabase/supabase-js'
import { todayKST, hmKST, ymdKST } from '@/lib/date-kst'
import type { BoardRow } from '@/components/broker/pixel-office'

/**
 * 이사실에 앉는 사람(권세현 이사)의 broker_profiles.id.
 * 직급 칸이 따로 없어 여기서 정한다 — 다른 사무소에 팔 때는 사무소 설정으로 옮겨야 한다.
 */
export const DIRECTOR_ID = '6581efd5-6ec9-46ea-a391-7e6537cc6345'

/**
 * ids — 이 줄에 묶인 사람(broker_profiles.id). 일지에서 직원에게 드래곤·자기 줄만 보여 줄 때 쓴다.
 * 오늘 등록 수(propsToday)는 BoardRow 에 있다 — 칠판과 일지 표 둘 다 매물장 옆 '+n'(2026-10-29 사장님).
 */
export type OfficeBoardRow = BoardRow & { ids?: string[] }
/** byId — 사람(broker_profiles.id)마다 등록한 매물 전체 수. 사무실 책상이 따로 세지 않게 같이 돌려준다 */
export interface OfficeBoard { rows: OfficeBoardRow[]; total: OfficeBoardRow; at: string; byId?: Record<string, number> }

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
  const todayYmd = todayKST()
  const [counts, total, totalAvail, ls, ps, newProps] = await Promise.all([
    // 사람마다 '전체'·'거래가능' 을 차례로 물으면 왕복이 두 번 쌓인다(느린 폰 회선에서 약 2초) — 함께 보낸다
    Promise.all(members.map(async m => [m.id, ...await Promise.all([매물(m.id, false), 매물(m.id, true)])] as const)),
    매물(null, false),
    매물(null, true),
    supabase.from('ad_listings').select('manager, bank_period').eq('broker_id', officeId)
      // 광고관리 [등록매물] 탭·뱅크 화면과 같은 잣대. 상태(서비스중 등)로 세면 '수정실패' 처럼
      // 등록매물에 있는 매물이 빠져 광고관리와 한 건 어긋났다(2026-10-29)
      .eq('bank_tab', '등록매물'),
    supabase.from('ad_posts').select('posted_at, ad_listings!inner(manager, broker_id)')
      .eq('ad_listings.broker_id', officeId).eq('status', 'posted').eq('channel', 'daangn'),
    // 오늘 등록한 매물 — 하루치라 줄을 읽어 사람마다 나눈다
    supabase.from('broker_properties').select('broker_id')
      .eq('office_broker_id', officeId).is('deleted_at', null)
      .gte('created_at', new Date(`${todayYmd}T00:00:00+09:00`).toISOString()).limit(1000),
  ])
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
  const sum: OfficeBoardRow = { ...empty('사무실 전체'), props: total, avail: totalAvail, propsToday: 0 }
  for (const p of (newProps.data ?? []) as { broker_id: string }[]) {
    sum.propsToday!++
    const r = rows.find(x => x.ids?.includes(p.broker_id))
    if (r) r.propsToday = (r.propsToday ?? 0) + 1
  }
  // 뱅크 오늘 등록 — 등록기간('26.10.30 ~26.11.29')이 오늘 시작한 것(재등록 포함). 사무실 화면 영업부 말풍선과 같은 잣대(2026-10-30)
  const 오늘뱅크 = todayYmd.slice(2).replace(/-/g, '.')
  for (const l of (ls.data ?? []) as { manager: string | null; bank_period: string | null }[]) {
    const r = l.manager ? byName[l.manager] : undefined
    for (const t of [sum, r]) {
      if (!t) continue
      t.bank++
      if (l.bank_period?.startsWith(오늘뱅크)) t.bankToday = (t.bankToday ?? 0) + 1
    }
  }
  for (const p of (ps.data ?? []) as unknown as { posted_at: string | null; ad_listings: { manager: string | null } }[]) {
    const r = p.ad_listings.manager ? byName[p.ad_listings.manager] : undefined
    for (const t of [sum, r]) {
      if (!t) continue
      t.daangn++
      if (p.posted_at && ymdKST(p.posted_at) === todayYmd) t.daangnToday++
    }
  }
  // 줄 순서 — 드래곤 맨 위, 나머지는 매물장 많은 순(2026-10-29 사장님)
  const shown = rows.filter(r => r.props + r.bank + r.daangn > 0)
    .sort((a, b) => Number(b.name === '드래곤') - Number(a.name === '드래곤') || b.props - a.props)
  // 뱅크 '담당자' 가 비었거나 직원 명단에 없는 이름이면 전체에만 세지고 어느 줄에도 안 들어가,
  // 줄을 더해도 전체와 안 맞았다(당근 238 vs 243, 10-30 점검). 그 몫을 한 줄로 보여 준다.
  const rest = empty('없음')
  rest.bank = sum.bank - rows.reduce((s, r) => s + r.bank, 0)
  rest.daangn = sum.daangn - rows.reduce((s, r) => s + r.daangn, 0)
  rest.daangnToday = sum.daangnToday - rows.reduce((s, r) => s + r.daangnToday, 0)
  if (rest.bank > 0 || rest.daangn > 0) shown.push(rest)
  return { rows: shown, total: sum, at: hmKST(new Date().toISOString()), byId: Object.fromEntries(counts.map(c => [c[0], c[1]])) }
}
