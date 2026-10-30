/**
 * 입찰 실험실 — 투찰 금액을 고르는 방법(버전) 여러 개를 이미 개찰한 공고에 넣어 보고 버전 1과 낙찰 건수를 비교한다.
 *
 * 규칙(사장님, 2026-10-30): **모든 버전은 들어갈 수 있는 공고에 다 넣는다** — 넣는 공고를 줄여 '공고당 낙찰률'을
 * 올리는 것은 따는 건수가 줄어 소용없다. 금액만 바꿔 버전 1보다 **더 많이 따야** 나은 것이고, 아니면 버전 1을 쓴다.
 *
 * 공정하게 재려고 공고마다 **그 공고 개찰 전 낙찰만** 보고 금액을 정한다(답을 보고 맞히지 않게).
 * 다른 업체는 실제 넣은 그대로라고 본다. 판정은 y 로 한다(bid-analysis.ts 맨 위 설명):
 *   y < 사정률            → 하한 미달
 *   y < 1순위의 y(win_y)   → 낙찰 (같으면 진 것으로)
 *   그 밖                  → 하한은 넘었지만 더 낮은 업체에 밀림
 */
import {
  bestPoint, recommendY, scopesOf, similarPool, toNorm, winCurve,
  ENOUGH, GRID_MAX, GRID_MIN, GRID_STEP, MIN_POOL, type CurvePoint, type PoolRow,
} from './bid-analysis'

export type LabRow = PoolRow & { openg_at: string; prtcpt_cnum: number | null }
export type Verdict = 'win' | 'pass' | 'below'

export function verdictOf(y: number, row: { sajeong: number; win_y: number | null }): Verdict {
  if (y < Number(row.sajeong)) return 'below'
  return row.win_y == null || y < Number(row.win_y) ? 'win' : 'pass'
}

/** 개찰 순으로 정렬된 rows 에서 t 보다 먼저 개찰한 것들 (이분 탐색) */
export function priorOf<T extends { openg_at: string }>(sorted: T[], opengAt: string): T[] {
  let lo = 0, hi = sorted.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (sorted[mid].openg_at < opengAt) lo = mid + 1
    else hi = mid
  }
  return sorted.slice(0, lo)
}

/** 고정 y 를 쭉 바꿔 가며 낙찰 수 — 사후에 고른 값이라 실제로는 미리 알 수 없다(참고용) */
export function fixedSweep(targets: { sajeong: number; win_y: number | null }[], min = 0.98, max = 1.02, step = 0.0005) {
  const out: { y: number; win: number; pass: number; below: number }[] = []
  for (let i = 0; i <= Math.round((max - min) / step); i++) {
    const y = Math.round((min + i * step) * 1e4) / 1e4
    const c = { y, win: 0, pass: 0, below: 0 }
    for (const t of targets) c[verdictOf(y, t)]++
    out.push(c)
  }
  return out
}

/** winCurve 와 같되 과거 공고마다 무게(w)를 달리 준다 — 최근 것·경쟁 수가 비슷한 것을 더 믿을 때 */
function weightedCurve(rows: LabRow[], w: (h: LabRow) => number): CurvePoint[] {
  const steps = Math.round((GRID_MAX - GRID_MIN) / GRID_STEP)
  const diff = new Array<number>(steps + 2).fill(0)
  const idx = (v: number) => Math.ceil((v - GRID_MIN) / GRID_STEP - 1e-9)
  for (const h of rows) {
    const from = Math.max(0, idx(Number(h.sajeong)))
    const to = h.win_y != null ? Math.min(steps, idx(Number(h.win_y)) - 1) : steps
    if (from > steps || to < from) continue
    const ww = w(h)
    diff[from] += ww
    diff[to + 1] -= ww
  }
  const out: CurvePoint[] = []
  let run = 0
  for (let i = 0; i <= steps; i++) {
    run += diff[i]
    out.push({ y: Math.round((GRID_MIN + i * GRID_STEP) * 1e4) / 1e4, wins: run, rate: run })
  }
  return out
}

/** 지금 추천과 같은 비교 범위(같은 발주기관 → 같은 시도 → 업종 전체 중 enough 건 넘는 가장 좁은 것) */
function autoRows(c: VersionCtx, enough = ENOUGH): LabRow[] {
  const { byScope } = scopesOf(similarPool(c.prior, c.t.bssamt, c.t.rng), c.t.dminstt_cd, c.t.dminstt_nm)
  return byScope.instt.length >= enough ? byScope.instt : byScope.region.length >= enough ? byScope.region : byScope.all
}

const DAY = 86_400_000

export type VersionCtx = { prior: LabRow[]; t: LabRow }
export type Version = { id: string; label: string; desc: string; pick: (c: VersionCtx) => number | null }

