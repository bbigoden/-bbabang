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
