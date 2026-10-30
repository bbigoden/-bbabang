/**
 * 낙찰가 분석 — 과거 낙찰결과로 '이 값에 넣었으면 몇 번 땄을까'를 세어 투찰가를 고른다.
 *
 * ## 낙찰 구조 (적격심사·소액 최저가 공사)
 * 기초금액 ±2~3% 안에서 예비가격 15개를 만들고, 업체들이 고른 번호 중 많이 나온 4개의
 * 평균이 예정가격이 된다. 하한선 = (예정가격 − A) × 낙찰하한율 + A 이고, **하한선 이상
 * 중 가장 낮게 넣은 업체가 1순위**다. A값은 국민연금·건강보험 등 깎을 수 없는 금액이다.
 *
 * ## 공고마다 다른 금액을 한 자로 재기
 * 기초금액·A·하한율이 공고마다 달라 금액 그대로는 비교가 안 된다. 그래서
 *   사정률  r = (예정가격 − A) / (기초금액 − A)
 *   투찰값  y = (투찰금액 − A) / ((기초금액 − A) × 하한율)
 * 로 바꾼다. 그러면 **y ≥ r 이면 하한선 통과**, 그중 y 가 가장 작은 업체가 낙찰이다.
 * A = 0 이면 r 은 흔히 말하는 사정률(예정가격 ÷ 기초금액)과 같다.
 *
 * ## 되돌려 보기
 * 과거 공고 하나마다 '우리가 y 에 넣었으면 땄는가'는 r ≤ y < (r 이상인 경쟁사 중 가장 낮은 y)
 * 일 때다. 비슷한 과거 공고 전체에서 이걸 세면 y 마다 낙찰 확률이 나온다.
 * 경쟁사는 그때 그대로 넣었다고 본다 — 같은 발주처·같은 금액대 공고에서 업체들의
 * 버릇은 잘 안 바뀐다는 가정이다. 표본이 적으면 확률이 들쭉날쭉하므로 화면에 건수를 같이 적는다.
 */

export type HistoryInput = {
  bssamt: number
  plnprc: number
  lwlt_rate: number  // %
  a_amount: number | null
  amounts: number[]  // 그 공고의 업체별 투찰금액
}

export type NormalizedHistory = {
  /** 사정률 (A 를 뺀 값 기준) */
  r: number
  /** r 이상으로 넣은 경쟁사 중 가장 낮은 y. 없으면 Infinity */
  minAbove: number
  /** 업체 수 */
  n: number
}

export function normalize(h: HistoryInput): NormalizedHistory | null {
  const A = h.a_amount ?? 0
  const L = h.lwlt_rate / 100
  const base = h.bssamt - A
  if (!(base > 0) || !(L > 0) || !(h.plnprc > 0)) return null
  const r = (h.plnprc - A) / base
  let minAbove = Infinity
  for (const amt of h.amounts) {
    const y = (amt - A) / (base * L)
    if (y >= r && y < minAbove) minAbove = y
  }
  return { r, minAbove, n: h.amounts.length }
}

export type CurvePoint = { y: number; wins: number; rate: number }

export const GRID_MIN = 0.97
export const GRID_MAX = 1.03
export const GRID_STEP = 0.0001

/**
 * y 마다 '몇 번 땄을까'. 구간 [r, minAbove) 가 y 를 덮는 공고 수를 센다.
 * 같은 값으로 넣은 업체가 있으면 진 것으로 친다(동점 추첨은 운이라 기대하지 않는다).
 */
