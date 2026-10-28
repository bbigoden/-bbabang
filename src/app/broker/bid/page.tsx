'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/lib/auth-context'
import { createClient } from '@/lib/supabase/client'
import { fetchAllPaged } from '@/lib/fetch-all-paged'
import { Header } from '@/components/layout/header'
import { PageHeader } from '@/components/layout/page-header'
import { SearchClear } from '@/components/ui/search-clear'
import { Chip } from '@/components/ui/chip'
import { useToast } from '@/components/toast'
import { Gavel, Download, ChevronDown, ExternalLink } from 'lucide-react'
import { ymdKST, hmKST, todayKST } from '@/lib/date-kst'
import { BACKFILL_FLOOR, type CollectReport } from '@/lib/bid-collect'
import { latestOrd } from '@/lib/bid-notices'
import { AnalysisPanel, type HistoryRow } from './analysis-panel'

/**
 * 입찰 — 도장·습식·방수·석공사업 공사 입찰공고와 낙찰가 분석.
 *
 * 사장님이 따로 하는 전문건설업 일이다. 입찰정보 사이트(비드비드·제이비드 등)에
 * 돈 내고 보던 것을 나라장터 공공데이터로 직접 받는다. 그 사이트들도 원본은 같다.
 *
 * **공고** 탭은 면허로 들어갈 수 있는 공고를 마감 순으로 보여 준다. 줄을 누르면
 * 과거 낙찰로 센 추천 투찰가가 펼쳐진다. **낙찰결과** 탭은 쌓인 과거 낙찰이다.
 *
 * 받는 일은 서버가 한다(나라장터는 Vercel 에서 잘 불린다). 하루 세 번(6·12·18시)
 * 자동이고, [가져오기] 로 지금 한 번 더 돌릴 수 있다. 과거 낙찰은 하루 한도(1,000건)
 * 안에서 조금씩 거슬러 올라가며 채운다.
 *
 * 입찰을 켠 사무소(broker_profiles.bid_enabled)의 대표에게만 열린다.
 */

type Notice = {
  bid_ntce_no: string
  bid_ntce_ord: string
  name: string
  dminstt_cd: string | null
  dminstt_nm: string | null
  cntrct_mthd: string | null
  lwlt_rate: number | null
  presmpt_prce: number | null
  site_region: string | null
  bid_close_at: string | null
  openg_at: string | null
  detail_url: string | null
  bssamt: number | null
  rng_end: number | null
  a_amount: number | null
}

type Result = {
  bid_ntce_no: string
  bid_ntce_ord: string
  rbid_no: string
  name: string
  dminstt_nm: string | null
  openg_at: string | null
  prtcpt_cnum: number | null
  winner_nm: string | null
  sucsf_amt: number | null
  sucsf_rate: number | null
  plnprc: number | null
  sajeong: number | null
}

type Tab = 'notice' | 'result'

const won = (n: number | null) => (n == null ? '-' : n.toLocaleString('ko-KR'))
const 억 = (n: number | null) => {
  if (n == null) return '-'
  // 99,995,000 같은 값이 '10,000만' 으로 찍히지 않게 만 단위로 반올림한 뒤 가른다
  const man = Math.round(n / 1e4)
  return man >= 1e4 ? `${(n / 1e8).toFixed(2)}억` : `${man.toLocaleString('ko-KR')}만`
}
const sido = (s: string | null) => (s ?? '').split(' ')[0] || '기타'
const 언제 = (iso: string) => `${ymdKST(iso).slice(5).replace('-', '/')} ${hmKST(iso)}`

/** 마감까지 남은 날. 오늘이면 '오늘' */
function dday(iso: string | null): { text: string; urgent: boolean } | null {
  if (!iso) return null
  // 오늘 10시 마감이 오후에도 '오늘'로 보였다 — 시각이 지났으면 마감
  if (Date.parse(iso) <= Date.now()) return { text: '마감', urgent: false }
  const d = ymdKST(iso)
  const days = Math.round((Date.parse(d) - Date.parse(todayKST())) / 86400000)
  if (days < 0) return { text: '마감', urgent: false }
  return { text: days === 0 ? '오늘' : `D-${days}`, urgent: days <= 1 }
}

