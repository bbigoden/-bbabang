'use client'

import { useMemo, useState } from 'react'
import { Chip } from '@/components/ui/chip'
import { amountFor, bestPoint, rateHistogram, rateStats, winCurve, type NormalizedHistory } from '@/lib/bid-analysis'

/**
 * 공고 한 건의 추천 투찰가.
 *
 * 비슷한 과거 낙찰(같은 발주기관 → 같은 시도 → 업종 전체 순으로 넓힌다)을 모아
 * '이 값에 넣었으면 몇 번 땄을까'를 세고, 가장 많이 딴 자리를 금액으로 바꿔 보여 준다.
 * 계산 방식은 src/lib/bid-analysis.ts 맨 위에 적어 두었다.
 */

export type HistoryRow = {
  dminstt_cd: string | null
  dminstt_nm: string | null
  bssamt: number | null
  sajeong: number
  win_y: number | null
  rng: number | null
}

export type NoticeForAnalysis = {
  dminstt_cd: string | null
  dminstt_nm: string | null
  bssamt: number | null
  presmpt_prce: number | null
  lwlt_rate: number | null
  a_amount: number | null
  rng_end: number | null
}

type Scope = 'instt' | 'region' | 'all'
const SCOPE_LABEL: Record<Scope, string> = { instt: '같은 발주기관', region: '같은 시도', all: '업종 전체' }
/** 이보다 적으면 확률이 들쭉날쭉해 한 단계 넓힌다 */
const ENOUGH = 30

const won = (n: number) => n.toLocaleString('ko-KR')
const sido = (nm: string | null) => (nm ?? '').split(' ')[0] || null

