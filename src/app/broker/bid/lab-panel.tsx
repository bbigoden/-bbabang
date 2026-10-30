'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { fetchAllPaged } from '@/lib/fetch-all-paged'
import { Chip } from '@/components/ui/chip'
import { canEnter, fitsFields } from '@/lib/bid-notices'
import {
  STRATEGIES, emptyTally, fixedSweep, priorOf, verdictOf,
  type LabRow, type Tally, type Verdict,
} from '@/lib/bid-lab'

/**
 * 실험실 — 투찰 자리를 고르는 방법을 이미 개찰한 공고에 넣어 보고 낙찰 수를 비교한다.
 * 계산 방식은 src/lib/bid-lab.ts 맨 위에 적어 두었다.
 */

type Row = LabRow & { bid_ntce_no: string; winner_nm: string | null }
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
      setRows(r)
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
  const [progress, setProgress] = useState(0)
  useEffect(() => {
    let alive = true
    setTallies(null)
    setProgress(0)
    const acc: Record<string, Tally> = Object.fromEntries(STRATEGIES.map(s => [s.id, emptyTally()]))
    let i = 0
    const step = () => {
      if (!alive) return
      const end = Math.min(calc.length, i + 60)
      for (; i < end; i++) {
        const t = calc[i]
        const prior = priorOf(pool, t.openg_at)
        for (const s of STRATEGIES) {
          const y = s.pick(prior, t)
          if (y == null) acc[s.id].none++
          else acc[s.id][verdictOf(y, t)]++
        }
      }
      if (i < calc.length) { setProgress(i / calc.length); setTimeout(step, 0) }
      else setTallies(acc)
    }
    setTimeout(step, 0)
    return () => { alive = false }
  }, [calc, pool])

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

      <section className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white">자리 고르는 방법별 결과</h2>
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
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white">늘 같은 자리에 넣었다면</h2>
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
