'use client'

import { useMemo, useState } from 'react'
import { Chip } from '@/components/ui/chip'
import {
  ENOUGH, GRID_MIN, MIN_POOL, GRID_STEP, amountFor, bestPoint, passShare, rateHistogram, rateStats, scopesOf, similarPool, toNorm, winCurve, yOf,
  type CurvePoint, type NormalizedHistory, type PoolRow, type Scope,
} from '@/lib/bid-analysis'
import { parseWon } from '@/lib/bid-notices'

/**
 * 공고 한 건의 추천 투찰가.
 *
 * 비슷한 과거 낙찰(같은 발주기관 → 같은 시도 → 업종 전체 순으로 넓힌다)을 모아
 * '이 값에 넣었으면 몇 번 땄을까'를 세고, 가장 많이 딴 자리를 금액으로 바꿔 보여 준다.
 * 계산 방식은 src/lib/bid-analysis.ts 맨 위에 적어 두었다.
 */

export type HistoryRow = PoolRow

export type NoticeForAnalysis = {
  dminstt_cd: string | null
  dminstt_nm: string | null
  bssamt: number | null
  presmpt_prce: number | null
  lwlt_rate: number | null
  a_amount: number | null
  rng_end: number | null
}

const SCOPE_LABEL: Record<Scope, string> = { instt: '같은 발주기관', region: '같은 시도', all: '업종 전체' }

const won = (n: number) => n.toLocaleString('ko-KR')
/** 숫자만 친 동안엔 쉼표를 찍어 자릿수가 보이게. '2억3600만' 처럼 한글을 섞으면 그대로 둔다 */
const commaTyped = (v: string) => {
  const digits = v.replace(/,/g, '')
  return /^\d{1,13}$/.test(digits) ? Number(digits).toLocaleString('ko-KR') : v.slice(0, 30)
}