export function AnalysisPanel({ notice, history }: { notice: NoticeForAnalysis; history: HistoryRow[] }) {
  const [typedBssamt, setTypedBssamt] = useState('')
  const bssamt = notice.bssamt ?? (Number(typedBssamt.replace(/\D/g, '')) || null)
  const lwlt = notice.lwlt_rate
  const rng = notice.rng_end != null ? Math.abs(notice.rng_end) : null

  // 금액대·예가범위가 같은 것만. 기초금액을 모르면 추정가격으로 금액대를 잡는다
  const pool = useMemo(() => {
    const ref = bssamt ?? notice.presmpt_prce
    return history.filter(h =>
      (rng == null || h.rng == null || h.rng === rng) &&
      (!ref || !h.bssamt || (h.bssamt >= ref / 3 && h.bssamt <= ref * 3)))
  }, [history, bssamt, notice.presmpt_prce, rng])

  const byScope = useMemo(() => ({
    instt: pool.filter(h => notice.dminstt_cd && h.dminstt_cd === notice.dminstt_cd),
    region: pool.filter(h => sido(notice.dminstt_nm) && sido(h.dminstt_nm) === sido(notice.dminstt_nm)),
    all: pool,
  }), [pool, notice.dminstt_cd, notice.dminstt_nm])

  const autoScope: Scope = byScope.instt.length >= ENOUGH ? 'instt' : byScope.region.length >= ENOUGH ? 'region' : 'all'
  const [picked, setPicked] = useState<Scope | null>(null)
  const scope = picked ?? autoScope
  const rows = byScope[scope]

  const norm: NormalizedHistory[] = useMemo(
    () => rows.map(h => ({ r: Number(h.sajeong), minAbove: h.win_y == null ? Infinity : Number(h.win_y), n: 0 })),
    [rows],
  )
  const curve = useMemo(() => winCurve(norm), [norm])
  const best = useMemo(() => (norm.length ? bestPoint(curve) : null), [curve, norm.length])
  const stats = useMemo(() => rateStats(norm), [norm])
  const hist = useMemo(() => rateHistogram(norm, 97, 103, 0.25), [norm])
  const histMax = Math.max(1, ...hist.map(b => b.count))

  const amount = best && bssamt && lwlt ? amountFor(best.y, bssamt, lwlt, notice.a_amount) : null

  return (
    <div className="space-y-4 rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm dark:border-gray-800 dark:bg-gray-950">
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-14 shrink-0 text-gray-500">비교</span>
        {(Object.keys(SCOPE_LABEL) as Scope[]).map(s => (
          <Chip key={s} size="xs" on={scope === s} onClick={() => setPicked(s)}>
            {SCOPE_LABEL[s]} {byScope[s].length}건
          </Chip>
        ))}
      </div>

      {!lwlt ? (
        <p className="text-gray-500">이 공고엔 낙찰하한율이 없습니다 — 하한율로 가르는 공고가 아니라 계산하지 않습니다.</p>
      ) : norm.length < 5 ? (
        <p className="text-gray-500">비교할 과거 낙찰이 {norm.length}건뿐입니다. 과거 데이터가 더 쌓이면 계산합니다.</p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg bg-white p-3 dark:bg-gray-900">
              <div className="text-xs text-gray-500">추천 투찰금액</div>
              {amount ? (
                <div className="mt-1 text-xl font-bold text-blue-600 dark:text-blue-400">{won(amount)}원</div>
              ) : (
                <div className="mt-1">
                  {/* 기초금액은 공고 뒤에 따로 공개된다. 공개 전이면 손으로 넣어 볼 수 있게 한다 */}
                  <input
                    inputMode="numeric"
                    value={typedBssamt}
                    onChange={e => setTypedBssamt(e.target.value.replace(/[^\d,]/g, ''))}
                    placeholder="기초금액 넣기"
                    className="h-9 w-full rounded-lg border border-gray-200 bg-white px-2 text-sm dark:border-gray-800 dark:bg-gray-950"
                  />
                  <div className="mt-1 text-xs text-gray-400">기초금액 공개 전입니다</div>
                </div>
              )}
              {amount && bssamt && (
                <div className="mt-1 text-xs text-gray-500">기초금액 대비 {(amount / bssamt * 100).toFixed(3)}%</div>
              )}
            </div>
            <div className="rounded-lg bg-white p-3 dark:bg-gray-900">
              <div className="text-xs text-gray-500">과거에 이 자리였다면</div>
              <div className="mt-1 text-xl font-bold text-gray-900 dark:text-white">
                {best ? `${best.wins}건 / ${norm.length}건` : '-'}
              </div>
              <div className="mt-1 text-xs text-gray-500">낙찰 {best ? (best.rate * 100).toFixed(1) : '-'}%</div>
            </div>
            <div className="rounded-lg bg-white p-3 dark:bg-gray-900">
              <div className="text-xs text-gray-500">사정률 (가운데 80%)</div>
              <div className="mt-1 text-xl font-bold text-gray-900 dark:text-white">
                {stats.p10?.toFixed(2)} ~ {stats.p90?.toFixed(2)}%
              </div>
              <div className="mt-1 text-xs text-gray-500">가운데값 {stats.p50?.toFixed(3)}%</div>
            </div>
          </div>

          <WinChart curve={curve} best={best?.y ?? null} />

          <div>
            <div className="mb-1 text-xs text-gray-500">사정률 분포 (예정가격 ÷ 기초금액, A값 제외)</div>
            <div className="flex h-16 items-end gap-px">
              {hist.map(b => (
                <div key={b.from} className="flex-1 rounded-t bg-blue-600/70 dark:bg-blue-400/70"
                  style={{ height: `${(b.count / histMax) * 100}%` }}
                  title={`${b.from.toFixed(2)}% ~ ${(b.from + 0.25).toFixed(2)}% · ${b.count}건`} />
              ))}
            </div>
            <div className="flex justify-between text-[10px] text-gray-400"><span>97%</span><span>100%</span><span>103%</span></div>
          </div>

          <p className="text-xs leading-relaxed text-gray-500">
            과거 공고에서 업체들이 그때 그대로 넣었다고 보고, 이 값이었으면 하한선을 넘은 업체 중 가장 낮았을지 센 것입니다.
            적격심사 점수(경영상태·시공실적)는 따지지 않습니다. 하한선 = (예정가격 − A값) × {lwlt}% + A값
            {notice.a_amount ? ` · A값 ${won(notice.a_amount)}원` : ''}.
          </p>
        </>
      )}
    </div>
  )
}

/** y(하한율 대비 투찰값)마다 낙찰 확률. 가로축은 사정률 단위(%)로 적는다 */
function WinChart({ curve, best }: { curve: { y: number; rate: number }[]; best: number | null }) {
  const lo = 0.975, hi = 1.025
  const pts = curve.filter(p => p.y >= lo && p.y <= hi)
  const maxRate = Math.max(0.01, ...pts.map(p => p.rate))
  const W = 600, H = 90
  const x = (y: number) => ((y - lo) / (hi - lo)) * W
  const yy = (r: number) => H - (r / maxRate) * (H - 6)
  return (
    <div>
      <div className="mb-1 text-xs text-gray-500">넣는 자리별 낙찰 확률 (최고 {(maxRate * 100).toFixed(1)}%)</div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-24 w-full" preserveAspectRatio="none" role="img" aria-label="넣는 자리별 낙찰 확률">
        <polyline fill="none" strokeWidth={1.5} className="stroke-blue-600 dark:stroke-blue-400"
          points={pts.map(p => `${x(p.y).toFixed(1)},${yy(p.rate).toFixed(1)}`).join(' ')} />
        {best != null && best >= lo && best <= hi && (
          <line x1={x(best)} x2={x(best)} y1={0} y2={H} strokeDasharray="3 3" className="stroke-red-500" />
        )}
      </svg>
      <div className="flex justify-between text-[10px] text-gray-400"><span>97.5%</span><span>100%</span><span>102.5%</span></div>
    </div>
  )
}
