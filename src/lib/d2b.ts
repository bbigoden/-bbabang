/**
 * 국방전자조달(D2B) 시설공사 — 방위사업청 공공데이터 API.
 *
 * 국방부·각 군 부대 공사는 나라장터가 아니라 D2B 에 올라와 나라장터 API 에 없다(제이비드에서 본 계룡대·문경 공사).
 * 2026년 방위사업청이 'GW' API 로 시설공사 공고·결과·참가업체·복수예비가격을 열었다. 키는 나라장터와 같은
 * 공공데이터포털 키(SEUM_API_KEY) — 활용신청만 따로 했다(2026-11-01, 운영계정).
 *
 * 두 갈래가 있다.
 *  - 공개수의협상(소액 수의, 공고번호 MCT0013 같은 것): 결과·업체별 금액·예가까지 다 받는다
 *  - 경쟁입찰(제한경쟁·적격심사): 같은 식으로 받되 조회 키가 조금 다르다
 * 낙찰 방식은 나라장터와 같다 — 예가 15개 중 4개 평균이 예정가격, 하한율 이상 최저가가 1순위.
 *
 * 우리 표(bid_*)에 나라장터 공고와 같이 넣는다. 공고번호는 제이비드·D2B 화면과 같게 '공고번호+공사번호'
 * (MCS01552026-17331), 차수는 001. **번호에 '-' 가 있으면 D2B** — 나라장터 번호(R26BK…, 옛 2023…)엔 없다.
 * 주력분야는 API 에 없고 첨부 공고문에만 있어 mfrc_flds 는 비워 둔다(모름).
 */

const BASE = 'https://apis.data.go.kr/1690000'

export type D2bRaw = Record<string, string>

export class D2bError extends Error {
  readonly code?: string
  constructor(message: string, code?: string) { super(message); this.code = code }
}

/** JSON 으로 받는다(_type=json). 숫자·날짜도 문자열로 바꿔 돌려준다 — 한 건이면 item 이 배열이 아니라 객체로 온다 */
export async function d2bGet(svc: 'BidPblancInfoService' | 'BidResultInfoService', op: string, params: Record<string, string | number>): Promise<{ items: D2bRaw[]; total: number }> {
  const key = process.env.G2B_API_KEY || process.env.SEUM_API_KEY
  if (!key) throw new D2bError('API 키가 없습니다', 'no_key')
  const qs = new URLSearchParams({ _type: 'json', ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])) })
  const res = await fetch(`${BASE}/${svc}/${op}?serviceKey=${key}&${qs}`, { cache: 'no-store', signal: AbortSignal.timeout(20_000) })
  const text = await res.text()
  let json: { response?: { header?: { resultCode?: string; resultMsg?: string }; body?: { items?: unknown; item?: unknown; totalCount?: number | string } } }
  try { json = JSON.parse(text) } catch {
    if (/시스템\s*점검/.test(text)) throw new D2bError('국방전자조달 시스템 점검 중', 'maintenance')
    const m = text.match(/<returnAuthMsg>([^<]+)</) ?? text.match(/<errMsg>([^<]+)</)
    throw new D2bError(m?.[1] ?? `응답을 읽지 못했습니다 (${res.status})`, text.match(/<returnReasonCode>(\d+)</)?.[1] ?? 'bad_response')
  }
  const r = json.response
  if (!r) throw new D2bError(`알 수 없는 응답: ${text.slice(0, 120)}`)
  if (r.header?.resultCode === '03') return { items: [], total: 0 }
  if (r.header?.resultCode !== '00') throw new D2bError(r.header?.resultMsg ?? '오류', r.header?.resultCode)
  // 목록은 body.items.item, 상세는 body.item
  const raw = (r.body?.items && typeof r.body.items === 'object' ? (r.body.items as { item?: unknown }).item : undefined) ?? r.body?.item
  const arr = (Array.isArray(raw) ? raw : raw ? [raw] : []) as Record<string, unknown>[]
  const items = arr.map(o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v == null ? '' : String(v).trim()])))
  return { items, total: Number(r.body?.totalCount ?? items.length) }
}

// ── 값 다듬기 ──────────────────────────────────────────────

