'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/lib/auth-context'
import { createClient } from '@/lib/supabase/client'
import { Header } from '@/components/layout/header'
import { PageHeader } from '@/components/layout/page-header'
import { Pagination, usePageSize } from '@/components/sheet/pagination'
import { SearchClear } from '@/components/ui/search-clear'
import { Radar } from 'lucide-react'
import { REAL_ESTATE_TYPES, TRADE_TYPES, REGIONS } from '@/lib/naver-land'

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
 * 수집은 사장님 PC의 광고 프로그램(`부소장광고`)이 30분마다 한다. 서버에서 받게
 * 만들었다가 걷어냈다 — 네이버가 데이터센터 IP를 막아 Vercel 에서는 다섯 번 다
 * 응답 없이 멎었다. 뱅크·카페와 같은 이유로 PC가 맡는다.
 */

type Article = {
  article_no: string
  real_estate_type: string
  trade_type: string
  division: string | null
  sector: string | null
  exposure_start_date: string | null
  first_seen_at: string
  last_seen_at: string
}

/** 골라 보는 기간. 기본은 7일 — 일주일치를 한 번에 훑는 것이 이 화면의 쓰임이다. */
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
  return a.exposure_start_date > a.first_seen_at.slice(0, 10)
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

export default function NaverWatchPage() {
  const supabase = useMemo(() => createClient(), [])
  const auth = useAuth()

  const [rows, setRows] = useState<Article[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [agentSeenAt, setAgentSeenAt] = useState<string | null>(null)

  const [period, setPeriod] = useState<string>('7')
  // 빈 배열 = 전부 본다. 하나라도 고르면 고른 것만.
  const [regions, setRegions] = useState<string[]>([])
  const [types, setTypes] = useState<string[]>([])
  const [trades, setTrades] = useState<string[]>([])
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = usePageSize('naver-watch', 50)

  const load = useCallback(async () => {
    // 수집이 7일치만 담으므로 표 전체라야 수백 건이다. 통째로 받아 화면에서 좁힌다.
    // 화면에 쓰는 칸만 받는다 — 사진·가격까지 끌고 오면 목록만 무거워진다.
    const { data, error } = await supabase
      .from('naver_articles')
      .select('article_no, real_estate_type, trade_type, division, sector, exposure_start_date, first_seen_at, last_seen_at')
      .order('exposure_start_date', { ascending: false })
      .order('first_seen_at', { ascending: false })
      .limit(2000)
    if (error) setError(error.message)
    else { setError(null); setRows((data ?? []) as Article[]) }
    setLoading(false)
  }, [supabase])

  useEffect(() => { void load() }, [load])

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

  /** 마지막으로 수집이 돌아간 시각. 0건일 때 "수집이 멈춘 건지"를 여기서 안다. */
  const lastSweep = useMemo(
    () => rows.reduce<string | null>((a, r) => (!a || r.last_seen_at > a ? r.last_seen_at : a), null),
    [rows],
  )

  const toggle = (list: string[], set: (v: string[]) => void, id: string) => {
    set(list.includes(id) ? list.filter(x => x !== id) : [...list, id])
    setPage(1)
  }

  const filtered = useMemo(() => {
    const days = PERIODS.find(p => p.id === period)?.days ?? 7
    const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)
    const needle = q.trim().toLowerCase()

    return rows.filter(a => {
      if ((a.exposure_start_date ?? '') < since) return false
      if (regions.length) {
        const region = REGIONS.find(r => a.division?.startsWith(r.divisionPrefix))
        if (!region || !regions.includes(region.id)) return false
      }
      if (types.length && !types.includes(a.real_estate_type)) return false
      if (trades.length && !trades.includes(a.trade_type)) return false
      if (needle && ![a.division, a.sector].filter(Boolean).join(' ').toLowerCase().includes(needle)) return false
      return true
    })
  }, [rows, period, regions, types, trades, q])

  /** 하트비트가 이보다 오래되면 꺼진 것으로 본다. 광고관리 화면과 같은 잣대다. */
  const agentOnline = !!agentSeenAt && Date.now() - new Date(agentSeenAt).getTime() < 60_000

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const shown = filtered.slice((page - 1) * pageSize, page * pageSize)

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
        />

        <div className="mb-5 space-y-3 rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-12 shrink-0 text-sm text-gray-500 dark:text-gray-500">기간</span>
            {PERIODS.map(p => (
              <Chip key={p.id} on={period === p.id} onClick={() => { setPeriod(p.id); setPage(1) }}>
                {p.label}
              </Chip>
            ))}
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
            {Object.entries(REAL_ESTATE_TYPES).map(([code, name]) => (
              <Chip key={code} on={types.includes(code)} onClick={() => toggle(types, setTypes, code)}>
                {name}
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
              ? '아직 수집된 매물이 없습니다. 광고 프로그램을 켜 두면 30분마다 받아 옵니다.'
              : '고른 조건에 맞는 매물이 없습니다.'}
          </p>
        ) : (
          <>
            <p className="mb-2 text-sm text-gray-600 dark:text-gray-400">{filtered.length}건</p>
            <ul className="divide-y divide-gray-100 overflow-hidden rounded-2xl border border-gray-200
                           bg-white dark:divide-gray-800 dark:border-gray-800 dark:bg-gray-900">
              {shown.map(a => (
                <li key={a.article_no}>
                  <a
                    href={`https://fin.land.naver.com/articles/${a.article_no}`}
                    target="_blank"
                    rel="noreferrer"
                    className="group flex items-center gap-3 px-4 py-2.5 transition-colors
                               hover:bg-blue-50/60 dark:hover:bg-gray-800"
                  >
                    <span className="w-11 shrink-0 text-sm tabular-nums text-gray-400 dark:text-gray-600">
                      {a.exposure_start_date?.slice(5).replace('-', '/')}
                    </span>
                    <span className="w-16 shrink-0 text-sm text-gray-500 dark:text-gray-500">
                      {REAL_ESTATE_TYPES[a.real_estate_type as keyof typeof REAL_ESTATE_TYPES] ?? a.real_estate_type}
                    </span>
                    <span className="w-10 shrink-0 text-sm text-gray-500 dark:text-gray-500">
                      {TRADE_TYPES[a.trade_type as keyof typeof TRADE_TYPES] ?? a.trade_type}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm text-gray-900 group-hover:underline dark:text-white">
                      {[a.division, a.sector].filter(Boolean).join(' ')}
                    </span>
                    {isRelisted(a) ? (
                      <span
                        className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-700
                                   dark:bg-amber-900/40 dark:text-amber-400"
                        title="예전부터 있던 매물인데 네이버 광고만 새로 올라왔습니다"
                      >재등록</span>
                    ) : isFresh(a) ? (
                      <span className="shrink-0 rounded bg-blue-600 px-1.5 py-0.5 text-[11px] font-semibold text-white">신규</span>
                    ) : null}
                  </a>
                </li>
              ))}
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
