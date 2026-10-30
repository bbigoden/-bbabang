'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { fetchAllPaged } from '@/lib/fetch-all-paged'
import { Chip } from '@/components/ui/chip'
import { canEnter, fitsFields } from '@/lib/bid-notices'
import { VERSIONS, chanceAtLeast, fixedSweep, priorOf, verdictOf, type LabRow, type Verdict, type VersionResult } from '@/lib/bid-lab'

/**
 * 실험실 — 투찰 금액 고르는 방법(버전)을 이미 개찰한 공고에 넣어 보고 버전 1과 낙찰 건수를 비교한다.
 * 계산 방식과 규칙은 src/lib/bid-lab.ts 맨 위에 적어 두었다.
 */

type Row = LabRow & { bid_ntce_no: string; winner_nm: string | null }
type Meta = { rgns: string[] | null; flds: string[] | null; site: string | null }
type Period = 30 | 90 | 0

const PERIODS: [Period, string][] = [[30, '최근 30일'], [90, '최근 90일'], [0, '받은 전체']]
const DAY = 86_400_000
const VERDICTS: { id: Verdict | 'none'; label: string; bar: string }[] = [
  { id: 'win', label: '낙찰', bar: 'bg-emerald-500' },
  { id: 'pass', label: '통과·순위 밀림', bar: 'bg-gray-400 dark:bg-gray-500' },
  { id: 'below', label: '하한 미달', bar: 'bg-red-400' },
  { id: 'none', label: '추천 못 함 (비교할 낙찰 5건 미만)', bar: 'bg-gray-200 dark:bg-gray-700' },
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
        .not('openg_at', 'is', null).order('openg_at', { ascending: true })
        .order('bid_ntce_no').order('bid_ntce_ord').order('rbid_no').range(from, to)),
      fetchAllPaged<{ bid_ntce_no: string; bid_ntce_ord: string; prtcpt_rgns: string[] | null; mfrc_flds: string[] | null; site_region: string | null }>((from, to) =>
        supabase.from('bid_notices').select('bid_ntce_no, bid_ntce_ord, prtcpt_rgns, mfrc_flds, site_region')
          .or('prtcpt_rgns.not.is.null,mfrc_flds.not.is.null')
          .order('bid_ntce_no').order('bid_ntce_ord').range(from, to)),
    ]).then(([r, ns]) => {
      if (!alive) return
      // 정정공고는 차수마다 줄이 있다 — 값이 있는 가장 늦은 차수 것
      ns.sort((a, b) => b.bid_ntce_ord.localeCompare(a.bid_ntce_ord))
      const m = new Map<string, Meta>()
      for (const x of ns) {
        const cur = m.get(x.bid_ntce_no) ?? { rgns: null, flds: null, site: null }
        m.set(x.bid_ntce_no, { rgns: cur.rgns ?? x.prtcpt_rgns, flds: cur.flds ?? x.mfrc_flds, site: cur.site ?? x.site_region })
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
      canEnter(meta.get(r.bid_ntce_no)?.rgns, ourRegion, meta.get(r.bid_ntce_no)?.site) !== false &&
      fitsFields(meta.get(r.bid_ntce_no)?.flds, ourFields) !== false)))
  }, [rows, meta, period, ours, ourRegion, ourFields])

  const one = targets.filter(t => t.prtcpt_cnum === 1).length
  const calc = useMemo(() => targets.filter(t => t.sajeong != null), [targets])
  const noDetail = targets.length - one - calc.length
  // 아무 금액에나 넣는 평균 업체가 딸 건수 — 공고마다 참여 업체 수분의 1
  const baseline = calc.reduce((s, t) => s + (t.prtcpt_cnum ? 1 / t.prtcpt_cnum : 0), 0)
  const medianN = useMemo(() => {
    const ns = calc.map(t => t.prtcpt_cnum ?? 0).sort((a, b) => a - b)
    return ns.length ? ns[Math.floor(ns.length / 2)] : 0
  }, [calc])

  // 버전마다 공고 수천 건을 다시 계산하므로 화면이 멈추지 않게 나눠서 돈다
  const [results, setResults] = useState<Record<string, VersionResult> | null>(null)
  const [progress, setProgress] = useState(0)
  useEffect(() => {
    let alive = true
    setResults(null)
    setProgress(0)
    const acc: Record<string, VersionResult> = Object.fromEntries(VERSIONS.map(v => [v.id, { win: 0, pass: 0, below: 0, none: 0, gain: 0, lost: 0 }]))
    let i = 0
    const step = () => {
      if (!alive) return
      const end = Math.min(calc.length, i + 40)
      for (; i < end; i++) {
        const t = calc[i]
        const ctx = { prior: priorOf(pool, t.openg_at), t }
        let baseWin = false
        for (const v of VERSIONS) {
          const y = v.pick(ctx)
          const verdict = y == null ? null : verdictOf(y, t)
          const r = acc[v.id]
          if (verdict) r[verdict]++
          else r.none++
          const won = verdict === 'win'
          if (v.id === 'v1') baseWin = won
          else if (won && !baseWin) r.gain++
          else if (!won && baseWin) r.lost++
        }
      }
      if (i < calc.length) { setProgress(i / calc.length); setTimeout(step, 0) }
      else setResults(acc)
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

      <VersionTable results={results} total={calc.length} baseline={baseline} progress={progress} />

      <section className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white">참고 · 늘 같은 자리에 넣었다면</h2>
        <p className="mt-0.5 text-xs text-gray-500">
          모든 공고에 같은 y(= 투찰금액이 버티는 가장 높은 사정률)로 넣었을 때 낙찰 수입니다. 결과를 다 보고 고른 값이라
          실제로는 미리 알 수 없습니다 — 버전들이 이 선에 얼마나 가까운지 보는 참고용입니다.
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

/**
 * 버전 비교 — 모든 버전이 같은 공고에 다 넣고 금액만 다르다. 버전 1보다 더 많이 땄고, 그 차이가
 * 우연일 확률이 5% 미만일 때만 '나음'. 아니면 버전 1을 쓴다.
 */
function VersionTable({ results, total, baseline, progress }: {
  results: Record<string, VersionResult> | null; total: number; baseline: number; progress: number
}) {
  const base = results?.v1
  return (
    <section className="rounded-2xl border-2 border-blue-600/30 bg-white p-4 dark:border-blue-400/30 dark:bg-gray-900">
      <h2 className="text-sm font-semibold text-gray-900 dark:text-white">버전 비교 — 버전 1 기준</h2>
      <p className="mt-0.5 text-xs text-gray-500">
        모든 버전이 같은 공고 {n(total)}건에 다 넣고 금액만 다릅니다(공고마다 그 공고 개찰 전 낙찰만 보고 정함).
        버전 1보다 <b>더 많이 땄고</b> 그 차이가 우연일 확률이 5% 미만일 때만 &lsquo;나음&rsquo;입니다. 아니면 버전 1을 씁니다.
      </p>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-gray-500">
        {VERDICTS.map(v => (
          <span key={v.id} className="flex items-center gap-1.5"><span className={`h-2.5 w-2.5 rounded-sm ${v.bar}`} />{v.label}</span>
        ))}
      </div>
      {!results || !base ? (
        <p className="py-6 text-center text-xs text-gray-400">계산 중… {Math.round(progress * 100)}%</p>
      ) : !total ? (
        <p className="py-6 text-center text-xs text-gray-400">계산할 공고가 없습니다</p>
      ) : (
        <div className="mt-3 space-y-3">
          {VERSIONS.map(v => {
            const r = results[v.id]
            const diff = r.win - base.win
            const chance = v.id === 'v1' ? null : chanceAtLeast(r.gain, r.gain + r.lost, 0.5)
            const verdict = v.id === 'v1' ? { text: '기준 · 지금 사용 중', cls: 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300' }
              : diff > 0 && chance! < 0.05 ? { text: '확실히 나음', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400' }
              : diff > 0 ? { text: '더 땄지만 우연일 수 있음 — 버전 1 유지', cls: 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400' }
              : { text: '나아지지 않음 — 버전 1 유지', cls: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300' }
            return (
              <div key={v.id}>
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm">
                  <span className="font-medium text-gray-900 dark:text-white">
                    {v.label}
                    <span className={`ml-2 whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium ${verdict.cls}`}>{verdict.text}</span>
                  </span>
                  <span className="text-xs tabular-nums text-gray-600 dark:text-gray-300">
                    낙찰 <b className="text-gray-900 dark:text-white">{n(r.win)}건</b>
                    {v.id !== 'v1' && <> ({diff >= 0 ? '+' : ''}{diff}건 · 이 버전만 딴 것 {r.gain} / 버전 1만 딴 것 {r.lost}
                      {chance != null && ` · 우연일 확률 ${(chance * 100).toFixed(0)}%`})</>}
                    {baseline > 0 && <span className="text-gray-400"> · 평균 업체의 {(r.win / baseline).toFixed(2)}배</span>}
                  </span>
                </div>
                <div className="mt-1 flex h-3 w-full gap-0.5 overflow-hidden rounded">
                  {VERDICTS.map(x => {
                    const c = r[x.id]
                    return c ? <span key={x.id} className={`${x.bar} h-full`} style={{ width: `${(c / total) * 100}%` }}
                      title={`${x.label} ${n(c)}건 (${pct(c, total)})`} /> : null
                  })}
                </div>
                <p className="mt-0.5 text-[11px] text-gray-400">{v.desc}</p>
              </div>
            )
          })}
        </div>
      )}
    </section>
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
