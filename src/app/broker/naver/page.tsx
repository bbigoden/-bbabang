'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '@/lib/auth-context'
import { createClient } from '@/lib/supabase/client'
import { Header } from '@/components/layout/header'
import { PageHeader } from '@/components/layout/page-header'
import { Pagination, usePageSize } from '@/components/sheet/pagination'
import { SearchClear } from '@/components/ui/search-clear'
import { fetchAllPaged } from '@/lib/fetch-all-paged'
import { useToast } from '@/components/toast'
import { Radar, Download } from 'lucide-react'
import { PROPERTY_KINDS, TRADE_TYPES, REGIONS, kindOf, toKstDate } from '@/lib/naver-land'
import { DAANGN_KINDS, DAANGN_TRADES, daangnKindOf } from '@/lib/daangn-land'
import { sendAndForget } from '@/lib/send-and-forget'
import { DateRangeCell } from '@/components/sheet/cells/date-cell'
import { todayKST, addDays } from '@/lib/date-kst'

/**
 * 매물수집 — 네이버·당근에 올라온 매물을 최신순으로 모아 둔 링크 목록.
 *
 * 두 곳 다 화면에 최신순 정렬이 없다. 그래서 새로 올라온 매물을 찾으려면 지도를
 * 옮겨 가며 매일 눈으로 훑어야 했고, 그 일에 하루 시간이 통째로 들어갔다.
 *
 * **곳을 탭으로 가른다.** 올라오는 매물의 성격이 다르다 — 네이버는 중개사 광고,
 * 당근은 직거래가 섞인다. 한 목록에 섞으면 둘 다 제대로 못 훑는다.
 *
 * **이 화면은 링크 목록이다.** 가격·면적·사진은 일부러 싣지 않는다 — 어차피 눌러
 * 들어가서 주변과 시세를 직접 봐야 하고, 여기서 미리 보여 줘 봐야 한 화면에
 * 들어가는 건수만 줄어든다. 여기서 할 일은 **무엇을 눌러 볼지 고르는 것**뿐이다.
 *
 * **누른 것은 흐려진다.** 매일 열면 어제 본 것이 섞여 있어 '어디까지 봤더라' 를
 * 매번 다시 하게 된다. 본 것은 사람마다 따로 세므로 직원이 훑어도 사장님 화면은
 * 그대로다.
 *
 * 받아오는 일은 사장님 PC의 광고 프로그램(`부소장광고`)이 한다. 서버에서 받게
 * 만들었다가 걷어냈다 — 네이버가 데이터센터 IP를 막아 Vercel 에서는 다섯 번 다
 * 응답 없이 멎었다. 뱅크·카페와 같은 이유로 PC가 맡는다.
 *
 * **아침 9시 30분에 한 번, 그리고 [가져오기] 를 누를 때 받는다.** 한 시간마다
 * 받게 해 뒀다가 걷어냈다 — 하루 스물네 번 부를 이유가 없다. 아침 한 번만은 두는데,
 * 화면을 열자마자 훑을 수 있어야지 눌러 놓고 6분을 기다릴 일이 아니기 때문이다.
 * 거는 쪽은 PC 프로그램이다(`부소장광고/src/cli/agent-worker.js`).
 *
 * **기간은 달력에서 고른다.** 한 번에 최대 7일 — 여기서 할 일은 훑는 것이지 뒤지는
 * 것이 아니고, 길게 잡으면 하루 천 건씩이라 화면이 만 건을 넘는다.
 *
 * **[가져오기] 는 보고 있는 탭의 것만 받는다.** 버튼에 곳 이름을 붙이지 않는 이유는
 * 탭이 이미 말하고 있어서다. 다만 안에서는 곳마다 따로 돌아, 네이버를 걸어 두고
 * 당근 탭으로 옮겨 거기서 또 걸 수 있다 — 한 곳에 5~8분이라 하나가 끝나기를 앉아
 * 기다렸다 다시 누르게 하면 안 된다. 도는 중인 다른 곳은 위 상태 줄에 적어 준다.
 */

/** 화면이 다루는 한 줄. 곳이 달라도 이 모양으로 맞춰 담는다. */
type Row = {
  article_no: string
  kind_code: string
  trade_code: string | null
  division: string | null
  sector: string | null
  owner: string | null
  /** 목록 왼쪽에 적는 날짜 */
  shown_date: string | null
  first_seen_at: string
  last_seen_at: string
  gone_at: string | null
  /** 예전부터 알던 매물인데 광고만 새로 올라온 것 (네이버만 알 수 있다) */
  relisted: boolean
}

