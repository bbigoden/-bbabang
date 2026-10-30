'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { fetchAllPaged } from '@/lib/fetch-all-paged'
import { Chip } from '@/components/ui/chip'
import { canEnter, fitsFields } from '@/lib/bid-notices'
import {
  N_BUCKETS, STRATEGIES, VERSIONS, chanceAtLeast, predictNByRegion, bucketOf, emptyTally, fixedSweep, predictN, priorOf, verdictOf,
  type LabRow, type Tally, type Verdict, type VersionCtx, type VersionTally,
} from '@/lib/bid-lab'

/**
 * 실험실 — 투찰 자리를 고르는 방법을 이미 개찰한 공고에 넣어 보고 낙찰 수를 비교한다.
 * 계산 방식은 src/lib/bid-lab.ts 맨 위에 적어 두었다.
 */

type Row = LabRow & { bid_ntce_no: string; winner_nm: string | null; rgns?: string[] | null }
type Meta = { rgns: string[] | null; flds: string[] | null }
type Period = 30 | 90 | 0

const PERIODS: [Period, string][] = [[30, '최근 30일'], [90, '최근 90일'], [0, '받은 전체']]
const DAY = 86_400_000
const VERDICTS: { id: Verdict | 'none'; label: string; bar: string; dot: string }[] = [
  { id: 'win', label: '낙찰', bar: 'bg-emerald-500', dot: 'bg-emerald-500' },
  { id: 'pass', label: '통과·순위 밀림', bar: 'bg-gray-400 dark:bg-gray-500', dot: 'bg-gray-400 dark:bg-gray-500' },
  { id: 'below', label: '하한 미달', bar: 'bg-red-400', dot: 'bg-red-400' },
  { id: 'none', label: '추천 못 함 (비교할 낙찰 5건 미만)', bar: 'bg-gray-200 dark:bg-gray-700', dot: 'bg-gray-200 dark:bg-gray-700' },
]
const n = (v: number) => v.toLocaleString('ko-KR')
const pct = (a: number, b: number) => (b ? `${(a / b * 100).toFixed(1)}%` : '-')

