'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth-context'
import { createClient } from '@/lib/supabase/client'
import { Header } from '@/components/layout/header'
import { PageHeader } from '@/components/layout/page-header'
import { useToast } from '@/components/toast'
import { Megaphone, RefreshCw, Search, CircleCheck, TriangleAlert, Download } from 'lucide-react'
import { Pagination, usePageSize } from '@/components/sheet/pagination'
import { parseBankPeriod } from '@/lib/bank-period'

/**
 * 광고관리 — 부동산뱅크에 등록한 매물 중 카페·블로그·당근에 광고할 것을 선별하고,
 * 어느 채널에 올라가 있는지 추적한다.
 *
 * 매물 원본은 부동산뱅크이며, 목록은 로컬 프로그램(부소장광고/npm run sync)이 채운다.
 * 거래완료로 표시하면 그 프로그램이 3개 채널에서 광고를 내린다.
 * 표시광고법상 계약된 매물의 광고는 즉시 내려야 하므로, 누락이 남지 않게 하는 것이 이 화면의 목적이다.
 */

type Post = {
  id: string
  channel: 'cafe' | 'blog' | 'daangn' | 'bank'
  external_id: string | null
  url: string | null
  status: 'pending' | 'posted' | 'removing' | 'removed' | 'failed'
  error: string | null
}

type Listing = {
  id: string
  bank_no: string
  bank_kind: string | null
  deal_type: string | null
  property_kind: string | null
  region: string | null
  address_detail: string | null
  area_supply: number | null
  area_exclusive: number | null
  price_text: string | null
  bank_period: string | null
  bank_status: string | null
  is_advertising: boolean
  contracted_at: string | null
  synced_at: string | null
  ad_posts: Post[]
}

/**
 * 광고가 나가는 곳. 뱅크를 맨 앞에 둔다 — 네이버부동산까지 자동 전송되므로
 * 노출이 가장 크고, 계약이 끝났을 때 반드시 내려야 하는 곳이다.
 *
 * 뱅크는 우리가 올린 게 아니라 발행 기록이 없다. 그래서 기록 대신 뱅크가 준
 * 상태(bank_status)와 마지막 수집 결과로 판단한다.
 */
const CHANNELS: Array<{ key: 'bank' | 'cafe' | 'blog' | 'daangn'; label: string }> = [
  { key: 'bank', label: '뱅크' },
  { key: 'cafe', label: '카페' },
  { key: 'blog', label: '블로그' },
  { key: 'daangn', label: '당근' },
]