type Settings = { hide_own: boolean; track_gone: boolean }
const DEFAULT_SETTINGS: Settings = { hide_own: false, track_gone: false }

/**
 * 곳마다 다른 것들을 여기 한 곳에 모아 둔다.
 *
 * 표 이름·매물종류 코드·거래유형·링크 주소가 곳마다 다르다. 화면을 둘로 만들면
 * 고칠 때마다 두 번 고쳐야 하므로, 다른 점만 여기 적고 그리는 코드는 하나로 둔다.
 */
const SOURCES = {
  naver: {
    label: '네이버',
    table: 'naver_articles',
    views: 'naver_article_views',
    jobKind: 'naver',
    /** 한 번 받는 데 걸리는 시간. 실측값이다 — 어림수를 적으면 멈춘 줄 안다. */
    takes: '5~8분',
    columns: 'article_no, real_estate_type, trade_type, division, sector, brokerage_name, exposure_start_date, first_seen_at, last_seen_at, gone_at',
    /** 매물종류 이름 → 코드들 */
    kinds: PROPERTY_KINDS as Record<string, readonly string[]>,
    kindOf,
    trades: TRADE_TYPES as Record<string, string>,
    /**
     * 기간을 자르는 칸.
     *
     * 네이버는 광고 노출 시작일을 주므로 그것으로 자른다. 그 날짜는 재등록하면
     * 갱신되지만, 그래도 '언제부터 걸려 있는 광고인가' 는 그 값이 맞다.
     */
    dateColumn: 'exposure_start_date',
    /** 날짜만 담는 칸이라 '2026-09-05' 를 그대로 견줘도 된다. */
    dateIsTimestamp: false,
    link: (no: string) => `https://fin.land.naver.com/articles/${no}`,
    toRow: (a: any): Row => ({
      article_no: a.article_no,
      kind_code: a.real_estate_type,
      trade_code: a.trade_type,
      division: a.division,
      sector: a.sector,
      owner: a.brokerage_name,
      shown_date: a.exposure_start_date,
      first_seen_at: a.first_seen_at,
      last_seen_at: a.last_seen_at,
      gone_at: a.gone_at,
      relisted: !!a.exposure_start_date && a.exposure_start_date > toKstDate(a.first_seen_at),
    }),
  },
  daangn: {
    label: '당근',
    table: 'daangn_articles',
    views: 'daangn_article_views',
    jobKind: 'daangn',
    /** 실측 346초. 우리 지역 아닌 동을 첫 쪽에서 접기 전에는 460초였다. */
    takes: '6~9분',
    columns: 'article_no, sales_type, trade_type, division, sector, writer_name, first_seen_at, last_seen_at, gone_at',
    kinds: Object.fromEntries(Object.entries(DAANGN_KINDS).map(([k, v]) => [k, [v]])) as Record<string, readonly string[]>,
    kindOf: daangnKindOf,
    trades: DAANGN_TRADES as Record<string, string>,
    /**
     * **당근은 날짜를 안 준다.** 응답에 등록일·수정일이 아예 없다. 그래서 우리가
     * 처음 받은 날로 자르고, 목록에도 그 날짜를 적는다.
     */
    dateColumn: 'first_seen_at',
    /**
     * 시각까지 담는 칸이다. 날짜 글자를 그대로 견주면 세계표준시 0시로 읽혀
     * 한국 날짜와 아홉 시간 어긋난다 — 아침에 받은 매물이 어제로 밀린다.
     */
    dateIsTimestamp: true,
    link: (no: string) => `https://realty.daangn.com/articles/${no}`,
    toRow: (a: any): Row => ({
      article_no: a.article_no,
      kind_code: a.sales_type,
      trade_code: a.trade_type,
      division: a.division,
      sector: a.sector,
      owner: a.writer_name,
      shown_date: toKstDate(a.first_seen_at),
      first_seen_at: a.first_seen_at,
      last_seen_at: a.last_seen_at,
      gone_at: a.gone_at,
      relisted: false,
    }),
  },
} as const

type SourceId = keyof typeof SOURCES

/** 자주 쓰는 기간. 누르면 달력의 두 날짜가 그에 맞게 잡힌다. */
const PERIODS = [
  { id: '1', label: '오늘', days: 1 },
  { id: '3', label: '3일', days: 3 },
  { id: '7', label: '7일', days: 7 },
] as const

