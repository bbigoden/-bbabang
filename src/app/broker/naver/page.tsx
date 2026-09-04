'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/lib/auth-context'
import { createClient } from '@/lib/supabase/client'
import { Header } from '@/components/layout/header'
import { PageHeader } from '@/components/layout/page-header'
import { Pagination, usePageSize } from '@/components/sheet/pagination'
import { SearchClear } from '@/components/ui/search-clear'
import { useToast } from '@/components/toast'
import { Radar, ExternalLink, RefreshCw } from 'lucide-react'
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
 * 수집은 `/api/cron/naver-watch` 가 한다(아침에 한 번, 그리고 [지금 수집]).
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
  const toast = useToast()

  const [rows, setRows] = useState<Article[]>([])
  const [loading, setLoading] = useState(true)
  const [sweeping, setSweeping] = useState(false)
  const [sweepingAt, setSweepingAt] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

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
   * 지금 네이버에서 새로 받아 온다.
   *
   * 크론은 아침에 한 번만 돈다. 오후에 올라온 매물을 내일까지 기다릴 이유가 없어
   * 손으로도 돌릴 수 있게 열어 뒀다.
   *
   * **구역을 하나씩 따로 부른다.** 세 구역을 한 번에 부르면 Vercel 함수 제한
   * (60초)에 걸려 통째로 잘린다. 한 구역이 막혀도 나머지는 들어온다.
   * 다 도는 데 1분쯤 걸리므로 어디까지 왔는지 버튼에 적어 준다.
   */
  const sweep = async () => {
    setSweeping(true)
    let added = 0
    const failed: string[] = []
    try {
      for (const region of REGIONS) {
        setSweepingAt(region.name)
        try {
          const res = await fetch(`/api/cron/naver-watch?region=${region.id}`)
          const json = await res.json()
          if (!res.ok || !json.ok) throw new Error(json.error ?? '수집 실패')
          added += json.added ?? 0
        } catch {
          failed.push(region.name)
        }
      }
      await load()
      if (failed.length) toast.error(`${failed.join('·')} 은(는) 네이버가 막았습니다. 잠시 뒤 다시 눌러 주세요.`)
      else toast.success(added > 0 ? `새 매물 ${added}건을 받았습니다.` : '새로 올라온 매물이 없습니다.')
    } finally {
      setSweepingAt(null)
      setSweeping(false)
    }
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
            lastSweep
              ? `네이버부동산에 없는 최신순 목록 · 마지막 수집 ${new Date(lastSweep).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`
              : '네이버부동산에 없는 최신순 목록'
          }
          actions={
            <button
              onClick={sweep}
              disabled={sweeping}
              title="네이버에서 지금 새로 받아옵니다 (1분쯤)"
              className="flex h-9 items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 text-sm
                         font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50
                         dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              <RefreshCw className={`h-4 w-4 ${sweeping ? 'animate-spin' : ''}`} aria-hidden />
              {sweeping ? `${sweepingAt ?? ''} 받는 중…` : '지금 수집'}
            </button>
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
              ? '아직 수집된 매물이 없습니다. [지금 수집]을 누르거나 내일 아침을 기다려 주세요.'
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
                    <ExternalLink
                      className="h-3.5 w-3.5 shrink-0 text-gray-300 transition-colors group-hover:text-blue-600 dark:text-gray-700"
                      aria-hidden
                    />
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
