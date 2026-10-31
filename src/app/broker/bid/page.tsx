'use client'

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import { BID_FIELDS, DOC_RGN, canEnter, dutyOk, fitsFields, latestOrd, shortRegion } from '@/lib/bid-notices'
import dynamic from 'next/dynamic'
import type { HistoryRow } from './analysis-panel'
import { amountFor, judgeAmount, recommendY } from '@/lib/bid-analysis'
import type { ResultForDetail } from './result-detail'

// 공고를 펼치거나 탭을 바꿀 때만 쓰는 패널은 그때 받는다 — 폰 3G 에서 첫 화면 프로그램을 줄인다(10-30 점검)
const AnalysisPanel = dynamic(() => import('./analysis-panel').then(m => m.AnalysisPanel))
const ResultDetail = dynamic(() => import('./result-detail').then(m => m.ResultDetail))
const LabPanel = dynamic(() => import('./lab-panel').then(m => m.LabPanel))

/**
 * 입찰 — 도장·습식·방수·석공사업 공사 입찰공고와 낙찰가 분석.
 *
 * 사장님이 따로 하는 전문건설업 일이다. 입찰정보 사이트(비드비드·제이비드 등)에
 * 돈 내고 보던 것을 나라장터 공공데이터로 직접 받는다. 그 사이트들도 원본은 같다.
 *
 * **공고** 탭은 면허로 들어갈 수 있는 공고를 마감 순으로 보여 준다. 줄을 누르면
 * 과거 낙찰로 센 추천 투찰가가 펼쳐진다. **낙찰결과** 탭은 쌓인 과거 낙찰이다.
 *
 * 받는 일은 서버가 한다(나라장터는 Vercel 에서 잘 불린다). 1시간마다
 * 자동이고, [가져오기] 로 지금 한 번 더 돌릴 수 있다. 과거 낙찰은 하루 한도(운영계정)
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
  prtcpt_rgns: string[] | null
  rgn_duty_rt: number | null
  rgn_duty_rgns: string[] | null
  mfrc_flds: string[] | null
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
  bssamt: number | null
  lwlt_rate: number | null
  a_amount: number | null
  prices: ResultForDetail['prices']
  dminstt_cd: string | null
  rng: number | null
}
type Verdict = 'win' | 'pass' | 'below'
const VERDICT: Record<Verdict, { label: string; cls: string }> = {
  win: { label: '낙찰', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400' },
  pass: { label: '통과·순위 밀림', cls: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300' },
  below: { label: '하한 미달', cls: 'bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400' },
}

type Tab = 'notice' | 'result' | 'lab'

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
const RESULT_PAGE = 600
const RESULT_COLS ='bid_ntce_no, bid_ntce_ord, rbid_no, name, dminstt_nm, openg_at, prtcpt_cnum, winner_nm, sucsf_amt, sucsf_rate, plnprc, sajeong, bssamt, lwlt_rate, a_amount, prices, dminstt_cd, rng'


export default function BidPage() {
  const supabase = useMemo(() => createClient(), [])
  const toast = useToast()
  const { broker, loading: authLoading, refresh } = useAuth()
  const enabled = !!broker?.bid_enabled && broker?.is_owner !== false
  // 우리 업체 소재지 — 지역제한 공고 중 들어갈 수 있는 것만 거르는 데 쓴다
  const ourRegion = typeof broker?.bid_region === 'string' && broker.bid_region.trim() ? broker.bid_region.trim() : null
  const [enterableOnly, setEnterableOnly] = useState(true)
  // 우리 주력분야 — 같은 면허(4992)라도 석공 공사가 하루 공고의 40% 가까이 섞여 나온다
  const rawFields = broker?.bid_fields
  const ourFields = useMemo(() => (Array.isArray(rawFields) ? (rawFields as string[]) : []), [rawFields])
  const [fieldsOnly, setFieldsOnly] = useState(true)
  const [editingFields, setEditingFields] = useState(false)
  const [editingRegion, setEditingRegion] = useState<string | null>(null)

  const [tab, setTab] = useState<Tab>('notice')
  const [notices, setNotices] = useState<Notice[]>([])
  const [results, setResults] = useState<Result[]>([])
  const [resultsLoaded, setResultsLoaded] = useState(false)
  // 낙찰결과는 빨리 열리게 최근 것부터 한 묶음씩. 같은 개찰 시각끼리 순서가 흔들리면 묶음 사이에 겹치거나 빠지므로 번호로도 줄 세운다
  const resultPage = useCallback((from: number) => supabase.from('bid_results').select(RESULT_COLS)
    .order('openg_at', { ascending: false, nullsFirst: false })
    .order('bid_ntce_no').order('bid_ntce_ord').order('rbid_no')
    .range(from, from + RESULT_PAGE - 1), [supabase])
  const [moreResults, setMoreResults] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const loadMoreResults = async () => {
    setLoadingMore(true)
    const { data, error } = await resultPage(results.length)
    if (error) toast.error('더 불러오지 못했습니다')
    else {
      const rows = (data as Result[]) ?? []
      setResults(prev => {
        const seen = new Set(prev.map(r => `${r.bid_ntce_no}/${r.bid_ntce_ord}/${r.rbid_no}`))
        return [...prev, ...rows.filter(r => !seen.has(`${r.bid_ntce_no}/${r.bid_ntce_ord}/${r.rbid_no}`))]
      })
      setMoreResults(rows.length === RESULT_PAGE)
    }
    setLoadingMore(false)
  }
  const [history, setHistory] = useState<(HistoryRow & { bid_ntce_no: string; bid_ntce_ord: string; openg_at: string | null })[]>([])
  const [lastRun, setLastRun] = useState<CollectReport | null>(null)
  const [backfillUntil, setBackfillUntil] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  // 분석 재료(과거 낙찰)는 공고 목록을 띄운 뒤 뒤에서 받는다 — 수천 행이라
  // 같이 기다리면 폰 3G 에서 '불러오는 중'이 28초 걸렸다(10-30 점검, 그전 9초)
  const [analysisReady, setAnalysisReady] = useState(false)
  const [allNotices, setAllNotices] = useState(false)
  const [collecting, setCollecting] = useState(false)

  const [openOnly, setOpenOnly] = useState(true)
  const [regions, setRegions] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(REGION_KEY) ?? '[]') } catch { return [] }
  })
  const [q, setQ] = useState('')
  const [opened, setOpened] = useState<string | null>(null)

  // 우리 주력분야와 하나도 안 겹치는 공고(석공 전용 등) — 그 낙찰은 추천 계산에서 뺀다.
  // 석공 공사는 들어오는 업체·넣는 버릇이 달라 섞으면 추천이 흐려진다
  const [offFieldKeys, setOffFieldKeys] = useState<Set<string>>(new Set())
  // 과거 낙찰(분석 재료)을 다 받은 뒤에 묻는다 — 첫 화면과 같이 받으면 3G 대역을 나눠 쓴다
  useEffect(() => {
    if (!ourFields.length) { setOffFieldKeys(new Set()); return }
    if (!analysisReady) return
    let alive = true
    void fetchAllPaged<{ bid_ntce_no: string; bid_ntce_ord: string }>((from, to) => supabase.from('bid_notices')
      .select('bid_ntce_no, bid_ntce_ord')
      .not('mfrc_flds', 'is', null).neq('mfrc_flds', '{}')
      .not('mfrc_flds', 'ov', `{${ourFields.join(',')}}`)
      .range(from, to))
      .then(rows => { if (alive) setOffFieldKeys(new Set(rows.map(r => `${r.bid_ntce_no}/${r.bid_ntce_ord}`))) })
      .catch(() => { /* 못 받으면 거르지 않고 그대로 쓴다 */ })
    return () => { alive = false }
  }, [supabase, ourFields, analysisReady])
  const fieldHistory = useMemo(
    () => history.filter(h => !offFieldKeys.has(`${h.bid_ntce_no}/${h.bid_ntce_ord}`)),
    [history, offFieldKeys],
  )

  useEffect(() => {
    try { localStorage.setItem(REGION_KEY, JSON.stringify(regions)) } catch { /* 사생활 보호 창 */ }
  }, [regions])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      // 공고는 최근 60일만. 그 전 것은 이미 다 마감됐다
      const since = new Date(Date.now() - 60 * 86400000).toISOString()
      setAnalysisReady(false)
      setAllNotices(false)
      setResultsLoaded(false)
      // 첫 화면(공고 탭)에 필요한 것만 기다린다. 낙찰결과(600건)는 그 탭을 열 때, 분석 재료(수천 행)는
      // 목록을 띄운 뒤에 받는다 — 같이 받으면 폰 3G 에서 대역을 나눠 써 '불러오는 중'이 28초였다(10-30 점검)
      // 공고도 마감 전 것(150건 안팎)부터 — 기본이 '마감 전만'이다. 60일치 전체(1,450건)는 아래에서 이어 받는다
      const noticeQuery = (from: number, to: number) => supabase.from('bid_notices')
        .select('bid_ntce_no, bid_ntce_ord, name, dminstt_cd, dminstt_nm, cntrct_mthd, lwlt_rate, presmpt_prce, site_region, bid_close_at, openg_at, detail_url, bssamt, rng_end, a_amount, prtcpt_rgns, mfrc_flds, rgn_duty_rt, rgn_duty_rgns')
        .gte('ntce_at', since).order('bid_close_at', { ascending: true }).range(from, to)
      const [n, s] = await Promise.all([
        fetchAllPaged<Notice>((from, to) => noticeQuery(from, to).gt('bid_close_at', new Date().toISOString())),
        supabase.from('bid_sync').select('key, value').in('key', ['last_run', 'backfill']),
      ])
      setNotices(latestOrd(n))
      allNoticeQuery.current = noticeQuery
      const st = Object.fromEntries((s.data ?? []).map(x => [x.key, x.value]))
      setLastRun((st.last_run as CollectReport) ?? null)
      setBackfillUntil((st.backfill as { until?: string } | undefined)?.until ?? null)
    } catch {
      toast.error('입찰 정보를 불러오지 못했습니다')
    }
    setLoading(false)
    setHistoryAsked(false)
    // toast는 매 렌더 새 객체라 의존성에서 제외 (다른 페이지들과 동일 패턴)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase])

  useEffect(() => { if (enabled) load() }, [enabled, load])

  // 60일치 공고(약 140KB)와 분석 재료(과거 낙찰 약 250KB)는 쓸 때 받는다. 목록 뒤에서 늘 받으면 폰 3G 에서
  // 40초 가까이 회선을 붙잡아 그동안 다른 화면을 눌러도 같이 느렸다(10-30 폰 속도 조사).
  //  - 60일치 전체: '마감 전만' 을 끌 때
  //  - 과거 낙찰: 공고를 펼치거나(추천 금액) 낙찰결과 탭(되돌려 보기)을 열 때
  const allNoticeQuery = useRef<((from: number, to: number) => any) | null>(null)
  useEffect(() => {
    if (openOnly || allNotices || loading || !allNoticeQuery.current) return
    let alive = true
    void fetchAllPaged<Notice>(allNoticeQuery.current)
      .then(all => { if (alive) { setNotices(latestOrd(all)); setAllNotices(true) } })
      .catch(() => { /* 못 받으면 마감 전 공고만 보인다 */ })
    return () => { alive = false }
  }, [openOnly, allNotices, loading])
  const [historyAsked, setHistoryAsked] = useState(false)
  useEffect(() => {
    if (historyAsked || loading || !(opened || tab === 'result')) return
    setHistoryAsked(true)
    void fetchAllPaged<HistoryRow & { bid_ntce_no: string; bid_ntce_ord: string; openg_at: string | null }>((from, to) => supabase.from('bid_results')
      .select('bid_ntce_no, bid_ntce_ord, dminstt_cd, dminstt_nm, bssamt, sajeong, win_y, rng, openg_at')
      .not('sajeong', 'is', null).order('bid_ntce_no').order('bid_ntce_ord').order('rbid_no').range(from, to))
      .then(h => { setHistory(h); setAnalysisReady(true) })
      .catch(() => { setHistoryAsked(false); toast.error('분석 재료(과거 낙찰)를 불러오지 못했습니다 — 공고 목록은 그대로 볼 수 있어요') })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyAsked, loading, opened, tab, supabase])

  // 낙찰결과 탭은 열 때 받는다
  useEffect(() => {
    if (!enabled || tab !== 'result' || resultsLoaded) return
    let alive = true
    void resultPage(0).then(r => {
      if (!alive) return
      setResults((r.data as Result[]) ?? [])
      setMoreResults((r.data?.length ?? 0) === RESULT_PAGE)
      setResultsLoaded(true)
    })
    return () => { alive = false }
  }, [enabled, tab, resultsLoaded, resultPage])

  const toggleField = async (f: string) => {
    if (!broker) return
    const next = ourFields.includes(f) ? ourFields.filter(x => x !== f) : [...ourFields, f]
    const { error } = await supabase.from('broker_profiles').update({ bid_fields: next.length ? next : null }).eq('id', broker.id)
    if (error) { toast.error('주력분야를 저장하지 못했습니다'); return }
    await refresh()
  }

  const saveRegion = async () => {
    if (editingRegion == null || !broker) return
    const v = editingRegion.trim().replace(/\s+/g, ' ') || null
    const { error } = await supabase.from('broker_profiles').update({ bid_region: v }).eq('id', broker.id)
    if (error) { toast.error('소재지를 저장하지 못했습니다'); return }
    setEditingRegion(null)
    await refresh()
  }

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
      (!enterableOnly || (canEnter(n.prtcpt_rgns, ourRegion, n.site_region) === true && dutyOk(n.rgn_duty_rt, n.rgn_duty_rgns, n.site_region, ourRegion) === true)) &&
      (!fieldsOnly || fitsFields(n.mfrc_flds, ourFields) === true) &&
      words.every(w => `${n.name} ${n.dminstt_nm ?? ''} ${n.site_region ?? ''} ${n.bid_ntce_no}-${n.bid_ntce_ord}`.toUpperCase().includes(w.toUpperCase())))
  }, [notices, openOnly, enterableOnly, ourRegion, fieldsOnly, ourFields, q])

  const regionCounts = useMemo(() => {
    const m = new Map<string, number>()
    for (const n of baseNotices) m.set(sido(n.site_region), (m.get(sido(n.site_region)) ?? 0) + 1)
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [baseNotices])

  const shownNotices = useMemo(
    () => baseNotices.filter(n => !regions.length || regions.includes(sido(n.site_region))),
    [baseNotices, regions],
  )

  // 낙찰결과 검색은 받아 둔 최근 300건이 아니라 쌓인 낙찰 전체에서 찾는다 —
  // 어제 개찰한 온양문화원이 300건 밖이라 검색이 안 됐다
  const [searched, setSearched] = useState<Result[] | null>(null)
  useEffect(() => {
    const words = q.trim().split(/\s+/).filter(Boolean)
      // 'R26BK01787197-000' 처럼 차수까지 붙여 넣어도 찾게 차수는 뗀다
      .map(w => w.replace(/[,()%*\\]/g, '').replace(/^(R\d{2}[A-Z]{2}\d+)-\d{3}$/i, '$1')).filter(Boolean)
    if (tab !== 'result' || !words.length) { setSearched(null); return }
    const t = setTimeout(async () => {
      let query = supabase.from('bid_results').select(RESULT_COLS)
      for (const w of words) query = query.or(`name.ilike.*${w}*,dminstt_nm.ilike.*${w}*,winner_nm.ilike.*${w}*,bid_ntce_no.ilike.*${w}*`)
      const { data } = await query.order('openg_at', { ascending: false, nullsFirst: false }).limit(300)
      setSearched((data as Result[]) ?? [])
    }, 300)
    return () => clearTimeout(t)
  }, [q, tab, supabase])

  // 낙찰결과의 참가가능지역·주력분야는 공고 쪽에 있다 — 화면에 올린 낙찰의 공고만 따로 받아 붙인다.
  // 정정공고는 차수마다 줄이 있어 번호로 묶고, 값이 있는 가장 늦은 차수 것을 쓴다
  const [resultMeta, setResultMeta] = useState<Map<string, { rgns: string[] | null; flds: string[] | null; site: string | null; dutyRt: number | null; dutyRgns: string[] | null }>>(new Map())
  useEffect(() => {
    const nos = [...new Set([...results, ...(searched ?? [])].map(r => r.bid_ntce_no))]
    if (!nos.length) return
    let alive = true
    void (async () => {
      const rows: { bid_ntce_no: string; bid_ntce_ord: string; prtcpt_rgns: string[] | null; mfrc_flds: string[] | null; site_region: string | null; rgn_duty_rt: number | null; rgn_duty_rgns: string[] | null }[] = []
      for (let i = 0; i < nos.length; i += 150) {
        const { data } = await supabase.from('bid_notices').select('bid_ntce_no, bid_ntce_ord, prtcpt_rgns, mfrc_flds, site_region, rgn_duty_rt, rgn_duty_rgns')
          .in('bid_ntce_no', nos.slice(i, i + 150))
        rows.push(...(data ?? []))
      }
      if (!alive) return
      rows.sort((a, b) => b.bid_ntce_ord.localeCompare(a.bid_ntce_ord))
      const m = new Map<string, { rgns: string[] | null; flds: string[] | null; site: string | null; dutyRt: number | null; dutyRgns: string[] | null }>()
      for (const r of rows) {
        const cur = m.get(r.bid_ntce_no) ?? { rgns: null, flds: null, site: null, dutyRt: null, dutyRgns: null }
        m.set(r.bid_ntce_no, {
          rgns: cur.rgns ?? r.prtcpt_rgns, flds: cur.flds ?? r.mfrc_flds, site: cur.site ?? r.site_region,
          dutyRt: cur.dutyRt ?? r.rgn_duty_rt, dutyRgns: cur.dutyRgns ?? r.rgn_duty_rgns,
        })
      }
      setResultMeta(m)
    })()
    return () => { alive = false }
  }, [supabase, results, searched])

  // 공고 탭과 같은 칩을 쓴다. 지역·주력분야를 모르는 낙찰(공고를 아직 못 받은 오래된 것)도 뺀다 —
  // 들어갈 수 있었는지 확인이 안 되면 우리 공고가 아니다(10-30 사장님: 벗어나면 어차피 입찰을 못 한다)
  const shownResults = useMemo(() => {
    const words = q.trim().split(/\s+/).filter(Boolean)
    const base = searched ?? results.filter(r => words.every(w => `${r.name} ${r.dminstt_nm ?? ''} ${r.winner_nm ?? ''} ${r.bid_ntce_no}-${r.bid_ntce_ord}`.toUpperCase().includes(w.toUpperCase())))
    return base.filter(r => {
      const m = resultMeta.get(r.bid_ntce_no)
      return (!enterableOnly || (canEnter(m?.rgns, ourRegion, m?.site) === true && dutyOk(m?.dutyRt, m?.dutyRgns, m?.site, ourRegion) === true))
        && (!fieldsOnly || fitsFields(m?.flds, ourFields) === true)
    })
  }, [results, searched, q, resultMeta, enterableOnly, ourRegion, fieldsOnly, ourFields])

  // 되돌려 보기 — 그 공고 개찰 전까지의 낙찰만으로 공고 화면과 같은 추천을 내고, 그 금액이었으면 어떻게 됐을지.
  // 뒤에 개찰한 낙찰을 섞으면 답을 보고 맞히는 셈이라 뺀다
  const backtest = useMemo(() => {
    const m = new Map<string, { amount: number; verdict: Verdict }>()
    for (const r of shownResults) {
      if (!r.plnprc || !r.bssamt || !r.lwlt_rate || !r.openg_at) continue
      const before = fieldHistory.filter(h => h.openg_at && h.openg_at < r.openg_at!)
      const rec = recommendY(before, { bssamt: r.bssamt, rng: r.rng, dminstt_cd: r.dminstt_cd, dminstt_nm: r.dminstt_nm })
      if (!rec) continue
      const amount = amountFor(rec.y, r.bssamt, Number(r.lwlt_rate), r.a_amount)
      m.set(`${r.bid_ntce_no}/${r.bid_ntce_ord}/${r.rbid_no}`, {
        amount,
        verdict: judgeAmount(amount, { plnprc: r.plnprc, lwlt_rate: Number(r.lwlt_rate), a_amount: r.a_amount, sucsf_amt: r.sucsf_amt }),
      })
    }
    return m
  }, [shownResults, fieldHistory])
  const btCount = useMemo(() => {
    const c = { win: 0, pass: 0, below: 0 }
    for (const v of backtest.values()) c[v.verdict]++
    return c
  }, [backtest])

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
          {([['notice', '공고'], ['result', '낙찰결과'], ['lab', '실험실']] as [Tab, string][]).map(([id, label]) => (
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
          <span>1시간마다 자동</span>
          {editingRegion != null ? (
            <span className="flex items-center gap-1">
              우리 업체 소재지
              <input
                autoFocus
                value={editingRegion}
                onChange={e => setEditingRegion(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') void saveRegion(); if (e.key === 'Escape') setEditingRegion(null) }}
                placeholder="충청남도 아산시"
                className="h-7 w-36 rounded-md border border-gray-200 bg-white px-2 text-base sm:text-xs dark:border-gray-800 dark:bg-gray-950"
              />
              <button type="button" onClick={() => void saveRegion()} className="font-medium text-blue-600 dark:text-blue-400">저장</button>
              <button type="button" onClick={() => setEditingRegion(null)}>취소</button>
            </span>
          ) : (
            <button type="button" onClick={() => setEditingRegion(ourRegion ?? '')} className="hover:underline">
              우리 업체 소재지 <b className="font-medium text-gray-700 dark:text-gray-300">{ourRegion ?? '정하기'}</b>
            </button>
          )}
          {editingFields ? (
            <span className="flex flex-wrap items-center gap-1">
              우리 주력분야
              {BID_FIELDS.map(f => (
                <Chip key={f} size="xs" on={ourFields.includes(f)} onClick={() => void toggleField(f)}>{f.replace('공사', '')}</Chip>
              ))}
              <button type="button" onClick={() => setEditingFields(false)} className="font-medium text-blue-600 dark:text-blue-400">닫기</button>
            </span>
          ) : (
            <button type="button" onClick={() => setEditingFields(true)} className="hover:underline">
              우리 주력분야 <b className="font-medium text-gray-700 dark:text-gray-300">{ourFields.length ? ourFields.map(f => f.replace('공사', '')).join(', ') : '정하기'}</b>
            </button>
          )}
          {/* 분석이 얼마나 믿을 만한지는 쌓인 과거 낙찰 수에 달렸다. 숫자를 늘 보이게 둔다 */}
          {!loading && !analysisReady && historyAsked && <span>과거 낙찰 받는 중…</span>}
          {!loading && analysisReady && (
            <span title={offFieldKeys.size ? '우리 주력분야가 아닌 공고(석공 등)의 낙찰은 뺐습니다' : undefined}>
              분석에 쓰는 과거 낙찰 {fieldHistory.length.toLocaleString('ko-KR')}건
              {history.length > fieldHistory.length && ` (주력분야 아닌 ${(history.length - fieldHistory.length).toLocaleString('ko-KR')}건 뺌)`}
            </span>
          )}
          {tab === 'notice' && !loading && <span>공고 {shownNotices.length.toLocaleString('ko-KR')}건{!openOnly && !allNotices && ' · 마감된 공고 받는 중…'}</span>}
          {tab === 'result' && <span>{searched ? `전체에서 찾음 ${searched.length.toLocaleString('ko-KR')}건` : `아래 표는 최근 ${results.length.toLocaleString('ko-KR')}건 · 검색은 전체에서`}</span>}
          {backfillUntil && backfillUntil > BACKFILL_FLOOR && (
            <span>과거 데이터 {backfillUntil}까지 채움 · {BACKFILL_FLOOR}까지 매일 조금씩</span>
          )}
        </div>

        {tab !== 'lab' && <div className="mb-5 flex flex-wrap items-center gap-2 rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
          {tab === 'notice' && <Chip on={openOnly} onClick={() => setOpenOnly(v => !v)}>마감 전만</Chip>}
            {ourRegion && (
              <Chip on={enterableOnly} onClick={() => setEnterableOnly(v => !v)}
                title={`참가가능지역이 전국이거나 ${ourRegion}을 품는 공고만 — 지역을 아직 모르는 공고도 뺀다`}>
                들어갈 수 있는 것만
              </Chip>
            )}
            {ourFields.length > 0 && (
              <Chip on={fieldsOnly} onClick={() => setFieldsOnly(v => !v)}
                title={`주력분야가 ${ourFields.join('·')}이거나 지정 없는 공고만 — 주력분야를 아직 모르는 공고도 뺀다`}>
                주력분야만
              </Chip>
            )}
          {tab === 'notice' && <>
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
                placeholder={tab === 'notice' ? '공고명·발주기관·공고번호' : '공고명·발주기관·낙찰업체·공고번호'}
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
        </div>}

        {tab === 'lab' ? (
          <LabPanel ourRegion={ourRegion} ourFields={ourFields} />
        ) : loading || (tab === 'result' && !resultsLoaded) ? (
          <p className="py-10 text-center text-sm text-gray-400">불러오는 중…</p>
        ) : tab === 'notice' ? (
          shownNotices.length === 0 ? (
            <p className="py-10 text-center text-sm text-gray-400">
              {!openOnly && !allNotices ? '마감된 공고를 받는 중이에요…'
                : !notices.length ? '아직 받은 공고가 없습니다 — [가져오기] 를 눌러 보세요'
                : <>조건에 맞는 공고가 없습니다<br />위 칩을 하나씩 끄면 더 많은 공고가 보여요</>}
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
                        <RegionBadge rgns={n.prtcpt_rgns} ours={ourRegion} site={n.site_region} dutyRt={n.rgn_duty_rt} dutyRgns={n.rgn_duty_rgns} />
                        <FieldBadge flds={n.mfrc_flds} ours={ourFields} />
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
                        {analysisReady ? <AnalysisPanel key={key} notice={n} history={fieldHistory} /> : <p className="py-4 text-center text-sm text-gray-400">과거 낙찰을 받는 중이에요… 잠시 뒤 추천 금액이 나옵니다</p>}
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )
        ) : shownResults.length === 0 ? (
          <p className="py-10 text-center text-sm text-gray-400">
            {q.trim() ? '검색에 맞는 낙찰결과가 없습니다 — 개찰 전이거나 아직 받지 않은 공고일 수 있습니다'
              : results.length ? '조건에 맞는 낙찰결과가 없습니다' : '아직 받은 낙찰결과가 없습니다'}
          </p>
        ) : (
          <>
          {backtest.size > 0 && (
            <p className="mb-3 text-sm text-gray-600 dark:text-gray-300">
              추천 금액대로 넣었으면 — 계산된 {backtest.size}건 중{' '}
              <b className="text-emerald-600 dark:text-emerald-400">낙찰 {btCount.win}건</b>
              {' '}· 통과했지만 더 낮은 업체에 밀림 {btCount.pass}건 · 하한 미달 {btCount.below}건
              <span className="block text-xs text-gray-400">
                그 공고 개찰 전까지의 낙찰만으로 공고 화면과 같은 방식으로 계산했습니다. 다른 업체는 실제 넣은 그대로라고 봅니다.
              </span>
            </p>
          )}
          {/* 폰에선 표가 820px 라 1순위·금액이 화면 밖이었다 — 줄마다 카드로 */}
          <ul className="divide-y divide-gray-100 rounded-2xl border border-gray-200 bg-white md:hidden dark:divide-gray-800 dark:border-gray-800 dark:bg-gray-900">
            {shownResults.map(r => {
              const rk = `r/${r.bid_ntce_no}/${r.bid_ntce_ord}/${r.rbid_no}`
              return (
              <li key={rk} className="text-sm">
                <button type="button" onClick={() => setOpened(opened === rk ? null : rk)} aria-expanded={opened === rk}
                  className="w-full px-4 py-3 text-left">
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
                <BacktestLine bt={backtest.get(`${r.bid_ntce_no}/${r.bid_ntce_ord}/${r.rbid_no}`)} />
                </button>
                {opened === rk && <div className="px-4 pb-4"><ResultDetail r={r} /></div>}
              </li>
              )
            })}
          </ul>
          <div className="hidden overflow-x-auto rounded-2xl border border-gray-200 bg-white md:block dark:border-gray-800 dark:bg-gray-900">
            <table className="w-full min-w-[940px] text-sm">
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
                  <th className="px-3 py-2 text-right font-medium">추천 투찰금액</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {shownResults.map(r => {
                  const rk = `r/${r.bid_ntce_no}/${r.bid_ntce_ord}/${r.rbid_no}`
                  return (<Fragment key={rk}>
                  <tr onClick={() => setOpened(opened === rk ? null : rk)} aria-expanded={opened === rk}
                    className={`cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50 ${opened === rk ? 'bg-gray-50 dark:bg-gray-800/50' : ''}`}>
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-500">{r.openg_at ? ymdKST(r.openg_at).slice(2) : '-'}</td>
                    <td className="px-3 py-2 text-gray-900 dark:text-white">{r.name}</td>
                    <td className="px-3 py-2 text-xs text-gray-500">{r.dminstt_nm}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right text-gray-500">{r.prtcpt_cnum ?? '-'}</td>
                    <td className="px-3 py-2 text-xs">{r.winner_nm ?? '-'}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right text-gray-500">{won(r.plnprc)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">{won(r.sucsf_amt)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right text-gray-500">{r.sucsf_rate ?? '-'}%</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right text-gray-500">{r.sajeong != null ? `${(r.sajeong * 100).toFixed(3)}%` : '-'}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      {(() => {
                        const bt = backtest.get(`${r.bid_ntce_no}/${r.bid_ntce_ord}/${r.rbid_no}`)
                        return bt ? <>
                          <span className="block tabular-nums">{won(bt.amount)}</span>
                          <span className={`mt-0.5 inline-block rounded px-1.5 text-[11px] font-medium ${VERDICT[bt.verdict].cls}`}>{VERDICT[bt.verdict].label}</span>
                        </> : <span className="text-gray-400">-</span>
                      })()}
                    </td>
                  </tr>
                  {opened === rk && (
                    <tr><td colSpan={10} className="px-3 pb-4"><ResultDetail r={r} /></td></tr>
                  )}
                  </Fragment>)
                })}
              </tbody>
            </table>
          </div>
          {!searched && moreResults && (
            <div className="mt-4 text-center">
              <button type="button" onClick={() => void loadMoreResults()} disabled={loadingMore}
                className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800">
                {loadingMore ? '불러오는 중…' : `더 보기 — ${RESULT_PAGE}건 더 (지금 ${results.length.toLocaleString('ko-KR')}건 · ${results.at(-1)?.openg_at ? ymdKST(results.at(-1)!.openg_at!).slice(2) : '-'} 개찰까지)`}
              </button>
            </div>
          )}
          </>
        )}
      </main>
    </>
  )
}

/** 참가가능지역 한 줄. 우리가 못 들어가는 곳이면 빨갛게 */
function RegionBadge({ rgns, ours, site, dutyRt, dutyRgns }: {
  rgns: string[] | null; ours: string | null; site: string | null; dutyRt: number | null; dutyRgns: string[] | null
}) {
  if (rgns == null) return null
  const duty = dutyOk(dutyRt, dutyRgns, site, ours)
  const ok = canEnter(rgns, ours, site) === false || duty === false ? false : true
  const text = rgns.includes(DOC_RGN) ? '지역 공고서 참조 (API에 없음 — 원문 확인)' : rgns.length === 0 ? '전국' : rgns.length > 3
    ? `${rgns.slice(0, 3).map(shortRegion).join('·')} 외 ${rgns.length - 3}곳`
    : rgns.map(shortRegion).join('·')
  return (
    <span className={`mt-0.5 block text-xs ${ok === false ? 'text-red-600 dark:text-red-400' : 'text-gray-500'}`}>
      참가 {text}
      {dutyRt ? ` · 지역의무공동도급 ${dutyRt}% (${(dutyRgns?.length ? dutyRgns : [site?.split(' ')[0] ?? '현장 지역']).map(shortRegion).join('·')} 업체와 공동)` : ''}
      {ok === false && ' — 우리 업체 혼자는 못 들어갑니다'}
    </span>
  )
}

/** 주력분야 한 줄. 우리 주력분야가 아니면 빨갛게 */
function FieldBadge({ flds, ours }: { flds: string[] | null; ours: string[] }) {
  if (flds == null) return null
  const ok = fitsFields(flds, ours)
  return (
    <span className={`block text-xs ${ok === false ? 'text-red-600 dark:text-red-400' : 'text-gray-500'}`}>
      주력 {flds.length ? flds.map(f => f.replace('공사', '')).join('·') : '지정 없음'}
      {ok === false && ' — 우리 주력분야가 아닙니다'}
    </span>
  )
}

function BacktestLine({ bt }: { bt: { amount: number; verdict: Verdict } | undefined }) {
  if (!bt) return null
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs">
      <span className="text-gray-500">추천 투찰금액</span>
      <span className="font-semibold tabular-nums">{won(bt.amount)}원</span>
      <span className={`rounded px-1.5 text-[11px] font-medium ${VERDICT[bt.verdict].cls}`}>{VERDICT[bt.verdict].label}</span>
    </div>
  )
}
