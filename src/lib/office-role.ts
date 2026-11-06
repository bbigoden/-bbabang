import type { BidCompany } from '@/lib/bid-notices'
/**
 * 사무소 안 등급 — 대표 / 이사 / 직원.
 *
 * 이사는 대표가 설정 › 직원에서 고른다(broker_profiles.permissions.grade = 'director').
 * 2026-11-05 사장님: "이사도 대표와 같은 권한" — 보기·고치기·지우기·일지·자료실·휴지통·입찰·정산은
 * 대표와 같다. 직원 승인·등급 바꾸기·사무소 정보·사무소 코드만 대표에게 남는다.
 * DB 도 같은 규칙(supabase/migrations/director_same_as_owner.sql).
 *
 * 주의: '사무소 id' 는 등급과 따로 구한다. 이사의 사무소는 자기 id 가 아니라 parent_broker_id 다.
 */
type B = {
  id?: string
  is_owner?: boolean | null
  is_approved?: boolean | null
  parent_broker_id?: string | null
  permissions?: Record<string, unknown> | null
} | null | undefined

/** 대표 본인 (사무소를 만든 계정) */
export const isOfficeOwner = (b: B) => !!b && b.is_owner !== false

/** 승인된 이사 */
export const isDirector = (b: B) =>
  !!b && b.is_owner === false && !!b.parent_broker_id && b.is_approved === true
  && b.permissions?.grade === 'director'

/** 대표 권한으로 움직이는 사람 — 대표 또는 이사 */
export const canManageOffice = (b: B) => isOfficeOwner(b) || isDirector(b)

/**
 * 입찰 설정 — 대표 계정에 있다. 이사는 auth-context 가 붙여 둔 office_bid(대표 설정)를 본다.
 * 법인마다 면허·주력분야·소재지가 따로다(bid_companies, 2026-11-06 한결이엔씨·아천환경개발).
 * 그 칸이 비면 예전 한 법인 설정(bid_fields·bid_region, 면허 4992)으로 본다.
 * 지역·분야를 바꾸는 건 대표만(대표 계정 행을 고치는 일이라).
 */
type BidRow = { bid_enabled?: unknown; bid_region?: unknown; bid_fields?: unknown; bid_companies?: unknown }
export function bidOf(b: (NonNullable<B> & BidRow & { office_bid?: unknown }) | null | undefined) {
  if (!b) return { enabled: false, companies: [] as BidCompany[], editable: false }
  const own = isOfficeOwner(b)
  const o: BidRow | undefined = own ? b : isDirector(b) ? (b.office_bid as BidRow | undefined) : undefined
  return { enabled: !!o?.bid_enabled, companies: o ? companiesOf(o) : [], editable: own }
}

function companiesOf(o: BidRow): BidCompany[] {
  const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
  const region = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
  if (Array.isArray(o.bid_companies) && o.bid_companies.length) {
    return o.bid_companies.map((c: Record<string, unknown>) => ({
      name: typeof c.name === 'string' ? c.name : '우리 업체', lics: strs(c.lics), fields: strs(c.fields), region: region(c.region),
    }))
  }
  return [{ name: '우리 업체', lics: ['4992'], fields: strs(o.bid_fields), region: region(o.bid_region) }]
}
