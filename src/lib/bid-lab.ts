/**
 * 입찰 실험실 — 투찰 자리를 고르는 방법(전략) 여러 개를 이미 개찰한 공고에 넣어 보고 낙찰 수를 비교한다.
 *
 * 공정하게 재려고 공고마다 **그 공고 개찰 전 낙찰만** 보고 자리를 정한다(답을 보고 맞히지 않게).
 * 다른 업체는 실제 넣은 그대로라고 본다. 판정은 y 로 한다(bid-analysis.ts 맨 위 설명):
 *   y < 사정률            → 하한 미달
 *   y < 1순위의 y(win_y)   → 낙찰 (같으면 진 것으로)
 *   그 밖                  → 하한은 넘었지만 더 낮은 업체에 밀림
 */
import { bestPoint, recommendY, scopesOf, similarPool, toNorm, winCurve, MIN_POOL, type PoolRow } from './bid-analysis'

export type LabRow = PoolRow & { openg_at: string; prtcpt_cnum: number | null }
export type Verdict = 'win' | 'pass' | 'below'

export function verdictOf(y: number, row: { sajeong: number; win_y: number | null }): Verdict {
  if (y < Number(row.sajeong)) return 'below'
  return row.win_y == null || y < Number(row.win_y) ? 'win' : 'pass'
}

type Pick = (prior: LabRow[], t: LabRow) => number | null
export type Strategy = { id: string; label: string; desc: string; pick: Pick }

const DAY = 86_400_000

/** 비교 범위 안에서 사정률이 q 비율만큼 y 이하로 나왔던 자리 — 통과 확률 q 를 노린다 */
function passAt(q: number): Pick {
  return (prior, t) => {
    const { byScope, auto } = scopesOf(similarPool(prior, t.bssamt, t.rng), t.dminstt_cd, t.dminstt_nm)
    const rs = byScope[auto].map(h => Number(h.sajeong)).sort((a, b) => a - b)
    if (rs.length < MIN_POOL) return null
    return rs[Math.min(rs.length - 1, Math.floor(q * rs.length))]
  }
}

export const STRATEGIES: Strategy[] = [
  {
    id: 'current', label: '지금 추천',
    desc: '공고 화면의 추천 투찰금액. 같은 발주기관 → 같은 시도 → 업종 전체 중 30건 넘는 가장 좁은 범위에서 가장 많이 딴 자리',
    pick: (prior, t) => recommendY(prior, t)?.y ?? null,
  },
  {
    id: 'all', label: '업종 전체로',
    desc: '발주기관·시도로 좁히지 않고 비슷한 금액대 전체에서 가장 많이 딴 자리',
    pick: (prior, t) => {
      const norm = toNorm(similarPool(prior, t.bssamt, t.rng))
      return norm.length < MIN_POOL ? null : bestPoint(winCurve(norm)).y
    },
  },
  {
    id: 'recent60', label: '최근 60일만',
    desc: '지금 추천과 같되 개찰 전 60일 낙찰만 본다 — 업체들 버릇이 바뀌었으면 이쪽이 낫다',
    pick: (prior, t) => {
      const since = new Date(Date.parse(t.openg_at) - 60 * DAY).toISOString()
      return recommendY(prior.filter(h => h.openg_at >= since), t)?.y ?? null
    },
  },
  { id: 'pass50', label: '통과 50% 자리', desc: '과거 사정률의 가운데 값 — 절반은 하한을 넘는 자리', pick: passAt(0.5) },
  { id: 'pass70', label: '통과 70% 자리', desc: '과거 사정률의 70% 지점 — 하한 미달을 줄이고 대신 순위에서 밀리기 쉽다', pick: passAt(0.7) },
]

export type Tally = { win: number; pass: number; below: number; none: number }
export const emptyTally = (): Tally => ({ win: 0, pass: 0, below: 0, none: 0 })

/** 개찰 순으로 정렬된 rows 에서 t 보다 먼저 개찰한 것들 (이분 탐색) */
export function priorOf(sorted: LabRow[], opengAt: string): LabRow[] {
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