/**
 * 한 번에 볼 수 있는 최대 날수.
 *
 * 하루에 천 건 넘게 올라오는 동네라 길게 잡으면 화면이 만 건이 넘는다. 그리고
 * 여기서 할 일은 훑는 것이지 뒤지는 것이 아니다 — 7일이면 밀린 것을 메우고도 남는다.
 */
const MAX_DAYS = 7

/** 얼마나 지난 날까지 고를 수 있나. 프로그램이 90일 지난 매물을 지운다. */
const KEEP_DAYS = 90

/** 그 날의 다음 날. */
const 다음날 = (day: string) => addDays(day, 1)

/** 두 날 사이 날수 — 양 끝을 다 센다. 9/1~9/3 이면 3. */
function 날수(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1
}

/**
 * 대장에서 견줄 값으로 바꾼다.
 *
 * 날짜만 담는 칸은 글자 그대로, 시각까지 담는 칸은 **그 날 한국 0시** 를 가리키는
 * 순간으로. 후자를 빼먹으면 아홉 시간이 어긋나 아침에 받은 매물이 어제로 밀린다.
 */
function 경계(day: string, 시각칸: boolean): string {
  return 시각칸 ? new Date(`${day}T00:00:00+09:00`).toISOString() : day
}

/** 하루 안에 처음 받은 매물인가. 곳이 주는 날짜가 아니라 **우리가 처음 본 시각** 기준이다. */
function isFresh(r: Row): boolean {
  return Date.now() - new Date(r.first_seen_at).getTime() < 24 * 60 * 60 * 1000
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

export default function CollectPage() {
  const supabase = useMemo(() => createClient(), [])
  const auth = useAuth()
  const toast = useToast()

  const [source, setSource] = useState<SourceId>('naver')
  const src = SOURCES[source]

  const [rows, setRows] = useState<Row[]>([])
  /** 매물번호 → 몇 번 눌러 봤나. 없으면 아직 안 본 것. */
  const [seen, setSeen] = useState<Map<string, number>>(new Map())
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [savingSettings, setSavingSettings] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [agentSeenAt, setAgentSeenAt] = useState<string | null>(null)

  /**
   * 곳마다 따로 돈다 — 값이 있으면 그 곳을 받아오는 중이고, 그 값이 진행 표시다.
   *
   * 예전에는 받는 중 하나로 뭉쳐 있어서, 네이버를 걸어 두면 당근 버튼까지 잠겼다.
   * 네이버가 5~8분이라 그게 끝날 때까지 앉아 기다렸다가 당근을 또 눌러야 했다.
   * 이제 둘을 함께 걸어 두고 자리를 떠도 된다 — PC 프로그램이 차례로 처리한다.
   */
  const [jobs, setJobs] = useState<Record<SourceId, string | null>>({ naver: null, daangn: null })

  /** 지켜보는 중인 타이머. 화면을 떠날 때 정리하지 않으면 없는 화면을 계속 고치려 든다. */
  const timers = useRef<Partial<Record<SourceId, ReturnType<typeof setInterval>>>>({})
  useEffect(() => () => { for (const t of Object.values(timers.current)) clearInterval(t) }, [])

  /**
   * 볼 기간 — 달력에서 직접 고른다. 자주 쓰는 것은 위 칩으로 한 번에 잡는다.
   *
   * `from`/`to` 라고 안 쓴 것은 아래 `fetchAllPaged` 의 쪽 번호(from, to)와 이름이
   * 겹쳐서다. 한 화면 안에서 같은 이름이 다른 뜻으로 두 번 나오면 반드시 헷갈린다.
   */
  const [첫날, set첫날] = useState<string>(() => addDays(todayKST(), -2))
  const [끝날, set끝날] = useState<string>(() => todayKST())

  const [unseenOnly, setUnseenOnly] = useState(false)
  const [goneOnly, setGoneOnly] = useState(false)
  // 빈 배열 = 전부 본다. 하나라도 고르면 고른 것만.
  const [regions, setRegions] = useState<string[]>([])
  const [kinds, setKinds] = useState<string[]>([])
  const [trades, setTrades] = useState<string[]>([])
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = usePageSize('collect-watch', 50)

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
    const s = SOURCES[source]
    try {
      const [arts, views] = await Promise.all([
        fetchAllPaged<any>((from, to) => {
          let q = supabase.from(s.table).select(s.columns)
            .gte(s.dateColumn, 경계(첫날, s.dateIsTimestamp))
          // 끝날이 오늘이면 위를 막지 않는다. 막으면 날짜가 앞선 매물이 조용히
          // 빠지는데, 지금까지 보이던 것이 안 보이게 되는 셈이다.
          if (끝날 < todayKST()) q = q.lt(s.dateColumn, 경계(다음날(끝날), s.dateIsTimestamp))
          return q
            .order(s.dateColumn, { ascending: false })
            // 매물번호로 순서를 못박는다. 날짜만으로는 같은 값이 수백 건이라
            // 나눠 받는 사이에 순서가 흔들려 중복·누락이 난다.
            .order('article_no', { ascending: false })
            .range(from, to)
        }),
        // 본 기록은 계속 쌓인다. 화면이 최대 7일치만 보여주므로 그만큼만 받는다.
        fetchAllPaged<{ article_no: string; view_count: number }>((from, to) =>
          supabase.from(s.views).select('article_no, view_count')
            .gte('seen_at', new Date(Date.now() - 30 * 86_400_000).toISOString())
            .order('seen_at', { ascending: false })
            .range(from, to)),
      ])
      setError(null)
      setRows(arts.map(s.toRow))
      setSeen(new Map(views.map(v => [v.article_no, v.view_count ?? 1])))
    } catch (e) {
      setError(e instanceof Error ? e.message : '알 수 없는 오류')
    }
    setLoading(false)
  }, [supabase, source, 첫날, 끝날])

  useEffect(() => { void load() }, [load])

  // 받아오기가 끝났을 때 **그때 보고 있는 탭**을 다시 읽어야 한다. 지켜보는 함수가
  // 잡아 둔 옛 load 를 그대로 부르면, 당근을 보는 중에 네이버 목록이 들어온다.
  const loadRef = useRef(load)
  const sourceRef = useRef(source)
  useEffect(() => { loadRef.current = load; sourceRef.current = source }, [load, source])

  useEffect(() => {
    if (!officeId) return
    void (async () => {
      const { data } = await supabase.from('collect_settings')
        .select('hide_own, track_gone').eq('broker_id', officeId).eq('source', source).maybeSingle()
      setSettings((data as Settings) ?? DEFAULT_SETTINGS)
    })()
  }, [supabase, officeId, source])

  /**
   * 받아오는 PC 프로그램이 켜져 있는가. 광고관리 화면과 같은 방식이다.
   *
   * 목록이 안 늘 때 "새 매물이 없는 것"과 "프로그램이 꺼져 있는 것"은 전혀 다른
   * 일인데, 화면만 봐서는 구분이 안 된다. 그래서 적어 준다.
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
    setSettings(next)          // 먼저 화면에 반영한다 — 늦게 움직이면 두 번 누르게 된다
    setSavingSettings(true)
    const { error } = await supabase.from('collect_settings')
      .upsert({ broker_id: officeId, source, ...next, updated_at: new Date().toISOString() })
    if (error) { setSettings(before); toast.error(`설정을 저장하지 못했습니다: ${error.message}`) }
    setSavingSettings(false)
  }

  /**
   * 눌러 본 매물을 적어 둔다. 실패해도 화면은 흐려진 채로 둔다 — 다시 누르면 그만이다.
   *
   * **`sendAndForget` 을 거치는 이유** — `void supabase...` 로 두면 요청이 아예
   * 나가지 않는다. 그래서 이 기록이 한 건도 안 남았고, 흐려짐이 그 화면에서만
   * 보이다 새로고침하면 사라졌다.
   */
  const markSeen = (articleNo: string) => {
    const uid = auth.user?.id
    if (!uid) return
    const 횟수 = (seen.get(articleNo) ?? 0) + 1
    setSeen(prev => new Map(prev).set(articleNo, 횟수))
    sendAndForget(supabase.from(src.views).upsert(
      { user_id: uid, article_no: articleNo, view_count: 횟수, seen_at: new Date().toISOString() },
      { onConflict: 'user_id,article_no' },
    ))
  }

  /**
   * 걸어 둔 수집이 끝날 때까지 지켜본다.
   *
   * 누를 때만이 아니라 화면을 새로 열 때도 쓴다 — 돌고 있는 것을 이어서 보여줘야
   * 한다. 30분이 넘으면 화면만 놓아주고 작업은 그대로 둔다. 앞선 수집 뒤에 서
   * 있을 수 있어 넉넉히 잡는다.
   */
  const watchJob = useCallback((id: SourceId, jobId: string) => {
    const s = SOURCES[id]
    const 진행 = (text: string | null) => setJobs(prev => ({ ...prev, [id]: text }))
    const 끝 = () => { clearInterval(timers.current[id]); delete timers.current[id]; 진행(null) }
    진행('가져오는 중…')

    const deadline = Date.now() + 30 * 60_000
    timers.current[id] = setInterval(async () => {
      const { data } = await supabase.from('ad_jobs')
        .select('status, progress, result, error').eq('id', jobId).maybeSingle()
      // 작업이 사라졌거나 못 읽었을 때도 시한은 봐야 한다. 그냥 돌아가면 이 지켜보기가
      // 영영 안 끝나고, 버튼도 계속 잠긴 채로 남는다.
      if (!data) {
        if (Date.now() > deadline) { 끝(); toast.error(`${s.label} 가져오기 상태를 알 수 없습니다. 다시 눌러 주세요.`) }
        return
      }
      if (data.status === 'done') {
        끝()
        const r = data.result as { added?: number; fetched?: number; missed?: number } | null
        // 못 본 곳이 있으면 그것부터 말한다 — '새 매물 0건' 과 '못 받았다' 는 다르다.
        if (r?.missed) toast.error(`${s.label} — ${r.missed}곳을 못 받았습니다. 잠시 뒤 다시 눌러 주세요.`)
        else if (r?.added) toast.success(`${s.label} — 새 매물 ${r.added}건을 받았습니다. (전체 ${r.fetched ?? 0}건 확인)`)
        else toast.success(`${s.label} — 새로 올라온 매물이 없습니다. (전체 ${r?.fetched ?? 0}건 확인)`)
        // 지금 보고 있는 탭일 때만 다시 읽는다. 아니면 그 탭으로 옮길 때 읽힌다.
        if (sourceRef.current === id) void loadRef.current()
      } else if (data.status === 'failed' || data.status === 'canceled') {
        끝()
        toast.error(`${s.label} 을(를) 가져오지 못했습니다 — ${data.error ?? '알 수 없는 오류'}`)
      } else if (Date.now() > deadline) {
        끝()
        toast.error(`${s.label} 가져오기가 너무 오래 걸립니다. PC 프로그램 창을 확인해 주세요.`)
      } else {
        // 아직 차례가 안 온 작업은 진행 표시가 없다. 멈춘 것처럼 보이지 않게 적어 준다.
        진행(data.status === 'queued' ? '차례 기다리는 중' : (data.progress ?? '가져오는 중…'))
      }
    }, 2000)
  }, [supabase, toast])

  /**
   * 그 곳에서 새 매물을 받아 온다 — 광고관리의 [가져오기] 와 같은 방식.
   *
   * **이 화면은 Vercel 서버에서 도는데 네이버·당근 모두 데이터센터 IP를 막는다.**
   * 그래서 `ad_jobs` 에 "해달라" 고 적어 두면 PC 프로그램이 집어가 실행한다.
   *
   * **곳마다 따로 부른다.** 보고 있는 탭과 상관없이 누를 수 있고, 하나가 도는
   * 중에도 다른 하나를 걸 수 있다. PC 프로그램은 한 번에 하나씩 처리하므로
   * 뒤엣것은 앞엣것이 끝날 때까지 '차례 기다리는 중' 으로 서 있는다.
   */
  async function requestCollect(id: SourceId) {
    if (!officeId || jobs[id]) return
    const s = SOURCES[id]
    if (!agentOnline && !confirm(
      'PC의 부소장광고 프로그램이 꺼져 있는 것 같습니다.' + String.fromCharCode(10, 10)
      + '요청은 남겨 두고, 프로그램을 켜면 그때 실행됩니다.' + String.fromCharCode(10)
      + '계속할까요?'
    )) return

    setJobs(prev => ({ ...prev, [id]: '요청 보냄' }))

    // 이미 대기·실행 중인 것이 있으면 그걸 지켜본다. 프로그램이 꺼져 있을 때 여러 번
    // 누르면 요청이 쌓여, 켜는 순간 같은 수집을 반복하게 된다.
    const { data: pending } = await supabase.from('ad_jobs')
      .select('id').eq('kind', s.jobKind).in('status', ['queued', 'running'])
      .order('requested_at', { ascending: true }).limit(1).maybeSingle()

    const { data: job, error } = pending
      ? { data: pending, error: null }
      : await supabase.from('ad_jobs')
        .insert({ broker_id: officeId, kind: s.jobKind, requested_by: auth.user?.id })
        .select('id').single()
    if (error || !job) {
      setJobs(prev => ({ ...prev, [id]: null }))
      toast.error(`${s.label} 가져오기를 요청하지 못했습니다 — ${error?.message ?? '알 수 없는 오류'}`)
      return
    }
    watchJob(id, job.id)
  }

  /**
   * 화면을 새로 열어도 돌고 있는 수집을 이어서 보여 준다.
   *
   * 걸어 두고 새로고침하거나 다른 화면에 다녀오면 아무 일도 없는 것처럼 보였다.
   * 그러면 또 누르게 되는데, 눌러도 같은 작업에 붙을 뿐이라 헛걸음이다.
   */
  useEffect(() => {
    if (!officeId) return
    void (async () => {
      const { data } = await supabase.from('ad_jobs')
        .select('id, kind')
        .in('kind', Object.values(SOURCES).map(s => s.jobKind))
        .in('status', ['queued', 'running'])
      for (const j of data ?? []) {
        const id = (Object.keys(SOURCES) as SourceId[]).find(k => SOURCES[k].jobKind === j.kind)
        if (id && !timers.current[id]) watchJob(id, j.id)
      }
    })()
  }, [supabase, officeId, watchJob])

  /** 마지막으로 받아온 시각. 0건일 때 "받아오기가 멈춘 건지"를 여기서 안다. */
  const lastSweep = useMemo(
    () => rows.reduce<string | null>((a, r) => (!a || r.last_seen_at > a ? r.last_seen_at : a), null),
    [rows],
  )

  const 기간잡기 = (a: string, b: string) => { set첫날(a); set끝날(b); setPage(1) }

  /** 칩이 지금 고른 기간과 같은가 — 끝이 오늘이고 날수가 맞으면. */
  const 칩켜짐 = (days: number) => 끝날 === todayKST() && 날수(첫날, 끝날) === days

  const toggle = (list: string[], set: (v: string[]) => void, id: string) => {
    set(list.includes(id) ? list.filter(x => x !== id) : [...list, id])
    setPage(1)
  }

  const ownName = auth.broker?.office_name?.trim()

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return rows.filter(r => {
      // 사라진 매물은 따로 볼 때만 나온다 — 목록에 섞이면 죽은 링크를 누르게 된다.
      // 표시 기능을 꺼 두면 사라짐 표시는 없는 셈 친다.
      if (settings.track_gone && (goneOnly ? !r.gone_at : !!r.gone_at)) return false
      if (unseenOnly && seen.has(r.article_no)) return false
      if (settings.hide_own && ownName && r.owner === ownName) return false
      if (regions.length) {
        const region = REGIONS.find(g => r.division?.startsWith(g.divisionPrefix))
        if (!region || !regions.includes(region.id)) return false
      }
      if (kinds.length && !kinds.includes(src.kindOf(r.kind_code))) return false
      if (trades.length && !trades.includes(r.trade_code ?? '')) return false
      if (needle && ![r.division, r.sector].filter(Boolean).join(' ').toLowerCase().includes(needle)) return false
      return true
    })
  }, [rows, regions, kinds, trades, q, unseenOnly, goneOnly, seen,
      settings.hide_own, settings.track_gone, ownName, src])

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const shown = filtered.slice((page - 1) * pageSize, page * pageSize)
  const unseenCount = useMemo(() => filtered.filter(r => !seen.has(r.article_no)).length, [filtered, seen])

  /** 하트비트가 이보다 오래되면 꺼진 것으로 본다. 광고관리 화면과 같은 잣대다. */
  const agentOnline = !!agentSeenAt && Date.now() - new Date(agentSeenAt).getTime() < 60_000

  /** 곳을 바꾸면 그 곳에 없는 필터가 남아 있으면 안 된다. */
  const switchSource = (next: SourceId) => {
    if (next === source) return
    setSource(next); setKinds([]); setTrades([]); setGoneOnly(false); setPage(1)
  }

  if (auth.loading || !auth.broker) return null

  return (
    <>
      <Header />
      <main className="mx-auto max-w-7xl px-4 py-6">
        <PageHeader title="매물수집" icon={Radar} />

        {/* 곳을 가른다. 올라오는 매물의 성격이 달라 한 목록에 섞으면 둘 다 못 훑는다. */}
        <div className="mb-3 flex items-center gap-1 border-b border-gray-200 dark:border-gray-800">
          {(Object.keys(SOURCES) as SourceId[]).map(id => (
            <button
              key={id}
              onClick={() => switchSource(id)}
              className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
                id === source
                  ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                  : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-500 dark:hover:text-gray-300'
              }`}
            >
              {SOURCES[id].label}
            </button>
          ))}
        </div>

        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
          {lastSweep && (
            <span>
              {new Date(lastSweep).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} 받아옴
            </span>
          )}
          <span className="flex items-center gap-1">
            <span className={`h-1.5 w-1.5 rounded-full ${agentOnline ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'}`} />
            {agentOnline ? 'PC 프로그램 켜짐' : 'PC 프로그램 꺼짐'}
          </span>
          {/* 자동으로 받는다는 걸 화면 어딘가에서 말해 주지 않으면, 아침에 이미 받아져
              있는 것을 보고 "어제 것이 남아 있나" 하게 된다. */}
          <span>매일 오전 9시 30분 자동</span>
          {/* 다른 탭 것이 도는 중이면 여기에 적는다. 버튼은 보고 있는 탭 것만
              보여 주므로, 이게 없으면 아까 걸어 둔 것이 어떻게 됐는지 알 길이 없다. */}
          {(Object.keys(SOURCES) as SourceId[])
            .filter(id => id !== source && jobs[id])
            .map(id => (
              <span key={id} className="text-blue-600 dark:text-blue-400">
                {SOURCES[id].label} 받는 중 — {jobs[id]}
              </span>
            ))}
          {!agentOnline && (
            <span>PC 바탕화면의 <b className="font-medium">부소장 광고 프로그램</b> 을 켜면 [가져오기]가 동작합니다.</span>
          )}
        </div>

        <div className="mb-5 space-y-3 rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-12 shrink-0 text-sm text-gray-500 dark:text-gray-500">기간</span>
            {PERIODS.map(p => (
              <Chip key={p.id} on={칩켜짐(p.days)} onClick={() => 기간잡기(addDays(todayKST(), -(p.days - 1)), todayKST())}>
                {p.label}
              </Chip>
            ))}
            {/* 매물목록·고객목록이 쓰는 그 달력 그대로다 — 화면마다 다른 달력이 뜨면
                같은 프로그램으로 안 보인다. 다른 곳은 한 날만 고르므로, 기간이 필요한
                여기서만 두 날을 눌러 정한다. */}
            <DateRangeCell
              from={첫날} to={끝날}
              onSave={기간잡기}
              maxDays={MAX_DAYS}
              min={addDays(todayKST(), -(KEEP_DAYS - 1))}
              max={todayKST()}
            />
            <span className="text-xs text-gray-400 dark:text-gray-600">{날수(첫날, 끝날)}일</span>
            <span className="mx-1 h-4 w-px bg-gray-200 dark:bg-gray-800" />
            <Chip on={unseenOnly} onClick={() => { setUnseenOnly(v => !v); setPage(1) }}>안 본 것만</Chip>
            {settings.track_gone && (
              <Chip on={goneOnly} onClick={() => { setGoneOnly(v => !v); setPage(1) }}>사라진 것</Chip>
            )}
            {/* 보고 있는 탭의 것만 받는다. 그래서 이름에 곳을 붙일 필요가 없다 —
                탭이 이미 어느 곳인지 말하고 있다. 다만 안에서는 곳마다 따로 돌아,
                네이버를 걸어 두고 당근 탭으로 옮겨 거기서 또 걸 수 있다. */}
            <button
              onClick={() => void requestCollect(source)}
              disabled={!!jobs[source]}
              title={agentOnline
                ? `${src.label}에서 새 매물을 받아옵니다 (${src.takes})`
                : 'PC에서 부소장광고 프로그램을 먼저 켜 주세요'}
              className="ml-auto flex h-8 items-center gap-1.5 whitespace-nowrap rounded-xl bg-blue-600
                         px-3 text-sm font-medium text-white transition-colors hover:bg-blue-700
                         disabled:opacity-60"
            >
              <Download className={`h-4 w-4 ${jobs[source] ? 'animate-pulse' : ''}`} aria-hidden />
              {jobs[source] ?? '가져오기'}
            </button>
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
            {Object.keys(src.kinds).map(kind => (
              <Chip key={kind} on={kinds.includes(kind)} onClick={() => toggle(kinds, setKinds, kind)}>
                {kind}
              </Chip>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-12 shrink-0 text-sm text-gray-500 dark:text-gray-500">거래</span>
            {Object.entries(src.trades).map(([code, name]) => (
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
          {/* 켜고 끄면 사무소 사람 모두에게 걸린다. 눌러야 나오면 있는 줄도 모른다. */}
          <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3 dark:border-gray-800">
            <span className="w-12 shrink-0 text-sm text-gray-500 dark:text-gray-500">설정</span>
            <Chip
              on={settings.hide_own}
              onClick={() => { void saveSetting({ hide_own: !settings.hide_own }); setPage(1) }}
            >
              우리 사무소 매물 빼기
            </Chip>
            <Chip
              on={settings.track_gone}
              onClick={() => { void saveSetting({ track_gone: !settings.track_gone }); setPage(1) }}
            >
              사라진 매물 표시
            </Chip>
            {savingSettings && <span className="text-xs text-gray-400">저장 중…</span>}
            <span className="text-xs text-gray-400 dark:text-gray-600">
              {settings.hide_own && ownName ? `'${ownName}' 매물은 목록에서 빠집니다` : ''}
            </span>
          </div>
        </div>

        {loading ? (
          <p className="py-20 text-center text-gray-500 dark:text-gray-500">불러오는 중…</p>
        ) : error ? (
          <p className="py-20 text-center text-red-600 dark:text-red-400">
            목록을 불러오지 못했습니다. 새로고침해 보시고, 계속 그러면 알려 주세요.
            <span className="mt-1 block text-xs text-gray-500 dark:text-gray-500">{error}</span>
          </p>
        ) : filtered.length === 0 ? (
          <p className="py-20 text-center text-gray-500 dark:text-gray-500">
            {rows.length === 0
              ? `아직 받아온 ${src.label} 매물이 없습니다. 위의 [가져오기]를 눌러 주세요.`
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
              {shown.map(r => {
                const 본횟수 = seen.get(r.article_no) ?? 0
                return (
                  <li key={r.article_no}>
                    <a
                      href={src.link(r.article_no)}
                      target="_blank"
                      rel="noreferrer"
                      onClick={() => markSeen(r.article_no)}
                      className="group flex items-center gap-3 px-4 py-2.5 transition-colors
                                 hover:bg-blue-50/60 dark:hover:bg-gray-800"
                    >
                      <span className="w-11 shrink-0 text-sm tabular-nums text-gray-400 dark:text-gray-600">
                        {r.shown_date?.slice(5).replace('-', '/')}
                      </span>
                      <span className="w-16 shrink-0 text-sm text-gray-500 dark:text-gray-500">
                        {src.kindOf(r.kind_code)}
                      </span>
                      <span className="w-10 shrink-0 text-sm text-gray-500 dark:text-gray-500">
                        {r.trade_code ? (src.trades[r.trade_code] ?? r.trade_code) : ''}
                      </span>
                      <span className={`min-w-0 flex-1 truncate text-sm text-gray-900 group-hover:underline
                                        dark:text-white ${r.gone_at ? 'line-through' : ''}`}>
                        {[r.division, r.sector].filter(Boolean).join(' ')}
                      </span>
                      {settings.track_gone && r.gone_at ? (
                        <span className="shrink-0 rounded bg-gray-200 px-1.5 py-0.5 text-[11px] font-medium text-gray-600
                                         dark:bg-gray-700 dark:text-gray-300">사라짐</span>
                      ) : r.relisted ? (
                        <span
                          className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-700
                                     dark:bg-amber-900/40 dark:text-amber-400"
                          title="예전부터 있던 매물인데 광고만 새로 올라왔습니다"
                        >재등록</span>
                      ) : isFresh(r) && !본횟수 ? (
                        <span className="shrink-0 rounded bg-blue-600 px-1.5 py-0.5 text-[11px] font-semibold text-white">신규</span>
                      ) : null}
                      {/* 흐리게 만드는 대신 몇 번 봤는지 적는다. 흐려 놓으면 본 것이
                          읽기 어려워지는데, 정작 다시 들여다볼 만한 것은 그중에 있다. */}
                      <span className="w-8 shrink-0 text-right text-xs tabular-nums text-gray-400 dark:text-gray-600">
                        {본횟수 ? `${본횟수}회` : ''}
                      </span>
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
