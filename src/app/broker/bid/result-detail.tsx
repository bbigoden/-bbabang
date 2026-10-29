'use client'

import { useEffect, useMemo, useState } from 'react'
import { ExternalLink } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

/**
 * 낙찰결과 한 건 펼침 — 예정가격이 어떻게 나왔고, 하한선이 어디였고, 누가 어디에 넣었는지.
 *
 * 나라장터 개찰결과 화면을 다시 열지 않고 여기서 바로 맞춰 보게 한다
 * (온양문화원을 사장님이 직접 계산기로 맞춰 보던 것을 화면이 대신한다).
 * 업체별 투찰은 수천 줄이라 목록엔 안 싣고, 펼칠 때 이 공고 것만 받는다.
 */

export type ResultForDetail = {
  bid_ntce_no: string
  bid_ntce_ord: string
  rbid_no: string
  bssamt: number | null
  plnprc: number | null
  lwlt_rate: number | null
  a_amount: number | null
  sajeong: number | null
  prices: { sno: number; price: number; drawn: boolean; picks: number }[] | null
}

type Bid = { rank: number; bizno: string; company_nm: string | null; amount: number | null; rate: number | null; picks: number[] | null; rmrk: string | null }

const won = (n: number | null | undefined) => (n == null ? '-' : n.toLocaleString('ko-KR'))
/** 하한선 위아래로 이만큼만 먼저 보인다. 참여가 500곳 넘는 공고도 있다 */
const AROUND = 8