export function winCurve(hist: NormalizedHistory[], min = GRID_MIN, max = GRID_MAX, step = GRID_STEP): CurvePoint[] {
  const steps = Math.round((max - min) / step)
  const diff = new Array<number>(steps + 2).fill(0)
  const idx = (v: number) => Math.ceil((v - min) / step - 1e-9)
  for (const h of hist) {
    const from = Math.max(0, idx(h.r))
    // minAbove 는 진다 → 그 직전 칸까지
    const to = Number.isFinite(h.minAbove) ? Math.min(steps, idx(h.minAbove) - 1) : steps
    if (from > steps || to < from) continue
    diff[from] += 1
    diff[to + 1] -= 1
  }
  const total = hist.length || 1
  const out: CurvePoint[] = []
  let run = 0
  for (let i = 0; i <= steps; i++) {
    run += diff[i]
    out.push({ y: round(min + i * step, 4), wins: run, rate: run / total })
  }
  return out
}

/**
 * 가장 잘 따는 자리. 한 칸만 튀는 자리는 우연이라, 앞뒤 `window` 칸 평균으로 고른다.
 */
export function bestPoint(curve: CurvePoint[], window = 5): CurvePoint & { smooth: number } {
  let best = { ...curve[0], smooth: -1 }
  for (let i = 0; i < curve.length; i++) {
    let s = 0, c = 0
    for (let j = Math.max(0, i - window); j <= Math.min(curve.length - 1, i + window); j++) { s += curve[j].rate; c++ }
    const smooth = s / c
    if (smooth > best.smooth) best = { ...curve[i], smooth }
  }
  return best
}

/** y → 실제 투찰금액(원). 하한선 밑으로 떨어지지 않게 올림한다 */
export function amountFor(y: number, bssamt: number, lwltRate: number, a: number | null): number {
  const A = a ?? 0
  return Math.ceil(A + y * (bssamt - A) * (lwltRate / 100))
}

/**
 * 투찰금액(원) → y. amountFor 의 거꾸로다.
 * y 는 곧 '이 금액이 하한선을 넘는 가장 높은 사정률'이다 — 사정률이 y 이하로 나와야 통과.
 * 같은 식이라 사정률 r 일 때의 하한선은 amountFor(r, …) 로 구한다.
 */
export function yOf(amount: number, bssamt: number, lwltRate: number, a: number | null): number {
  const A = a ?? 0
  return (amount - A) / ((bssamt - A) * (lwltRate / 100))
}

/** 과거 공고 중 사정률이 y 이하로 나와 이 자리가 하한선을 넘었을 비율 */
export function passShare(hist: NormalizedHistory[], y: number): number {
  return hist.length ? hist.filter(h => h.r <= y).length / hist.length : 0
}

/** 추천에 쓰는 과거 낙찰 한 줄 (bid_results 에서 업체 목록 없이 숫자 몇 개) */
export type PoolRow = {
  dminstt_cd: string | null
  dminstt_nm: string | null
  bssamt: number | null
  sajeong: number
  win_y: number | null
  rng: number | null
}

export type Scope = 'instt' | 'region' | 'all'
/** 이보다 적으면 확률이 들쭉날쭉해 한 단계 넓힌다 */
export const ENOUGH = 30
/** 이보다 적으면 추천하지 않는다 */
export const MIN_POOL = 5
const sidoOf = (nm: string | null) => (nm ?? '').split(' ')[0] || null

/** 예가 범위가 같고 기초금액이 1/3~3배인 것만. 기준 금액(ref)을 모르면 금액대는 안 본다 */
export function similarPool<T extends PoolRow>(history: T[], ref: number | null, rng: number | null): T[] {
  return history.filter(h =>
    (rng == null || h.rng == null || h.rng === rng) &&
    (!ref || !h.bssamt || (h.bssamt >= ref / 3 && h.bssamt <= ref * 3)))
}

/** 같은 발주기관 → 같은 시도 → 업종 전체. 넉넉한(ENOUGH) 가장 좁은 범위를 자동으로 고른다 */
export function scopesOf<T extends PoolRow>(pool: T[], dminsttCd: string | null, dminsttNm: string | null) {
  const byScope: Record<Scope, T[]> = {
    instt: pool.filter(h => dminsttCd && h.dminstt_cd === dminsttCd),
    region: pool.filter(h => sidoOf(dminsttNm) && sidoOf(h.dminstt_nm) === sidoOf(dminsttNm)),
    all: pool,
  }
  const auto: Scope = byScope.instt.length >= ENOUGH ? 'instt' : byScope.region.length >= ENOUGH ? 'region' : 'all'
  return { byScope, auto }
}