const CHANNEL_LABEL: Record<string, string> = {
  cafe: '카페', blog: '블로그', daangn: '당근', bank: '뱅크',
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
function ExpiryCell({ period }: { period: string | null }) {
  const p = parseBankPeriod(period)
  if (!p) return <span className="text-gray-300 dark:text-gray-600">–</span>
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
 * 뱅크에 광고가 살아 있는지.
 *
 * 거래완료를 눌러도 뱅크는 따로 내려야 한다. 그런데 행이 회색이 되고 '완료'만
 * 뜨면 전부 내려간 것처럼 보인다 — 실제로는 뱅크와 네이버부동산에 그대로 남는다.
 * 그래서 한 칸을 내주고, 계약이 끝났는데 살아 있으면 붉게 띄운다.
 */
function BankCell({ listing, gone }: { listing: Listing; gone: boolean }) {
  const post = listing.ad_posts.find(p => p.channel === 'bank')
  if (post?.status === 'removed') return <span className="text-gray-400">내림</span>
  if (post?.status === 'failed') {
    return <span className="text-red-600 dark:text-red-400" title={post.error ?? ''}>실패</span>
  }
  if (gone) return <span className="text-gray-400">없음</span>
  if (listing.contracted_at) {
    return <span className="font-medium text-red-600 dark:text-red-400" title="계약이 끝났는데 뱅크에 광고가 남아 있습니다">게시중</span>
  }
  return <span className="text-green-600 dark:text-green-400">게시중</span>
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

/** 채널 게시 상태를 한 칸으로 표시 */
function ChannelCell({ post }: { post: Post | undefined }) {
  if (!post || post.status === 'pending') {
    return <span className="text-gray-300 dark:text-gray-600">–</span>
  }
  if (post.status === 'posted') {
    const body = <span className="text-green-600 dark:text-green-400">게시중</span>
    return post.url
      ? <a href={post.url} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-green-700">{body}</a>
      : body
  }
  if (post.status === 'removing') return <span className="text-amber-600 dark:text-amber-400">내리는 중</span>
  if (post.status === 'removed') return <span className="text-gray-400">내림</span>
  return <span className="text-red-600 dark:text-red-400" title={post.error ?? ''}>실패</span>
}

export default function AdsPage() {
  const router = useRouter()
  const auth = useAuth()
  const toast = useToast()
  const supabase = createClient()

  const [listings, setListings] = useState<Listing[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [tab, setTab] = useState<'all' | 'advertising' | 'takedown' | 'expiring'>('all')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = usePageSize('ads')
  const [agentSeenAt, setAgentSeenAt] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncProgress, setSyncProgress] = useState<string | null>(null)
  const [syncError, setSyncError] = useState<string | null>(null)
  const [takedownWatch, setTakedownWatch] = useState(false)
  const [renewWatch, setRenewWatch] = useState(false)

  const agentOnline = !!agentSeenAt && Date.now() - new Date(agentSeenAt).getTime() < AGENT_ALIVE_MS
  const lastSynced = useMemo(
    () => listings.reduce<string | null>(
      (a, l) => (l.synced_at && (!a || l.synced_at > a) ? l.synced_at : a), null),
    [listings],
  )

  /**
   * 마지막 수집 때 뱅크가 돌려주지 않은 매물 — 뱅크에서 빠졌다는 뜻이다.
   * 30일이 지나 자동 종료됐거나 직접 지운 것이다. 이 매물이 아직 카페·블로그에
   * 광고 중이면 뱅크에 없는 물건을 광고하는 셈이라 표시광고법 문제가 된다.
   *
   * 수집 시각을 비교해 판정한다. 같은 수집에서 들어온 행은 시각이 몇 초 안에 몰린다.
   */
  const goneFromBank = useMemo(() => {
    if (!lastSynced) return new Set<string>()
    const cutoff = new Date(lastSynced).getTime() - 10 * 60_000
    return new Set(listings.filter(l =>
      l.synced_at && new Date(l.synced_at).getTime() < cutoff).map(l => l.id))
  }, [listings, lastSynced])

  const goneButLive = listings.filter(l =>
    goneFromBank.has(l.id) && !l.contracted_at &&
    (l.is_advertising || l.ad_posts.some(p => p.status === 'posted')))

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
      .order('is_advertising', { ascending: false })
      .order('bank_no', { ascending: false })
    if (error) toast.error(`목록을 불러오지 못했습니다: ${error.message}`)
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
        .insert({ broker_id: auth.broker.id, kind: 'sync', requested_by: auth.user?.id })
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

  async function toggleAd(l: Listing) {
    const next = !l.is_advertising
    setListings(prev => prev.map(x => x.id === l.id ? { ...x, is_advertising: next } : x))
    const { error } = await supabase
      .from('ad_listings')
      .update({ is_advertising: next, updated_at: new Date().toISOString() })
      .eq('id', l.id)
    if (error) {
      setListings(prev => prev.map(x => x.id === l.id ? { ...x, is_advertising: !next } : x))
      toast.error(`변경하지 못했습니다: ${error.message}`)
    }
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
      broker_id: auth.broker!.id, kind: 'takedown',
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
      broker_id: auth.broker.id, kind: 'renew',
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

  /** 밀려 있는 것을 한꺼번에 내린다. 앞서 실패한 건을 다시 시도할 때도 쓴다. */
  async function takedownAll() {
    if (!auth.broker) return
    if (!confirm(`광고 중인 거래완료 매물 ${takedownCount}건을 전 채널에서 내립니다.\n\n되돌릴 수 없습니다. 계속할까요?`)) return

    // 이미 대기·실행 중인 내리기가 있으면 그걸 기다린다
    const { data: pending } = await supabase.from('ad_jobs')
      .select('id').eq('kind', 'takedown').in('status', ['queued', 'running']).limit(1).maybeSingle()
    if (!pending) {
      const { error } = await supabase.from('ad_jobs').insert({
        broker_id: auth.broker.id, kind: 'takedown', requested_by: auth.user?.id,
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

  const filtered = useMemo(() => {
    const key = q.trim().toLowerCase()
    return listings.filter(l => {
      if (tab === 'advertising' && !l.is_advertising) return false
      if (tab === 'takedown' && !needsTakedown(l, goneFromBank.has(l.id))) return false
      if (tab === 'expiring') {
        if (l.contracted_at) return false
        const lv = parseBankPeriod(l.bank_period)?.level
        if (lv !== 'expired' && lv !== 'urgent' && lv !== 'soon') return false
      }
      if (!key) return true
      return [l.bank_no, l.region, l.address_detail, l.property_kind, l.deal_type]
        .filter(Boolean).some(v => String(v).toLowerCase().includes(key))
    })
  }, [listings, q, tab, goneFromBank])

  // 고객목록과 같은 방식으로 자른다 — 250건 규모라 전부 받아 두고 화면에서만 나눈다.
  // 매물목록만 서버에서 페이지 단위로 받는데, 그쪽은 1,800건에 2.3MB라 사정이 다르다.
  // 여기서 서버로 옮기면 아래 탭 숫자(전체·광고중·내려야 함)를 세려고 집계를 따로
  // 만들어야 하고, "내려야 함"은 틀리면 안 되는 숫자다.
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const paginated = filtered.slice((page - 1) * pageSize, page * pageSize)
  useEffect(() => { setPage(1) }, [q, tab, pageSize])

  // 표시광고법상 즉시 내려야 하는 건들 — 화면 최상단에 경고로 띄운다
  const takedownCount = listings.filter(l => needsTakedown(l, goneFromBank.has(l.id))).length
  const adCount = listings.filter(l => l.is_advertising).length

  // 뱅크 등록은 30일이면 자동 종료된다. 재등록은 사람이 해야 하므로 미리 보여 준다.
  const expiring = listings.filter(l => {
    if (l.contracted_at) return false
    const lv = parseBankPeriod(l.bank_period)?.level
    return lv === 'expired' || lv === 'urgent' || lv === 'soon'
  })
  const expiredCount = expiring.filter(l => parseBankPeriod(l.bank_period)?.level === 'expired').length

  if (auth.loading || !auth.broker) return null

  return (
    <>
      <Header />
      <main className="mx-auto max-w-7xl px-4 py-6">
        <PageHeader
          icon={Megaphone}
          title="광고관리"
          description="부동산뱅크 매물 중 카페·블로그·당근에 광고할 것을 선별하고, 게시 상태를 추적합니다."
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
                뱅크에서 빠진 매물({goneButLive.map(l => l.bank_no).slice(0, 5).join(', ')}
                {goneButLive.length > 5 && ' 외'})을 다른 채널에 광고하고 있습니다.
                계약이 끝난 것이면 거래완료를 눌러 내리고, 아니면 뱅크에 다시 등록하세요.
              </p>
            </div>
          </div>
        )}

        {expiring.length > 0 && (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <div>
              <p className="font-medium text-amber-900 dark:text-amber-300">
                뱅크 등록이 곧 끝나는 매물 {expiring.length}건
                {expiredCount > 0 && ` (이미 지난 것 ${expiredCount}건)`}
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
              ['all', `전체 ${listings.length}`],
              ['advertising', `광고중 ${adCount}`],
              ['takedown', `내려야 함 ${takedownCount}`],
              ['expiring', `뱅크 만료임박 ${expiring.length}`],
            ] as const).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`px-3 py-1.5 text-sm first:rounded-l-lg last:rounded-r-lg ${
                  tab === key
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-600 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800'
                }`}
              >{label}</button>
            ))}
          </div>

          <div className="relative flex-1 min-w-[200px]">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="매물번호, 지역, 종류로 검색"
              className="w-full rounded-lg border border-gray-200 bg-white py-1.5 pl-8 pr-3 text-sm outline-none focus:ring-2 focus:ring-blue-300 dark:border-gray-800 dark:bg-gray-900"
            />
          </div>

          <button
            onClick={requestSync}
            disabled={syncing}
            title={agentOnline
              ? '부동산뱅크에 접속해 매물을 새로 받아옵니다'
              : 'PC에서 부소장광고 프로그램(npm run agent)을 먼저 켜 주세요'}
            className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-60"
          >
            <Download className={`h-4 w-4 ${syncing ? 'animate-pulse' : ''}`} />
            {syncing ? (syncProgress ?? '가져오는 중…') : '뱅크에서 가져오기'}
          </button>

          <button
            onClick={load}
            title="뱅크에 접속하지 않고 이 화면만 다시 그립니다"
            className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            <RefreshCw className="h-4 w-4" /> 화면 새로고침
          </button>
        </div>

        {/* 언제 받아온 목록인지, PC 프로그램이 켜져 있는지. 이게 없으면 화면이
            낡았는지 알 수가 없고, 버튼을 눌러도 왜 반응이 없는지 알 수 없다. */}
        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
          <span>
            뱅크에서 받아온 시각:{' '}
            {lastSynced
              ? <span className="text-gray-700 dark:text-gray-300">{fmtWhen(lastSynced)}</span>
              : '아직 없음'}
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
                  <th className="px-3 py-2 font-medium">광고</th>
                  <th className="px-3 py-2 font-medium">매물번호</th>
                  <th className="px-3 py-2 font-medium">종류</th>
                  <th className="px-3 py-2 font-medium">소재지</th>
                  <th className="px-3 py-2 font-medium">면적</th>
                  <th className="px-3 py-2 font-medium">가격</th>
                  <th className="px-3 py-2 font-medium">뱅크상태</th>
                  <th className="px-3 py-2 font-medium">뱅크만료</th>
                  {CHANNELS.map(c => <th key={c.key} className="px-3 py-2 font-medium">{c.label}</th>)}
                  <th className="px-3 py-2 font-medium">거래</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {paginated.map(l => {
                  const done = !!l.contracted_at
                  return (
                    <tr key={l.id} className={done ? 'bg-gray-50/60 text-gray-400 dark:bg-gray-900/40' : ''}>
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={l.is_advertising}
                          disabled={done}
                          onChange={() => toggleAd(l)}
                          className="h-4 w-4 cursor-pointer accent-blue-600 disabled:cursor-not-allowed"
                        />
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">{l.bank_no}</td>
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
                      <td className="px-3 py-2 whitespace-nowrap text-xs text-gray-500">{l.bank_status ?? '–'}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-xs">
                        {goneFromBank.has(l.id)
                          ? <span className="text-gray-400" title="마지막 수집 때 뱅크 목록에 없었습니다">뱅크에 없음</span>
                          : <ExpiryCell period={l.bank_period} />}
                      </td>
                      {CHANNELS.map(c => (
                        <td key={c.key} className="px-3 py-2 whitespace-nowrap text-xs">
                          {c.key === 'bank'
                            ? <BankCell listing={l} gone={goneFromBank.has(l.id)} />
                            : <ChannelCell post={l.ad_posts.find(p => p.channel === c.key)} />}
                        </td>
                      ))}
                      <td className="px-3 py-2">
                        {done ? (
                          <span className="flex items-center gap-1 whitespace-nowrap text-xs text-gray-400">
                            <CircleCheck className="h-3.5 w-3.5" /> 완료
                          </span>
                        ) : (
                          <button
                            onClick={() => markContracted(l)}
                            className="whitespace-nowrap rounded border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:border-blue-400 hover:text-blue-600 dark:border-gray-700 dark:text-gray-300"
                          >거래완료</button>
                        )}
                      </td>
                    </tr>
                  )
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