export const VERSIONS: Version[] = [
  {
    id: 'v1', label: '버전 1', desc: '지금 추천 — 같은 발주기관 → 같은 시도 → 업종 전체 중 30건 넘는 가장 좁은 범위에서 가장 많이 딴 자리',
    pick: c => recommendY(c.prior, c.t)?.y ?? null,
  },
  {
    id: 'v2', label: '버전 2', desc: '가장 많이 딴 자리를 고를 때 앞뒤 10칸(±0.1%) 평균으로 — 한두 칸 튄 자리를 덜 믿는다 (버전 1은 ±0.05%)',
    pick: c => { const r = autoRows(c); return r.length < MIN_POOL ? null : bestPoint(winCurve(toNorm(r)), 10).y },
  },
  {
    id: 'v3', label: '버전 3', desc: '비교 범위를 넓게 — 발주기관·시도 표본이 100건은 넘어야 그 범위를 쓴다 (버전 1은 30건)',
    pick: c => { const r = autoRows(c, 100); return r.length < MIN_POOL ? null : bestPoint(winCurve(toNorm(r))).y },
  },
  {
    id: 'v4', label: '버전 4', desc: '최근 낙찰을 더 믿는다 — 60일 지날 때마다 무게 절반',
    pick: c => {
      const r = autoRows(c)
      if (r.length < MIN_POOL) return null
      const T = Date.parse(c.t.openg_at)
      return bestPoint(weightedCurve(r, h => Math.pow(0.5, (T - Date.parse(h.openg_at)) / (60 * DAY)))).y
    },
  },
  {
    id: 'v5', label: '버전 5', desc: '업종 전체 하나로 — 발주기관·시도로 좁히지 않는다',
    pick: c => { const r = similarPool(c.prior, c.t.bssamt, c.t.rng); return r.length < MIN_POOL ? null : bestPoint(winCurve(toNorm(r))).y },
  },
  {
    id: 'v6', label: '버전 6', desc: '발주기관·시도·업종 전체를 섞는다 — 좁은 범위는 표본 수만큼만 믿고 나머지는 넓은 범위로 채운다',
    pick: c => {
      const pool = similarPool(c.prior, c.t.bssamt, c.t.rng)
      if (pool.length < MIN_POOL) return null
      const { byScope } = scopesOf(pool, c.t.dminstt_cd, c.t.dminstt_nm)
      const ca = winCurve(toNorm(byScope.all)), cr = winCurve(toNorm(byScope.region)), ci = winCurve(toNorm(byScope.instt))
      const k = ENOUGH, na = byScope.all.length, nr = byScope.region.length, ni = byScope.instt.length
      return bestPoint(ca.map((p, i) => {
        const rr = (cr[i].wins + k * (p.wins / na)) / (nr + k)
        const ri = (ci[i].wins + k * rr) / (ni + k)
        return { y: p.y, wins: ri, rate: ri }
      })).y
    },
  },
  {
    id: 'v7', label: '버전 7', desc: '참여 업체 수가 비슷했던 공고를 더 믿는다 — 같은 발주기관의 평소 참여 수 기준(경쟁이 많으면 업체 사이 간격이 촘촘하다)',
    pick: c => {
      const r = autoRows(c)
      if (r.length < MIN_POOL) return null
      const ns = c.prior.filter(h => h.dminstt_cd === c.t.dminstt_cd && h.prtcpt_cnum && h.prtcpt_cnum > 1).map(h => h.prtcpt_cnum!).sort((a, b) => a - b)
      if (ns.length < 3) return bestPoint(winCurve(toNorm(r))).y
      const p = ns[Math.floor(ns.length / 2)]
      return bestPoint(weightedCurve(r, h => (h.prtcpt_cnum ? Math.exp(-Math.abs(Math.log(h.prtcpt_cnum / p))) : 0.3))).y
    },
  },
]

/**
 * 버전 1과 같은 공고들에서 '이 버전만 딴 공고(gain)'와 '버전 1만 딴 공고(lost)'를 비교한다.
 * 둘이 반반이라면(차이 없음) gain 번 이상 이길 확률 — 5% 밑이면 운이 아니라 나아졌다고 본다.
 */
export function chanceAtLeast(win: number, n: number, p: number): number {
  if (win <= 0) return 1
  if (p <= 0) return 0
  if (p >= 1) return 1
  // 로그로 이항분포를 더한다 (n 수천 건도 넘치지 않게)
  let logPmf = n * Math.log(1 - p)  // k = 0
  let below = 0
  for (let k = 0; k < win; k++) {
    below += Math.exp(logPmf)
    logPmf += Math.log((n - k) / (k + 1)) + Math.log(p / (1 - p))
  }
  return Math.max(0, 1 - below)
}

export type VersionResult = { win: number; pass: number; below: number; none: number; gain: number; lost: number }
