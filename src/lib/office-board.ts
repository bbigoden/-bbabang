import type { SupabaseClient } from '@supabase/supabase-js'
import { todayKST, hmKST, ymdKST } from '@/lib/date-kst'
import { fetchAllPaged } from '@/lib/fetch-all-paged'
import { getOfficeMembers } from '@/lib/office-members'
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
// 같은 사무소 현황판을 몇 초 안에 또 세지 않는다 — 업무일지는 화면이 뜨며 현황판 칸이 한 번 더 그려져
// 같은 숫자를 동시에 두 번 셌다(2026-11-05). 5초 안의 다시 묻기는 앞의 것을 같이 쓴다.
const boardRecent = new Map<string, { at: number; p: Promise<OfficeBoard> }>()
const BOARD_REUSE_MS = 5000
/** office_board_counts 가 담당자별 광고 수(kind)까지 주는 새 함수인지 — 한 번 확인되면 브라우저 셈을 건너뛴다 */
let rpcHasAdCounts = false

export function fetchOfficeBoard(supabase: SupabaseClient, officeId: string, members?: BoardMember[]): Promise<OfficeBoard> {
  const hit = boardRecent.get(officeId)
  if (hit && Date.now() - hit.at < BOARD_REUSE_MS) return hit.p
  const p = countOfficeBoard(supabase, officeId, members)
  boardRecent.set(officeId, { at: Date.now(), p })
  p.catch(() => boardRecent.delete(officeId))
  return p
}