export const toNorm = (rows: PoolRow[]): NormalizedHistory[] =>
  rows.map(h => ({ r: Number(h.sajeong), minAbove: h.win_y == null ? Infinity : Number(h.win_y), n: 0 }))

/**
 * 공고 하나의 추천 자리(y). 공고 화면의 추천 투찰금액과 같은 계산이다 — 낙찰결과의
 * '추천대로 넣었으면' 되돌려 보기도 이걸 쓴다(그때는 그 공고 개찰 전 낙찰만 넘긴다).
 */
export function recommendY(
  history: PoolRow[],
  t: { bssamt: number | null; rng: number | null; dminstt_cd: string | null; dminstt_nm: string | null },
): { y: number; scope: Scope; n: number } | null {
  const { byScope, auto } = scopesOf(similarPool(history, t.bssamt, t.rng), t.dminstt_cd, t.dminstt_nm)
  const norm = toNorm(byScope[auto])
  if (norm.length < MIN_POOL) return null
  return { y: bestPoint(winCurve(norm)).y, scope: auto, n: norm.length }
}

/**
 * 추천 금액을 이미 개찰한 공고에 넣어 봤으면 — 하한 미달 / 통과했지만 더 낮은 업체가 있음 / 낙찰.
 * 하한선 이상 중 가장 낮은 금액이 1순위라, 실제 1순위 금액보다 낮고 하한선 이상이면 낙찰이다.
 */
export function judgeAmount(
  amount: number,
  r: { plnprc: number; lwlt_rate: number; a_amount: number | null; sucsf_amt: number | null },
): 'win' | 'pass' | 'below' {
  const A = r.a_amount ?? 0
  const floor = Math.ceil((r.plnprc - A) * (r.lwlt_rate / 100) + A)
  if (amount < floor) return 'below'
  return r.sucsf_amt == null || amount < r.sucsf_amt ? 'win' : 'pass'
}

/** 사정률 분포 요약 (백분율 r×100) */
export function rateStats(hist: NormalizedHistory[]) {
  const rs = hist.map(h => h.r * 100).sort((a, b) => a - b)
  const q = (p: number) => rs.length ? rs[Math.min(rs.length - 1, Math.floor(p * rs.length))] : null
  return { count: rs.length, p10: q(0.1), p50: q(0.5), p90: q(0.9), min: rs[0] ?? null, max: rs[rs.length - 1] ?? null }
}

/** 사정률 막대그래프용 칸 나누기 — lo~hi(%)를 width 간격으로 */
export function rateHistogram(hist: NormalizedHistory[], lo = 97, hi = 103, width = 0.25) {
  const bins = Math.round((hi - lo) / width)
  const counts = new Array<number>(bins).fill(0)
  for (const h of hist) {
    const v = h.r * 100
    const i = Math.floor((v - lo) / width)
    if (i >= 0 && i < bins) counts[i]++
  }
  return counts.map((c, i) => ({ from: round(lo + i * width, 2), count: c }))
}

/** 예가 범위(±2·±3) — 공고 값이 없으면 15개 예가의 퍼짐으로 짐작한다 */
export function rangeOf(bssamt: number, prices: { price: number }[] | null | undefined): number | null {
  if (!prices?.length || !(bssamt > 0)) return null
  const spread = Math.max(...prices.map(p => Math.abs(p.price / bssamt - 1)))
  return spread <= 0.0205 ? 2 : 3
}

function round(v: number, d: number) {
  const k = 10 ** d
  return Math.round(v * k) / k
}
