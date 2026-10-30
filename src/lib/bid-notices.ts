/** 입찰공고 목록 다듬기 */

type OrdRow = {
  bid_ntce_no: string
  bid_ntce_ord: string
  name: string
  bid_close_at: string | null
  bssamt: number | null
  a_amount: number | null
  rng_end: number | null
  prtcpt_rgns?: string[] | null
  mfrc_flds?: string[] | null
}

/**
 * 정정공고는 같은 공고번호에 차수만 올라간다(000 → 001 → 002). 살아 있는 건 마지막 차수뿐이라
 * 앞 차수를 그대로 두면 같은 공고가 두세 번 보인다. 취소공고도 새 차수로 오므로, 마지막 차수가
 * 취소면 공고째 뺀다. 기초금액은 앞 차수에만 붙어 있기도 해서 비었으면 넘겨 받는다.
 */
export function latestOrd<T extends OrdRow>(rows: T[]): T[] {
  const byNo = new Map<string, T[]>()
  for (const r of rows) byNo.set(r.bid_ntce_no, [...(byNo.get(r.bid_ntce_no) ?? []), r])
  const out: T[] = []
  for (const group of byNo.values()) {
    const sorted = [...group].sort((a, b) => b.bid_ntce_ord.localeCompare(a.bid_ntce_ord))
    const last = sorted[0]
    if (/취소공고/.test(last.name)) continue
    const withBase = sorted.find(r => r.bssamt != null)
    const withRgn = sorted.find(r => r.prtcpt_rgns != null)
    const withFld = sorted.find(r => r.mfrc_flds != null)
    out.push({
      ...last,
      ...(last.bssamt == null && withBase
        ? { bssamt: withBase.bssamt, a_amount: last.a_amount ?? withBase.a_amount, rng_end: last.rng_end ?? withBase.rng_end }
        : {}),
      ...(last.prtcpt_rgns == null && withRgn ? { prtcpt_rgns: withRgn.prtcpt_rgns } : {}),
      ...(last.mfrc_flds == null && withFld ? { mfrc_flds: withFld.mfrc_flds } : {}),
    })
  }
  return out.sort((a, b) => (a.bid_close_at ?? '').localeCompare(b.bid_close_at ?? ''))
}

/** 이보다 크면 잘못 친 것으로 본다(1조) — 5,000자 숫자를 넣자 '∞원'이 찍혔다 */
const MAX_WON = 1e12

/**
 * 사람이 치는 금액 → 원. '2억3600만' '6,400만' '2.36억' '63500000' 모두 받는다.
 * 숫자를 못 읽으면 null — 소수점·마이너스·1e10 처럼 애매한 건 숫자만 골라 읽지 않고 거절한다
 * (예전엔 '25240000.5' 를 252,400,005 원으로 읽어 추천 금액이 10배가 됐다).
 */
export function parseWon(text: string): number | null {
  const t = text.replace(/[,\s원]/g, '')
  if (!t) return null
  if (/^\d+$/.test(t)) return t.length <= 13 && Number(t) > 0 && Number(t) <= MAX_WON ? Number(t) : null
  const m = t.match(/^(?:(\d+(?:\.\d+)?)억)?(?:(\d+(?:\.\d+)?)만)?(\d+)?$/)
  if (!m || (!m[1] && !m[2])) return null
  const v = Number(m[1] ?? 0) * 1e8 + Number(m[2] ?? 0) * 1e4 + Number(m[3] ?? 0)
  return v > 0 && v <= MAX_WON ? Math.round(v) : null
}

/**
 * 참가가능지역이 공고서(첨부 파일)에만 적힌 공고의 표시. 나라장터 화면엔 '지역제한: 공고서참조' 로 나오고
 * API 엔 지역 줄이 없다(참가제한 Y). 서남병원 옥상 방수(R26BK01710029)가 이래서 '전국'으로 잘못 보였다.
 */
export const DOC_RGN = '공고서참조'

/**
 * 우리 업체가 이 공고에 들어갈 수 있나.
 * 참가가능지역이 '충청남도' 면 도 안 어디든, '충청남도 아산시' 면 아산만 된다.
 * 목록이 비면(전국) 된다. 아직 안 받았으면(null) 모른다 — 화면은 '모름'도 뺀다(true 만 들어갈 수 있는 공고).
 * 지역이 공고서에만 있으면(DOC_RGN) 지역제한은 대개 현장 시도라, 현장(site)이 우리 시도면 '모름', 아니면 못 들어간다고 본다.
 */
export function canEnter(rgns: string[] | null | undefined, ours: string | null | undefined, site?: string | null): boolean | null {
  if (!ours) return true
  if (rgns == null) return null
  if (rgns.length === 0) return true
  if (rgns.includes(DOC_RGN)) return site && site.split(' ')[0] === ours.split(' ')[0] ? null : false
  return rgns.some(r => ours === r || ours.startsWith(r + ' '))
}

/**
 * 지역의무공동도급을 우리가 채우나. 참가는 '전국'이어도 이게 걸리면 의무 지역(비면 현장 시도) 업체와
 * 공동도급해야 한다 — 우리가 그 지역 업체면 되고, 아니면 혼자서는 못 들어간다(하양초 외벽 R26BK01792828, 경북 49%).
 * rt 0 = 의무 없음, null = 아직 안 받음(모름).
 */
export function dutyOk(rt: number | null | undefined, rgns: string[] | null | undefined, site: string | null | undefined, ours: string | null | undefined): boolean | null {
  if (!ours) return true
  if (rt == null) return null
  if (rt === 0) return true
  const duty = rgns?.length ? rgns : site ? [site.split(' ')[0]] : []
  return duty.some(r => ours === r || ours.startsWith(r + ' '))
}

/** "충청남도 아산시" → "충남 아산시". 목록 줄에 짧게 */
export function shortRegion(r: string): string {
  return r
    .replace(/^(충청|전라|경상)([남북])도/, (_, a: string, b: string) => a[0] + b)
    .replace(/^전북특별자치도/, '전북').replace(/^강원특별자치도/, '강원').replace(/^제주특별자치도/, '제주')
    .replace(/^세종특별자치시/, '세종').replace(/특별시|광역시/, '')
}

/** 우리가 고를 수 있는 주력분야 — 4992 면허의 나라장터 표기 그대로 */
export const BID_FIELDS = ['도장공사', '습식·방수공사', '석공사'] as const

/**
 * 공고의 주력분야가 우리 주력분야와 맞나. 공고가 주력분야를 안 정했으면(빈 배열) 누구나 된다.
 * 아직 안 받았으면(null) 모른다 — 화면은 '모름'도 뺀다. 우리 주력분야를 안 정했으면 거르지 않는다.
 */
export function fitsFields(flds: string[] | null | undefined, ours: string[] | null | undefined): boolean | null {
  if (!ours?.length) return true
  if (flds == null) return null
  if (flds.length === 0) return true
  return flds.some(f => ours.includes(f))
}

/** 나라장터 '[1^습식·방수공사]' '[1^도장공사][2^석공사]' → ['습식·방수공사', …] */
export function parseMfrc(list: string | null | undefined): string[] {
  return [...(list ?? '').matchAll(/\^([^\]^,]+)/g)].map(m => m[1].trim()).filter(Boolean)
}
