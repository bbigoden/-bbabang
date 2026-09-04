'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/lib/auth-context'
import { createClient } from '@/lib/supabase/client'
import { Header } from '@/components/layout/header'
import { PageHeader } from '@/components/layout/page-header'
import { Pagination, usePageSize } from '@/components/sheet/pagination'
import { SearchClear } from '@/components/ui/search-clear'
import { fetchAllPaged } from '@/lib/fetch-all-paged'
import { useToast } from '@/components/toast'
import { Radar, Settings2, Download } from 'lucide-react'
import { PROPERTY_KINDS, TRADE_TYPES, REGIONS, kindOf, kstDate, toKstDate } from '@/lib/naver-land'

/**
 * 신규매물 — 네이버부동산에 없는 '최신순' 목록.
 *
 * 네이버부동산에는 최신순 정렬이 없다. 그래서 새로 올라온 매물을 찾으려면 지도를
 * 옮겨 가며 매일 눈으로 훑어야 했고, 그 일에 하루 시간이 통째로 들어갔다.
 *
 * **이 화면은 링크 목록이다.** 가격·면적·사진은 일부러 싣지 않는다 — 어차피 눌러
 * 들어가서 주변과 시세를 직접 봐야 하고, 여기서 미리 보여 줘 봐야 한 화면에
 * 들어가는 건수만 줄어든다. 여기서 할 일은 **무엇을 눌러 볼지 고르는 것**뿐이다.
 *
 * **누른 것은 흐려진다.** 매일 열면 어제 본 것이 섞여 있어 '어디까지 봤더라' 를
 * 매번 다시 하게 된다. 본 것은 사람마다 따로 세므로 직원이 훑어도 사장님 화면은
 * 그대로다.
 *
 * 수집은 사장님 PC의 광고 프로그램(`부소장광고`)이 한 시간마다 한다. 서버에서 받게
 * 만들었다가 걷어냈다 — 네이버가 데이터센터 IP를 막아 Vercel 에서는 다섯 번 다
 * 응답 없이 멎었다. 뱅크·카페와 같은 이유로 PC가 맡는다.
 */

type Article = {
  article_no: string
  real_estate_type: string
  trade_type: string
  division: string | null
  sector: string | null
  brokerage_name: string | null
  exposure_start_date: string | null
  first_seen_at: string
  last_seen_at: string
  gone_at: string | null
}

type Settings = {
  hide_own: boolean
  track_gone: boolean
}

const DEFAULT_SETTINGS: Settings = { hide_own: false, track_gone: false }

/**
 * 골라 보는 기간.
 *
 * 기본은 3일. 수집은 매 회차 이틀치를 받지만 표에는 계속 쌓이므로, 며칠 돌고 나면
 * 7일도 채워진다.
 */
const PERIODS = [
  { id: '1', label: '오늘', days: 1 },
  { id: '3', label: '3일', days: 3 },
  { id: '7', label: '7일', days: 7 },
] as const

/** 하루 안에 처음 받은 매물인가. 네이버 날짜가 아니라 **우리가 처음 본 시각** 기준이다. */
function isFresh(a: Article): boolean {
  return Date.now() - new Date(a.first_seen_at).getTime() < 24 * 60 * 60 * 1000
}

/**
 * 네이버 광고는 최근에 시작했는데 우리는 예전부터 알던 매물 — 재등록된 것이다.
 *
 * 재등록은 새 매물이 아니다. 구분하지 않으면 같은 물건을 광고 기간마다 새 매물로
 * 다시 열어 보게 된다.
 */
function isRelisted(a: Article): boolean {
  if (!a.exposure_start_date) return false
  return a.exposure_start_date > toKstDate(a.first_seen_at)
}

