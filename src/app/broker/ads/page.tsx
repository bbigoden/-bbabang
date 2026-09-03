'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth-context'
import { createClient } from '@/lib/supabase/client'
import { Header } from '@/components/layout/header'
import { PageHeader } from '@/components/layout/page-header'
import { useToast } from '@/components/toast'
import {
  Megaphone, Search, CircleCheck, TriangleAlert, Download,
} from 'lucide-react'
import { Pagination, usePageSize } from '@/components/sheet/pagination'
import { parseBankPeriod } from '@/lib/bank-period'
import { SearchClear } from '@/components/ui/search-clear'

/**
 * 광고관리 — 부동산뱅크 매물을 그대로 가져와, 그중 카페에 올릴 것을 고르고 관리한다.
 *
 * 매물 원본은 언제나 부동산뱅크다. 이 화면은 뱅크를 옮겨 적을 뿐 스스로 매물을
 * 만들지 않는다. 목록은 로컬 프로그램(부소장광고)이 채운다.
 *
 * 표시광고법상 계약된 매물의 광고는 즉시 내려야 한다. **누락이 남지 않게 하는 것이
 * 이 화면의 목적이다** — 그래서 내린 것을 확인한 뒤에만 내렸다고 표시한다.
 *
 * 블로그·당근은 로컬 프로그램에 코드가 있지만 아직 이 화면에서 다루지 않는다.
 */

type Post = {
  id: string
  channel: 'cafe' | 'daangn' | 'bank'
  external_id: string | null
  url: string | null
  status: 'pending' | 'posted' | 'removing' | 'removed' | 'failed'
  error: string | null
}

type Listing = {
  id: string
  bank_no: string
  bank_kind: string | null
  naver_no: string | null
  deal_type: string | null
  property_kind: string | null
  region: string | null
  address_detail: string | null
  area_supply: number | null
  area_exclusive: number | null
  price_text: string | null
  bank_period: string | null
  is_advertising: boolean
  contracted_at: string | null
  synced_at: string | null
  bank_closed_reason: string | null
  bank_tab: string | null
  closing_soon: boolean
  manager: string | null
  check_report: string[] | null
  checked_at: string | null
  ad_posts: Post[]
}

/**
 * 화면에 칸을 내주는 채널.
 *
 * 지금은 **뱅크(원본)와 카페**만 다룬다. 블로그·당근은 코드가 준비돼 있지만
 * 화면에서는 뺐다 — 늘 비어 있는 칸이 둘 붙어 있으면 볼 것만 늘어난다.
 * 실제로 쓰기 시작할 때 여기에 다시 넣는다.
 *
 * 뱅크를 맨 앞에 두는 이유는 네이버부동산까지 자동 전송돼 노출이 가장 크고,
 * 계약이 끝났을 때 반드시 내려야 하는 곳이기 때문이다. 다만 우리가 올린 게
 * 아니라 발행 기록이 없어, 뱅크가 준 상태와 마지막 수집 결과로 판단한다.
 */
const CHANNELS: Array<{ key: 'bank' | 'cafe'; label: string }> = [
  { key: 'bank', label: '뱅크' },
  { key: 'cafe', label: '카페' },
]

/**
 * 채널 칸을 뺀 나머지 열 수 — 매물번호·담당자·종류·소재지·면적·가격·
 * 뱅크만료·점검·거래. 점검 보고를 행 아래에 펼 때 colSpan 에 쓴다.
 * 열을 더하거나 뺄 때 여기도 같이 고쳐야 펼침이 표 폭과 어긋나지 않는다.
 */
const FIXED_COLS = 9

const CHANNEL_LABEL: Record<string, string> = {
  cafe: '카페', daangn: '당근', bank: '뱅크',
}

const m2ToPyeong = (m2: number | null) => (m2 ? (m2 * 0.3025).toFixed(1) : null)

/** PC 프로그램이 이 시간 안에 신호를 보냈으면 켜져 있는 것으로 본다 (신호 주기는 20초). */
const AGENT_ALIVE_MS = 60_000

/** 뱅크 '원클릭 재전송'이 한 번에 받는 상한. 넘기면 뱅크가 경고창을 띄운다. */
const BANK_RENEW_MAX = 30

