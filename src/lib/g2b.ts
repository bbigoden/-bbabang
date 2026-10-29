/**
 * 조달청 나라장터 공공데이터 API — 공사 입찰공고·낙찰결과.
 *
 * 키는 공공데이터포털(data.go.kr) 계정 인증키 하나로 모든 API 가 열린다. 그래서
 * 건축물대장에 쓰는 SEUM_API_KEY 를 그대로 쓴다(API 마다 '활용신청'만 따로 하면 된다).
 * 따로 두고 싶으면 G2B_API_KEY 를 넣으면 그게 먼저다.
 *
 * 한도는 API(서비스)마다 하루 1,000건 — 입찰공고 1,000 + 낙찰 1,000 이 따로 센다.
 *
 * 시각은 전부 한국시간 문자열("2026-10-27 08:04:20")로 온다. timestamptz 에 넣을 수
 * 있게 kstToIso 로 +09:00 을 붙인다.
 */

const NOTICE_BASE = 'https://apis.data.go.kr/1230000/ad/BidPublicInfoService'
const RESULT_BASE = 'https://apis.data.go.kr/1230000/as/ScsbidInfoService'

/**
 * 사장님 면허 업종 — 도장ㆍ습식ㆍ방수ㆍ석공사업(4992).
 *
 * 이름(indstrytyNm)으로도 거를 수 있지만 **낙찰 목록에선 이름 필터가 거의 안 걸린다**
 * (1주일 1,563건 중 1,364건이 걸려 나왔다). 코드로 거르면 98건으로 맞게 줄어든다.
 * 공고 쪽은 둘 다 맞는다. 그래서 코드를 쓴다.
 */
export const BID_INDUSTRY_CD = '4992'

export type G2bService = 'notice' | 'result'

export function g2bKey(): string | null {
  return process.env.G2B_API_KEY || process.env.SEUM_API_KEY || null
}

type Raw = Record<string, string>

export class G2bError extends Error {
  readonly code?: string
  constructor(message: string, code?: string) { super(message); this.code = code }
}

/** 한 번 부르고 items·totalCount 를 돌려준다. onCall 로 한도를 센다. */
export async function g2bGet(
  service: G2bService,
  op: string,
  params: Record<string, string | number>,
  onCall?: (service: G2bService) => void,
): Promise<{ items: Raw[]; total: number }> {
  const key = g2bKey()
  if (!key) throw new G2bError('나라장터 API 키가 없습니다', 'no_key')
  const base = service === 'notice' ? NOTICE_BASE : RESULT_BASE
  const qs = new URLSearchParams({ type: 'json', ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])) })
  // 인증키는 포털이 이미 인코딩해 준 값이라 URLSearchParams 에 넣으면 두 번 인코딩된다
  const url = `${base}/${op}?serviceKey=${key}&${qs}`
  onCall?.(service)
  const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(20_000) })
  const text = await res.text()
  let json: unknown
  try { json = JSON.parse(text) } catch {
    // 키 오류·한도 초과 등은 XML 로 온다. 한도 초과(22)를 알아봐야 수집이 '한 건 실패'로 여기고
    // 남은 낙찰을 줄줄이 건너뜀 처리하지 않는다
    const m = text.match(/<returnAuthMsg>([^<]+)</) ?? text.match(/<errMsg>([^<]+)</)
    const code = text.match(/<returnReasonCode>(\d+)</)?.[1]
    throw new G2bError(m?.[1] ?? `응답을 읽지 못했습니다 (${res.status})`, code ?? 'bad_response')
  }
  const r = (json as { response?: { header?: { resultCode?: string; resultMsg?: string }; body?: { items?: Raw[] | ''; totalCount?: number } } }).response
  if (!r) {
    const err = Object.values(json as Record<string, { header?: { resultCode?: string; resultMsg?: string } }>)[0]?.header
    throw new G2bError(err?.resultMsg ?? '알 수 없는 오류', err?.resultCode)
  }
  // 03 = 데이터 없음. 오류가 아니라 빈 목록이다
  if (r.header?.resultCode === '03') return { items: [], total: 0 }
  if (r.header?.resultCode !== '00') throw new G2bError(r.header?.resultMsg ?? '오류', r.header?.resultCode)
  const items = Array.isArray(r.body?.items) ? r.body.items : []
  return { items, total: Number(r.body?.totalCount ?? 0) }
}

// ── 값 다듬기 ──────────────────────────────────────────────