const CHIP_ON = 'border-blue-600 bg-blue-600 text-white'
const CHIP_OFF =
  'border-gray-200 bg-white text-gray-600 hover:bg-gray-50 ' +
  'dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400 dark:hover:bg-gray-800'

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-sm font-medium transition-colors ${on ? CHIP_ON : CHIP_OFF}`}
    >
      {children}
    </button>
  )
}

/** 켜고 끄는 스위치. 무엇을 하는 것인지 한 줄로 같이 적는다. */
function Toggle({ on, onChange, label, hint, busy }: {
  on: boolean; onChange: (v: boolean) => void; label: string; hint: string; busy?: boolean
}) {
  return (
    <button
      onClick={() => onChange(!on)}
      disabled={busy}
      className="flex w-full items-start gap-3 rounded-xl px-2 py-2 text-left transition-colors
                 hover:bg-gray-50 disabled:opacity-50 dark:hover:bg-gray-800"
    >
      <span
        className={`mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors
                    ${on ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-700'}`}
      >
        <span className={`h-4 w-4 rounded-full bg-white transition-transform ${on ? 'translate-x-4' : ''}`} />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-gray-900 dark:text-white">{label}</span>
        <span className="block text-xs text-gray-500 dark:text-gray-500">{hint}</span>
      </span>
    </button>
  )
}