/** "방금", "12분 전", 하루가 넘으면 날짜. 어제 받은 목록을 오늘 것으로 착각하지 않게. */
function fmtWhen(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const min = Math.floor(diff / 60_000)
  if (min < 1) return '방금'
  if (min < 60) return `${min}분 전`
  const hour = Math.floor(min / 60)
  if (hour < 24) return `${hour}시간 전`
  return new Date(iso).toLocaleString('ko-KR', {
    month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

/**
 * 뱅크 광고 만료까지 남은 날.
 *
 * 뱅크 등록은 30일이 지나면 자동 종료돼 뱅크·네이버부동산에서 조용히 빠진다.
 * 화면에 남은 날짜가 없으면 빠진 뒤에야 알게 되므로 한 칸을 내준다.
 */
function ExpiryCell({ period, live }: { period: string | null; live: boolean }) {
  const p = parseBankPeriod(period)
  if (!p) return <span className="text-gray-300 dark:text-gray-600">–</span>
  // 이미 끝난 매물에 '1일 지남' 을 붉게 띄우면 지금 손봐야 할 일처럼 보인다.
  // 끝난 것은 끝난 것이라, 언제까지였는지만 흐리게 남긴다.
  if (!live) {
    return <span className="text-gray-400" title={`${period} (뱅크 등록 기간)`}>{p.label}</span>
  }
  const tone = {
    expired: 'text-red-600 dark:text-red-400 font-medium',
    urgent: 'text-red-600 dark:text-red-400',
    soon: 'text-amber-600 dark:text-amber-400',
    ok: 'text-gray-500',
  }[p.level]
  return (
    <span className={tone} title={`${period} (뱅크 등록 기간)`}>{p.label}</span>
  )
}

/**
 * 뱅크 매물 상세 주소.
 *
 * 목록의 링크는 `goDetail(매물번호, 종류코드, …)` 함수를 부르지만, 그 함수가
 * 만드는 주소는 이 형태다. 매물번호와 종류코드만 있으면 바로 열 수 있다.
 */
function bankDetailUrl(l: Listing): string | null {
  if (!l.bank_kind) return null
  return 'https://agency.neonet.co.kr/novo-agency/view/offerings/OfferingsDetail.neo'
    + `?offerings_cd=${l.bank_no}&offerings_gbn=${l.bank_kind}`
}

/**
 * 뱅크에 광고가 살아 있는지. 눌러서 뱅크 원본으로 바로 갈 수 있다.
 *
 * 거래완료를 눌러도 뱅크는 따로 내려야 한다. 그런데 행이 회색이 되고 '완료'만
 * 뜨면 전부 내려간 것처럼 보인다 — 실제로는 뱅크와 네이버부동산에 그대로 남는다.
 * 그래서 한 칸을 내주고, 계약이 끝났는데 살아 있으면 붉게 띄운다.
 */
function BankCell({ listing }: { listing: Listing }) {
  const post = listing.ad_posts.find(p => p.channel === 'bank')
  const url = bankDetailUrl(listing)

  // 링크로 감싼다. 점검 보고를 보고 원문을 고치러 갈 때 이 칸이 지름길이 된다.
  const link = (body: React.ReactNode, hint: string) => url
    ? <a href={url} target="_blank" rel="noreferrer"
        className="underline underline-offset-2" title={`${hint} — 눌러서 뱅크에서 열기`}>{body}</a>
    : <span title={hint}>{body}</span>

  if (post?.status === 'failed') {
    return link(<span className="text-red-600 dark:text-red-400">내리기 실패</span>, post.error ?? '내리지 못했습니다')
  }

  // **뱅크가 넣어 둔 탭을 그대로 말한다.** 예전에는 '뱅크에 없음' 인지만 보고
  // 나머지를 전부 '게시중' 으로 적어서, 등록종료 탭인데도 게시중으로 떴다.
  switch (listing.bank_tab) {
    case '등록종료':
      return link(<span className="text-gray-500">종료</span>,
        listing.bank_closed_reason ? `뱅크에서 종료됨 (${listing.bank_closed_reason})` : '뱅크에서 종료됐습니다')
    case '거래완료':
      return link(<span className="text-gray-500">거래완료</span>, '뱅크에서 거래완료 처리됐습니다')
    case '뱅크에 없음':
      return link(<span className="text-gray-400">없음</span>, '뱅크에서 지워졌습니다 (휴지통)')
    case '전송실패':
      return link(<span className="text-red-600 dark:text-red-400">전송실패</span>,
        '뱅크에는 있지만 네이버부동산에 못 올라갔습니다')
  }

  // 여기부터는 뱅크에 살아 있는 매물이다.
  if (listing.contracted_at) {
    return link(
      <span className="font-medium text-red-600 dark:text-red-400">게시중</span>,
      '계약이 끝났는데 뱅크에 광고가 남아 있습니다',
    )
  }
  return link(<span className="text-green-600 dark:text-green-400">게시중</span>, '뱅크에 광고 중입니다')
}

/** 이 매물을 지금 카페에 올려도 되는가. PC 프로그램의 판단과 같아야 한다. */
function canPublish(l: Listing) {
  return !l.contracted_at && l.bank_tab === '등록매물'
}

/**
 * 아직 내려야 할 광고가 남았는가.
 *
 * 카페·블로그·당근은 우리가 올린 기록으로 판단하지만, **뱅크는 기록이 없다**
 * (사장님이 직접 올린다). 기록만 보면 뱅크가 통째로 빠져서, 계약이 끝났는데
 * 노출이 가장 큰 뱅크·네이버부동산에 광고가 그대로 남는다.
 * 그래서 뱅크는 "내렸다는 기록이 없고 아직 뱅크에 있으면" 남은 것으로 센다.
 */
function needsTakedown(l: Listing, gone: boolean) {
  if (!l.contracted_at) return false
  if (l.ad_posts.some(p => p.status === 'posted' || p.status === 'failed')) return true
  const bank = l.ad_posts.find(p => p.channel === 'bank')
  return bank?.status !== 'removed' && !gone
}

/**
 * 화면 탭 ↔ 뱅크 탭 대응. **뱅크가 나눠 둔 그대로 보여주는 것이 원칙이다.**
 * 우리가 따로 분류하면 건수가 뱅크 화면과 어긋나 어느 쪽이 맞는지 알 수 없게 된다.
 * (여기 없는 탭은 광고를 관리하려고 우리가 더한 것.)
 */
/** 확인창 줄바꿈. 소스에 직접 쓰면 편집 중에 자주 깨진다. */
const NL = String.fromCharCode(10)

const BANK_TABS: Record<string, string | undefined> = {
  all: '등록매물',
  past: '등록종료',
}

/** 지금 카페에 글이 살아 있는가. 올린 기록이 아니라 **살아 있는 글**만 센다. */
function isLive(l: Listing) {
  return l.ad_posts.some(p => p.status === 'posted')
}

/**
 * 곧 끝나서 재등록해야 할 매물인가.
 *
 * **뱅크의 '종료예정' 목록을 그대로 쓴다.** 우리가 남은 날짜로 따로 세면 뱅크
 * 화면과 숫자가 어긋나 어느 쪽이 맞는지 알 수 없게 된다. 재등록(원클릭 재전송)
 * 대상도 그 목록에 있는 것뿐이라, 따로 세면 못 고치는 매물까지 세게 된다.
 */
function isExpiring(l: Listing) {
  return l.closing_soon && !l.contracted_at
}

/**
 * 뱅크에서 왜 빠졌는지.
 *
 * 뱅크의 광고 내리기는 두 가지이고 뜻이 다르다.
 *   거래완료 — 계약 확정. 다른 채널 광고도 내려야 한다
 *   노출종료 — 30일이 지나 자동으로 끝났거나(기간만료), 사장님이 직접 내린 것
 *
 * 기간만료는 재등록하면 그만이지만 직접종료는 계약됐을 수 있다. 구분해서
 * 보여줘야 무엇을 할지 정할 수 있다.
 */
function ClosedReason({ listing }: { listing: Listing }) {
  if (listing.contracted_at) return <span className="text-gray-400">거래완료</span>
  const r = listing.bank_closed_reason
  if (r === '기간만료') {
    return <span className="text-amber-600 dark:text-amber-400" title="30일이 지나 자동 종료됐습니다. 재등록하면 계속 광고할 수 있습니다.">기간만료</span>
  }
  if (r === '직접종료') {
    return <span className="text-red-600 dark:text-red-400" title="뱅크에서 노출종료를 누른 매물입니다. 계약된 것이면 거래완료로 표시해 다른 채널도 내려 주세요.">직접 내림</span>
  }
  return <span className="text-gray-400" title="마지막 수집 때 뱅크 목록에 없었습니다">뱅크에 없음</span>
}

/**
 * 카페글로 바꿀 때 원문에서 발견한 문제.
 *
 * 면적 불일치, 관리비 비목 누락, 부당광고 표현 제거, 항목 못 찾음 같은 것들이다.
 * **만들어 놓고 발행 직전에 잘라내 아무도 못 보고 있었다.** 원문을 고쳐야 하는
 * 내용이므로 여기 띄운다. 고칠 곳은 뱅크다.
 */
function CheckCell({ listing, open, onToggle }: {
  listing: Listing; open: boolean; onToggle: () => void
}) {
  if (!listing.checked_at) {
    return <span className="text-gray-300 dark:text-gray-600" title="아직 올려 보지 않았습니다. 올리기를 누르면 함께 점검합니다">–</span>
  }
  const n = listing.check_report?.length ?? 0
  if (!n) return <span className="text-green-600 dark:text-green-400">이상 없음</span>

  // 이 표시가 붙은 건은 올리기에서 건너뛴 것 — 원문을 고쳐야 나간다.
  const blocked = listing.check_report?.some(r => /^\[(위반|형식|필수|실패|건너뜀)\]/.test(r))
  // 이 프로그램이 다루지 않는 종류(아파트·토지…). 잘못된 게 아니라 대상이 아닌 것이라
  // 빨간색으로 겁줄 일이 아니다.
  const notTarget = listing.check_report?.some(r => r.startsWith('[대상 아님]'))
  return (
    <button
      onClick={onToggle}
      className={`rounded px-1.5 py-0.5 underline underline-offset-2 ${
        notTarget ? 'text-gray-400 dark:text-gray-500'
          : blocked ? 'text-red-600 dark:text-red-400'
          : 'text-amber-600 dark:text-amber-400'
      }`}
      title="눌러서 내용 보기"
    >
      {open ? '접기' : notTarget ? '대상 아님' : `${n}건`}
    </button>
  )
}

/** 채널 게시 상태를 한 칸으로 표시 */
function ChannelCell({ post, onPublish, busy }: {
  post: Post | undefined
  /** 올릴 수 있는 매물이면 이 자리에서 바로 올린다. 없으면 '–' 만 보인다. */
  onPublish?: () => void
  busy?: boolean
}) {
  const 올리기 = (label: string, hint: string) => onPublish
    ? (
      <button
        onClick={onPublish}
        disabled={busy}
        title={hint}
        className="rounded border border-gray-200 px-1.5 py-0.5 text-gray-500 hover:border-green-500 hover:text-green-600 disabled:opacity-50 dark:border-gray-700 dark:text-gray-400"
      >{label}</button>
    )
    : <span className="text-gray-300 dark:text-gray-600">–</span>

  if (post?.status === 'posted') {
    const body = <span className="text-green-600 dark:text-green-400">게시중</span>
    return post.url
      ? <a href={post.url} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-green-700">{body}</a>
      : body
  }
  if (post?.status === 'removing') return <span className="text-amber-600 dark:text-amber-400">내리는 중</span>

  // 내려간 글·실패한 글도 다시 올릴 수 있어야 한다. 예전에는 '내림' 글자만
  // 남고 버튼이 사라져서, 카페에서 직접 지운 매물은 다시 올릴 방법이 없었다.
  if (post?.status === 'removed') {
    return (
      <span className="flex items-center gap-1">
        <span className="text-gray-400">내림</span>
        {올리기('다시', '내려간 글을 다시 올립니다')}
      </span>
    )
  }
  if (post?.status === 'failed') {
    return (
      <span className="flex items-center gap-1">
        <span className="text-red-600 dark:text-red-400" title={post.error ?? ''}>실패</span>
        {올리기('다시', '다시 올려 봅니다')}
      </span>
    )
  }
  return 올리기('올리기', '이 매물만 카페에 올립니다')
}

export default function AdsPage() {
  const router = useRouter()
  const auth = useAuth()
  const toast = useToast()
  const supabase = createClient()

  const [listings, setListings] = useState<Listing[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [manager, setManager] = useState('')   // 담당자 좁혀 보기
  const [tab, setTab] = useState<
    'all' | 'expiring' | 'past' | 'live' | 'takedown'
  >('all')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = usePageSize('ads')
  const [agentSeenAt, setAgentSeenAt] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncProgress, setSyncProgress] = useState<string | null>(null)
  const [syncError, setSyncError] = useState<string | null>(null)
  const [takedownWatch, setTakedownWatch] = useState(false)
  const [renewWatch, setRenewWatch] = useState(false)
  const [publishWatch, setPublishWatch] = useState(false)
  const [publishProgress, setPublishProgress] = useState<string | null>(null)
  const [openReport, setOpenReport] = useState<string | null>(null)

  /**
   * 사무소 기준 id — 직원이면 대표의 id 다.
   *
   * 광고 대장·작업은 **사무소 단위**로 움직인다. PC 프로그램은 대표 계정으로
   * 돌기 때문에, 직원 계정으로 누른 작업을 직원 자신의 id 로 적으면 프로그램이
   * 영영 못 본다 — 실제로 [올리기] 를 눌러도 아무 일이 없었다.
   */
  const officeId = auth.broker?.parent_broker_id ?? auth.broker?.id

  const agentOnline = !!agentSeenAt && Date.now() - new Date(agentSeenAt).getTime() < AGENT_ALIVE_MS
  const lastSynced = useMemo(
    () => listings.reduce<string | null>(
      (a, l) => (l.synced_at && (!a || l.synced_at > a) ? l.synced_at : a), null),
    [listings],
  )

  /**
   * 뱅크의 어느 탭에도 없는 매물 — 휴지통으로 보낸 것이다. 이 매물이 아직
   * 카페·블로그에 광고 중이면 없는 물건을 광고하는 셈이라 표시광고법 문제가 된다.
   *
   * 예전에는 '마지막 수집에 안 들어온 것' 으로 판정했는데, 수집이 도중에
   * 끊기면 멀쩡한 매물이 통째로 빠진 것으로 보였다. 지금은 프로그램이 네 탭을
   * 모두 훑은 뒤에 표시를 남기므로 그 표시만 보면 된다.
   */
  const goneFromBank = useMemo(
    () => new Set(listings.filter(l => l.bank_tab === '뱅크에 없음').map(l => l.id)),
    [listings])

  // 뱅크에서 지웠는데 카페 광고가 살아 있는 것 — 없는 물건을 광고하는 셈이다.
  const goneButLive = listings.filter(l =>
    goneFromBank.has(l.id) && !l.contracted_at && isLive(l))

  useEffect(() => {
    if (auth.loading) return
    if (!auth.user) { router.push('/auth/login?redirect=/broker/ads'); return }
    if (!auth.broker) { router.push('/broker/register'); return }
    load()
  }, [auth.loading, auth.user?.id, auth.broker?.id])

  async function load() {
    setLoading(true)
    const { data, error } = await supabase
      .from('ad_listings')
      .select('*, ad_posts(id, channel, external_id, url, status, error)')
      .order('bank_no', { ascending: false })
    if (error) toast.error(`목록을 불러오지 못했습니다: ${error.message}`)
    // 등록종료가 매달 쌓이므로 언젠가 서버 한도(1,000행)에 닿는다. 잘린 채로 세면
    // '내려야 함' 이 실제보다 적게 나온다 — 그건 틀리면 안 되는 숫자다.
    if ((data?.length ?? 0) >= 1000) {
      toast.error('매물이 너무 많아 목록이 잘렸습니다. 건수가 실제와 다를 수 있습니다.')
    }
    setListings((data as Listing[]) ?? [])
    setLoading(false)
  }

  /** PC 프로그램이 살아 있는지 주기적으로 확인한다. */
  useEffect(() => {
    if (!auth.broker) return
    let alive = true
    const tick = async () => {
      const { data } = await supabase.from('ad_agents').select('last_seen_at').maybeSingle()
      if (alive) setAgentSeenAt(data?.last_seen_at ?? null)
    }
    tick()
    const id = setInterval(tick, 15_000)
    return () => { alive = false; clearInterval(id) }
  }, [auth.broker?.id])

  /**
   * 뱅크 수집을 PC에 맡긴다.
   *
   * 이 화면은 Vercel 서버에서 도니까 뱅크에 직접 못 간다 — 브라우저를 띄워 사람처럼
   * 로그인해야 하는 일이고, 뱅크 비밀번호를 클라우드에 둘 수도 없다. 그래서 여기서는
   * `ad_jobs` 에 "해달라"고 적어 두고, PC에서 도는 프로그램이 집어가 실행한다.
   */
  async function requestSync() {
    if (!auth.broker) return
    if (!agentOnline && !confirm(
      'PC의 부소장광고 프로그램이 꺼져 있는 것 같습니다.\n\n' +
      '요청은 남겨 두고, 프로그램을 켜면 그때 실행됩니다.\n계속할까요?'
    )) return

    setSyncing(true); setSyncError(null); setSyncProgress('요청 보냄')

    // 이미 대기·실행 중인 수집이 있으면 그걸 지켜본다. PC 프로그램이 꺼져 있을 때
    // 버튼을 여러 번 누르면 요청이 쌓여, 켜는 순간 같은 수집을 반복하게 된다.
    const { data: pending } = await supabase.from('ad_jobs')
      .select('id').eq('kind', 'sync').in('status', ['queued', 'running'])
      .order('requested_at', { ascending: true }).limit(1).maybeSingle()

    const { data: job, error } = pending
      ? { data: pending, error: null }
      : await supabase
        .from('ad_jobs')
        .insert({ broker_id: officeId!, kind: 'sync', requested_by: auth.user?.id })
        .select('id').single()
    if (error || !job) {
      setSyncing(false); setSyncProgress(null)
      toast.error(`요청하지 못했습니다: ${error?.message ?? '알 수 없는 오류'}`)
      return
    }

    // 끝날 때까지 지켜본다. 30분이 넘으면 화면만 놓아주고 작업은 그대로 둔다.
    const deadline = Date.now() + 30 * 60_000
    const poll = setInterval(async () => {
      const { data } = await supabase.from('ad_jobs')
        .select('status, progress, result, error').eq('id', job.id).maybeSingle()
      if (!data) return
      setSyncProgress(data.progress ?? null)
      if (data.status === 'done') {
        clearInterval(poll)
        setSyncing(false); setSyncProgress(null)
        const n = (data.result as { collected?: number } | null)?.collected
        toast.success(n ? `뱅크에서 ${n}건을 받아왔습니다.` : '가져오기를 마쳤습니다.')
        load()
      } else if (data.status === 'failed' || data.status === 'canceled') {
        clearInterval(poll)
        setSyncing(false); setSyncProgress(null)
        setSyncError(data.error ?? '알 수 없는 오류')
        toast.error(`가져오지 못했습니다: ${data.error ?? '알 수 없는 오류'}`)
      } else if (Date.now() > deadline) {
        clearInterval(poll)
        setSyncing(false); setSyncProgress(null)
        toast.error('시간이 너무 오래 걸립니다. PC 창을 확인해 주세요.')
      }
    }, 2000)
  }

  /** 거래완료 표시 — 실제 광고 내리기는 로컬 프로그램이 수행한다. */
  async function markContracted(l: Listing) {
    // 뱅크는 발행 기록이 없어도 항상 내려야 한다. 네이버부동산까지 자동 전송되므로
    // 계약이 끝난 매물이 여기 남으면 노출이 가장 큰 곳에서 위반이 된다.
    const bankLive = l.ad_posts.find(p => p.channel === 'bank')?.status !== 'removed'
      && !goneFromBank.has(l.id)
    const where = [
      ...(bankLive ? ['뱅크'] : []),
      ...l.ad_posts
        .filter(p => p.channel !== 'bank' && (p.status === 'posted' || p.status === 'failed'))
        .map(p => CHANNEL_LABEL[p.channel] ?? p.channel),
    ]
    const msg = where.length
      ? `${l.bank_no} 매물을 거래완료로 표시하고, 광고 중인 ${where.length}곳(${where.join(', ')})에서 내립니다.\n\n` +
        (agentOnline ? '되돌릴 수 없습니다. 계속할까요?' : 'PC 프로그램이 꺼져 있어 켤 때 내려갑니다. 계속할까요?')
      : `${l.bank_no} 매물을 거래완료로 표시할까요?`
    if (!confirm(msg)) return

    const { error } = await supabase
      .from('ad_listings')
      .update({ contracted_at: new Date().toISOString(), is_advertising: false })
      .eq('id', l.id)
    if (error) { toast.error(`처리하지 못했습니다: ${error.message}`); return }

    if (!where.length) { toast.success('거래완료로 표시했습니다.'); load(); return }

    // 표시만으로 끝나면 광고가 그대로 남는다. 내리는 일까지 PC에 맡긴다.
    const { error: jobError } = await supabase.from('ad_jobs').insert({
      broker_id: officeId!, kind: 'takedown',
      params: { listingId: l.id }, requested_by: auth.user?.id,
    })
    if (jobError) {
      toast.error(`거래완료로 표시했지만 내리기를 요청하지 못했습니다: ${jobError.message}`)
      load(); return
    }
    toast.success(agentOnline ? `${where.join(', ')} 광고를 내리는 중입니다.` : '내리기를 예약했습니다. PC 프로그램을 켜 주세요.')
    setTakedownWatch(true)
    load()
  }

  /**
   * 만료가 임박한 뱅크 등록을 다시 내보낸다 (뱅크의 '원클릭 재전송').
   *
   * 광고를 다시 내보내는 조작이라 거래완료된 매물이 섞이면 표시광고법 위반이다.
   * 여기서 한 번 거르고, PC 프로그램이 실행 직전에 한 번 더 거른다.
   * 뱅크가 한 번에 30건까지만 받는다.
   */
  async function renewExpiring() {
    if (!auth.broker) return
    const targets = expiring.filter(l => !l.contracted_at).slice(0, BANK_RENEW_MAX)
    if (!targets.length) { toast.error('재등록할 매물이 없습니다.'); return }

    const over = expiring.filter(l => !l.contracted_at).length - targets.length
    if (!confirm(
      `뱅크에 ${targets.length}건을 다시 등록합니다. 등록일이 오늘부터 30일로 새로 시작됩니다.\n` +
      (over > 0 ? `\n뱅크가 한 번에 ${BANK_RENEW_MAX}건까지만 받아 ${over}건은 다음에 다시 눌러 주세요.\n` : '') +
      '\n계속할까요?'
    )) return

    const { error } = await supabase.from('ad_jobs').insert({
      broker_id: officeId!, kind: 'renew',
      params: { bankNos: targets.map(l => l.bank_no) }, requested_by: auth.user?.id,
    })
    if (error) { toast.error(`요청하지 못했습니다: ${error.message}`); return }
    toast.success(agentOnline ? `${targets.length}건을 재등록하는 중입니다.` : '재등록을 예약했습니다. PC 프로그램을 켜 주세요.')
    setRenewWatch(true)
  }

  /** 재등록이 끝나면 목록을 새로 받아 남은 날짜를 갱신한다. */
  useEffect(() => {
    if (!renewWatch) return
    const id = setInterval(async () => {
      const { data } = await supabase.from('ad_jobs')
        .select('id').eq('kind', 'renew').in('status', ['queued', 'running']).limit(1)
      if (data && data.length) return
      setRenewWatch(false)
      const { data: last } = await supabase.from('ad_jobs')
        .select('status, error, result').eq('kind', 'renew')
        .order('requested_at', { ascending: false }).limit(1).maybeSingle()
      if (last?.status === 'failed') toast.error(`재등록하지 못했습니다: ${last.error ?? '알 수 없는 오류'}`)
      else if (last?.status === 'done') {
        const n = (last.result as { renewed?: number } | null)?.renewed
        toast.success(n ? `${n}건을 재등록했습니다.` : '재등록을 마쳤습니다.')
        // 새 기간은 뱅크에서 다시 받아야 화면에 보인다
        requestSync()
        return
      }
      load()
    }, 3000)
    return () => clearInterval(id)
  }, [renewWatch])

  /**
   * 체크한 매물을 카페에 올린다.
   *
   * 체크(광고)는 "이 매물을 광고하겠다"는 표시다. 여기서 그 표시를 실제 발행으로
   * 잇는다. 이미 카페에 올라가 있는 것은 빼고, 계약이 끝났거나 뱅크에서 빠진
   * 매물은 PC 프로그램이 실행 직전에 한 번 더 거른다.
   */
  /**
   * 이 매물 하나만 올린다. 표의 카페 칸에서 바로 누른다.
   *
   * 여러 건은 체크해서 위쪽 버튼으로 올린다 — 200건을 한 줄씩 누를 수는 없다.
   * 한 건만 올릴 때 체크하고 위로 올라갔다 오는 것이 번거로워 둘 다 둔다.
   */
  async function publishOne(l: Listing) {
    if (!auth.broker) return
    if (!confirm(
      `${l.naver_no ?? l.bank_no} 매물을 카페에 올립니다. 1분쯤 걸립니다.${NL}${NL}`
      + '원문에 문제가 있으면 올리지 않고 점검 칸에 이유를 남깁니다.'
      + (agentOnline ? '' : `${NL}${NL}PC 프로그램이 꺼져 있어 켤 때 올라갑니다.`)
    )) return

    const { data: pending } = await supabase.from('ad_jobs')
      .select('id').eq('kind', 'publish').in('status', ['queued', 'running']).limit(1).maybeSingle()
    if (pending) { toast.error('이미 올리는 중입니다. 끝나면 다시 눌러 주세요.'); return }

    const { error } = await supabase.from('ad_jobs').insert({
      broker_id: officeId!, kind: 'publish',
      params: { bankNos: [l.bank_no] }, requested_by: auth.user?.id,
    })
    if (error) { toast.error(`요청하지 못했습니다: ${error.message}`); return }
    toast.success(agentOnline ? '카페에 올리는 중입니다.' : '올리기를 예약했습니다. PC 프로그램을 켜 주세요.')
    setPublishWatch(true)
  }


  /** 발행이 끝나면 목록을 새로 받아 게시 상태를 보여준다. */
  useEffect(() => {
    if (!publishWatch) return
    const id = setInterval(async () => {
      const { data } = await supabase.from('ad_jobs')
        .select('id, progress').eq('kind', 'publish').in('status', ['queued', 'running']).limit(1)
      if (data && data.length) { setPublishProgress(data[0].progress ?? null); return }
      setPublishWatch(false); setPublishProgress(null)
      const { data: last } = await supabase.from('ad_jobs')
        .select('status, error, result').eq('kind', 'publish')
        .order('requested_at', { ascending: false }).limit(1).maybeSingle()
      if (last?.status === 'failed') toast.error(`올리지 못했습니다: ${last.error ?? '알 수 없는 오류'}`)
      else if (last?.status === 'done') {
        const r = last.result as { published?: number; skipped?: string[] } | null
        toast.success(r?.published ? `카페에 ${r.published}건 올렸습니다.` : '발행을 마쳤습니다.')
        // 원문에 문제가 있어 안 올라간 건. 무엇이 문제였는지는 점검 칸에 남는다.
        if (r?.skipped?.length) {
          toast.error(`원문에 문제가 있어 ${r.skipped.length}건은 올리지 않았습니다. 점검 칸을 눌러 확인해 주세요.`)
        }
      }
      load()
    }, 3000)
    return () => clearInterval(id)
  }, [publishWatch])

  /**
   * 뱅크에서 내린 매물의 다른 채널 광고도 내린다.
   *
   * 실무에서는 계약이 끝나도 뱅크의 [거래완료] 대신 [노출종료] 를 누른다 —
   * 거래완료는 거래금액·계약일을 채워야 해서 손이 많이 간다. 그래서 뱅크에서
   * 직접 내린 매물이 곧 "계약 끝난 매물"인 경우가 대부분이다.
   *
   * 다만 잠깐 내렸다 다시 올리는 경우도 있어 자동으로 지우지는 않는다.
   * 여기서 한 번 눌러 확인하게 한다.
   */
  async function takedownGone() {
    if (!auth.broker) return
    if (!confirm(
      `뱅크에서 내린 매물 ${goneButLive.length}건의 카페·블로그 광고를 내립니다.\n` +
      `${goneButLive.map(l => l.bank_no).join(', ')}\n\n` +
      '글이 삭제되며 되돌릴 수 없습니다. 계속할까요?'
    )) return

    // 거래완료로 표시해야 내리기 대상이 된다. 뱅크에서 이미 내렸으니 광고를
    // 계속 둘 이유가 없다.
    const { error } = await supabase.from('ad_listings')
      .update({ contracted_at: new Date().toISOString(), is_advertising: false })
      .in('id', goneButLive.map(l => l.id))
    if (error) { toast.error(`처리하지 못했습니다: ${error.message}`); return }

    const { data: pending } = await supabase.from('ad_jobs')
      .select('id').eq('kind', 'takedown').in('status', ['queued', 'running']).limit(1).maybeSingle()
    if (!pending) {
      const { error: e2 } = await supabase.from('ad_jobs').insert({
        broker_id: officeId!, kind: 'takedown', requested_by: auth.user?.id,
      })
      if (e2) { toast.error(`요청하지 못했습니다: ${e2.message}`); load(); return }
    }
    toast.success(agentOnline ? '광고를 내리는 중입니다.' : '내리기를 예약했습니다. PC 프로그램을 켜 주세요.')
    setTakedownWatch(true)
    load()
  }

    /** 밀려 있는 것을 한꺼번에 내린다. 앞서 실패한 건을 다시 시도할 때도 쓴다. */
  async function takedownAll() {
    if (!auth.broker) return
    if (!confirm(`광고 중인 거래완료 매물 ${takedownCount}건을 전 채널에서 내립니다.\n\n되돌릴 수 없습니다. 계속할까요?`)) return

    // 이미 대기·실행 중인 내리기가 있으면 그걸 기다린다
    const { data: pending } = await supabase.from('ad_jobs')
      .select('id').eq('kind', 'takedown').in('status', ['queued', 'running']).limit(1).maybeSingle()
    if (!pending) {
      const { error } = await supabase.from('ad_jobs').insert({
        broker_id: officeId!, kind: 'takedown', requested_by: auth.user?.id,
      })
      if (error) { toast.error(`요청하지 못했습니다: ${error.message}`); return }
    }
    toast.success(agentOnline ? '광고를 내리는 중입니다.' : '내리기를 예약했습니다. PC 프로그램을 켜 주세요.')
    setTakedownWatch(true)
  }

  /**
   * 내리기가 끝나면 화면을 갱신한다.
   *
   * "내려야 함"은 표시광고법이 걸린 숫자라, 실제로 내려갔는지가 화면에 바로
   * 보여야 한다. 작업이 남아 있는 동안만 짧게 확인한다.
   */
  useEffect(() => {
    if (!takedownWatch) return
    const id = setInterval(async () => {
      const { data } = await supabase.from('ad_jobs')
        .select('status, error').eq('kind', 'takedown')
        .in('status', ['queued', 'running']).limit(1)
      if (data && data.length) return          // 아직 진행 중
      setTakedownWatch(false)
      const { data: last } = await supabase.from('ad_jobs')
        .select('status, error').eq('kind', 'takedown')
        .order('requested_at', { ascending: false }).limit(1).maybeSingle()
      if (last?.status === 'failed') toast.error(`내리지 못했습니다: ${last.error ?? '알 수 없는 오류'}`)
      else if (last?.status === 'done') toast.success('광고를 내렸습니다.')
      load()
    }, 3000)
    return () => clearInterval(id)
  }, [takedownWatch])

  // 지금 고른 탭에 들어가는 매물인지 — 담당자별 건수도 같은 잣대로 세야
  // 드롭다운 숫자와 화면에 뜨는 건수가 어긋나지 않는다.
  const inTab = useCallback((l: Listing) => {
    // 계약이 끝나면 뱅크가 그 매물을 등록매물에서 빼 거래완료·휴지통으로 옮긴다.
    // 그래서 이 탭만은 뱅크 탭을 가리지 않고 전부에서 골라야 한다. 아래 '끝난
    // 매물은 뺀다' 를 그대로 태우면 목록이 늘 비어 배너 숫자와 어긋난다.
    if (tab === 'takedown') return needsTakedown(l, goneFromBank.has(l.id))
    // 끝난 매물(거래완료·뱅크에서 빠짐)은 기본 목록에서 뺀다. 지우지는 않는다 —
    // 언제 무엇을 내렸는지가 표시광고법 대응의 근거가 된다.
    // 이걸 같이 세면 [전체]가 뱅크 등록 건수와 안 맞아 숫자를 못 믿게 된다.
    // 전송실패는 등록매물 목록에 없으므로 '지난 매물' 판정에 걸린다. 먼저 가른다.
    // 앞의 다섯 탭은 뱅크가 나눠 둔 그대로다. 뱅크가 어디에 넣었는지만 본다.
    if (BANK_TABS[tab]) { if (l.bank_tab !== BANK_TABS[tab]) return false }
    // 나머지 탭은 광고를 관리하려고 우리가 더한 것이라, 끝난 매물은 빼고 본다.
    else if (l.bank_tab !== '등록매물') return false
    if (tab === 'live' && !isLive(l)) return false
    if (tab === 'expiring' && !isExpiring(l)) return false
    return true
  }, [tab, goneFromBank])

  const filtered = useMemo(() => {
    const key = q.trim().toLowerCase()
    return listings.filter(l => {
      if (!inTab(l)) return false
      if (manager && (l.manager ?? '') !== manager) return false
      if (!key) return true
      return [l.bank_no, l.naver_no, l.region, l.address_detail, l.property_kind, l.deal_type, l.manager]
        .filter(Boolean).some(v => String(v).toLowerCase().includes(key))
    })
  }, [listings, q, manager, inTab])

  // 고객목록과 같은 방식으로 자른다 — 250건 규모라 전부 받아 두고 화면에서만 나눈다.
  // 매물목록만 서버에서 페이지 단위로 받는데, 그쪽은 1,800건에 2.3MB라 사정이 다르다.
  // 여기서 서버로 옮기면 아래 탭 숫자(전체·광고중·내려야 함)를 세려고 집계를 따로
  // 만들어야 하고, "내려야 함"은 틀리면 안 되는 숫자다.
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const paginated = filtered.slice((page - 1) * pageSize, page * pageSize)
  useEffect(() => { setPage(1) }, [q, tab, manager, pageSize])

  // 표시광고법상 즉시 내려야 하는 건들 — 화면 최상단에 경고로 띄운다
  const takedownCount = listings.filter(l => needsTakedown(l, goneFromBank.has(l.id))).length
  // 체크박스로 '올릴 것' 이라고 고른 건수 — [카페에 올리기] 버튼에 쓴다.
  const liveCount = listings.filter(l => l.bank_tab === '등록매물' && isLive(l)).length
  const managers = [...new Set(listings.map(l => l.manager).filter(Boolean))].sort() as string[]
  // 담당자별 건수 — 고객목록과 같이 이름 옆에 붙인다. 지금 보고 있는 탭 기준이라
  // 탭을 바꾸면 숫자도 같이 바뀐다. 그 탭에 한 건도 없는 담당자는 (0)으로 남긴다 —
  // 선택지가 사라지면 골라 둔 담당자가 화면에서 통째로 없어져 버린다.
  const managerCounts = listings.reduce<Record<string, number>>((acc, l) => {
    if (l.manager && inTab(l)) acc[l.manager] = (acc[l.manager] ?? 0) + 1
    return acc
  }, {})
  const countOf = (t: string) => listings.filter(l => l.bank_tab === t).length

  // 뱅크 등록은 30일이면 자동 종료된다. 재등록은 사람이 해야 하므로 미리 보여 준다.
  // 종료예정은 등록매물에만 있는 개념이다 — 탭 숫자는 이 배열로, 탭을 눌렀을 때
  // 나오는 목록은 inTab 으로 가르므로 두 잣대가 같아야 숫자가 어긋나지 않는다.
  const expiring = listings.filter(l => l.bank_tab === '등록매물' && isExpiring(l))

  if (auth.loading || !auth.broker) return null

  return (
    <>
      <Header />
      <main className="mx-auto max-w-7xl px-4 py-6">
        <PageHeader
          icon={Megaphone}
          title="광고관리"
          description="부동산뱅크 매물을 가져와, 카페에 올릴 것을 고르고 관리합니다."
        />

        {takedownCount > 0 && (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 p-3 text-sm dark:border-red-900 dark:bg-red-950">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
            <div>
              <p className="font-medium text-red-800 dark:text-red-300">
                거래완료된 매물 {takedownCount}건이 아직 광고 중입니다.
              </p>
              <p className="mt-0.5 text-red-700 dark:text-red-400">
                표시광고법상 즉시 내려야 합니다.
                {!agentOnline && ' PC 프로그램이 꺼져 있습니다 — 켜면 내려갑니다.'}
              </p>
              <button
                onClick={takedownAll}
                disabled={takedownWatch}
                className="mt-2 rounded-lg bg-red-600 px-3 py-1.5 text-xs text-white hover:bg-red-700 disabled:opacity-60"
              >
                {takedownWatch ? '내리는 중…' : '지금 전부 내리기'}
              </button>
            </div>
          </div>
        )}

        {goneButLive.length > 0 && (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 p-3 text-sm dark:border-red-900 dark:bg-red-950">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
            <div>
              <p className="font-medium text-red-800 dark:text-red-300">
                뱅크에 없는 매물 {goneButLive.length}건이 아직 광고 중입니다.
              </p>
              <p className="mt-0.5 text-red-700 dark:text-red-400">
                {goneButLive.map(l => l.bank_no).slice(0, 5).join(', ')}
                {goneButLive.length > 5 && ' 외'} — 뱅크에는 없는데 다른 채널에 광고가 남아 있습니다.
              </p>
              <p className="mt-1 text-red-700 dark:text-red-400">
                계약이 끝나 뱅크에서 내린 것이면 아래 버튼으로 한 번에 내리고,
                <b> 기간만료</b>라 계속 광고할 것이면 [뱅크에 다시 등록] 을 누르세요.
              </p>
              <button
                onClick={takedownGone}
                disabled={takedownWatch}
                className="mt-2 rounded-lg bg-red-600 px-3 py-1.5 text-xs text-white hover:bg-red-700 disabled:opacity-60"
              >
                {takedownWatch ? '내리는 중…' : `이 ${goneButLive.length}건 광고 내리기`}
              </button>
            </div>
          </div>
        )}

        {expiring.length > 0 && (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <div>
              <p className="font-medium text-amber-900 dark:text-amber-300">
                뱅크가 곧 종료할 매물 {expiring.length}건
              </p>
              <p className="mt-0.5 text-amber-800 dark:text-amber-400">
                뱅크 등록은 30일이면 자동 종료돼 뱅크·네이버부동산에서 빠집니다. 재등록하면 오늘부터 30일로 새로 시작됩니다.
              </p>
              <button
                onClick={renewExpiring}
                disabled={renewWatch}
                className="mt-2 rounded-lg bg-amber-600 px-3 py-1.5 text-xs text-white hover:bg-amber-700 disabled:opacity-60"
              >
                {renewWatch ? '재등록 중…' : `뱅크에 다시 등록 (${Math.min(expiring.filter(l => !l.contracted_at).length, BANK_RENEW_MAX)}건)`}
              </button>
            </div>
          </div>
        )}

        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-gray-200 dark:border-gray-800">
            {([
              // 앞쪽은 뱅크 탭을 그대로 옮긴 것 — 건수가 뱅크 화면과 그대로 맞아야
              // 어느 쪽이 맞는지 따질 일이 없다. 뒤쪽은 광고를 관리하려고 우리가 더한 것.
              ['all', `등록매물 ${countOf('등록매물')}`],
              ['expiring', `종료예정 ${expiring.length}`],
              ['past', `등록종료 ${countOf('등록종료')}`],
              // 거래완료·전송실패·휴지통은 탭으로 두지 않는다. 부소장에서 할 일이
              // 없고 전부 뱅크에서 처리할 것들이라, 탭만 늘어나 눈이 흩어진다.
              // (수집은 계속한다 — 등록매물 건수를 뱅크와 맞추고, 그 매물들이
              //  카페에 올라가지 못하게 막는 근거가 된다.)
              ['live', `카페에 올림 ${liveCount}`, '지금 카페에 글이 살아 있는 매물'],
              ['takedown', `계약 끝·광고 남음 ${takedownCount}`,
                '계약이 끝났는데 광고가 아직 내려가지 않은 매물. 표시광고법상 즉시 내려야 합니다'],
            ] as [string, string, string?][]).map(([key, label, hint]) => (
              <button
                key={key}
                onClick={() => setTab(key as typeof tab)}
                title={hint}
                className={`px-3 py-1.5 text-sm first:rounded-l-lg last:rounded-r-lg ${
                  tab === key
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-600 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800'
                }`}
              >{label}</button>
            ))}
          </div>

          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
            <input
              type="text"
              aria-label="광고 매물 검색"
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="전체 검색..."
              className="w-full rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 py-2.5 pl-9 pr-8 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
            {q && <SearchClear onClick={() => setQ('')} />}
          </div>

          {/* 사무소가 셋이서 나눠 맡고 있어, 내 것만 보고 올리는 일이 잦다. */}
          {managers.length > 0 && (
            <select
              aria-label="담당자"
              value={manager}
              onChange={e => setManager(e.target.value)}
              className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-800 dark:bg-gray-900"
            >
              <option value="">담당자 전체</option>
              {managers.map(n => <option key={n} value={n}>{`${n} (${managerCounts[n] ?? 0})`}</option>)}
            </select>
          )}

          <button
            onClick={requestSync}
            disabled={syncing}
            title={agentOnline
              ? '뱅크 매물을 새로 받고, 담당자와 카페 글이 실제로 남아 있는지까지 맞춥니다'
              : 'PC에서 부소장광고 프로그램(npm run agent)을 먼저 켜 주세요'}
            className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-60"
          >
            <Download className={`h-4 w-4 ${syncing ? 'animate-pulse' : ''}`} />
            {syncing ? (syncProgress ?? '가져오는 중…') : '가져오기'}
          </button>

          
        </div>

        {/* 언제 받아온 목록인지, PC 프로그램이 켜져 있는지. 이게 없으면 화면이
            낡았는지 알 수가 없고, 버튼을 눌러도 왜 반응이 없는지 알 수 없다. */}
        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
          {/* 뱅크 화면의 '서비스중' 건수와 바로 대조할 수 있어야 한다.
              숫자가 다르면 가져오기를 다시 눌러야 한다는 뜻이다. */}
          <span>
            뱅크에서 받아온 것:{' '}
            <span className="text-gray-700 dark:text-gray-300">{countOf('등록매물')}건</span>
            {lastSynced && <> · {fmtWhen(lastSynced)}</>}
          </span>
          <span className="flex items-center gap-1">
            <span className={`h-1.5 w-1.5 rounded-full ${agentOnline ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'}`} />
            {agentOnline ? 'PC 프로그램 켜짐' : 'PC 프로그램 꺼짐'}
          </span>
          {!agentOnline && (
            <span>
              PowerShell에서 <code className="rounded bg-gray-100 px-1 dark:bg-gray-800">npm run agent</code> 를 실행하면 버튼이 동작합니다.
            </span>
          )}
          {syncError && <span className="text-red-600 dark:text-red-400">마지막 시도 실패: {syncError}</span>}
        </div>

        {loading ? (
          <p className="py-16 text-center text-sm text-gray-500">불러오는 중…</p>
        ) : !listings.length ? (
          <div className="rounded-lg border border-dashed border-gray-300 py-16 text-center dark:border-gray-700">
            <p className="text-sm text-gray-500">아직 가져온 매물이 없습니다.</p>
            <p className="mt-1 text-xs text-gray-400">
              부소장광고 폴더에서 <code className="rounded bg-gray-100 px-1 dark:bg-gray-800">npm run sync</code> 를 실행하면
              부동산뱅크 매물을 가져옵니다.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-800">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="bg-gray-50 text-left text-xs text-gray-500 dark:bg-gray-900 dark:text-gray-400">
                <tr>
                  <th className="px-3 py-2 font-medium" title="네이버부동산 매물번호 — 고객이 아는 번호입니다. 눌러서 뱅크 원본으로 갑니다">매물번호</th>
                  <th className="px-3 py-2 font-medium" title="뱅크 중개사메모에 적힌 담당자입니다">담당자</th>
                  <th className="px-3 py-2 font-medium">종류</th>
                  <th className="px-3 py-2 font-medium">소재지</th>
                  <th className="px-3 py-2 font-medium">면적</th>
                  <th className="px-3 py-2 font-medium">가격</th>
                  <th className="px-3 py-2 font-medium">뱅크만료</th>
                  {CHANNELS.map(c => <th key={c.key} className="px-3 py-2 font-medium">{c.label}</th>)}
                  <th className="px-3 py-2 font-medium" title="올릴 때 원문에서 발견한 문제. 빨간 건은 이 문제 때문에 안 올라간 것입니다">점검</th>
                  <th className="px-3 py-2 font-medium">거래</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {paginated.map(l => {
                  const done = !!l.contracted_at
                  // 뱅크에 아직 살아 있는가. 끝난 매물에 남은 날짜·[거래완료] 를
                  // 띄우면 지금 손봐야 할 일처럼 보인다.
                  const bankLive = l.bank_tab === '등록매물'
                  const row = (
                    <tr key={l.id} className={done ? 'bg-gray-50/60 text-gray-400 dark:bg-gray-900/40' : ''}>
                      {/* 고객이 부르는 번호만 보여준다. 뱅크 번호는 사장님도 쓸 일이
                          없고 두 개가 나란히 있으면 어느 것을 말하는지 헷갈린다.
                          링크는 그대로 뱅크 원본으로 간다. */}
                      <td className="px-3 py-2 font-mono text-xs">
                        {bankDetailUrl(l)
                          ? <a
                              href={bankDetailUrl(l)!}
                              target="_blank"
                              rel="noreferrer"
                              className="underline underline-offset-2 hover:text-blue-600"
                              title={`뱅크에서 이 매물 열기 (뱅크 번호 ${l.bank_no})`}
                            >{l.naver_no ?? l.bank_no}</a>
                          : (l.naver_no ?? l.bank_no)}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-xs">
                        {l.manager ?? <span className="text-gray-300 dark:text-gray-600">–</span>}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {l.property_kind}
                        <span className="ml-1 text-xs text-gray-400">{l.deal_type}</span>
                      </td>
                      <td className="px-3 py-2">
                        {l.region}
                        {l.address_detail && <span className="ml-1 text-xs text-gray-400">{l.address_detail}</span>}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-xs">
                        {l.area_exclusive ? `전용 ${m2ToPyeong(l.area_exclusive)}평` : '–'}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">{l.price_text ?? '–'}</td>
                      {/* 뱅크상태('서비스중' 따위)는 칸으로 두지 않는다. 탭이 이미
                          같은 것을 가르고, 등록종료 사유는 아래 뱅크만료 칸이 말한다.
                          '확인전'은 뱅크 목록에 아예 안 나와 대장에 들어오지 않는다. */}
                      <td className="px-3 py-2 whitespace-nowrap text-xs">
                        {goneFromBank.has(l.id)
                          ? <ClosedReason listing={l} />
                          : <ExpiryCell period={l.bank_period} live={bankLive} />}
                      </td>
                      {CHANNELS.map(c => (
                        <td key={c.key} className="px-3 py-2 whitespace-nowrap text-xs">
                          {c.key === 'bank'
                            ? <BankCell listing={l} />
                            : <ChannelCell
                                post={l.ad_posts.find(p => p.channel === c.key)}
                                onPublish={c.key === 'cafe' && canPublish(l) && !isLive(l)
                                  ? () => publishOne(l) : undefined}
                                busy={publishWatch}
                              />}
                        </td>
                      ))}
                      <td className="px-3 py-2 whitespace-nowrap text-xs">
                        <CheckCell
                          listing={l}
                          open={openReport === l.id}
                          onToggle={() => setOpenReport(openReport === l.id ? null : l.id)}
                        />
                      </td>
                      <td className="px-3 py-2">
                        {done ? (
                          <span className="flex items-center gap-1 whitespace-nowrap text-xs text-gray-400">
                            <CircleCheck className="h-3.5 w-3.5" /> 완료
                          </span>
                        ) : bankLive || isLive(l) ? (
                          // 뱅크에 살아 있거나 카페 글이 남아 있을 때만 의미가 있다.
                          <button
                            onClick={() => markContracted(l)}
                            className="whitespace-nowrap rounded border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:border-blue-400 hover:text-blue-600 dark:border-gray-700 dark:text-gray-300"
                          >거래완료</button>
                        ) : (
                          // 뱅크에서 이미 내려갔고 카페에도 없다. 누를 이유가 없다.
                          <span className="text-xs text-gray-300 dark:text-gray-600">–</span>
                        )}
                      </td>
                    </tr>
                  )
                  // 점검 보고는 길어서 칸에 못 담는다. 누르면 그 행 아래에 편다.
                  const report = openReport === l.id && l.check_report?.length ? (
                    <tr key={`${l.id}-report`} className="bg-amber-50/60 dark:bg-amber-950/30">
                      <td colSpan={CHANNELS.length + FIXED_COLS} className="px-4 py-3">
                        <p className="mb-2 text-xs font-medium text-amber-800 dark:text-amber-300">
                          {l.bank_no} 원문에서 발견한 것 — 뱅크에서 고치면 다음 발행부터 반영됩니다
                        </p>
                        <ul className="space-y-1.5">
                          {l.check_report.map((r, i) => (
                            <li key={i} className="text-xs leading-relaxed text-amber-900 dark:text-amber-200">
                              · {r}
                            </li>
                          ))}
                        </ul>
                      </td>
                    </tr>
                  ) : null
                  return report ? [row, report] : row
                })}
              </tbody>
            </table>
            {!filtered.length && (
              <p className="py-10 text-center text-sm text-gray-500">조건에 맞는 매물이 없습니다.</p>
            )}
          </div>
        )}

        {!loading && listings.length > 0 && (
          <Pagination
            page={page}
            totalPages={totalPages}
            pageSize={pageSize}
            totalCount={filtered.length}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
          />
        )}
      </main>
    </>
  )
}