/** "2026-10-27 08:04:20" / "2026-11-02 18:00" (한국시간) → ISO. 비면 null */
export function kstToIso(s: string | undefined | null): string | null {
  const t = (s ?? '').trim()
  const m = t.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/)
  if (!m) return null
  return new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] ?? '00'}+09:00`).toISOString()
}

/** 날짜 → 나라장터 조회 형식 YYYYMMDDHHMM (한국시간 그대로) */
export function g2bDt(ymd: string, hm = '0000'): string {
  return ymd.replace(/-/g, '') + hm
}

const num = (s: string | undefined | null): number | null => {
  const t = (s ?? '').replace(/[,\s+]/g, '')
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}
const str = (s: string | undefined | null) => ((s ?? '').trim() || null)

// ── 행 변환 ────────────────────────────────────────────────

export function toNoticeRow(x: Raw) {
  return {
    bid_ntce_no: x.bidNtceNo,
    bid_ntce_ord: x.bidNtceOrd || '000',
    name: (x.bidNtceNm ?? '').trim(),
    ntce_instt_nm: str(x.ntceInsttNm),
    dminstt_cd: str(x.dminsttCd),
    dminstt_nm: str(x.dminsttNm),
    cntrct_mthd: str(x.cntrctCnclsMthdNm),
    sucsfbid_mthd: str(x.sucsfbidMthdNm),
    lwlt_rate: num(x.sucsfbidLwltRate),
    presmpt_prce: num(x.presmptPrce),
    bdgt_amt: num(x.bdgtAmt),
    site_region: str(x.cnstrtsiteRgnNm),
    ntce_at: kstToIso(x.bidNtceDt),
    bid_close_at: kstToIso(x.bidClseDt),
    openg_at: kstToIso(x.opengDt),
    detail_url: str(x.bidNtceDtlUrl),
    updated_at: new Date().toISOString(),
  }
}

/**
 * 기초금액 조회 한 줄 → 공고에 덧붙일 값.
 *
 * A값은 낙찰하한율을 곱하지 않고 그대로 더하는 금액이다(행안부 적격심사 기준).
 * bidPrceCalclAYn='Y' 일 때만 의미가 있다. 품질관리비는 qltyMngcstAObjYn 이 Y 일 때만 넣는다.
 */
export function toBsisPatch(x: Raw) {
  const useA = x.bidPrceCalclAYn === 'Y'
  const a = useA
    ? [x.npnInsrprm, x.mrfnHealthInsrprm, x.odsnLngtrmrcprInsrprm, x.rtrfundNon, x.sftyMngcst, x.sftyChckMngcst,
       x.qltyMngcstAObjYn === 'Y' ? x.qltyMngcst : '0']
        .reduce((s, v) => s + (num(v) ?? 0), 0)
    : 0
  return {
    bid_ntce_no: x.bidNtceNo,
    bid_ntce_ord: x.bidNtceOrd || '000',
    bssamt: num(x.bssamt),
    rng_bgn: num(x.rsrvtnPrceRngBgnRate),
    rng_end: num(x.rsrvtnPrceRngEndRate),
    a_amount: a,
    bssamt_open_at: kstToIso(x.bssamtOpenDt),
  }
}

export function toResultRow(x: Raw) {
  return {
    bid_ntce_no: x.bidNtceNo,
    bid_ntce_ord: x.bidNtceOrd || '000',
    rbid_no: x.rbidNo || '000',
    name: (x.bidNtceNm ?? '').trim(),
    dminstt_cd: str(x.dminsttCd),
    dminstt_nm: str(x.dminsttNm),
    openg_at: kstToIso(x.rlOpengDt),
    prtcpt_cnum: num(x.prtcptCnum),
    winner_nm: str(x.bidwinnrNm),
    winner_bizno: str(x.bidwinnrBizno),
    sucsf_amt: num(x.sucsfbidAmt),
    sucsf_rate: num(x.sucsfbidRate),
  }
}

export type PriceSlot = { sno: number; price: number; drawn: boolean; picks: number }

/** 예비가격 상세 15줄 → 기초금액·예정가격·예가 15개 */
export function toPrepar(items: Raw[]) {
  const first = items[0]
  if (!first) return null
  const prices: PriceSlot[] = items
    .map(x => ({ sno: num(x.compnoRsrvtnPrceSno) ?? 0, price: num(x.bsisPlnprc) ?? 0, drawn: x.drwtYn === 'Y', picks: num(x.drwtNum) ?? 0 }))
    .sort((a, b) => a.sno - b.sno)
  return { bssamt: num(first.bssamt), plnprc: num(first.plnprc), prices }
}

/** 개찰완료 목록 한 줄 → 업체별 투찰 */
export function toBidRow(x: Raw, rbidNo: string) {
  const picks = [x.drwtNo1, x.drwtNo2].map(v => num(v)).filter((v): v is number => v != null)
  return {
    bid_ntce_no: x.bidNtceNo,
    bid_ntce_ord: x.bidNtceOrd || '000',
    rbid_no: x.rbidNo || rbidNo,
    rank: num(x.opengRank) ?? 0,
    bizno: (x.prcbdrBizno ?? '').trim(),
    company_nm: str(x.prcbdrNm),
    amount: num(x.bidprcAmt),
    rate: num(x.bidprcrt),
    picks,
    rmrk: str(x.rmrk),
  }
}