export function AnalysisPanel({ notice, history }: { notice: NoticeForAnalysis; history: HistoryRow[] }) {
  const [typedBssamt, setTypedBssamt] = useState('')
  // 기초금액은 공고 뒤에 따로 공개된다. 그 전엔 추정가격×1.1 로 먼저 계산해 둔다 —
  // 받은 공고 739건 중 거의 다 정확히 1.1배였다(부가세). 알면 손으로 넣어 바꾼다.
  const guessBssamt = notice.presmpt_prce ? Math.round(notice.presmpt_prce * 1.1) : null
  const typedValue = parseWon(typedBssamt)
  const bssamt = notice.bssamt ?? typedValue ?? guessBssamt
  const provisional = !notice.bssamt
  const lwlt = notice.lwlt_rate
  const rng = notice.rng_end != null ? Math.abs(notice.rng_end) : null

  // 금액대·예가범위가 같은 것만. 기초금액을 모르면 추정가격으로 금액대를 잡는다
  const pool = useMemo(() => {
    // 손으로 치는 값은 쓰지 않는다 — 한 자씩 치면 '3' 원 기준으로 걸러 0건이 되고 입력칸까지 사라졌다
    const ref = notice.bssamt ?? guessBssamt
    return similarPool(history, ref, rng)
  }, [history, notice.bssamt, guessBssamt, rng])

  const { byScope, auto: autoScope } = useMemo(
    () => scopesOf(pool, notice.dminstt_cd, notice.dminstt_nm),
    [pool, notice.dminstt_cd, notice.dminstt_nm],
  )
  const [picked, setPicked] = useState<Scope | null>(null)
  const scope = picked ?? autoScope
  const rows = byScope[scope]

  const norm: NormalizedHistory[] = useMemo(() => toNorm(rows), [rows])
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
        <span className="text-[11px] text-gray-400">예가 범위가 같고 기초금액이 1/3~3배인 과거 낙찰만 셉니다</span>
      </div>

      {!lwlt ? (
        <p className="text-gray-500">이 공고엔 낙찰하한율이 없습니다 — 하한율로 가르는 공고가 아니라 계산하지 않습니다.</p>
      ) : norm.length < MIN_POOL ? (
        <p className="text-gray-500">비교할 과거 낙찰이 {norm.length}건뿐입니다. 과거 데이터가 더 쌓이면 계산합니다.</p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg bg-white p-3 dark:bg-gray-900">
              <div className="text-xs text-gray-500">추천 투찰금액</div>
              {amount ? (
                <div className="mt-1 text-xl font-bold text-blue-600 dark:text-blue-400">
                  {won(amount)}원{provisional && <span className="ml-1 text-xs font-medium text-amber-600 dark:text-amber-400">임시</span>}
                </div>
              ) : <div className="mt-1 text-xl font-bold text-gray-400">-</div>}
              {amount && bssamt && (
                <div className="mt-1 text-xs text-gray-500">
                  기초금액 대비 {(amount / bssamt * 100).toFixed(3)}% · 가장 자주 1순위였던 자리
                </div>
              )}
              {provisional && (
                <div className="mt-2 space-y-1">
                  <div className="text-xs text-amber-700 dark:text-amber-400">
                    기초금액 공개 전이라 {typedValue ? '넣은 금액' : `추정가격×1.1(${guessBssamt ? won(guessBssamt) : '-'}원)`}으로 계산했습니다. 공개되면 저절로 바뀝니다.
                  </div>
                  <input
                    inputMode="numeric"
            maxLength={30}
                    value={typedBssamt}
                    onChange={e => setTypedBssamt(commaTyped(e.target.value))}
                    placeholder="기초금액을 알면 넣기"
                    aria-label="기초금액"
                    className="h-9 w-full rounded-lg border border-gray-200 bg-white px-2 text-base sm:text-sm dark:border-gray-800 dark:bg-gray-950"
                  />
                  {typedBssamt && !typedValue && (
                    <div className="text-xs text-red-600 dark:text-red-400">금액을 읽지 못했습니다 — 예: 71,251,000 또는 7125만</div>
                  )}
                </div>
              )}
            </div>
            <div className="rounded-lg bg-white p-3 dark:bg-gray-900">
              <div className="text-xs text-gray-500">과거에 이 자리였다면</div>
              <div className="mt-1 text-xl font-bold text-gray-900 dark:text-white">
                {best ? `${best.wins}건 / ${norm.length}건` : '-'}
              </div>
              <div className="mt-1 text-xs text-gray-500">낙찰 {best ? (best.rate * 100).toFixed(1) : '-'}% · 앞뒤를 고르게 본 자리</div>
            </div>
            <div className="rounded-lg bg-white p-3 dark:bg-gray-900">
              <div className="text-xs text-gray-500">사정률 (가운데 80%)</div>
              <div className="mt-1 text-xl font-bold text-gray-900 dark:text-white">
                {stats.p10?.toFixed(2)} ~ {stats.p90?.toFixed(2)}%
              </div>
              <div className="mt-1 text-xs text-gray-500">가운데값 {stats.p50?.toFixed(3)}%</div>
            </div>
          </div>

          {norm.length < ENOUGH && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
              비교한 과거 낙찰이 {norm.length}건뿐이라 확률이 크게 흔들립니다. 한두 건만 달라져도 추천 금액이 바뀝니다.
            </p>
          )}

          {bssamt && (
            <PassCheck
              bssamt={bssamt} lwlt={lwlt} a={notice.a_amount} rng={rng ?? 3}
              stats={stats} norm={norm} curve={curve} recommended={amount}
            />
          )}

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

          <details className="text-xs text-gray-500">
            <summary className="cursor-pointer select-none">낱말 풀이</summary>
            <dl className="mt-2 grid gap-x-3 gap-y-1 sm:grid-cols-[7rem_1fr]">
              <dt className="font-medium text-gray-700 dark:text-gray-300">추정가격</dt><dd>발주처가 공고에 적는 예산(부가세 빼고). 기초금액은 보통 이것의 1.1배입니다.</dd>
              <dt className="font-medium text-gray-700 dark:text-gray-300">기초금액</dt><dd>입찰 기준 금액. 공고 뒤 며칠 안에 따로 공개됩니다.</dd>
              <dt className="font-medium text-gray-700 dark:text-gray-300">예가 ±3%</dt><dd>기초금액의 위아래 3% 안에서 예비가격 15개를 만든다는 뜻(±2% 공고도 있습니다).</dd>
              <dt className="font-medium text-gray-700 dark:text-gray-300">예정가격</dt><dd>개찰 때 업체들이 고른 예비가격 번호 중 많이 나온 4개의 평균. 미리 알 수 없습니다.</dd>
              <dt className="font-medium text-gray-700 dark:text-gray-300">사정률</dt><dd>예정가격 ÷ 기초금액. 이 화면에선 A값을 뺀 금액끼리 나눕니다.</dd>
              <dt className="font-medium text-gray-700 dark:text-gray-300">낙찰하한율</dt><dd>예정가격의 이 비율 밑으로 쓰면 탈락합니다(하한 미달).</dd>
              <dt className="font-medium text-gray-700 dark:text-gray-300">A값</dt><dd>국민연금·건강보험 등 깎을 수 없는 금액. 하한율을 곱하지 않고 그대로 더합니다 — 그래서 추천이 ‘기초×하한율’보다 낮게 나올 수 있습니다.</dd>
              <dt className="font-medium text-gray-700 dark:text-gray-300">추천 투찰금액</dt><dd>과거 비슷한 공고에 이 자리로 넣었다면 가장 자주 1순위였을 금액. 통과 확률이 가장 높은 금액은 아닙니다.</dd>
            </dl>
          </details>
        </>
      )}
    </div>
  )
}

