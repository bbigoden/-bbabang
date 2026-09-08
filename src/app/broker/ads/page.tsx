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
 * 채널은 뱅크(원본)·카페·당근 셋이다. 카페는 글을 새로 지어 올리고, 당근은
 * 뱅크 원문을 그대로 옮긴다. 내릴 때는 셋이 한 번에 내려간다.
 */

type Post = {
  id: string
  channel: 'cafe' | 'daangn' | 'bank'
  external_id: string | null
  url: string | null
  status: 'pending' | 'posted' | 'removing' | 'removed' | 'failed'
  posted_at: string | null
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
  /** area_exclusive 가 무슨 면적인지 — 전용 / 공급 / 연면적. 원문에서 읽는다. */
  area_label: string | null
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
  /** 매물끼리 비교해야 보이는 것 — 뱅크 중복 등록, 글 겹침. 수집할 때 다시 센다. */
  anomalies: string[] | null
  anomalies_at: string | null
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
/**
 * 표에 칸을 내주는 채널.
 *
 * 뱅크는 칸을 두지 않는다. 등록매물 탭에 있다는 것 자체가 뱅크 게시중이고,
 * 뱅크 원본으로 가는 링크는 매물번호가 이미 하고 있다. 계약이 끝났는데 뱅크에
 * 남아 있는 경우는 화면 위 경고와 '종료 못 함' 탭이 잡는다.
 *
 * 당근은 카페와 나란히 둔다. 뱅크 원문을 그대로 옮기는 곳이라 글을 새로 짓지
 * 않을 뿐, 올리고 내리는 흐름은 카페와 똑같다.
 */
const CHANNELS: Array<{ key: 'cafe' | 'daangn'; label: string }> = [
  { key: 'cafe', label: '카페' },
  { key: 'daangn', label: '당근' },
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

/**
 * ㎡ → 평. **글과 같은 규칙을 쓴다** (cafe-post.ts 의 m2ToPyeong).
 *
 * 예전에는 여기서만 `toFixed(1)` 을 써서 화면은 `전용 36.0평`,
 * 글은 `전용 36평` 이었다. 같은 매물을 두 곳이 다르게 불렀다 — 51건.
 * 소수점 아래가 0이면 뗀다.
 */
const m2ToPyeong = (m2: number | null) => {
  if (!m2) return null
  const v = (m2 * 0.3025).toFixed(1)
  return v.endsWith('.0') ? v.slice(0, -2) : v
}

/** PC 프로그램이 이 시간 안에 신호를 보냈으면 켜져 있는 것으로 본다 (신호 주기는 20초). */
const AGENT_ALIVE_MS = 60_000

/** 뱅크 '원클릭 재전송'이 한 번에 받는 상한. 넘기면 뱅크가 경고창을 띄운다. */
/**
 * 하루에 카페에 올리는 최대 건수. PC 프로그램의 DAILY_CAP 과 같아야 한다.
 * 여기만 고치면 화면 숫자는 바뀌어도 프로그램은 그대로 올린다.
 */
const DAILY_CAP = 10

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
 * 화면에 적는 번호.
 *
 * **사장님이 쓰는 번호는 네이버부동산 매물번호 하나뿐이다.** 뱅크 번호는
 * 뱅크 안에서만 쓰는 내부 번호라, 확인 문구나 점검 보고에 그게 뜨면
 * 무슨 매물인지 알아보려고 한 번 더 찾아봐야 한다.
 * 뱅크 번호는 뱅크 원본으로 가는 링크에만 쓴다.
 */
const 보이는번호 = (l: Listing) => l.naver_no ?? l.bank_no

/** 이 매물을 지금 카페에 올려도 되는가. PC 프로그램의 판단과 같아야 한다. */
function canPublish(l: Listing) {
  return !l.contracted_at && l.bank_tab === '등록매물'
}

/**
 * 광고를 접기로 했는데 아직 살아 있는가.
 *
 * 종료 표시와 실제로 내리는 일은 한 동작이 아니다. 웹은 표시만 하고
 * 내리는 것은 PC 프로그램이 한다. 그 사이(프로그램이 꺼져 있거나 노출종료가
 * 실패한 경우)에 접기로 한 매물이 뱅크·네이버부동산에 그대로 노출된다.
 *
 * 뱅크는 우리가 올린 게 아니라 기록이 없다. **뱅크가 어느 탭에 넣었는지**로
 * 판단한다 — 등록매물에 남아 있으면 아직 광고 중이다.
 */
function needsTakedown(l: Listing) {
  if (!l.contracted_at) return false
  if (l.ad_posts.some(p => p.status === 'posted' || p.status === 'failed')) return true
  return l.bank_tab === '등록매물'
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

/**
 * 지금 그 채널에 광고가 살아 있는가. 올린 기록이 아니라 **살아 있는 것**만 센다.
 *
 * 채널을 주지 않으면 카페든 당근이든 하나라도 살아 있으면 참이다. 광고를
 * 내려야 하는지 따질 때는 이쪽이 맞다 — 한 곳만 봐서는 다른 곳에 남은 것을 놓친다.
 */
function isLive(l: Listing, channel?: Post['channel']) {
  return l.ad_posts.some(p => p.status === 'posted' && (!channel || p.channel === channel))
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
  if (listing.contracted_at) return <span className="text-gray-400">광고종료</span>
  const r = listing.bank_closed_reason
  if (r === '기간만료') {
    return <span className="text-amber-600 dark:text-amber-400" title="30일이 지나 자동 종료됐습니다. 재등록하면 계속 광고할 수 있습니다.">기간만료</span>
  }
  if (r === '직접종료') {
    return <span className="text-red-600 dark:text-red-400" title="뱅크에서 노출종료를 누른 매물입니다. 광고를 접은 것이면 [광고종료]를 눌러 카페·당근도 같이 내려 주세요.">직접 내림</span>
  }
  return <span className="text-gray-400" title="마지막 수집 때 뱅크 목록에 없었습니다">뱅크에 없음</span>
}

/**
 * 이 매물에서 발견한 것 두 가지를 한 칸에 모은다.
 *
 * 하나는 **원문의 문제** — 면적 불일치, 관리비 비목 누락, 부당광고 표현,
 * 항목 못 찾음. 올릴 때 만들어지고, 고칠 곳은 뱅크다.
 *
 * 다른 하나는 **나란히 놓고 봐야 보이는 것** — 뱅크에 같은 매물이 두 번
 * 올라가 있다거나, 다른 글과 문장이 겹친다거나. 한 건만 봐서는 알 수 없어
 * 수집할 때마다 따로 센다. 올려 본 적이 없어도 알아야 하는 내용이라,
 * 점검을 한 적 없는 매물에도 이건 뜬다.
 *
 * 칸을 따로 내지 않고 합친다 — 볼 곳이 둘이면 한쪽은 안 보게 된다.
 */
/**
 * 사장님이 **손봐야 할 것**이 있는 매물인가.
 *
 * 점검 칸에는 두 가지가 섞여 들어간다 — 원문에서 고칠 것과, 이 프로그램이
 * 다루지 않는 종류라는 알림. 뒤에서 사장님이 할 일은 없으므로 세지 않는다.
 */
function 손볼것(l: Listing) {
  const 알림만 = (r: string) => r.startsWith('[대상 아님]')
  return (l.check_report ?? []).some(r => !알림만(r))
}

function CheckCell({ listing, open, onToggle }: {
  listing: Listing; open: boolean; onToggle: () => void
}) {
  const n = listing.check_report?.length ?? 0
  const 특이 = listing.anomalies?.length ?? 0
  if (!listing.checked_at && !특이) {
    return <span className="text-gray-300 dark:text-gray-600" title="아직 올려 보지 않았습니다. 올리기를 누르면 함께 점검합니다">–</span>
  }
  if (!n && !특이) return <span className="text-green-600 dark:text-green-400">이상 없음</span>

  // 이 표시가 붙은 건은 올리기에서 건너뛴 것 — 원문을 고쳐야 나간다.
  const blocked = listing.check_report?.some(r => /^\[(위반|형식|필수|실패|건너뜀)\]/.test(r))
  // 이 프로그램이 다루지 않는 종류(아파트·토지…). 잘못된 게 아니라 대상이 아닌 것이라
  // 빨간색으로 겁줄 일이 아니다.
  const notTarget = listing.check_report?.some(r => r.startsWith('[대상 아님]'))
  // 같은 자리를 두 번 광고하는 것은 그냥 넘길 일이 아니다. 눈에 띄어야 한다.
  const 중복 = listing.anomalies?.some(a => a.startsWith('[중복]'))
  return (
    <button
      onClick={onToggle}
      className={`rounded px-1.5 py-0.5 underline underline-offset-2 ${
        notTarget && !특이 ? 'text-gray-400 dark:text-gray-500'
          : blocked || 중복 ? 'text-red-600 dark:text-red-400'
          : 'text-amber-600 dark:text-amber-400'
      }`}
      title="눌러서 내용 보기"
    >
      {open ? '접기' : notTarget && !특이 ? '대상 아님' : `${n + 특이}건`}
    </button>
  )
}

/**
 * 채널 칸(카페·당근). **두 가지만 보여준다 — 게시중이거나, 올릴 수 있거나.**
 *
 * 내림·실패를 따로 적어 봤자 할 일이 달라지지 않는다. 올렸는데도 [올리기] 가
 * 그대로면 그게 곧 실패다. 무엇이 잘못됐는지는 점검 칸이 말한다.
 */
function ChannelCell({ label, post, onPublish, busy }: {
  /** 확인 문구에 쓸 채널 이름 — '카페' / '당근' */
  label: string
  post: Post | undefined
  /** 올릴 수 있는 매물이면 이 자리에서 바로 올린다. 없으면 '–' 만 보인다. */
  onPublish?: () => void
  busy?: boolean
}) {
  // 내리는 중이어도 글은 아직 카페에 있다. 지워진 것을 확인한 뒤에야 '내림' 이 된다.
  if (post?.status === 'posted' || post?.status === 'removing') {
    const body = <span className="text-green-600 dark:text-green-400">게시중</span>
    return post.url
      ? <a href={post.url} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-green-700">{body}</a>
      : body
  }
  // 오늘 상한을 다 썬을 때도 그냥 '–' 로 둔다. 상태줄에 이미
  // `오늘 카페에 올린 것: 10 / 10건 — 오늘은 여기까지` 가 적혀 있다.
  // 줄마다 또 적으면 목록만 조잡해진다.
  if (!onPublish) return <span className="text-gray-300 dark:text-gray-600">–</span>
  return (
    <button
      onClick={onPublish}
      disabled={busy}
      title={post?.error ? `지난번 실패: ${post.error}` : `이 매물만 ${label}에 올립니다`}
      className="underline underline-offset-2 text-gray-500 hover:text-green-600 disabled:opacity-50 dark:text-gray-400"
    >올리기</button>
  )
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
  // 특이사항만 모아 보기. 탭을 더 만들지 않고 집게로 둔다 — 등록매물을
  // 보다가 그중 문제 있는 것만 보는 식이지, 따로 떨어져 있는 목록이 아니다.
  // 좁혀 보기 — 점검 칸에 뜼는 두 가지를 각각 걸러 볼 수 있게 한다.
  // 한 개로 두면 집게 숫자와 칸의 숫자가 안 맞아 화면을 못 믿게 된다.
  const [좁혀보기, set좁혀보기] = useState<'' | '점검' | '특이'>('')
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
   * 카페·당근에 광고 중이면 없는 물건을 광고하는 셈이라 표시광고법 문제가 된다.
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
      .select('*, ad_posts(id, channel, external_id, url, status, error, posted_at)')
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
   * 화면을 새로 열어도 돌고 있는 작업을 이어서 보여 준다.
   *
   * 발행은 길면 한 시간이 넘는다. 걸어 두고 새로고침하거나 다른 화면에 다녀오면
   * 진행 표시가 통째로 사라져, 도는 중인지 끝났는지 알 수 없었다.
   */
  useEffect(() => {
    if (!auth.broker) return
    let 살아있음 = true
    void (async () => {
      const { data } = await supabase.from('ad_jobs')
        .select('id, kind, progress')
        .in('kind', ['sync', 'publish', 'renew', 'takedown'])
        .in('status', ['queued', 'running'])
      if (!살아있음) return
      for (const j of data ?? []) {
        if (j.kind === 'sync') { setSyncProgress(j.progress ?? null); watchSync(j.id) }
        if (j.kind === 'publish') { setPublishWatch(true); setPublishProgress(j.progress ?? null) }
        if (j.kind === 'renew') setRenewWatch(true)
        if (j.kind === 'takedown') setTakedownWatch(true)
      }
    })()
    return () => { 살아있음 = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

    watchSync(job.id)
  }

  /**
   * 걸어 둔 뱅크 수집이 끝날 때까지 지켜본다.
   *
   * 누를 때만이 아니라 **화면을 새로 열 때도** 쓴다. 그래야 걸어 두고 새로고침해도
   * 진행이 이어져 보인다. 매물수집 화면과 같은 잣대다.
   */
  function watchSync(jobId: string) {
    setSyncing(true); setSyncProgress(prev => prev ?? '가져오는 중…')
    // 끝날 때까지 지켜본다. 매물수집 화면과 같은 잣대를 쓴다.
    //
    // **시한은 실행이 시작된 뒤부터 센다.** 앞에 카페 발행 같은 긴 작업이 서 있으면
    // 수집은 한 시간 넘게 차례를 기다린다. 누른 때부터 세면 멀쩡히 줄 서 있는 것을
    // 두고 '너무 오래 걸립니다' 라고 겁을 준다. 다만 프로그램이 꺼져 있으면 영영
    // 차례가 안 오므로 지켜보는 것 자체는 두 시간에서 놓아준다.
    const 놓아줄때 = Date.now() + 2 * 60 * 60_000
    let 시한 = Date.now() + 30 * 60_000
    const 끝 = () => { clearInterval(poll); setSyncing(false); setSyncProgress(null) }
    const poll = setInterval(async () => {
      const { data } = await supabase.from('ad_jobs')
        .select('status, progress, result, error').eq('id', jobId).maybeSingle()
      // 작업 기록이 사라졌거나 못 읽었을 때도 시한은 봐야 한다. 그냥 돌아가면 이
      // 지켜보기가 영영 안 끝나고 버튼도 잠긴 채로 남는다.
      if (!data) {
        if (Date.now() > 시한) { 끝(); toast.error('가져오기 상태를 알 수 없습니다. 다시 눌러 주세요.') }
        return
      }
      if (data.status === 'done') {
        끝()
        const n = (data.result as { collected?: number } | null)?.collected
        toast.success(n ? `뱅크에서 ${n}건을 받아왔습니다.` : '가져오기를 마쳤습니다.')
        load()
      } else if (data.status === 'failed' || data.status === 'canceled') {
        끝()
        setSyncError(data.error ?? '알 수 없는 오류')
        toast.error(`가져오지 못했습니다: ${data.error ?? '알 수 없는 오류'}`)
      } else if (data.status === 'queued') {
        시한 = Date.now() + 30 * 60_000        // 아직 차례가 아니다. 시한은 실행부터 센다
        if (Date.now() > 놓아줄때) {
          끝()
          toast.error('가져오기가 아직 차례를 못 받았습니다. PC 프로그램이 켜져 있는지 봐 주세요.')
        } else {
          setSyncProgress('차례 기다리는 중')
        }
      } else if (Date.now() > 시한) {
        끝()
        toast.error('시간이 너무 오래 걸립니다. PC 창을 확인해 주세요.')
      } else {
        setSyncProgress(data.progress ?? null)
      }
    }, 2000)
  }

  /**
   * 이 매물의 광고를 전 채널에서 내린다 — 표의 [광고종료].
   *
   * **'거래완료' 가 아니라 '광고종료' 다.** 계약이 확정돼야만 광고를 내리는 게
   * 아니다. 손님이 직접 뺐거나, 조건이 바뀌어 잠시 내리거나, 계약은 됐는데
   * 뱅크의 거래완료(거래금액·계약일을 채워야 한다)는 안 누른 경우가 더 많다.
   * 어느 쪽이든 하는 일은 하나 — 뱅크·카페·당근에서 광고를 내린다.
   *
   * 표시만 여기서 하고 실제로 내리는 것은 PC 프로그램이 한다.
   */
  async function endAds(l: Listing) {
    // 뱅크는 발행 기록이 없어도 항상 내려야 한다. 네이버부동산까지 자동 전송되므로
    // 계약이 끝난 매물이 여기 남으면 노출이 가장 큰 곳에서 위반이 된다.
    //
    // **표의 bankLive 와 같은 잣대를 쓴다.** 예전에는 여기만 뱅크 기록을 보고
    // 표는 bank_tab 을 봐서, 등록종료 매물은 화면에 버튼이 안 뜼는데 누를 수만
    // 있으면 이미 내려간 뱅크 광고를 또 내리려 했다.
    const bankLive = l.bank_tab === '등록매물'
      && l.ad_posts.find(p => p.channel === 'bank')?.status !== 'removed'
    const where = [
      ...(bankLive ? ['뱅크'] : []),
      ...l.ad_posts
        .filter(p => p.channel !== 'bank' && (p.status === 'posted' || p.status === 'failed'))
        .map(p => CHANNEL_LABEL[p.channel] ?? p.channel),
    ]
    const msg = where.length
      ? `${보이는번호(l)} 매물의 광고를 ${where.length}곳(${where.join(', ')})에서 내립니다.\n\n` +
        (agentOnline ? '되돌릴 수 없습니다. 계속할까요?' : 'PC 프로그램이 꺼져 있어 켤 때 내려갑니다. 계속할까요?')
      : `${보이는번호(l)} 매물을 광고종료로 표시할까요?`
    if (!confirm(msg)) return

    const { error } = await supabase
      .from('ad_listings')
      .update({ contracted_at: new Date().toISOString(), is_advertising: false })
      .eq('id', l.id)
    if (error) { toast.error(`처리하지 못했습니다: ${error.message}`); return }

    if (!where.length) { toast.success('광고종료로 표시했습니다.'); load(); return }

    // 표시만으로 끝나면 광고가 그대로 남는다. 내리는 일까지 PC에 맡긴다.
    const { error: jobError } = await supabase.from('ad_jobs').insert({
      broker_id: officeId!, kind: 'takedown',
      params: { listingId: l.id }, requested_by: auth.user?.id,
    })
    if (jobError) {
      toast.error(`광고종료로 표시했지만 내리기를 요청하지 못했습니다: ${jobError.message}`)
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
   * 잇는다. 이미 올라가 있는 것은 빼고, 광고를 접었거나 뱅크에서 빠진
   * 매물은 PC 프로그램이 실행 직전에 한 번 더 거른다.
   */
  /**
   * 이 매물 하나를 그 채널에 올린다. 표의 카페·당근 칸에서 바로 누른다.
   *
   * 두 채널이 같은 작업(publish)을 쓰고 채널만 달리 보낸다. 브라우저는 한
   * 프로그램이 하나만 쓰므로 어차피 한 번에 하나씩 돈다.
   *
   * 카페는 글을 새로 지어 올리고, 당근은 뱅크 원문을 그대로 옮긴다. 무엇이
   * 다른지는 PC 프로그램이 알고, 화면은 어디로 보낼지만 정한다.
   */
  async function publishOne(l: Listing, channel: 'cafe' | 'daangn') {
    if (!auth.broker) return
    const 이름 = CHANNEL_LABEL[channel] ?? channel
    // 하루 상한은 카페만의 것이다 — 한 카페에 하루 열 건 넘게 올리면 광고로
    // 보이고, 네이버가 막으면 그날 글쓰기가 통째로 잠긴다.
    if (channel === 'cafe' && 오늘올림 >= DAILY_CAP) {
      toast.error(`오늘 이미 ${오늘올림}건을 올렸습니다. 하루 ${DAILY_CAP}건까지만 올립니다.`)
      return
    }
    if (!confirm(
      `${보이는번호(l)} 매물을 ${이름}에 올립니다. 1분쯤 걸립니다.${NL}${NL}`
      + '원문에 문제가 있으면 올리지 않고 점검 칸에 이유를 남깁니다.'
      + (agentOnline ? '' : `${NL}${NL}PC 프로그램이 꺼져 있어 켤 때 올라갑니다.`)
    )) return

    const { data: pending } = await supabase.from('ad_jobs')
      .select('id').eq('kind', 'publish').in('status', ['queued', 'running']).limit(1).maybeSingle()
    if (pending) { toast.error('이미 올리는 중입니다. 끝나면 다시 눌러 주세요.'); return }

    const { error } = await supabase.from('ad_jobs').insert({
      broker_id: officeId!, kind: 'publish',
      params: { bankNos: [l.bank_no], channel }, requested_by: auth.user?.id,
    })
    if (error) { toast.error(`요청하지 못했습니다: ${error.message}`); return }
    toast.success(agentOnline ? `${이름}에 올리는 중입니다.` : '올리기를 예약했습니다. PC 프로그램을 켜 주세요.')
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
        const 어디 = CHANNEL_LABEL[(last.result as { channel?: string } | null)?.channel ?? 'cafe'] ?? '카페'
        toast.success(r?.published ? `${어디}에 ${r.published}건 올렸습니다.` : '발행을 마쳤습니다.')
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
      `뱅크에서 내린 매물 ${goneButLive.length}건의 카페·당근 광고를 내립니다.\n` +
      `${goneButLive.map(보이는번호).join(', ')}\n\n` +
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
    if (!confirm(`광고종료한 매물 ${takedownCount}건을 뱅크·카페·당근에서 내립니다.\n\n되돌릴 수 없습니다. 계속할까요?`)) return

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
    if (tab === 'takedown') return needsTakedown(l)
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
      if (좁혀보기 === '특이' && !l.anomalies?.length) return false
      if (좁혀보기 === '점검' && !손볼것(l)) return false
      if (manager && (l.manager ?? '') !== manager) return false
      if (!key) return true
      return [l.bank_no, l.naver_no, l.region, l.address_detail, l.property_kind, l.deal_type, l.manager]
        .filter(Boolean).some(v => String(v).toLowerCase().includes(key))
    })
  }, [listings, q, manager, 좁혀보기, inTab])

  // 고객목록과 같은 방식으로 자른다 — 250건 규모라 전부 받아 두고 화면에서만 나눈다.
  // 매물목록만 서버에서 페이지 단위로 받는데, 그쪽은 1,800건에 2.3MB라 사정이 다르다.
  // 여기서 서버로 옮기면 아래 탭 숫자(전체·광고중·내려야 함)를 세려고 집계를 따로
  // 만들어야 하고, "내려야 함"은 틀리면 안 되는 숫자다.
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const paginated = filtered.slice((page - 1) * pageSize, page * pageSize)
  useEffect(() => { setPage(1) }, [q, tab, manager, 좁혀보기, pageSize])

  // 표시광고법상 즉시 내려야 하는 건들 — 화면 최상단에 경고로 띄운다
  const takedownCount = listings.filter(l => needsTakedown(l)).length
  // 체크박스로 '올릴 것' 이라고 고른 건수 — [카페에 올리기] 버튼에 쓴다.
  const liveCount = listings.filter(l => l.bank_tab === '등록매물' && isLive(l)).length
  const managers = [...new Set(listings.map(l => l.manager).filter(Boolean))].sort() as string[]
  // 특이사항은 등록매물에서만 센다 — 끝난 매물은 정리할 거리가 아니다.
  const 특이건수 = listings.filter(l => l.bank_tab === '등록매물' && l.anomalies?.length).length
  const 점검건수 = listings.filter(l => l.bank_tab === '등록매물' && 손볼것(l)).length

  // 오늘 카페에 올린 건수. 하루 10건까지만 올린다 — 한 카페에 그 이상 올리면
  // 광고로 보이고, 네이버가 막으면 그날 글쓰기가 통째로 잠긴다.
  const 오늘올림 = listings.filter(l => {
    const at = l.ad_posts.find(p => p.channel === 'cafe' && p.status === 'posted')?.posted_at
    if (!at) return false
    const d = new Date(at)
    const 오늘 = new Date()
    return d.toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' })
      === 오늘.toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' })
  }).length
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
        />

        {takedownCount > 0 && (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 p-3 text-sm dark:border-red-900 dark:bg-red-950">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
            <div>
              <p className="font-medium text-red-800 dark:text-red-300">
                광고종료한 매물 {takedownCount}건이 아직 내려가지 않았습니다.
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
                {goneButLive.map(보이는번호).slice(0, 5).join(', ')}
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

        {/* 종료예정은 탭이 이미 건수를 말한다. 화면 위에 늘 띄워 두면 볼 것이
            하나 더 늘 뿐이라, 그 탭을 볼 때만 무엇을 하면 되는지 알려준다. */}
        {tab === 'expiring' && expiring.length > 0 && (
          <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950">
            <p className="text-amber-800 dark:text-amber-400">
              뱅크 등록은 30일이면 자동 종료돼 뱅크·네이버부동산에서 빠집니다.
              재등록하면 오늘부터 30일로 새로 시작됩니다.
            </p>
            <button
              onClick={renewExpiring}
              disabled={renewWatch}
              className="ml-auto shrink-0 rounded-lg bg-amber-600 px-3 py-1.5 text-xs text-white hover:bg-amber-700 disabled:opacity-60"
            >
              {renewWatch ? '재등록 중…' : `뱅크에 다시 등록 (${Math.min(expiring.filter(l => !l.contracted_at).length, BANK_RENEW_MAX)}건)`}
            </button>
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
              ['live', `광고 중 ${liveCount}`, '카페나 당근에 광고가 살아 있는 매물'],
              ['takedown', `종료 못 함 ${takedownCount}`,
                '광고종료를 눌렀는데 아직 내려가지 않은 매물. 표시광고법상 즉시 내려야 합니다'],
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
          {/* 건수는 위 탭(등록매물 245)에 이미 있다. 여기는 언제 받아온
              목록인지만 둔다 — 신규매물 화면과 같은 모양이다. */}
          {lastSynced && <span>{fmtWhen(lastSynced)} 받아옴</span>}
          {/* 매물을 나란히 놓고 봐야 보이는 것 — 뱅크에 같은 매물이 두 번
              올라가 있거나, 글끼리 문장이 겹치는 것. 누르면 그것만 본다. */}
          {점검건수 > 0 && (
            <button
              onClick={() => set좁혀보기(v => (v === '점검' ? '' : '점검'))}
              className={`rounded px-1.5 py-0.5 underline underline-offset-2 ${
                좁혀보기 === '점검' ? 'bg-amber-600 text-white no-underline' : 'text-amber-600 dark:text-amber-400'
              }`}
              title="원문에서 손봐야 할 것이 있는 매물 — 고칠 곳은 뱅크입니다"
            >
              점검 {점검건수}건{좁혀보기 === '점검' && ' — 이것만 보는 중'}
            </button>
          )}
          {특이건수 > 0 && (
            <button
              onClick={() => set좁혀보기(v => (v === '특이' ? '' : '특이'))}
              className={`rounded px-1.5 py-0.5 underline underline-offset-2 ${
                좁혀보기 === '특이' ? 'bg-red-600 text-white no-underline' : 'text-red-600 dark:text-red-400'
              }`}
              title="뱅크에 같은 매물이 두 번 있거나, 다른 글과 문장이 겹치는 매물"
            >
              특이사항 {특이건수}건{좁혀보기 === '특이' && ' — 이것만 보는 중'}
            </button>
          )}
          <span className={오늘올림 >= DAILY_CAP ? 'font-medium text-amber-600 dark:text-amber-400' : ''}>
            오늘 카페에 올린 것:{' '}
            <span className={오늘올림 >= DAILY_CAP ? '' : 'text-gray-700 dark:text-gray-300'}>
              {오늘올림} / {DAILY_CAP}건
            </span>
            {오늘올림 >= DAILY_CAP && ' — 오늘은 여기까지'}
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
                  <th className="px-3 py-2 font-medium" title="뱅크·카페·당근의 광고를 한 번에 내립니다">광고종료</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {paginated.map(l => {
                  const done = !!l.contracted_at
                  // 뱅크에 아직 살아 있는가. 끝난 매물에 남은 날짜·[광고종료] 를
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
                            >{보이는번호(l)}</a>
                          : 보이는번호(l)}
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
                      {/* 뱅크처럼 두 면적을 함께 보여 준다.
                          구분상가면 `공급 / 전용`, 통건물이면 `대지 / 연면적` 이다.
                          무슨 면적인지는 원문에서 읽어 둔다(area_label) — 예전에는 둘 다
                          공급/전용으로 알아, 연면적 1,141평을 `전용 1,141.8평` 이라 적었다. */}
                      <td className="px-3 py-2 whitespace-nowrap text-xs">
                        {l.area_exclusive ? (
                          <>
                            {`${l.area_label ?? ''} ${m2ToPyeong(l.area_exclusive)}평`.trim()}
                            {l.area_supply && l.area_supply !== l.area_exclusive && (
                              <span className="ml-1 text-gray-400">
                                {l.area_label === '연면적' ? '대지' : '공급'} {m2ToPyeong(l.area_supply)}평
                              </span>
                            )}
                          </>
                        ) : '–'}
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
                          <ChannelCell
                            label={c.label}
                            post={l.ad_posts.find(p => p.channel === c.key)}
                            // 하루 상한은 카페만의 것이다. 당근은 내가 올린 것이
                            // 내 가게에 쌓이는 곳이라 건수를 세는 규칙이 없다.
                            onPublish={canPublish(l) && !isLive(l, c.key)
                              && (c.key !== 'cafe' || 오늘올림 < DAILY_CAP)
                              ? () => publishOne(l, c.key) : undefined}
                            busy={publishWatch}
                          />
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
                            <CircleCheck className="h-3.5 w-3.5" /> 종료
                          </span>
                        ) : bankLive || isLive(l) ? (
                          // 뱅크에 살아 있거나 카페·당근에 광고가 남아 있을 때만 의미가 있다.
                          <button
                            onClick={() => endAds(l)}
                            className="whitespace-nowrap rounded border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:border-blue-400 hover:text-blue-600 dark:border-gray-700 dark:text-gray-300"
                          >광고종료</button>
                        ) : (
                          // 어디에도 광고가 남아 있지 않다. 누를 이유가 없다.
                          <span className="text-xs text-gray-300 dark:text-gray-600">–</span>
                        )}
                      </td>
                    </tr>
                  )
                  // 점검 보고는 길어서 칸에 못 담는다. 누르면 그 행 아래에 편다.
                  // 원문의 문제와 '나란히 놓고 봐야 보이는 것' 은 고칠 곳이 달라
                  // (뱅크의 이 매물 / 뱅크의 다른 매물) 문단을 나눠 적는다.
                  const 펼침 = openReport === l.id && (l.check_report?.length || l.anomalies?.length)
                  const report = 펼침 ? (
                    <tr key={`${l.id}-report`} className="bg-amber-50/60 dark:bg-amber-950/30">
                      <td colSpan={CHANNELS.length + FIXED_COLS} className="space-y-3 px-4 py-3">
                        {!!l.anomalies?.length && (
                          <div>
                            <p className="mb-2 text-xs font-medium text-red-800 dark:text-red-300">
                              {보이는번호(l)} 다른 매물과 견줘 본 것 — 뱅크에서 정리하실 거리입니다
                            </p>
                            <ul className="space-y-1.5">
                              {l.anomalies.map((a, i) => (
                                <li key={i} className="text-xs leading-relaxed text-red-900 dark:text-red-200">
                                  · {a}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {!!l.check_report?.length && (
                          <div>
                            {/* 대상 아님은 원문을 고칠 거리가 아니다. 이 프로그램이 안 다루는
                                종류라는 알림이라, 뱅크에서 고치라고 하면 말이 안 맞는다. */}
                            <p className="mb-2 text-xs font-medium text-amber-800 dark:text-amber-300">
                              {l.check_report.every(r => r.startsWith('[대상 아님]'))
                                ? `${보이는번호(l)} — 이 종류는 프로그램이 글로 만들지 않습니다`
                                : `${보이는번호(l)} 원문에서 발견한 것 — 뱅크에서 고치면 다음 발행부터 반영됩니다`}
                            </p>
                            <ul className="space-y-1.5">
                              {l.check_report.map((r, i) => (
                                <li key={i} className="text-xs leading-relaxed text-amber-900 dark:text-amber-200">
                                  · {r}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
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