async function countOfficeBoard(supabase: SupabaseClient, officeId: string, members?: BoardMember[]): Promise<OfficeBoard> {
  // 사무소 사람 목록은 화면끼리 같이 쓴다(office-members, 대표가 맨 앞)
  const membersP = members ? Promise.resolve(members) : getOfficeMembers(officeId).then(
    ms => ms.filter(m => m.approved).map(m => ({ id: m.id, profiles: { name: m.name } }) as BoardMember), () => [] as BoardMember[])
  const todayYmd = todayKST()
  // 사람마다 전체·거래가능·오늘 등록 수를 한 번에 센다(office_board_counts). 예전엔 사람마다 2번 + 전체 3번
  // 따로 물어 직원 7명이면 17번 — 폰에서 사무실 화면이 3초 넘게 걸렸다(2026-11-05)
  // 2026-11-06 부터 담당자마다 뱅크·당근 수도 같이 센다(kind 칸, supabase/migrations/office_board_counts_ads_20261106.sql).
  // 예전엔 당근 게시중 광고를 날짜 없이 전부 받아 브라우저에서 셌다.
  // DB 함수가 아직 옛것이면 브라우저 셈이 필요하다. 처음엔 둘을 함께 보내(예전과 같은 왕복) 새 함수인 걸
  // 한 번 확인하면 그다음부터는 브라우저 셈을 보내지 않는다 — 줄 세우면 한 왕복이 더 늦었다.
  const 브라우저셈 = rpcHasAdCounts ? null : countAdsInBrowser(supabase, officeId, todayYmd)
  const [cnt, ms] = await Promise.all([supabase.rpc('office_board_counts', { p_office: officeId }), membersP])
  members = ms
  const 받은 = (cnt.data ?? []) as CountRow[]
  const 새함수 = 받은.some(c => 'kind' in c)
  if (새함수) rpcHasAdCounts = true
  const byBroker = new Map(받은.filter(c => !새함수 || c.kind === 'broker').map(c => [c.broker_id!, c]))
  const 담당별 = 새함수
    ? 받은.filter(c => c.kind === 'manager').map(c => ({
      manager: c.manager ?? null, bank: c.bank ?? 0, bankToday: c.bank_today ?? 0, daangn: c.daangn ?? 0, daangnToday: c.daangn_today ?? 0,
    }))
    : await (브라우저셈 ?? countAdsInBrowser(supabase, officeId, todayYmd))
  const counts = members.map(m => [m.id, byBroker.get(m.id)?.total ?? 0, byBroker.get(m.id)?.avail ?? 0] as const)
  let total = 0, totalAvail = 0, totalToday = 0
  for (const c of byBroker.values()) { total += c.total ?? 0; totalAvail += c.avail ?? 0; totalToday += c.today ?? 0 }
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
  const sum: OfficeBoardRow = { ...empty('사무실 전체'), props: total, avail: totalAvail, propsToday: totalToday }
  for (const [id, c] of byBroker) {
    if (!c.today) continue
    const r = rows.find(x => x.ids?.includes(id))
    if (r) r.propsToday = (r.propsToday ?? 0) + (c.today ?? 0)
  }
  // 담당자 이름으로 줄을 찾아 더한다. 빈 담당자·명단에 없는 이름은 전체에만 들어간다(아래 '없음' 줄)
  for (const a of 담당별) {
    const r = a.manager ? byName[a.manager] : undefined
    for (const t of [sum, r]) {
      if (!t) continue
      t.bank += a.bank
      if (a.bankToday) t.bankToday = (t.bankToday ?? 0) + a.bankToday
      t.daangn += a.daangn
      t.daangnToday += a.daangnToday
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

/** office_board_counts 한 줄. kind 가 없으면 아직 적용 전 함수(broker 줄만 온다) */
interface CountRow {
  kind?: 'broker' | 'manager'
  broker_id: string | null
  manager?: string | null
  total: number | null; avail: number | null; today: number | null
  bank?: number | null; bank_today?: number | null; daangn?: number | null; daangn_today?: number | null
}
interface ManagerAds { manager: string | null; bank: number; bankToday: number; daangn: number; daangnToday: number }

/**
 * office_board_counts 가 뱅크·당근을 아직 안 세 줄 때(마이그레이션 적용 전) 브라우저에서 센다.
 * 1,000줄을 넘으면 PostgREST 가 말없이 잘라 숫자가 틀려진다 — 페이지를 이어 받는다(2026-11-06 점검).
 * 마이그레이션이 적용되면 안 불린다 — 그때 지워도 된다.
 */
async function countAdsInBrowser(supabase: SupabaseClient, officeId: string, todayYmd: string): Promise<ManagerAds[]> {
  const [ls, ps] = await Promise.all([
    fetchAllPaged((from, to) => supabase.from('ad_listings').select('manager, bank_period').eq('broker_id', officeId)
      // 광고관리 [등록매물] 탭·뱅크 화면과 같은 잣대. 상태(서비스중 등)로 세면 '수정실패' 처럼
      // 등록매물에 있는 매물이 빠져 광고관리와 한 건 어긋났다(2026-10-29)
      .eq('bank_tab', '등록매물').order('id').range(from, to)).catch(() => []),
    fetchAllPaged((from, to) => supabase.from('ad_posts').select('posted_at, ad_listings!inner(manager, broker_id)')
      .eq('ad_listings.broker_id', officeId).eq('status', 'posted').eq('channel', 'daangn').order('id').range(from, to))
      .catch(() => []),
  ])
  const by = new Map<string | null, ManagerAds>()
  const at = (m: string | null) => by.get(m) ?? by.set(m, { manager: m, bank: 0, bankToday: 0, daangn: 0, daangnToday: 0 }).get(m)!
  // 뱅크 오늘 등록 — 등록기간('26.10.30 ~26.11.29')이 오늘 시작한 것(재등록 포함). 사무실 화면 영업부 말풍선과 같은 잣대(2026-10-30)
  const 오늘뱅크 = todayYmd.slice(2).replace(/-/g, '.')
  for (const l of ls as { manager: string | null; bank_period: string | null }[]) {
    const a = at(l.manager)
    a.bank++
    if (l.bank_period?.startsWith(오늘뱅크)) a.bankToday++
  }
  for (const p of ps as unknown as { posted_at: string | null; ad_listings: { manager: string | null } }[]) {
    const a = at(p.ad_listings.manager)
    a.daangn++
    if (p.posted_at && ymdKST(p.posted_at) === todayYmd) a.daangnToday++
  }
  return [...by.values()]
}