const num = (s: string | undefined | null): number | null => {
  const t = (s ?? '').replace(/[,\s+]/g, '')
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}
const str = (s: string | undefined | null) => ((s ?? '').trim() || null)

/** 202611051030 / 20261105 (한국시간) → ISO */
export function d2bTime(s: string | undefined | null): string | null {
  const m = (s ?? '').match(/^(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?/)
  if (!m) return null
  return new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4] ?? '00'}:${m[5] ?? '00'}:00+09:00`).toISOString()
}

/** 날짜 → D2B 조회 형식 YYYYMMDD */
export const d2bDate = (ymd: string) => ymd.replace(/-/g, '')

/** 공고번호+공사번호 — 제이비드·D2B 화면의 'MCS01552026-17331' */
export const d2bNo = (pblancNo: string, cntrwkNo: string) => `${pblancNo}${cntrwkNo}`
export const d2bOrd = (odr: string | number) => String(odr || 1).padStart(3, '0')
export { isD2b } from '@/lib/bid-notices'

/** 우리 번호 → D2B 조회 키. 발주기관 코드는 공고번호 앞 세 글자, 공사번호는 'YYYY-NNNNN' */
export function d2bKeyOf(bidNtceNo: string, bidNtceOrd: string) {
  const m = bidNtceNo.match(/^([A-Z0-9]{3}\d{4})(\d{4}-\d+)$/)
  if (!m) return null
  return { orntCode: m[1].slice(0, 3), pblancNo: m[1], cntrwkNo: m[2], pblancOdr: String(Number(bidNtceOrd) || 1) }
}

/** "[44000] 충청남도^[44200] 충청남도 아산시" → ['충청남도', '충청남도 아산시'] */
export function d2bNames(list: string | null | undefined): string[] {
  return (list ?? '').split('^').map(s => s.replace(/^\s*\[[^\]]*\]\s*/, '').trim()).filter(Boolean)
}
/** "[4992] 도장ㆍ습식ㆍ방수ㆍ석공사업^[4990] 실내건축공사업" → ['4992', '4990'] */
export function d2bCodes(list: string | null | undefined): string[] {
  return [...(list ?? '').matchAll(/\[(\d+)\]/g)].map(m => m[1])
}

const SIDO_SHORT: Record<string, string> = {
  서울: '서울특별시', 부산: '부산광역시', 대구: '대구광역시', 인천: '인천광역시', 광주: '광주광역시', 대전: '대전광역시',
  울산: '울산광역시', 세종: '세종특별자치시', 경기: '경기도', 강원: '강원특별자치도', 충북: '충청북도', 충남: '충청남도',
  전북: '전북특별자치도', 전남: '전라남도', 경북: '경상북도', 경남: '경상남도', 제주: '제주특별자치도',
}
const SIDO_FULL = new Set(Object.values(SIDO_SHORT).concat(['전라북도', '강원도', '전남광주통합특별시']))

/**
 * 공사현장. D2B 는 '경상북도 문경시 호계면…' / '전남 영암군' / '부남리' 처럼 제각각이라 시도로 시작하게 맞춘다.
 * 시도를 못 알아보면 참가지역이 한 곳일 때 그걸 쓴다(계룡대 '부남리' → 충청남도)
 */
export function d2bSite(lc: string | null | undefined, areas: string[]): string | null {
  const t = (lc ?? '').trim()
  const first = t.split(/\s+/)[0] ?? ''
  if (SIDO_FULL.has(first)) return t
  if (SIDO_SHORT[first]) return `${SIDO_SHORT[first]} ${t.split(/\s+/).slice(1).join(' ')}`.trim()
  return areas.length === 1 ? `${areas[0]}${t ? ` ${t}` : ''}` : (t || null)
}

/** A값 — 국민연금·건강·노인장기요양·안전관리비·퇴직공제·품질관리비. 제이비드 '보험료 합계(A)' 와 같다(계룡대 3,500,984원) */
export function d2bAmountA(x: D2bRaw): number {
  return [x.inanAmnt, x.inheAmnt, x.treaAmnt, x.safeAmnt, x.retiDedu, x.quasCost].reduce((s, v) => s + (num(v) ?? 0), 0)
}

/**
 * 공고 상세(공개수의협상 계획 상세 / 경쟁입찰공고 상세) → bid_notices 한 줄.
 * ntceAt: 공개수의협상은 공고일이 없어 처음 본 날로 넣는다
 */
export function d2bNoticeRow(x: D2bRaw, ntceAt: string) {
  const areas = d2bNames(x.areaLmttList)
  const lo = num(x.asessRtLwlt), hi = num(x.asessRtUplmt)
  return {
    bid_ntce_no: d2bNo(x.pblancNo, x.cntrwkNo),
    bid_ntce_ord: d2bOrd(x.pblancOdr),
    name: (x.cntrwkNm ?? '').trim(),
    ntce_instt_nm: '국방전자조달',
    dminstt_cd: str(x.pblancNo)?.slice(0, 3) ?? null,
    dminstt_nm: str(x.ornt),
    cntrct_mthd: str(x.cntrctMth),
    sucsfbid_mthd: str(x.sucbidrDecsnMth),
    lwlt_rate: num(x.scsbidLwltRt) || null,
    presmpt_prce: num(x.estmPrce),
    bdgt_amt: num(x.budgetAmount),
    site_region: d2bSite(x.lc, areas),
    ntce_at: d2bTime(x.pblancDate) ?? ntceAt,
    bid_close_at: d2bTime(x.prqudoPresentnClosDt || x.biddocPresentnClosDt),
    openg_at: d2bTime(x.opengDt),
    detail_url: 'https://www.d2b.go.kr/',
    bssamt: num(x.bsisPreparPc) ?? num(x.baseAmnt),
    rng_bgn: lo,
    rng_end: hi,
    a_amount: d2bAmountA(x),
    prtcpt_rgns: areas,
    // 공동계약 여부는 API 에 없다 — 공고문엔 대개 '미허용'. 지역의무공동도급은 없다고 본다
    rgn_duty_rt: 0,
    rgn_duty_rgns: [],
    updated_at: new Date().toISOString(),
  }
}

/**
 * 공개수의 참가업체(Mnuf) → bid_result_bids. 순위는 '2순위'·'10순위' 비고에서 — **1순위는 '낙찰'로 온다**
 * (계룡대 세차장: 금강건설 '낙찰', 신라기업 '2순위'. 처음엔 '낙찰'을 순위 없음으로 읽어 2순위를 1순위로 보였다).
 * 하한 미만·계약포기·자격미달은 순위 없음(0)
 */
export function d2bOthbcBid(x: D2bRaw, no: string, ord: string) {
  const note = (x.negnNote ?? '').trim()
  const rank = note === '낙찰' ? 1 : Number(note.match(/(\d+)\s*순위/)?.[1] ?? 0)
  return {
    bid_ntce_no: no, bid_ntce_ord: ord, rbid_no: '000',
    rank, bizno: (x.bznsRgnb ?? '').trim(), company_nm: str(x.mfkrName),
    amount: num(x.tnegnAmnt), rate: num(x.negnRate), picks: [] as number[], rmrk: str(x.negnNote),
  }
}
/** 경쟁입찰 참가업체 → bid_result_bids */
export function d2bCmpetBid(x: D2bRaw, no: string, ord: string) {
  return {
    bid_ntce_no: no, bid_ntce_ord: ord, rbid_no: '000',
    rank: num(x.bidnRank) ?? 0, bizno: (x.bznsRgnb ?? '').trim(), company_nm: str(x.mfkrName),
    amount: num(x.tbidAmnt), rate: num(x.bidnRate), picks: [] as number[], rmrk: str(x.bidxNote),
  }
}

/** 복수예비가격 15개 → 예가 칸·예정가격(뽑힌 4개 평균, 원 미만 버림) */
export function d2bPrices(items: D2bRaw[]) {
  const prices = items
    .map(x => ({ sno: num(x.epprRank) ?? 0, price: num(x.planPrce) ?? 0, drawn: x.choiYsno === 'Y', picks: 0 }))
    .sort((a, b) => a.sno - b.sno)
  const drawn = prices.filter(p => p.drawn)
  const plnprc = drawn.length ? Math.floor(drawn.reduce((s, p) => s + p.price, 0) / drawn.length) : null
  return { prices, plnprc }
}