export function LabPanel({ ourRegion, ourFields }: { ourRegion: string | null; ourFields: string[] }) {
  const supabase = useMemo(() => createClient(), [])
  const [rows, setRows] = useState<Row[] | null>(null)
  const [meta, setMeta] = useState<Map<string, Meta>>(new Map())
  const [ours, setOurs] = useState(true)
  const [period, setPeriod] = useState<Period>(90)
  const [fixedY, setFixedY] = useState(1.0)

  useEffect(() => {
    let alive = true
    void Promise.all([
      fetchAllPaged<Row>((from, to) => supabase.from('bid_results')
        .select('bid_ntce_no, openg_at, prtcpt_cnum, winner_nm, sajeong, win_y, bssamt, rng, dminstt_cd, dminstt_nm')
        .not('openg_at', 'is', null).order('openg_at', { ascending: true }).range(from, to)),
      fetchAllPaged<{ bid_ntce_no: string; bid_ntce_ord: string; prtcpt_rgns: string[] | null; mfrc_flds: string[] | null }>((from, to) =>
        supabase.from('bid_notices').select('bid_ntce_no, bid_ntce_ord, prtcpt_rgns, mfrc_flds')
          .or('prtcpt_rgns.not.is.null,mfrc_flds.not.is.null')
          .order('bid_ntce_no').order('bid_ntce_ord').range(from, to)),
    ]).then(([r, ns]) => {
      if (!alive) return
      // 정정공고는 차수마다 줄이 있다 — 값이 있는 가장 늦은 차수 것
      ns.sort((a, b) => b.bid_ntce_ord.localeCompare(a.bid_ntce_ord))
      const m = new Map<string, Meta>()
      for (const x of ns) {
        const cur = m.get(x.bid_ntce_no) ?? { rgns: null, flds: null }
        m.set(x.bid_ntce_no, { rgns: cur.rgns ?? x.prtcpt_rgns, flds: cur.flds ?? x.mfrc_flds })
      }
      setMeta(m)
      // 버전 4 짐작이 참가지역 제한을 쓴다
      setRows(r.map(x => ({ ...x, rgns: m.get(x.bid_ntce_no)?.rgns ?? null })))
    }).catch(() => { if (alive) setRows([]) })
    return () => { alive = false }
  }, [supabase])

  // 추천 재료 — 공고 화면과 같게 주력분야가 아닌 공고(석공 등)의 낙찰은 뺀다
  const pool = useMemo(
    () => (rows ?? []).filter(r => r.sajeong != null && fitsFields(meta.get(r.bid_ntce_no)?.flds, ourFields) !== false),
    [rows, meta, ourFields],
  )

  const targets = useMemo(() => {
    const since = period ? new Date(Date.now() - period * DAY).toISOString() : ''
    return (rows ?? []).filter(r => r.openg_at >= since && (!ours || (
      canEnter(meta.get(r.bid_ntce_no)?.rgns, ourRegion) !== false &&
      fitsFields(meta.get(r.bid_ntce_no)?.flds, ourFields) !== false)))
  }, [rows, meta, period, ours, ourRegion, ourFields])

  const one = targets.filter(t => t.prtcpt_cnum === 1).length
  const calc = useMemo(() => targets.filter(t => t.sajeong != null), [targets])
  const noDetail = targets.length - one - calc.length
  // 아무 자리에나 넣는 평균 업체가 딸 건수 — 공고마다 참여 업체 수분의 1
  const baseline = calc.reduce((s, t) => s + (t.prtcpt_cnum ? 1 / t.prtcpt_cnum : 0), 0)
  const medianN = useMemo(() => {
    const ns = calc.map(t => t.prtcpt_cnum ?? 0).sort((a, b) => a - b)
    return ns.length ? ns[Math.floor(ns.length / 2)] : 0
  }, [calc])

  // 전략마다 공고 수천 건을 다시 계산하므로 화면이 멈추지 않게 나눠서 돈다
  const [tallies, setTallies] = useState<Record<string, Tally> | null>(null)
  // 실험 2 재료 — 공고마다 미리 짐작한 참여 업체 수, 실제 수, 지금 추천으로 넣었을 때 판정
  const [picks, setPicks] = useState<{ pred: number; actual: number; v: Verdict | null }[]>([])
  const [versions, setVersions] = useState<Record<string, VersionTally> | null>(null)
  const [progress, setProgress] = useState(0)
  useEffect(() => {
    let alive = true
    setTallies(null)
    setVersions(null)
    setProgress(0)
    const acc: Record<string, Tally> = Object.fromEntries(STRATEGIES.map(s => [s.id, emptyTally()]))
    const per: { pred: number; actual: number; v: Verdict | null }[] = []
    const all = rows ?? []
    const vt: Record<string, VersionTally> = Object.fromEntries(VERSIONS.map(v => [v.id, { bids: 0, win: 0, pass: 0, below: 0, none: 0, expect: 0 }]))
    let i = 0
    const step = () => {
      if (!alive) return
      const end = Math.min(calc.length, i + 60)
      for (; i < end; i++) {
        const t = calc[i]
        const prior = priorOf(pool, t.openg_at)
        let vCurrent: Verdict | null = null
        for (const s of STRATEGIES) {
          const y = s.pick(prior, t)
          if (y == null) acc[s.id].none++
          else {
            const v = verdictOf(y, t)
            acc[s.id][v]++
            if (s.id === 'current') vCurrent = v
          }
        }
        // 참여 업체 수는 석공 공고까지 다 쓴다 — 발주기관이 얼마나 붐비는지는 업종을 안 가린다
        const allPrior = priorOf(all, t.openg_at)
        const pred = predictN(allPrior, t)
        if (pred && t.prtcpt_cnum) per.push({ pred: pred.n, actual: t.prtcpt_cnum, v: vCurrent })

        // 버전 비교 — 같은 공고들에 버전마다 '넣을까, 얼마에'를 정해 센다
        const ctx: VersionCtx = { prior, t, pred1: pred?.n ?? null, pred2: predictNByRegion(allPrior, t)?.n ?? null }
        for (const v of VERSIONS) {
          if (!v.bid(ctx)) continue
          const tally = vt[v.id]
          tally.bids++
          if (t.prtcpt_cnum) tally.expect += 1 / t.prtcpt_cnum
          const y = v.pick(ctx)
          if (y == null) tally.none++
          else tally[verdictOf(y, t)]++
        }
      }
      if (i < calc.length) { setProgress(i / calc.length); setTimeout(step, 0) }
      else { setTallies(acc); setPicks(per); setVersions(vt) }
    }
    setTimeout(step, 0)
    return () => { alive = false }
  }, [calc, pool, rows])

  const buckets = useMemo(() => N_BUCKETS.map((b, i) => {
    const xs = picks.filter(p => bucketOf(p.pred) === i)
    const acts = xs.map(p => p.actual).sort((a, b) => a - b)
    return {
      label: b.label,
      count: xs.length,
      actualMedian: acts.length ? acts[Math.floor(acts.length / 2)] : null,
      win: xs.filter(p => p.v === 'win').length,
      expect: xs.reduce((s, p) => s + 1 / p.actual, 0),
    }
  }), [picks])
  const [cut, setCut] = useState(60)
  const chosen = useMemo(() => {
    const xs = picks.filter(p => p.pred <= cut)
    return { count: xs.length, win: xs.filter(p => p.v === 'win').length, expect: xs.reduce((s, p) => s + 1 / p.actual, 0) }
  }, [picks, cut])
  const allWin = picks.filter(p => p.v === 'win').length
  // 짐작이 얼마나 맞나 — 실제 참여가 짐작의 절반~두 배 안에 든 비율
  const within2x = picks.length ? picks.filter(p => p.actual >= p.pred / 2 && p.actual <= p.pred * 2).length / picks.length : null

  const sweep = useMemo(() => fixedSweep(calc), [calc])
  const sweepBest = sweep.reduce((b, p) => (p.win > b.win ? p : b), sweep[0] ?? { y: 1, win: 0, pass: 0, below: 0 })
  const fixedTally = useMemo(() => {
    const c = { win: 0, pass: 0, below: 0 }
    for (const t of calc) c[verdictOf(fixedY, t)]++
    return c
  }, [calc, fixedY])

  const winners = useMemo(() => {
    const m = new Map<string, number>()
    for (const t of targets) if (t.winner_nm) m.set(t.winner_nm, (m.get(t.winner_nm) ?? 0) + 1)
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
  }, [targets])

  if (!rows) return <p className="py-10 text-center text-sm text-gray-400">불러오는 중…</p>

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
        <Chip on={ours} onClick={() => setOurs(v => !v)} title="참가가능지역·주력분야가 우리 업체에 맞는 공고만">우리 업체 공고만</Chip>
        <span className="mx-1 h-4 w-px bg-gray-200 dark:bg-gray-800" />
        {PERIODS.map(([p, label]) => (
          <Chip key={p} on={period === p} onClick={() => setPeriod(p)}>{label}</Chip>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Tile label="개찰한 공고" value={n(targets.length)} />
        <Tile label="입찰자 1곳" value={n(one)} sub="경쟁 없음 — 계산에서 뺌" />
        <Tile label="상세 못 받음" value={n(noDetail)} sub="예정가격을 아직 못 받음" />
        <Tile label="계산한 공고" value={n(calc.length)} sub={calc.length ? `참여 업체 가운데 값 ${n(medianN)}곳` : undefined} />
        <Tile label="평균 업체라면" value={`${baseline.toFixed(1)}건`} sub="공고마다 1 ÷ 참여 업체 수를 더한 값" strong />
      </div>

      <VersionTable versions={versions} progress={progress} />

      <section className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
          실험 1 · 금액 자리 고르는 방법별 결과 <span className="ml-1 text-[11px] font-normal text-gray-400">버전 1</span>
        </h2>
        <p className="mt-0.5 text-xs text-gray-500">
          공고마다 그 공고 개찰 전 낙찰만 보고 자리를 정했습니다. 다른 업체는 실제 넣은 그대로라고 봅니다.
          &lsquo;평균 업체라면&rsquo;({baseline.toFixed(1)}건)보다 많이 따야 의미가 있습니다.
        </p>
        <Legend />
        {!tallies ? (
          <p className="py-6 text-center text-xs text-gray-400">계산 중… {Math.round(progress * 100)}%</p>
        ) : !calc.length ? (
          <p className="py-6 text-center text-xs text-gray-400">계산할 공고가 없습니다</p>
        ) : (
          <div className="mt-3 space-y-3">
            {STRATEGIES.map(s => {
              const t = tallies[s.id]
              const best = Math.max(...STRATEGIES.map(x => tallies[x.id].win))
              return (
                <div key={s.id}>
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
                    <span className="font-medium text-gray-900 dark:text-white" title={s.desc}>
                      {s.label}
                      {t.win === best && t.win > 0 && <span className="ml-1.5 rounded bg-emerald-100 px-1.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400">가장 많이</span>}
                    </span>
                    <span className="text-xs text-gray-600 tabular-nums dark:text-gray-300">
                      낙찰 <b className="text-gray-900 dark:text-white">{n(t.win)}건</b> ({pct(t.win, calc.length)})
                      {baseline > 0 && <> · 평균 업체의 {(t.win / baseline).toFixed(2)}배</>}
                    </span>
                  </div>
                  <StackBar t={t} total={calc.length} />
                  <p className="mt-0.5 text-[11px] text-gray-400">{s.desc}</p>
                </div>
              )
            })}
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white">실험 1 참고 · 늘 같은 자리에 넣었다면</h2>
        <p className="mt-0.5 text-xs text-gray-500">
          모든 공고에 같은 y(= 투찰금액이 버티는 가장 높은 사정률)로 넣었을 때 낙찰 수입니다. 결과를 다 보고 고른 값이라
          실제로는 미리 알 수 없습니다 — 추천 방법들이 이 선에 얼마나 가까운지 보는 참고용입니다.
        </p>
        {calc.length > 0 && <>
          <SweepChart sweep={sweep} fixedY={fixedY} best={sweepBest} />
          <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
            <label className="flex items-center gap-2">
              <span className="text-xs text-gray-500">y</span>
              <input type="range" min={0.98} max={1.02} step={0.0005} value={fixedY}
                onChange={e => setFixedY(Number(e.target.value))} className="w-56" aria-label="고정 y" />
              <b className="tabular-nums">{(fixedY * 100).toFixed(2)}%</b>
            </label>
            <span className="text-xs text-gray-600 tabular-nums dark:text-gray-300">
              낙찰 <b className="text-gray-900 dark:text-white">{n(fixedTally.win)}</b> · 밀림 {n(fixedTally.pass)} · 미달 {n(fixedTally.below)}
            </span>
            <span className="text-xs text-gray-400">
              가장 많이 딴 고정값 {(sweepBest.y * 100).toFixed(2)}% — {n(sweepBest.win)}건
            </span>
          </div>
        </>}
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
          실험 2 · 경쟁이 적을 공고만 골라 넣으면 <span className="ml-1 text-[11px] font-normal text-gray-400">버전 2</span>
        </h2>
        <p className="mt-0.5 text-xs text-gray-500">
          공고마다 개찰 전 낙찰만으로 참여 업체 수를 미리 짐작했습니다(같은 발주기관 → 같은 시도·비슷한 금액대 → 비슷한 금액대의 가운데 값).
          금액은 &lsquo;지금 추천&rsquo; 그대로 넣었다고 봅니다. 한 공고를 딸 확률은 대략 1 ÷ 참여 업체 수라, 어느 공고에 넣느냐가 낙찰률을 가릅니다.
        </p>
        {!tallies ? (
          <p className="py-6 text-center text-xs text-gray-400">계산 중… {Math.round(progress * 100)}%</p>
        ) : !picks.length ? (
          <p className="py-6 text-center text-xs text-gray-400">짐작할 만큼 쌓인 공고가 없습니다</p>
        ) : <>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[600px] text-sm">
              <thead className="text-left text-xs text-gray-500">
                <tr>
                  <th className="py-1.5 font-medium">미리 짐작한 참여</th>
                  <th className="py-1.5 text-right font-medium">공고</th>
                  <th className="py-1.5 text-right font-medium">실제 참여(가운데)</th>
                  <th className="py-1.5 text-right font-medium">낙찰</th>
                  <th className="py-1.5 pl-4 font-medium">공고당 낙찰률</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {(() => {
                  const maxRate = Math.max(0.0001, ...buckets.flatMap(x => (x.count ? [x.win / x.count, x.expect / x.count] : [])))
                  return buckets.map(b => (
                    <tr key={b.label}>
                      <td className="py-2 text-gray-900 dark:text-white">{b.label}</td>
                      <td className="py-2 text-right tabular-nums text-gray-600 dark:text-gray-300">{n(b.count)}</td>
                      <td className="py-2 text-right tabular-nums text-gray-600 dark:text-gray-300">{b.actualMedian != null ? `${n(b.actualMedian)}곳` : '-'}</td>
                      <td className="py-2 text-right font-medium tabular-nums text-gray-900 dark:text-white">{n(b.win)}</td>
                      <td className="py-2 pl-4">
                        <div className="flex items-center gap-2">
                          <div className="relative h-2.5 w-40 shrink-0 rounded-sm bg-gray-100 dark:bg-gray-800"
                            title={`낙찰률 ${pct(b.win, b.count)} · 평균 업체 ${pct(b.expect, b.count)}`}>
                            <div className="absolute inset-y-0 left-0 rounded-sm bg-emerald-500" style={{ width: `${(b.count ? b.win / b.count / maxRate : 0) * 100}%` }} />
                            {b.count > 0 && <div className="absolute -inset-y-0.5 w-0.5 bg-gray-900 dark:bg-white" style={{ left: `${(b.expect / b.count / maxRate) * 100}%` }} />}
                          </div>
                          <span className="whitespace-nowrap text-xs tabular-nums text-gray-600 dark:text-gray-300">
                            {pct(b.win, b.count)} <span className="text-gray-400">(평균 업체 {pct(b.expect, b.count)})</span>
                          </span>
                        </div>
                      </td>
                    </tr>
                  ))
                })()}
              </tbody>
            </table>
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 text-[11px] text-gray-500">
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-emerald-500" />지금 추천으로 넣었을 때 낙찰률</span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-0.5 bg-gray-900 dark:bg-white" />평균 업체 기대 낙찰률</span>
          </div>

          <div className="mt-4 rounded-xl bg-gray-50 p-3 text-sm dark:bg-gray-950">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-gray-500">짐작한 참여가</span>
              {[30, 60, 100].map(c => (
                <Chip key={c} size="xs" on={cut === c} onClick={() => setCut(c)}>{c}곳 이하만</Chip>
              ))}
              <Chip size="xs" on={cut === Infinity} onClick={() => setCut(Infinity)}>전부</Chip>
            </div>
            <p className="mt-2 text-gray-700 dark:text-gray-300">
              {n(chosen.count)}건에 넣어 <b className="text-emerald-600 dark:text-emerald-400">{n(chosen.win)}건 낙찰</b> — 공고당 {pct(chosen.win, chosen.count)}
              <span className="text-gray-400"> (평균 업체 {pct(chosen.expect, chosen.count)}) · 전부 넣으면 {n(picks.length)}건에 {n(allWin)}건, {pct(allWin, picks.length)}</span>
            </p>
            {within2x != null && (
              <p className="mt-1 text-[11px] text-gray-400">
                짐작 정확도 — 실제 참여가 짐작의 절반~두 배 안에 든 공고 {(within2x * 100).toFixed(0)}%
              </p>
            )}
          </div>
        </>}
      </section>

      {winners.length > 0 && (
        <section className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">자주 낙찰받은 업체</h2>
          <ul className="mt-2 space-y-1.5">
            {winners.map(([nm, c]) => (
              <li key={nm} className="flex items-center gap-3 text-sm">
                <span className="w-40 shrink-0 truncate text-gray-700 dark:text-gray-300" title={nm}>{nm}</span>
                <span className="h-2 rounded-r bg-blue-500" style={{ width: `${(c / winners[0][1]) * 60}%` }} />
                <span className="text-xs tabular-nums text-gray-500">{c}건</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

function Tile({ label, value, sub, strong }: { label: string; value: string; sub?: string; strong?: boolean }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
      <div className="text-xs text-gray-500">{label}</div>
      <div className={`mt-1 text-xl font-bold tabular-nums ${strong ? 'text-blue-600 dark:text-blue-400' : 'text-gray-900 dark:text-white'}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-gray-400">{sub}</div>}
    </div>
  )
}

function Legend() {
  return (
    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-gray-500">
      {VERDICTS.map(v => (
        <span key={v.id} className="flex items-center gap-1.5"><span className={`h-2.5 w-2.5 rounded-sm ${v.dot}`} />{v.label}</span>
      ))}
    </div>
  )
}

function StackBar({ t, total }: { t: Tally; total: number }) {
  return (
    <div className="mt-1 flex h-3 w-full gap-0.5 overflow-hidden rounded">
      {VERDICTS.map(v => {
        const c = t[v.id]
        if (!c) return null
        return <span key={v.id} className={`${v.bar} h-full`} style={{ width: `${(c / total) * 100}%` }}
          title={`${v.label} ${n(c)}건 (${pct(c, total)})`} />
      })}
    </div>
  )
}

/** 고정 y 마다 낙찰 수 — 막대 하나가 y 한 칸. 지금 고른 칸과 가장 많이 딴 칸을 표시한다 */
function SweepChart({ sweep, fixedY, best }: { sweep: { y: number; win: number }[]; fixedY: number; best: { y: number; win: number } }) {
  const [hover, setHover] = useState<number | null>(null)
  const max = Math.max(1, ...sweep.map(p => p.win))
  const h = hover != null ? sweep[hover] : null
  return (
    <div className="relative mt-3">
      <div className="flex h-32 items-end gap-px" onMouseLeave={() => setHover(null)}>
        {sweep.map((p, i) => {
          const on = Math.abs(p.y - fixedY) < 1e-6
          return (
            <div key={p.y} className="flex h-full flex-1 items-end" onMouseEnter={() => setHover(i)}>
              <div className={`w-full rounded-t-sm ${on ? 'bg-blue-600 dark:bg-blue-400' : p.y === best.y ? 'bg-emerald-500' : 'bg-gray-300 dark:bg-gray-600'} ${hover === i ? 'opacity-70' : ''}`}
                style={{ height: `${Math.max(2, (p.win / max) * 100)}%` }} />
            </div>
          )
        })}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-gray-400 tabular-nums">
        <span>98%</span><span>99%</span><span>100%</span><span>101%</span><span>102%</span>
      </div>
      {h && (
        <div className="pointer-events-none absolute -top-2 right-0 rounded-md bg-gray-900 px-2 py-1 text-[11px] text-white tabular-nums dark:bg-gray-100 dark:text-gray-900">
          y {(h.y * 100).toFixed(2)}% · 낙찰 {h.win}건
        </div>
      )}
    </div>
  )
}

/**
 * 버전 비교 — 버전 1(전부·지금 추천)을 기준으로 공고당 낙찰률이 운이 아니게 올랐는지 본다.
 * 확실히 낫지 않으면 버전 1을 그대로 쓴다.
 */
function VersionTable({ versions, progress }: { versions: Record<string, VersionTally> | null; progress: number }) {
  const base = versions?.v1
  const baseRate = base && base.bids ? base.win / base.bids : 0
  return (
    <section className="rounded-2xl border-2 border-blue-600/30 bg-white p-4 dark:border-blue-400/30 dark:bg-gray-900">
      <h2 className="text-sm font-semibold text-gray-900 dark:text-white">버전 비교 — 버전 1 기준</h2>
      <p className="mt-0.5 text-xs text-gray-500">
        같은 공고들에 버전마다 &lsquo;넣을지&rsquo;와 &lsquo;얼마에&rsquo;를 정해 셉니다. 공고당 낙찰률이 버전 1보다 높고,
        그만큼 높게 나올 확률이 우연으로는 5% 미만일 때만 &lsquo;나음&rsquo;입니다. 아니면 버전 1을 씁니다.
      </p>
      {!versions || !base ? (
        <p className="py-6 text-center text-xs text-gray-400">계산 중… {Math.round(progress * 100)}%</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="text-left text-xs text-gray-500">
              <tr>
                <th className="py-1.5 font-medium">버전</th>
                <th className="py-1.5 text-right font-medium">넣은 공고</th>
                <th className="py-1.5 text-right font-medium">낙찰</th>
                <th className="py-1.5 text-right font-medium">공고당 낙찰률</th>
                <th className="py-1.5 text-right font-medium">버전 1 대비</th>
                <th className="py-1.5 pl-4 font-medium">판정</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {VERSIONS.map(v => {
                const t = versions[v.id]
                const rate = t.bids ? t.win / t.bids : 0
                const chance = v.id === 'v1' ? null : chanceAtLeast(t.win, t.bids, baseRate)
                const verdict = v.id === 'v1' ? { text: '기준', cls: 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300' }
                  : rate > baseRate && chance! < 0.05 ? { text: '확실히 나음', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400' }
                  : rate > baseRate ? { text: '나아 보이나 우연일 수 있음 — 버전 1 유지', cls: 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400' }
                  : { text: '나아지지 않음 — 버전 1 유지', cls: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300' }
                return (
                  <tr key={v.id}>
                    <td className="py-2 pr-3">
                      <div className="font-medium text-gray-900 dark:text-white">{v.label}</div>
                      <div className="text-[11px] text-gray-400">{v.desc}</div>
                    </td>
                    <td className="py-2 text-right tabular-nums text-gray-600 dark:text-gray-300">{n(t.bids)}</td>
                    <td className="py-2 text-right font-medium tabular-nums text-gray-900 dark:text-white">{n(t.win)}</td>
                    <td className="py-2 text-right tabular-nums text-gray-900 dark:text-white">{pct(t.win, t.bids)}</td>
                    <td className="whitespace-nowrap py-2 text-right tabular-nums text-gray-600 dark:text-gray-300">
                      {v.id === 'v1' ? '-' : baseRate ? `${(rate / baseRate).toFixed(2)}배` : '-'}
                      {chance != null && <div className="text-[11px] text-gray-400">우연일 확률 {(chance * 100).toFixed(chance < 0.01 ? 2 : 0)}%</div>}
                    </td>
                    <td className="py-2 pl-4"><span className={`whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium ${verdict.cls}`}>{verdict.text}</span></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