export function ResultDetail({ r }: { r: ResultForDetail }) {
  const supabase = useMemo(() => createClient(), [])
  const [bids, setBids] = useState<Bid[] | null>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [all, setAll] = useState(false)

  useEffect(() => {
    let alive = true
    void Promise.all([
      supabase.from('bid_result_bids').select('rank, bizno, company_nm, amount, rate, picks, rmrk')
        .eq('bid_ntce_no', r.bid_ntce_no).eq('bid_ntce_ord', r.bid_ntce_ord).eq('rbid_no', r.rbid_no)
        .order('amount', { ascending: true }).limit(2000),
      supabase.from('bid_notices').select('detail_url')
        .eq('bid_ntce_no', r.bid_ntce_no).order('bid_ntce_ord', { ascending: false }).limit(1).maybeSingle(),
    ]).then(([b, n]) => {
      if (!alive) return
      setBids((b.data as Bid[]) ?? [])
      setUrl((n.data?.detail_url as string | null) ?? null)
    })
    return () => { alive = false }
  }, [supabase, r.bid_ntce_no, r.bid_ntce_ord, r.rbid_no])

  const A = r.a_amount ?? 0
  const L = r.lwlt_rate
  const floor = r.plnprc && L ? Math.ceil((r.plnprc - A) * (L / 100) + A) : null

  // 1순위는 나라장터 순위 그대로(적격심사로 뒤바뀌기도 한다). 없으면 하한선 위 첫 업체. 그 주변만 먼저 보인다
  const winIdx = !bids ? -1 : bids.some(b => b.rank === 1)
    ? bids.findIndex(b => b.rank === 1)
    : floor != null ? bids.findIndex(b => (b.amount ?? 0) >= floor) : -1
  const shown = !bids ? [] : all || bids.length <= AROUND * 2 + 1 || winIdx < 0
    ? bids
    : bids.slice(Math.max(0, winIdx - AROUND), winIdx + AROUND + 1)

  return (
    <div className="space-y-3 rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm dark:border-gray-800 dark:bg-gray-950">
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
        <span>공고번호 {r.bid_ntce_no}-{r.bid_ntce_ord}{r.rbid_no !== '000' && ` (재입찰 ${r.rbid_no})`}</span>
        {url && (
          <a href={url} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-blue-600 hover:underline dark:text-blue-400">
            나라장터 원문 <ExternalLink className="h-3 w-3" aria-hidden />
          </a>
        )}
      </div>

      {!r.plnprc ? (
        <p className="text-gray-500">예정가격 상세를 아직 받지 않았습니다. 수집이 3시간마다 채웁니다.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            <Cell label="기초금액" value={`${won(r.bssamt)}원`} />
            <Cell label="예정가격" value={`${won(r.plnprc)}원`}
              sub={r.bssamt ? `기초금액의 ${(r.plnprc / r.bssamt * 100).toFixed(3)}%` : undefined} />
            <Cell label="사정률 (A값 뺀 기준)" value={r.sajeong != null ? `${(r.sajeong * 100).toFixed(3)}%` : '-'} />
            <Cell label="A값" value={`${won(r.a_amount)}원`} />
            <Cell label="하한선" value={floor != null ? `${won(floor)}원` : '-'} strong
              sub={L ? `(예정가격 − A) × ${L}% + A` : '하한율 없음'} />
          </div>

          {r.prices?.length ? (
            <div>
              <div className="mb-1 text-xs text-gray-500">예비가격 15개 — 진한 칸이 뽑힌 4개(평균이 예정가격), 괄호는 그 번호를 고른 업체 수</div>
              <div className="grid grid-cols-3 gap-1 sm:grid-cols-5">
                {r.prices.map(p => (
                  <div key={p.sno} className={`rounded-md px-2 py-1 text-xs tabular-nums ${p.drawn
                    ? 'bg-blue-600 text-white dark:bg-blue-500'
                    : 'bg-white text-gray-700 dark:bg-gray-900 dark:text-gray-300'}`}>
                    <span className="opacity-70">{p.sno}번</span> {won(p.price)}
                    <span className="opacity-70"> ({p.picks})</span>
                    {r.bssamt ? <div className="opacity-70">{(p.price / r.bssamt * 100).toFixed(2)}%</div> : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </>
      )}

      <div>
        <div className="mb-1 flex items-center gap-2 text-xs text-gray-500">
          <span>업체별 투찰 (금액 순){bids ? ` · ${bids.length}곳` : ''}</span>
          {bids && shown.length < bids.length && (
            <button type="button" onClick={() => setAll(true)} className="text-blue-600 hover:underline dark:text-blue-400">
              전체 보기
            </button>
          )}
        </div>
        {!bids ? (
          <p className="text-xs text-gray-400">불러오는 중…</p>
        ) : !bids.length ? (
          <p className="text-xs text-gray-400">업체별 투찰을 아직 받지 않았습니다.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg bg-white dark:bg-gray-900">
            <table className="w-full min-w-[520px] text-xs">
              <thead className="text-left text-gray-500">
                <tr>
                  <th className="px-2 py-1.5 font-medium">순위</th>
                  <th className="px-2 py-1.5 font-medium">업체</th>
                  <th className="px-2 py-1.5 text-right font-medium">투찰금액</th>
                  <th className="px-2 py-1.5 text-right font-medium">투찰률</th>
                  <th className="px-2 py-1.5 font-medium">고른 번호</th>
                  <th className="px-2 py-1.5 font-medium">비고</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {shown.map((b, i) => {
                  const below = floor != null && (b.amount ?? 0) < floor
                  const isWin = bids.indexOf(b) === winIdx
                  return (
                    <tr key={`${b.rank}/${b.bizno}/${i}`}
                      className={isWin ? 'bg-blue-50 font-semibold dark:bg-blue-500/10' : below ? 'text-gray-400' : ''}>
                      <td className="px-2 py-1.5 tabular-nums">{b.rank || '-'}</td>
                      <td className="px-2 py-1.5">{b.company_nm ?? b.bizno}</td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{won(b.amount)}</td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{b.rate != null ? `${b.rate}%` : '-'}</td>
                      <td className="px-2 py-1.5 tabular-nums">{b.picks?.join(' · ') ?? '-'}</td>
                      <td className="px-2 py-1.5">{isWin ? '1순위' : below ? '하한 미달' : (b.rmrk ?? '')}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function Cell({ label, value, sub, strong }: { label: string; value: string; sub?: string; strong?: boolean }) {
  return (
    <div className="rounded-lg bg-white p-2 dark:bg-gray-900">
      <div className="text-[11px] text-gray-500">{label}</div>
      <div className={`tabular-nums ${strong ? 'font-bold text-blue-600 dark:text-blue-400' : 'font-semibold text-gray-900 dark:text-white'}`}>{value}</div>
      {sub && <div className="text-[11px] text-gray-400">{sub}</div>}
    </div>
  )
}