const REGION_KEY = 'bid_regions_v1'


export default function BidPage() {
  const supabase = useMemo(() => createClient(), [])
  const toast = useToast()
  const { broker, loading: authLoading } = useAuth()
  const enabled = !!broker?.bid_enabled && broker?.is_owner !== false

  const [tab, setTab] = useState<Tab>('notice')
  const [notices, setNotices] = useState<Notice[]>([])
  const [results, setResults] = useState<Result[]>([])
  const [history, setHistory] = useState<HistoryRow[]>([])
  const [lastRun, setLastRun] = useState<CollectReport | null>(null)
  const [backfillUntil, setBackfillUntil] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [collecting, setCollecting] = useState(false)

  const [openOnly, setOpenOnly] = useState(true)
  const [regions, setRegions] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(REGION_KEY) ?? '[]') } catch { return [] }
  })
  const [q, setQ] = useState('')
  const [opened, setOpened] = useState<string | null>(null)

  useEffect(() => {
    try { localStorage.setItem(REGION_KEY, JSON.stringify(regions)) } catch { /* 사생활 보호 창 */ }
  }, [regions])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      // 공고는 최근 60일만. 그 전 것은 이미 다 마감됐다
      const since = new Date(Date.now() - 60 * 86400000).toISOString()
      const [n, r, h, s] = await Promise.all([
        fetchAllPaged<Notice>((from, to) => supabase.from('bid_notices')
          .select('bid_ntce_no, bid_ntce_ord, name, dminstt_cd, dminstt_nm, cntrct_mthd, lwlt_rate, presmpt_prce, site_region, bid_close_at, openg_at, detail_url, bssamt, rng_end, a_amount')
          .gte('ntce_at', since).order('bid_close_at', { ascending: true }).range(from, to)),
        supabase.from('bid_results')
          .select('bid_ntce_no, bid_ntce_ord, rbid_no, name, dminstt_nm, openg_at, prtcpt_cnum, winner_nm, sucsf_amt, sucsf_rate, plnprc, sajeong')
          .order('openg_at', { ascending: false, nullsFirst: false }).limit(300),
        // 분석 재료 — 업체 목록 없이 공고당 숫자 몇 개라 수천 건도 가볍다
        fetchAllPaged<HistoryRow>((from, to) => supabase.from('bid_results')
          .select('dminstt_cd, dminstt_nm, bssamt, sajeong, win_y, rng')
          .not('sajeong', 'is', null).range(from, to)),
        supabase.from('bid_sync').select('key, value').in('key', ['last_run', 'backfill']),
      ])
      setNotices(latestOrd(n))
      setResults((r.data as Result[]) ?? [])
      setHistory(h)
      const st = Object.fromEntries((s.data ?? []).map(x => [x.key, x.value]))
      setLastRun((st.last_run as CollectReport) ?? null)
      setBackfillUntil((st.backfill as { until?: string } | undefined)?.until ?? null)
    } catch {
      toast.error('입찰 정보를 불러오지 못했습니다')
    }
    setLoading(false)
    // toast는 매 렌더 새 객체라 의존성에서 제외 (다른 페이지들과 동일 패턴)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase])

  useEffect(() => { if (enabled) load() }, [enabled, load])

  const collect = async () => {
    setCollecting(true)
    try {
      const res = await fetch('/api/bid/collect', { method: 'POST' })
      const body = await res.json().catch(() => ({}))
      if (res.status === 429) toast.error('방금 받았습니다. 1분 뒤에 다시 눌러 주세요')
      else if (!res.ok) toast.error(`가져오지 못했습니다${body.error ? ` — ${body.error}` : ''}`)
      else {
        const r = body as CollectReport
        toast.success(`나라장터에서 다시 확인했습니다 — 공고 ${r.notices}건 · 낙찰 ${r.results}건 · 낙찰 상세 ${r.details}건`
          + (r.stoppedBy === 'limit' ? ' · 오늘 조회 한도를 다 써서 나머지는 내일 이어 받습니다' : ''))
        await load()
      }
    } catch {
      toast.error('가져오지 못했습니다')
    }
    setCollecting(false)
  }

  // 지역 칩 숫자는 '마감 전만'·검색까지 건 뒤에 센다 — 칩을 눌렀을 때 나오는 줄 수와 같아야 한다
  const baseNotices = useMemo(() => {
    const now = Date.now()
    const words = q.trim().split(/\s+/).filter(Boolean)
    return notices.filter(n =>
      (!openOnly || (n.bid_close_at && Date.parse(n.bid_close_at) > now)) &&
      words.every(w => `${n.name} ${n.dminstt_nm ?? ''} ${n.site_region ?? ''}`.includes(w)))
  }, [notices, openOnly, q])

  const regionCounts = useMemo(() => {
    const m = new Map<string, number>()
    for (const n of baseNotices) m.set(sido(n.site_region), (m.get(sido(n.site_region)) ?? 0) + 1)
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [baseNotices])

  const shownNotices = useMemo(
    () => baseNotices.filter(n => !regions.length || regions.includes(sido(n.site_region))),
    [baseNotices, regions],
  )

  const shownResults = useMemo(() => {
    const words = q.trim().split(/\s+/).filter(Boolean)
    return results.filter(r => words.every(w => `${r.name} ${r.dminstt_nm ?? ''} ${r.winner_nm ?? ''}`.includes(w)))
  }, [results, q])

  if (authLoading) return null
  if (!enabled) {
    return (
      <>
        <Header />
        <main className="mx-auto max-w-7xl px-4 py-6">
          <PageHeader title="입찰" icon={Gavel} />
          <p className="text-sm text-gray-500">이 사무소에는 입찰이 켜져 있지 않습니다.</p>
        </main>
      </>
    )
  }

  return (
    <>
      <Header />
      <main className="mx-auto max-w-7xl px-4 py-6">
        <PageHeader title="입찰" icon={Gavel} description="도장ㆍ습식ㆍ방수ㆍ석공사업 · 나라장터" />

        <div className="mb-3 flex items-center gap-1 border-b border-gray-200 dark:border-gray-800">
          {([['notice', '공고'], ['result', '낙찰결과']] as [Tab, string][]).map(([id, label]) => (
            <button
              key={id}
              onClick={() => { setTab(id); setOpened(null) }}
              className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
                id === tab
                  ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                  : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-500 dark:hover:text-gray-300'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
          {lastRun?.stoppedBy === 'error' ? (
            <span className="font-medium text-red-600 dark:text-red-400">
              {언제(lastRun.finishedAt)} 받다가 멈춤 — {lastRun.error ?? '알 수 없는 오류'}
            </span>
          ) : lastRun?.finishedAt && <span>{언제(lastRun.finishedAt)} 받아옴</span>}
          <span>매일 6·12·18시 자동</span>
          {/* 분석이 얼마나 믿을 만한지는 쌓인 과거 낙찰 수에 달렸다. 숫자를 늘 보이게 둔다 */}
          {!loading && <span>분석에 쓰는 과거 낙찰 {history.length.toLocaleString('ko-KR')}건</span>}
          {tab === 'notice' && !loading && <span>공고 {shownNotices.length.toLocaleString('ko-KR')}건</span>}
          {tab === 'result' && <span>아래 표는 최근 {results.length.toLocaleString('ko-KR')}건</span>}
          {backfillUntil && backfillUntil > BACKFILL_FLOOR && (
            <span>과거 데이터 {backfillUntil}까지 채움 · {BACKFILL_FLOOR}까지 매일 조금씩</span>
          )}
        </div>

        <div className="mb-5 flex flex-wrap items-center gap-2 rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
          {tab === 'notice' && <>
            <Chip on={openOnly} onClick={() => setOpenOnly(v => !v)}>마감 전만</Chip>
            <span className="mx-1 hidden h-4 w-px bg-gray-200 sm:block dark:bg-gray-800" />
            {/* 폰에선 시도 17개가 아홉 줄이 돼 첫 화면에 공고가 하나도 안 보였다 — 한 줄로 옆으로 민다 */}
            <div className="-mx-4 flex w-[calc(100%+2rem)] gap-2 overflow-x-auto px-4 pb-1 sm:contents">
              {regionCounts.map(([r, c]) => (
                <Chip key={r} size="xs" on={regions.includes(r)} className="shrink-0 whitespace-nowrap"
                  onClick={() => setRegions(v => v.includes(r) ? v.filter(x => x !== r) : [...v, r])}>
                  {r} {c}
                </Chip>
              ))}
            </div>
          </>}
          <div className="relative ml-auto flex items-center gap-2">
            <div className="relative">
              <input
                value={q}
                onChange={e => setQ(e.target.value)}
                placeholder={tab === 'notice' ? '공고명·발주기관' : '공고명·발주기관·낙찰업체'}
                className="h-9 w-48 rounded-xl border border-gray-200 bg-white pl-3 pr-8 text-base sm:text-sm
                           text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none
                           dark:border-gray-800 dark:bg-gray-950 dark:text-white"
              />
              {q && <SearchClear onClick={() => setQ('')} />}
            </div>
            <button
              onClick={() => void collect()}
              disabled={collecting}
              title="나라장터에서 지금 받아옵니다 (최대 1분)"
              className="flex h-9 items-center gap-1.5 whitespace-nowrap rounded-xl bg-blue-600
                         px-3 text-sm font-medium text-white transition-colors hover:bg-blue-700
                         disabled:opacity-60"
            >
              <Download className={`h-4 w-4 ${collecting ? 'animate-pulse' : ''}`} aria-hidden />
              {collecting ? '받는 중…' : '가져오기'}
            </button>
          </div>
        </div>

        {loading ? (
          <p className="py-10 text-center text-sm text-gray-400">불러오는 중…</p>
        ) : tab === 'notice' ? (
          shownNotices.length === 0 ? (
            <p className="py-10 text-center text-sm text-gray-400">
              {notices.length ? '조건에 맞는 공고가 없습니다' : '아직 받은 공고가 없습니다 — [가져오기] 를 눌러 보세요'}
            </p>
          ) : (
            <ul className="divide-y divide-gray-100 rounded-2xl border border-gray-200 bg-white dark:divide-gray-800 dark:border-gray-800 dark:bg-gray-900">
              {shownNotices.map(n => {
                const key = `${n.bid_ntce_no}/${n.bid_ntce_ord}`
                const d = dday(n.bid_close_at)
                const isOpen = opened === key
                return (
                  <li key={key}>
                    <button
                      type="button"
                      onClick={() => setOpened(isOpen ? null : key)}
                      aria-expanded={isOpen}
                      className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-800/50"
                    >
                      <span className={`mt-0.5 w-12 shrink-0 text-xs font-semibold ${d?.urgent ? 'text-red-600 dark:text-red-400' : 'text-gray-500'}`}>
                        {d?.text ?? '-'}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium text-gray-900 dark:text-white">{n.name}</span>
                        <span className="mt-0.5 block text-xs text-gray-500">
                          {n.dminstt_nm} · {n.site_region ?? '지역 없음'}
                          {n.bid_close_at && ` · 마감 ${언제(n.bid_close_at)}`}
                          {n.cntrct_mthd && ` · ${n.cntrct_mthd}`}
                        </span>
                        {/* 폰에선 오른쪽 금액 칸이 제목 폭을 130px 로 줄였다 — 금액을 제목 밑으로 */}
                        <span className="mt-0.5 block text-xs font-semibold text-gray-900 sm:hidden dark:text-white">
                          {n.bssamt ? `기초 ${억(n.bssamt)}` : `추정 ${억(n.presmpt_prce)}`}
                          {n.lwlt_rate ? <span className="font-normal text-gray-500"> · 하한 {n.lwlt_rate}%</span> : null}
                        </span>
                      </span>
                      <span className="hidden shrink-0 text-right text-xs sm:block">
                        <span className="block font-semibold text-gray-900 dark:text-white">
                          {n.bssamt ? `기초 ${억(n.bssamt)}` : `추정 ${억(n.presmpt_prce)}`}
                        </span>
                        <span className="block text-gray-500">{n.lwlt_rate ? `하한 ${n.lwlt_rate}%` : ''}</span>
                      </span>
                      <ChevronDown className={`mt-1 h-4 w-4 shrink-0 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} aria-hidden />
                    </button>
                    {isOpen && (
                      <div className="px-4 pb-4">
                        <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                          <span>공고번호 {n.bid_ntce_no}-{n.bid_ntce_ord}</span>
                          {n.bssamt && <span>기초금액 {won(n.bssamt)}원</span>}
                          {n.rng_end != null && <span>예가 ±{Math.abs(n.rng_end)}%</span>}
                          {n.detail_url && (
                            <a href={n.detail_url} target="_blank" rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-blue-600 hover:underline dark:text-blue-400">
                              나라장터 원문 <ExternalLink className="h-3 w-3" aria-hidden />
                            </a>
                          )}
                        </div>
                        <AnalysisPanel key={key} notice={n} history={history} />
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )
        ) : shownResults.length === 0 ? (
          <p className="py-10 text-center text-sm text-gray-400">아직 받은 낙찰결과가 없습니다</p>
        ) : (
          <>
          {/* 폰에선 표가 820px 라 1순위·금액이 화면 밖이었다 — 줄마다 카드로 */}
          <ul className="divide-y divide-gray-100 rounded-2xl border border-gray-200 bg-white md:hidden dark:divide-gray-800 dark:border-gray-800 dark:bg-gray-900">
            {shownResults.map(r => (
              <li key={`${r.bid_ntce_no}/${r.bid_ntce_ord}/${r.rbid_no}`} className="px-4 py-3 text-sm">
                <div className="font-medium text-gray-900 dark:text-white">{r.name}</div>
                <div className="mt-0.5 text-xs text-gray-500">
                  {r.openg_at ? ymdKST(r.openg_at).slice(2) : '-'} 개찰 · {r.dminstt_nm} · {r.prtcpt_cnum ?? '-'}곳 참여
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 text-xs">
                  <span className="text-gray-700 dark:text-gray-300">1순위 {r.winner_nm ?? '-'}</span>
                  <span className="font-semibold tabular-nums">{won(r.sucsf_amt)}원</span>
                  <span className="text-gray-500">낙찰률 {r.sucsf_rate ?? '-'}%</span>
                  <span className="text-gray-500">사정률 {r.sajeong != null ? `${(r.sajeong * 100).toFixed(3)}%` : '-'}</span>
                </div>
              </li>
            ))}
          </ul>
          <div className="hidden overflow-x-auto rounded-2xl border border-gray-200 bg-white md:block dark:border-gray-800 dark:bg-gray-900">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="border-b border-gray-200 text-left text-xs text-gray-500 dark:border-gray-800">
                <tr>
                  <th className="px-3 py-2 font-medium">개찰</th>
                  <th className="px-3 py-2 font-medium">공고명</th>
                  <th className="px-3 py-2 font-medium">발주기관</th>
                  <th className="px-3 py-2 text-right font-medium">참여</th>
                  <th className="px-3 py-2 font-medium">1순위</th>
                  <th className="px-3 py-2 text-right font-medium">예정가격</th>
                  <th className="px-3 py-2 text-right font-medium">낙찰금액</th>
                  <th className="px-3 py-2 text-right font-medium">낙찰률</th>
                  <th className="px-3 py-2 text-right font-medium">사정률</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {shownResults.map(r => (
                  <tr key={`${r.bid_ntce_no}/${r.bid_ntce_ord}/${r.rbid_no}`}>
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-500">{r.openg_at ? ymdKST(r.openg_at).slice(2) : '-'}</td>
                    <td className="px-3 py-2 text-gray-900 dark:text-white">{r.name}</td>
                    <td className="px-3 py-2 text-xs text-gray-500">{r.dminstt_nm}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right text-gray-500">{r.prtcpt_cnum ?? '-'}</td>
                    <td className="px-3 py-2 text-xs">{r.winner_nm ?? '-'}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right text-gray-500">{won(r.plnprc)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">{won(r.sucsf_amt)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right text-gray-500">{r.sucsf_rate ?? '-'}%</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right text-gray-500">{r.sajeong != null ? `${(r.sajeong * 100).toFixed(3)}%` : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        )}
      </main>
    </>
  )
}