export default function NaverWatchPage() {
  const supabase = useMemo(() => createClient(), [])
  const auth = useAuth()
  const toast = useToast()

  const [rows, setRows] = useState<Article[]>([])
  const [seen, setSeen] = useState<Set<string>>(new Set())
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [savingSettings, setSavingSettings] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [agentSeenAt, setAgentSeenAt] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncProgress, setSyncProgress] = useState<string | null>(null)

  const [period, setPeriod] = useState<string>('3')
  const [unseenOnly, setUnseenOnly] = useState(false)
  const [goneOnly, setGoneOnly] = useState(false)
  // 빈 배열 = 전부 본다. 하나라도 고르면 고른 것만.
  const [regions, setRegions] = useState<string[]>([])
  const [kinds, setKinds] = useState<string[]>([])
  const [trades, setTrades] = useState<string[]>([])
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = usePageSize('naver-watch', 50)

  /** 사무소 기준 id — 직원이면 대표의 id 다. 설정은 사무소 단위로 하나뿐이다. */
  const officeId = auth.broker?.parent_broker_id ?? auth.broker?.id

  /**
   * 고른 기간의 매물을 받는다.
   *
   * **기간을 서버에서 자른다.** 하루에 천 건 넘게 올라오는 동네라 표 전체를 받으면
   * 금세 만 건이 넘는다. 그리고 PostgREST 는 한 번에 1000행만 주고 나머지를
   * 말없이 자르므로(실제로 3781건 중 1000건만 보였다) 반드시 이어받아야 한다.
   */
  const load = useCallback(async () => {
    setLoading(true)
    const days = PERIODS.find(p => p.id === period)?.days ?? 3
    // '오늘' 은 오늘 하루다. days-1 을 빼야 3일이 오늘 포함 사흘이 된다.
    const since = kstDate(days - 1)
    try {
      const [arts, views] = await Promise.all([
        fetchAllPaged<Article>((from, to) => supabase.from('naver_articles')
          .select('article_no, real_estate_type, trade_type, division, sector, brokerage_name, exposure_start_date, first_seen_at, last_seen_at, gone_at')
          .gte('exposure_start_date', since)
          .order('exposure_start_date', { ascending: false })
          .order('first_seen_at', { ascending: false })
          // 매물번호로 순서를 못박는다. 앞의 둘만으로는 822건이 같은 값이라
          // 나눠 받는 사이에 순서가 흔들려 중복·누락이 난다 — 매시간 도는 수집이
          // 그 3천 행의 last_seen_at 을 갱신하는 동안이면 특히.
          .order('article_no', { ascending: false })
          .range(from, to)),
        // 본 기록은 계속 쌓인다. 화면이 최대 7일치만 보여주므로 그만큼만 받는다.
        fetchAllPaged<{ article_no: string }>((from, to) =>
          supabase.from('naver_article_views').select('article_no')
            .gte('seen_at', new Date(Date.now() - 30 * 86_400_000).toISOString())
            .order('seen_at', { ascending: false })
            .range(from, to)),
      ])
      setError(null)
      setRows(arts)
      setSeen(new Set(views.map(v => v.article_no)))
    } catch (e) {
      setError(e instanceof Error ? e.message : '알 수 없는 오류')
    }
    setLoading(false)
  }, [supabase, period])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (!officeId) return
    void (async () => {
      const { data } = await supabase.from('naver_settings')
        .select('hide_own, track_gone').eq('broker_id', officeId).maybeSingle()
      if (data) setSettings(data as Settings)
    })()
  }, [supabase, officeId])

  /**
   * 수집을 맡은 PC 프로그램이 켜져 있는가. 광고관리 화면과 같은 방식이다.
   *
   * 목록이 안 늘 때 "네이버에 새 매물이 없는 것"과 "프로그램이 꺼져 있는 것"은
   * 전혀 다른 일인데, 화면만 봐서는 구분이 안 된다. 그래서 적어 준다.
   */
  useEffect(() => {
    let alive = true
    const tick = async () => {
      const { data } = await supabase.from('ad_agents').select('last_seen_at').maybeSingle()
      if (alive) setAgentSeenAt(data?.last_seen_at ?? null)
    }
    void tick()
    const id = setInterval(tick, 15_000)
    return () => { alive = false; clearInterval(id) }
  }, [supabase])

  const saveSetting = async (patch: Partial<Settings>) => {
    if (!officeId) return
    const before = settings
    const next = { ...settings, ...patch }
    setSettings(next)          // 먼저 화면에 반영한다 — 스위치가 늦게 움직이면 두 번 누르게 된다
    setSavingSettings(true)
    const { error } = await supabase.from('naver_settings')
      .upsert({ broker_id: officeId, ...next, updated_at: new Date().toISOString() })
    if (error) { setSettings(before); setError(error.message) }
    setSavingSettings(false)
  }

  /**
   * 지금 네이버에서 새로 받아 온다.
   *
   * **이 화면은 Vercel 서버에서 도는데 네이버는 데이터센터 IP를 막는다.** 그래서
   * 여기서 직접 못 부른다. 광고관리의 [가져오기] 와 같은 방식으로, `ad_jobs` 에
   * "해달라" 고 적어 두면 PC 프로그램이 집어가 실행한다.
   *
   * 평소에는 한 시간마다 알아서 받는다. 이 버튼은 오후에 올라온 것을 다음 회차까지
   * 기다리기 싫을 때 쓴다. 5~6분 걸린다.
   */
  async function requestCollect() {
    if (!officeId) return
    if (!agentOnline && !confirm(
      'PC의 부소장광고 프로그램이 꺼져 있는 것 같습니다.' + String.fromCharCode(10, 10)
      + '요청은 남겨 두고, 프로그램을 켜면 그때 실행됩니다.' + String.fromCharCode(10)
      + '계속할까요?'
    )) return

    setSyncing(true); setSyncProgress('요청 보냄')

    // 이미 대기·실행 중인 것이 있으면 그걸 지켜본다. 프로그램이 꺼져 있을 때 여러 번
    // 누르면 요청이 쌓여, 켜는 순간 같은 수집을 반복하게 된다.
    const { data: pending } = await supabase.from('ad_jobs')
      .select('id').eq('kind', 'naver').in('status', ['queued', 'running'])
      .order('requested_at', { ascending: true }).limit(1).maybeSingle()

    const { data: job, error } = pending
      ? { data: pending, error: null }
      : await supabase.from('ad_jobs')
        .insert({ broker_id: officeId, kind: 'naver', requested_by: auth.user?.id })
        .select('id').single()
    if (error || !job) {
      setSyncing(false); setSyncProgress(null)
      toast.error(`요청하지 못했습니다: ${error?.message ?? '알 수 없는 오류'}`)
      return
    }

    // 끝날 때까지 지켜본다. 20분이 넘으면 화면만 놓아주고 작업은 그대로 둔다.
    const deadline = Date.now() + 20 * 60_000
    const poll = setInterval(async () => {
      const { data } = await supabase.from('ad_jobs')
        .select('status, progress, result, error').eq('id', job.id).maybeSingle()
      if (!data) return
      setSyncProgress(data.progress ?? null)
      if (data.status === 'done') {
        clearInterval(poll)
        setSyncing(false); setSyncProgress(null)
        const n = (data.result as { added?: number } | null)?.added
        toast.success(n ? `새 매물 ${n}건을 받았습니다.` : '새로 올라온 매물이 없습니다.')
        void load()
      } else if (data.status === 'failed' || data.status === 'canceled') {
        clearInterval(poll)
        setSyncing(false); setSyncProgress(null)
        toast.error(`받지 못했습니다: ${data.error ?? '알 수 없는 오류'}`)
      } else if (Date.now() > deadline) {
        clearInterval(poll)
        setSyncing(false); setSyncProgress(null)
        toast.error('시간이 너무 오래 걸립니다. PC 창을 확인해 주세요.')
      }
    }, 2000)
  }

  /** 눌러 본 매물을 적어 둔다. 실패해도 화면은 흐려진 채로 둔다 — 다시 누르면 그만이다. */
  const markSeen = (articleNo: string) => {
    const uid = auth.user?.id
    if (!uid || seen.has(articleNo)) return
    setSeen(prev => new Set(prev).add(articleNo))
    void supabase.from('naver_article_views')
      .upsert({ user_id: uid, article_no: articleNo }, { onConflict: 'user_id,article_no' })
  }

  /** 마지막으로 수집이 돌아간 시각. 0건일 때 "수집이 멈춘 건지"를 여기서 안다. */
  const lastSweep = useMemo(
    () => rows.reduce<string | null>((a, r) => (!a || r.last_seen_at > a ? r.last_seen_at : a), null),
    [rows],
  )

  const toggle = (list: string[], set: (v: string[]) => void, id: string) => {
    set(list.includes(id) ? list.filter(x => x !== id) : [...list, id])
    setPage(1)
  }

  const officeName = auth.broker?.office_name?.trim()

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()

    return rows.filter(a => {
      // 사라진 매물은 따로 볼 때만 나온다 — 목록에 섞이면 죽은 링크를 누르게 된다.
      //
      // **표시 기능을 꺼 두면 사라짐 표시는 없는 셈 친다.** 안 그러면 켰다 껐을 때
      // 그동안 찍힌 매물이 목록에서도 빠지고 [사라진 것] 칩도 없어져, 볼 방법이
      // 영영 없어진다.
      if (settings.track_gone && (goneOnly ? !a.gone_at : !!a.gone_at)) return false
      if (unseenOnly && seen.has(a.article_no)) return false
      if (settings.hide_own && officeName && a.brokerage_name === officeName) return false
      if (regions.length) {
        const region = REGIONS.find(r => a.division?.startsWith(r.divisionPrefix))
        if (!region || !regions.includes(region.id)) return false
      }
      if (kinds.length && !kinds.includes(kindOf(a.real_estate_type))) return false
      if (trades.length && !trades.includes(a.trade_type)) return false
      if (needle && ![a.division, a.sector].filter(Boolean).join(' ').toLowerCase().includes(needle)) return false
      return true
    })
  }, [rows, regions, kinds, trades, q, unseenOnly, goneOnly, seen,
      settings.hide_own, settings.track_gone, officeName])

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const shown = filtered.slice((page - 1) * pageSize, page * pageSize)
  const unseenCount = useMemo(() => filtered.filter(a => !seen.has(a.article_no)).length, [filtered, seen])

  /** 하트비트가 이보다 오래되면 꺼진 것으로 본다. 광고관리 화면과 같은 잣대다. */
  const agentOnline = !!agentSeenAt && Date.now() - new Date(agentSeenAt).getTime() < 60_000

  if (auth.loading || !auth.broker) return null

  return (
    <>
      <Header />
      <main className="mx-auto max-w-7xl px-4 py-6">
        <PageHeader
          title="신규매물"
          icon={Radar}
          description={
            <>
              네이버부동산에 없는 최신순 목록
              {lastSweep && ` · 마지막 수집 ${new Date(lastSweep).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`}
              {!agentOnline && (
                <span className="text-amber-600 dark:text-amber-400">
                  {' · 광고 프로그램이 꺼져 있어 새로 받지 않습니다'}
                </span>
              )}
            </>
          }
          actions={
            <div className="flex items-center gap-2">
            <button
              onClick={requestCollect}
              disabled={syncing}
              title={agentOnline
                ? '네이버에서 지금 새로 받아옵니다 (5~6분)'
                : 'PC에서 부소장광고 프로그램을 먼저 켜 주세요'}
              className="flex h-9 items-center gap-1.5 rounded-xl bg-blue-600 px-3 text-sm font-medium
                         text-white transition-colors hover:bg-blue-700 disabled:opacity-60"
            >
              <Download className={`h-4 w-4 ${syncing ? 'animate-pulse' : ''}`} aria-hidden />
              {syncing ? (syncProgress ?? '받는 중…') : '지금 수집'}
            </button>
            <button
              onClick={() => setShowSettings(v => !v)}
              className="flex h-9 items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 text-sm
                         font-medium text-gray-700 transition-colors hover:bg-gray-50
                         dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              <Settings2 className="h-4 w-4" aria-hidden />
              설정
            </button>
            </div>
          }
        />

        {showSettings && (
          <div className="mb-5 space-y-1 rounded-2xl border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
            <Toggle
              on={settings.hide_own} busy={savingSettings}
              onChange={v => saveSetting({ hide_own: v })}
              label="우리 사무소 매물 빼기"
              hint={officeName
                ? `'${officeName}' 이(가) 올린 매물은 목록에서 뺍니다`
                : '사무소 이름이 등록돼 있지 않아 지금은 동작하지 않습니다 (설정 → 사무소)'}
            />
            <Toggle
              on={settings.track_gone} busy={savingSettings}
              onChange={v => saveSetting({ track_gone: v })}
              label="사라진 매물 표시"
              hint="받아 둔 매물이 네이버에서 내려가면 표시합니다. 거래됐거나 광고를 접은 것입니다"
            />
          </div>
        )}

        <div className="mb-5 space-y-3 rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-12 shrink-0 text-sm text-gray-500 dark:text-gray-500">기간</span>
            {PERIODS.map(p => (
              <Chip key={p.id} on={period === p.id} onClick={() => { setPeriod(p.id); setPage(1) }}>
                {p.label}
              </Chip>
            ))}
            <span className="mx-1 h-4 w-px bg-gray-200 dark:bg-gray-800" />
            <Chip on={unseenOnly} onClick={() => { setUnseenOnly(v => !v); setPage(1) }}>안 본 것만</Chip>
            {settings.track_gone && (
              <Chip on={goneOnly} onClick={() => { setGoneOnly(v => !v); setPage(1) }}>사라진 것</Chip>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-12 shrink-0 text-sm text-gray-500 dark:text-gray-500">지역</span>
            {REGIONS.map(r => (
              <Chip key={r.id} on={regions.includes(r.id)} onClick={() => toggle(regions, setRegions, r.id)}>
                {r.name}
              </Chip>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-12 shrink-0 text-sm text-gray-500 dark:text-gray-500">종류</span>
            {Object.keys(PROPERTY_KINDS).map(kind => (
              <Chip key={kind} on={kinds.includes(kind)} onClick={() => toggle(kinds, setKinds, kind)}>
                {kind}
              </Chip>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-12 shrink-0 text-sm text-gray-500 dark:text-gray-500">거래</span>
            {Object.entries(TRADE_TYPES).map(([code, name]) => (
              <Chip key={code} on={trades.includes(code)} onClick={() => toggle(trades, setTrades, code)}>
                {name}
              </Chip>
            ))}
            <div className="relative ml-auto">
              <input
                value={q}
                onChange={e => { setQ(e.target.value); setPage(1) }}
                placeholder="동 이름으로 좁히기"
                className="h-9 w-48 rounded-xl border border-gray-200 bg-white pl-3 pr-8 text-sm
                           text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none
                           dark:border-gray-800 dark:bg-gray-950 dark:text-white"
              />
              {q && <SearchClear onClick={() => setQ('')} />}
            </div>
          </div>
        </div>

        {loading ? (
          <p className="py-20 text-center text-gray-500 dark:text-gray-500">불러오는 중…</p>
        ) : error ? (
          <p className="py-20 text-center text-red-600 dark:text-red-400">목록을 불러오지 못했습니다 — {error}</p>
        ) : filtered.length === 0 ? (
          <p className="py-20 text-center text-gray-500 dark:text-gray-500">
            {rows.length === 0
              ? '아직 수집된 매물이 없습니다. 광고 프로그램을 켜 두면 한 시간마다 받아 옵니다.'
              : unseenOnly ? '안 본 매물이 없습니다. 다 훑으셨습니다.'
              : '고른 조건에 맞는 매물이 없습니다.'}
          </p>
        ) : (
          <>
            <p className="mb-2 text-sm text-gray-600 dark:text-gray-400">
              {filtered.length}건
              {!unseenOnly && unseenCount < filtered.length && ` · 안 본 것 ${unseenCount}건`}
            </p>
            <ul className="divide-y divide-gray-100 overflow-hidden rounded-2xl border border-gray-200
                           bg-white dark:divide-gray-800 dark:border-gray-800 dark:bg-gray-900">
              {shown.map(a => {
                const 봤음 = seen.has(a.article_no)
                return (
                  <li key={a.article_no}>
                    <a
                      href={`https://fin.land.naver.com/articles/${a.article_no}`}
                      target="_blank"
                      rel="noreferrer"
                      onClick={() => markSeen(a.article_no)}
                      className={`group flex items-center gap-3 px-4 py-2.5 transition-colors
                                  hover:bg-blue-50/60 dark:hover:bg-gray-800 ${봤음 ? 'opacity-45' : ''}`}
                    >
                      <span className="w-11 shrink-0 text-sm tabular-nums text-gray-400 dark:text-gray-600">
                        {a.exposure_start_date?.slice(5).replace('-', '/')}
                      </span>
                      <span className="w-16 shrink-0 text-sm text-gray-500 dark:text-gray-500">
                        {kindOf(a.real_estate_type)}
                      </span>
                      <span className="w-10 shrink-0 text-sm text-gray-500 dark:text-gray-500">
                        {TRADE_TYPES[a.trade_type as keyof typeof TRADE_TYPES] ?? a.trade_type}
                      </span>
                      <span className={`min-w-0 flex-1 truncate text-sm text-gray-900 group-hover:underline
                                        dark:text-white ${a.gone_at ? 'line-through' : ''}`}>
                        {[a.division, a.sector].filter(Boolean).join(' ')}
                      </span>
                      {a.gone_at ? (
                        <span className="shrink-0 rounded bg-gray-200 px-1.5 py-0.5 text-[11px] font-medium text-gray-600
                                         dark:bg-gray-700 dark:text-gray-300">사라짐</span>
                      ) : isRelisted(a) ? (
                        <span
                          className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-700
                                     dark:bg-amber-900/40 dark:text-amber-400"
                          title="예전부터 있던 매물인데 네이버 광고만 새로 올라왔습니다"
                        >재등록</span>
                      ) : isFresh(a) && !봤음 ? (
                        <span className="shrink-0 rounded bg-blue-600 px-1.5 py-0.5 text-[11px] font-semibold text-white">신규</span>
                      ) : null}
                    </a>
                  </li>
                )
              })}
            </ul>

            <Pagination
              page={page}
              totalPages={totalPages}
              pageSize={pageSize}
              totalCount={filtered.length}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
            />
          </>
        )}
      </main>
    </>
  )
}