/**
 * 하한선은 미리 정해져 있지 않다 — 개찰 때 뽑힌 예정가격(사정률)에 따라 움직인다.
 * 그래서 금액마다 '사정률이 몇 % 이하로 나와야 통과하는지'와 과거에 그런 경우가 얼마였는지를 적는다.
 * 기초금액×하한율은 사장님이 계산기로 먼저 재 보는 값이라 기준선으로 같이 둔다.
 */
function PassCheck({ bssamt, lwlt, a, rng, stats, norm, curve, recommended }: {
  bssamt: number; lwlt: number; a: number | null; rng: number
  stats: ReturnType<typeof rateStats>; norm: NormalizedHistory[]; curve: CurvePoint[]; recommended: number | null
}) {
  const [typed, setTyped] = useState('')
  const mine = parseWon(typed)
  const floors = [
    { label: `최저 ${100 - rng}%`, r: 1 - rng / 100 },
    stats.p10 != null && { label: `낮은 쪽 ${stats.p10.toFixed(2)}%`, r: stats.p10 / 100 },
    { label: '100% (예정가격 = 기초금액)', r: 1 },
    stats.p90 != null && { label: `높은 쪽 ${stats.p90.toFixed(2)}%`, r: stats.p90 / 100 },
    { label: `최고 ${100 + rng}%`, r: 1 + rng / 100 },
  ].filter((f): f is { label: string; r: number } => !!f)
  const simple = Math.round(bssamt * lwlt / 100)

  const check = (amt: number) => {
    const y = yOf(amt, bssamt, lwlt, a)
    const i = Math.round((y - GRID_MIN) / GRID_STEP)
    const wins = curve[i]?.wins ?? 0
    const pass = passShare(norm, y)
    return { y, wins, pass }
  }
  const lines = [
    recommended && { name: '추천', amt: recommended },
    { name: '기초×하한율', amt: simple },
    mine && { name: '내 금액', amt: mine },
  ].filter((l): l is { name: string; amt: number } => !!l)

  return (
    <div className="rounded-lg bg-white p-3 dark:bg-gray-900">
      <div className="text-xs text-gray-500">사정률별 하한선 — 하한선은 개찰 때 뽑힌 예정가격(사정률)에 따라 움직입니다</div>
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
        {floors.map(f => (
          <div key={f.label} className={f.r === 1 ? 'rounded-md bg-gray-50 p-2 dark:bg-gray-950' : 'p-2'}>
            <div className="text-[11px] text-gray-500">사정률 {f.label}</div>
            <div className="font-semibold tabular-nums text-gray-900 dark:text-white">{won(amountFor(f.r, bssamt, lwlt, a))}원</div>
          </div>
        ))}
      </div>

      <div className="mt-3 border-t border-gray-100 pt-3 dark:border-gray-800">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="text-xs text-gray-500">이 금액이면 통과할까</span>
          <input
            inputMode="numeric"
            maxLength={30}
            value={typed}
            onChange={e => setTyped(commaTyped(e.target.value))}
            placeholder="내 금액 넣어 보기"
            className="h-9 w-44 rounded-lg border border-gray-200 bg-white px-2 text-base sm:text-sm tabular-nums dark:border-gray-800 dark:bg-gray-950"
          />
          {typed && !mine && <span className="text-xs text-red-600 dark:text-red-400">금액을 읽지 못했습니다 — 예: 63,500,000 또는 6350만</span>}
        </div>
        <div className="divide-y divide-gray-100 dark:divide-gray-800">
          {lines.map(l => {
            const c = check(l.amt)
            return (
              <div key={l.name} className="flex flex-wrap items-baseline gap-x-4 gap-y-0.5 py-1.5">
                <span className="w-20 text-xs text-gray-500">{l.name}</span>
                <span className="w-32 font-semibold tabular-nums">{won(l.amt)}원</span>
                {c.y < 1 - rng / 100 ? (
                  <span className="font-medium text-red-600 dark:text-red-400">예정가격이 어떻게 나와도 하한 미달입니다</span>
                ) : c.y >= 1 + rng / 100 ? (
                  <span className="text-gray-700 dark:text-gray-300">언제나 통과 — 대신 더 낮게 쓴 업체에 밀립니다</span>
                ) : (
                  <span className="text-gray-700 dark:text-gray-300">사정률 <b>{(c.y * 100).toFixed(3)}%</b> 이하로 나와야 통과</span>
                )}
                <span className="text-xs text-gray-500">과거 {norm.length}건 중 통과 {(c.pass * 100).toFixed(0)}% · 낙찰 {c.wins}건</span>
              </div>
            )
          })}
        </div>
        <p className="mt-2 text-xs text-gray-400">
          낮게 쓸수록 통과할 확률은 줄고, 통과하면 1순위가 되기 쉽습니다. 높게 쓰면 거의 통과하지만 더 낮게 쓴 업체에 밀립니다.
        </p>
      </div>
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
      <div className="mb-1 text-xs text-gray-500">넣는 자리별 낙찰 확률 (한 칸 최고 {(maxRate * 100).toFixed(1)}% · 빨간 선이 추천 자리)</div>
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
