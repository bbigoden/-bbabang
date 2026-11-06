'use client'

/**
 * 사무실 — 사람 직원·PC 일꾼·Claude 가 지금 무엇을 하는지 한 화면에서 보고 부린다.
 *
 * 화면은 장부를 읽기만 한다. 실제 일은 지금처럼 PC 가 한다:
 *   광고 일꾼(agent-worker)      ad_jobs 를 집어 뱅크·카페·당근·수집을 돌린다
 *   뱅크 임시저장 일꾼            bank_draft_jobs 를 집는다
 *   사무실 일꾼(office-worker)    Claude 의 hooks 기록을 claude_sessions 로 옮기고,
 * 버튼은 그 줄에 한 줄 넣거나(다시 시도) 상태를 바꾸는(취소) 것뿐이다.
 *
 * 대표는 전부 보고, 직원은 일꾼 상태와 자기 할 일만 본다(Claude 두 표는 RLS 가 대표만 연다).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Users, AlertTriangle, RotateCcw, CheckCircle2, Circle, Trash2,
  RefreshCw,
} from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/lib/auth-context'
import { useToast } from '@/components/toast'
import { pollWhileVisible } from '@/lib/poll-visible'
import { todayKST, hmKST, ymdKST } from '@/lib/date-kst'
import { PixelOffice, type OfficeLayout, type Seat } from '@/components/broker/pixel-office'
import { fetchOfficeBoard, DIRECTOR_ID } from '@/lib/office-board'
import { canManageOffice } from '@/lib/office-role'
import { isMissingTable } from '@/lib/utils'

/** 입찰 수집이 마지막으로 돈 기록(bid_sync.last_run) */
interface BidRun { finishedAt: string; notices: number; results: number; details?: number; stoppedBy?: string }

/** 자리 → 그 일을 하는 화면. 사람 책상은 그 사람의 오늘 업무일지(아래에서 붙인다) */
const SEAT_HREF: Record<string, string> = {
  cafe: '/broker/ads', blog: '/broker/ads', 'daangn-post': '/broker/ads', takedown: '/broker/ads', sync: '/broker/ads',
  bank: '/broker/properties', collect: '/broker/naver', bid: '/broker/bid',
}

/** 영업부 책상 순서 — 왼쪽부터 */
const SALES_ORDER = ['박혜성', '이예리', '문지혜', '김미선', '김불당']
/** 홍보부에 앉는 직원(이름으로 — 계정이 생기기 전부터 자리를 정해 둔다). 나머지 직원은 영업부 */
const PROMO_STAFF = ['이현영']
/** 계정이 아직 없지만 자리를 내 둔 사람 */
const PENDING_STAFF = ['김미선', '이현영']
/** 이름으로 고른 포켓몬 — 계정이 생기기 전에도 같은 포켓몬이 앉는다 */
const NAME_MON: Record<string, string> = { 이현영: 'charmander', 권세현: 'charmander' }   // 2026-10-29 사장님 '파이리를 이쁘게', 권세현 이사도 같은 파이리(11-04)
/** 책상 앞 고양이 — 이현영은 애교 많은 치즈·흰 고양이(2026-10-29 사장님) */
const NAME_PETS: Record<string, string[]> = { 이현영: ['cheese', 'white'] }

/** 따로 고른 포켓몬 — 이예리는 님피아(2026-10-27 사장님) */
const STAFF_MON: Record<string, string> = {
  'c7e58900-e6bb-4f88-b3bf-d1879f8a6050': 'sylveon',   // 이예리
  'e21e1f46-6492-4f1d-964c-ba7da59a5372': 'charizard', // 박혜성 — 리자몽(2026-10-28)
}

/** 일꾼이 20초마다 찍는다 — 한 번쯤 늦어도 꺼짐으로 보이지 않게 60초를 잡는다. */
const ALIVE_MS = 60_000

/** 일이 끝나고 이만큼은 머리 위에 '✓' 풍선을 띄운다 — 10초마다 새로 보니 서너 번은 눈에 띈다. */
const FLASH_MS = 3 * 60_000

/** 일꾼 로봇이 일을 마쳤을 때 하는 말 */
const DONE_SAY: Record<string, string> = {
  publish: '올렸어요', takedown: '내렸어요', naver: '다 받았어요', daangn: '다 받았어요',
  sync: '가져왔어요', renew: '재등록 끝',
}
// 폰 3G 에서 10초마다면 한 번 새로 보는 데 걸리는 시간과 거의 같아 회선이 쉬지 않았다 — 20초(10-30)
const POLL_MS = 20_000

interface Agents {
  last_seen_at: string | null
  note: string | null
  bank_draft_seen_at: string | null
  office_seen_at?: string | null
}

interface AdJob {
  id: string
  kind: string
  status: 'queued' | 'running' | 'done' | 'failed' | 'canceled'
  params: Record<string, unknown> | null
  progress: string | null
  error: string | null
  requested_at: string
  finished_at: string | null
  requested_by?: string | null
}

interface BankJob {
  id: string
  property_id: string
  status: AdJob['status']
  progress: string | null
  error: string | null
  requested_at: string
  finished_at: string | null
  requested_by: string | null
  broker_properties: { address: string | null } | null
}

interface Member {
  id: string
  user_id?: string | null
  is_owner: boolean | null
  is_approved: boolean | null
  profiles: { name: string | null } | null
}

interface Task {
  id: string
  assignee_broker_id: string
  title: string
  note: string | null
  due_date: string | null
  status: 'open' | 'done'
  created_at: string
  done_at: string | null
}

interface ClaudeSession {
  session_id: string
  project: string | null
  title: string | null
  status: 'working' | 'waiting' | 'idle' | 'ended'
  last_action: string | null
  order_id: string | null
  updated_at: string
}

const KIND_LABEL: Record<string, string> = {
  sync: '뱅크 가져오기',
  publish: '광고 올리기',
  takedown: '광고 내리기',
  renew: '뱅크 재등록',
  naver: '네이버 수집',
  daangn: '당근 수집',
  check: '점검',
}

const CHANNEL_LABEL: Record<string, string> = { cafe: '카페', blog: '블로그', daangn: '당근', bank: '뱅크' }

/** 끝난 일은 이만큼만 먼저 보인다 — 하루치가 다 펼쳐지면 대기·실패가 아래로 밀린다. */
const DONE_SHOWN = 5

const STATUS_LABEL: Record<AdJob['status'], string> = {
  queued: '대기', running: '하는 중', done: '끝남', failed: '실패', canceled: '취소',
}

const STATUS_CLS: Record<AdJob['status'], string> = {
  queued: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300',
  running: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
  done: 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400',
  failed: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400',
  canceled: 'bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500',
}

/** 표가 아직 없을 때(장부 변경 전) Supabase 가 주는 오류. 화면은 그 칸만 '준비 전' 으로 둔다. */

const alive = (at: string | null | undefined, now: number) =>
  !!at && now - new Date(at).getTime() < ALIVE_MS


const when = (at: string) => (ymdKST(at) === todayKST() ? hmKST(at) : `${ymdKST(at).slice(5)} ${hmKST(at)}`)

export default function OfficePage() {
  const auth = useAuth()
  const { broker, loading } = auth
  const toast = useToast()
  const supabase = useMemo(() => createClient(), [])

  const isOwner = canManageOffice(broker)   // 대표·이사
  const officeId = broker?.parent_broker_id ?? broker?.id ?? null

  const [now, setNow] = useState(() => Date.now())
  const [agents, setAgents] = useState<Agents | null>(null)
  const [adJobs, setAdJobs] = useState<AdJob[]>([])
  /**
   * 뱅크 번호 → 매물 이름. short '성월리 상가' 는 말풍선에(번지·호수 없이),
   * full '성정동 1465 세림프라자 108호' 는 걸린 일 줄에 — 같은 동네 상가가 여럿 줄 서면 short 로는 못 가른다.
   */
  const [listingNames, setListingNames] = useState<Record<string, { short: string; full: string; 확인중: boolean }>>({})
  const [bankJobs, setBankJobs] = useState<BankJob[]>([])
  const [today, setToday] = useState({ cafe: 0, blog: 0, daangnPost: 0, naver: 0, daangn: 0, consult: 0 })
  // 처음 숫자를 받기 전엔 0 이 아니라 '…' — 방금 등록한 고객이 빠진 줄 알았다(10-30 재점검)
  const [todayLoaded, setTodayLoaded] = useState(false)
  /** 오늘 업무일지를 쓴 사람 → 마지막으로 고친 시각 */
  const [diaries, setDiaries] = useState<Record<string, string>>({})
  const [members, setMembers] = useState<Member[]>([])
  /** 사람마다 오늘 등록한 매물 수(10초마다) */
  const [todayProps, setTodayProps] = useState<Record<string, number>>({})
  /** 사람마다 오늘 새로 맡은 고객 수(고객목록 담당자 기준) */
  const [todayCustomers, setTodayCustomers] = useState<Record<string, number>>({})
  /** 담당자 이름마다 오늘 뱅크에 올린 것·당근에 올린 것 */
  const [todayBank, setTodayBank] = useState<Record<string, number>>({})
  /** 사무실 전체가 오늘 뱅크에 올린 수(담당자 없는 것 포함) — 뱅크 담당 말풍선 */
  const [bankTodayTotal, setBankTodayTotal] = useState(0)
  const [todayDaangn, setTodayDaangn] = useState<Record<string, number>>({})
  const [bidRun, setBidRun] = useState<BidRun | null>(null)
  /** 사람마다 지금까지 등록한 매물 수 — 현황판과 같이 5분마다 건수로만 센다 */
  const [totalProps, setTotalProps] = useState<Record<string, number>>({})
  const [tasks, setTasks] = useState<Task[] | null>(null)
  const [sessions, setSessions] = useState<ClaudeSession[] | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [board, setBoard] = useState<OfficeLayout['status'] | null>(null)
  const [showAllDone, setShowAllDone] = useState(false)

  // 앞 새로 보기가 아직 오는 중이면 다음 것을 겹쳐 보내지 않는다 — 폰 3G 에서 겹친 요청이 서로 끊겨
  // (HEAD ERR_ABORTED) 숫자가 몇 분씩 옛것으로 남았다(11-03 점검)
  const 불러오는중 = useRef(false)
  /** 받아 둔 매물 이름(bank_no → 이름). listingNames 와 같은 것을 새로 보기 사이에 들고 있는다 */
  const 이름캐시 = useRef<Record<string, { short: string; full: string; 확인중: boolean }>>({})
  const loadOnce = useCallback(async () => {
    if (!officeId) return
    // 사무실 화면에 필요한 15가지를 한 번에(office_room_snapshot). 따로 물을 땐 폰이 화면을 그리느라
    // 요청을 하나씩 늦게 내보내 2~3초 걸렸다(2026-11-05). 조건·권한(RLS)·한국 날짜는 함수 안에서 같다.
    // 받은 것을 예전 조회 결과 모양({ data })으로 맞춰 아래 처리는 그대로 둔다.
    const { data: snap, error: snapErr } = await supabase.rpc('office_room_snapshot', { p_office: officeId, p_owner: isOwner })
    if (snapErr || !snap) return // 다음 새로 보기(20초)에서 다시 — 그동안 보이던 숫자는 그대로
    type Snap = {
      members: unknown[]; todayProps: { broker_id: string }[]; sessions: unknown[] | null; diaries: unknown[]
      bidRun: unknown; agents: unknown; adJobs: unknown[]; bankJobs: unknown[]; postsByChannel: Record<string, number>
      naverToday: number; daangnToday: number; tasks: unknown[]; consult: { assignee_ids: string[] | null }[]
      bankToday: { manager: string | null }[]; daangnPosts: unknown[]
    }
    const S = snap as Snap
    const ok = <T,>(data: T) => ({ data, error: null as { message?: string; code?: string } | null })
    const ag = ok(S.agents), aj = ok(S.adJobs), bj = ok(S.bankJobs), ts = ok(S.tasks)
    const consult = ok(S.consult), bankToday = ok(S.bankToday), daangnToday = ok(S.daangnPosts)
    const nv = { count: S.naverToday }, dg = { count: S.daangnToday }
    const 사람쪽 = Promise.resolve([ok(S.members), ok(S.todayProps), ok(S.sessions), ok(S.diaries), ok(S.bidRun === null ? null : { value: S.bidRun })] as const)

    setAgents((ag.data as Agents | null) ?? null)
    const jobs = dropSuperseded((aj.data as AdJob[] | null) ?? [], j => `${j.kind}|${JSON.stringify(j.params?.bankNos ?? null)}|${JSON.stringify(j.params?.channels ?? null)}`)
    setAdJobs(jobs)
    // 돌거나 줄 선 광고 작업의 매물 이름 — '성월리 상가'(동네 + 종류). 번지·호수는 말풍선에 안 적는다(번지로 시작하면 읍면동)
    // 이름은 번호마다 한 번만 묻는다 — 작업이 줄 서 있는 동안 20초마다 같은 이름을 다시 받았다(2026-11-06 점검).
    // '확인중' 은 뱅크에서 풀리면 바뀌므로 그것만 다시 본다.
    const 번호들 = [...new Set(jobs
      .flatMap(j => (j.params?.bankNos as string[] | undefined) ?? []).map(String))]
      .filter(no => { const c = 이름캐시.current[no]; return !c || c.확인중 }).slice(0, 100)
    if (번호들.length) void supabase.from('ad_listings').select('bank_no, region, address_detail, property_kind, bank_status').in('bank_no', 번호들).then(({ data: ls }) => {
      if (!ls) return
      이름캐시.current = { ...이름캐시.current, ...Object.fromEntries(((ls ?? []) as { bank_no: string; region: string | null; address_detail: string | null; property_kind: string | null; bank_status: string | null }[])
        .map(l => {
          const 동 = l.region?.split(' ').pop()
          // 상세주소가 '성월리 …' 처럼 동네로 시작할 때만 동네를 뺀다 — '103동 508호' 는 동네가 없어 어느 단지인지 몰랐다(11-04)
          const 동네로시작 = /^[가-힣]/.test(l.address_detail ?? '')
          const short = [(동네로시작 ? l.address_detail!.split(' ')[0] : null) || 동, l.property_kind?.replace(/점포$/, '')].filter(Boolean).join(' ')
          const full = [동네로시작 ? null : 동, l.address_detail].filter(Boolean).join(' ') || short
          return [l.bank_no, { short, full, 확인중: /^확인중/.test(l.bank_status ?? '') }]
        })) }
      setListingNames(이름캐시.current)
    })
    setBankJobs(dropSuperseded((bj.data as unknown as BankJob[] | null) ?? [], j => j.property_id))
    const 채널 = (ch: string) => S.postsByChannel?.[ch] ?? 0
    setToday({
      cafe: 채널('cafe'), blog: 채널('blog'), daangnPost: 채널('daangn'),
      naver: nv.count ?? 0, daangn: dg.count ?? 0,
      consult: consult.data?.length ?? 0,
    })
    setTodayLoaded(true)
    const 고객: Record<string, number> = {}
    for (const c of (consult.data ?? []) as { assignee_ids: string[] | null }[]) {
      for (const id of c.assignee_ids ?? []) 고객[id] = (고객[id] ?? 0) + 1
    }
    setTodayCustomers(고객)
    const 담당 = (rows: { manager: string | null }[]) => {
      const n: Record<string, number> = {}
      for (const r of rows) if (r.manager) n[r.manager] = (n[r.manager] ?? 0) + 1
      return n
    }
    setTodayBank(담당((bankToday.data ?? []) as { manager: string | null }[]))
    setBankTodayTotal(bankToday.data?.length ?? 0)
    setTodayDaangn(담당(((daangnToday.data ?? []) as unknown as { ad_listings: { manager: string | null } }[]).map(p => p.ad_listings)))
    setTasks(isMissingTable(ts.error) ? null : ((ts.data as Task[] | null) ?? []))

    // 직원도 사무실 사람들은 본다(2026-10-28 '직원 계정으론 안 보인다') — Claude 만 사장님 것.
    // 업무일지는 RLS(can_access_diary)가 직원에겐 자기 것만 준다.
    {
      const [ms, props, ss, dys, br] = await 사람쪽
      setBidRun(((br as { data: { value: BidRun } | null }).data?.value) ?? null)
      const 쓴일지: Record<string, string> = {}
      for (const d of (dys.data ?? []) as { broker_id: string; wrote?: boolean; sections_content?: Record<string, unknown> | null; content?: string | null; updated_at: string }[]) {
        // 날짜를 열기만 해도 빈 줄이 생긴다 — 무엇이라도 적었을 때만 '썼다'.
        // 11-06 부터 DB(office_room_snapshot)가 원문 대신 썼는지(wrote)만 보낸다 — 옛 함수면 원문으로 판정
        const 글 = d.wrote ?? [...Object.values(d.sections_content ?? {}), d.content].some(v => typeof v === 'string' && v.trim())
        if (글) 쓴일지[d.broker_id] = d.updated_at
      }
      setDiaries(쓴일지)
      const list = ((ms.data as unknown as Member[] | null) ?? [])
        .filter(m => m.id === officeId || m.is_approved)
        .sort((a, b) => (a.id === officeId ? -1 : b.id === officeId ? 1 : 0))
      setMembers(list)
      const 오늘: Record<string, number> = {}
      for (const p of (props.data ?? []) as { broker_id: string }[]) 오늘[p.broker_id] = (오늘[p.broker_id] ?? 0) + 1
      setTodayProps(오늘)
      if (isOwner) setSessions(isMissingTable(ss.error) ? null : ((ss.data as ClaudeSession[] | null) ?? []))
    }

    setNow(Date.now())
    setLoaded(true)
  }, [supabase, officeId, isOwner])
  const load = useCallback(async () => {
    if (불러오는중.current) return
    불러오는중.current = true
    try { await loadOnce() } finally { 불러오는중.current = false }
  }, [loadOnce])

  useEffect(() => {
    void load()
    return pollWhileVisible(() => { void load() }, POLL_MS)
  }, [load])

  // 현황판 — 숫자 세는 법은 업무일지 3번 광고현황과 같이 쓴다(lib/office-board). 천천히 바뀌는 숫자라 5분마다만 본다.
  const loadBoard = useCallback(async () => {
    if (!officeId) return
    // 사람마다 매물 전체 수는 현황판이 이미 센다 — 따로 또 세면 폰 3G 에서 HEAD 가 사람 수만큼 더 나갔다(10-30)
    // 사람 목록이 아직 없으면(처음 열 때) 현황판이 직접 묻는다 — 위 묶음 15개가 끝나길 기다리면 폰에서
    // 현황판이 1초 넘게 늦게 떴다(2026-11-05)
    const b = await fetchOfficeBoard(supabase, officeId, members.length ? members : undefined)
    setBoard(b)
    setTotalProps(b.byId ?? {})
  }, [supabase, officeId, members])

  // 화면을 열면 곧바로 한 번, 그 뒤엔 5분마다(사람이 바뀌어도 다시 안 센다 — 10초마다 새 배열이 온다)
  const boardLoaded = useRef(false)
  useEffect(() => {
    if (!officeId || boardLoaded.current) return
    boardLoaded.current = true
    void loadBoard()
  }, [officeId, loadBoard])
  const loadBoardRef = useRef(loadBoard)
  useEffect(() => { loadBoardRef.current = loadBoard }, [loadBoard])
  useEffect(() => pollWhileVisible(() => { void loadBoardRef.current() }, 5 * 60_000), [])

  // ── 일꾼 조작 ─────────────────────────────────────────
  // 누르는 중인 일 — 요청이 오가고 목록을 다시 불러올 때까지 같은 버튼을 또 받지 않는다
  const 누르는중 = useRef(new Set<string>())
  const once = async (key: string, fn: () => Promise<unknown>) => {
    if (누르는중.current.has(key)) return
    누르는중.current.add(key)
    try { await fn() } finally { 누르는중.current.delete(key) }
  }

  const cancelAdJob = (j: AdJob) => once(j.id, async () => {
    // 대기 중인 것만 — 하는 중인 것은 PC 가 이미 브라우저를 띄웠다. 거기서 끊으면 올라갔는지 모른다.
    const { error } = await supabase.from('ad_jobs')
      .update({ status: 'canceled', finished_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', j.id).eq('status', 'queued')
    if (error) return toast.error(`취소하지 못했습니다: ${error.message}`)
    await loadOnce()
  })

  const retryAdJob = (j: AdJob) => once(j.id, async () => {
    if (!officeId) return
    // 카페 간격으로 미뤄졌던 시각은 버린다 — 다시 걸 때 일꾼이 간격을 새로 잰다.
    const params = j.params ? { ...j.params } : null
    if (params) delete params.notBefore
    const { error } = await supabase.from('ad_jobs')
      .insert({ broker_id: officeId, kind: j.kind, params, requested_by: auth.user?.id })
    if (error) return toast.error(`다시 걸지 못했습니다: ${error.message}`)
    toast.success('다시 걸었습니다')
    await loadOnce()
  })

  const cancelBankJob = (j: BankJob) => once(j.id, async () => {
    const { error } = await supabase.from('bank_draft_jobs')
      .update({ status: 'canceled', finished_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', j.id).eq('status', 'queued')
    if (error) return toast.error(`취소하지 못했습니다: ${error.message}`)
    await loadOnce()
  })

  const retryBankJob = (j: BankJob) => once(j.id, async () => {
    if (!officeId) return
    const { error } = await supabase.from('bank_draft_jobs')
      .insert({ office_broker_id: officeId, property_id: j.property_id, requested_by: auth.user?.id })
    if (error) return toast.error(`다시 걸지 못했습니다: ${error.message}`)
    toast.success('다시 걸었습니다')
    await loadOnce()
  })

  if (loading) return null
  if (!broker || !officeId) {
    return <p className="px-4 py-12 text-center text-sm text-gray-500">사무소에 속한 계정으로 로그인해 주세요.</p>
  }

  const adOn = alive(agents?.last_seen_at, now)
  const bankOn = alive(agents?.bank_draft_seen_at, now)
  const officeOn = alive(agents?.office_seen_at, now)

  const failedAd = adJobs.filter(j => j.status === 'failed')
  const failedBank = bankJobs.filter(j => j.status === 'failed')
  const waitingClaude = (sessions ?? []).filter(s => s.status === 'waiting')
  const alerts: string[] = []
  if (!adOn) alerts.push('광고 일꾼이 꺼져 있습니다 — PC 의 부소장 광고 프로그램을 켜 주세요')
  if (!bankOn) alerts.push('뱅크 임시저장 일꾼이 꺼져 있습니다')
  if (isOwner && sessions !== null && !officeOn) alerts.push('사무실 일꾼이 꺼져 있습니다 — Claude 활동 표시가 멈춥니다')
  if (failedAd.length + failedBank.length) {
    alerts.push(`최근 하루 실패한 일 ${failedAd.length + failedBank.length}건 — 아래 '걸린 일' 줄마다 까닭과 할 일이 있습니다`)
  }
  if (waitingClaude.length) alerts.push(`Claude ${waitingClaude.length}명이 사장님 대답을 기다립니다`)

  const myTasks = (tasks ?? []).filter(t => t.assignee_broker_id === broker.id)

  // 걸린 일: 대기·하는 중 → 실패 → 끝난 것 순. 끝난 것은 앞 몇 건만 보인다.
  const requesterName: Record<string, string> = Object.fromEntries(members
    .filter(m => m.user_id && m.profiles?.name).map(m => [m.user_id!, m.profiles!.name!]))
  // 누가 건 일인지 — 요청한 사람이 없으면 PC 프로그램이 매일 아침 스스로 건 것(2026-10-29 사장님)
  const whoOf = (id: string | null | undefined) => (id ? requesterName[id] ?? '직원' : '자동')
  // '확인중인 매물입니다' 로 실패했는데 뱅크에서 아직 확인중이면 다시 걸어도 같은 까닭으로 또 실패한다
  const 아직확인중 = (j: AdJob) => /확인중인 매물/.test(j.error ?? '')
    && ((j.params?.bankNos as string[] | undefined) ?? []).some(n => listingNames[String(n)]?.확인중)
  const rank = (s: AdJob['status']) => (s === 'running' || s === 'queued' ? 0 : s === 'failed' ? 1 : 2)
  const jobRows = [
    ...adJobs.map(j => ({ at: j.requested_at, status: j.status, node: (
      <JobRow key={`a${j.id}`} status={j.status} at={j.requested_at}
        title={KIND_LABEL[j.kind] ?? j.kind} who={whoOf(j.requested_by)} detail={jobDetail(j, listingNames)}
        onCancel={isOwner && j.status === 'queued' ? () => void cancelAdJob(j) : undefined}
        onRetry={isOwner && j.status === 'failed' && !아직확인중(j) ? () => void retryAdJob(j) : undefined} />
    ) })),
    ...bankJobs.map(j => ({ at: j.requested_at, status: j.status, node: (
      <JobRow key={`b${j.id}`} status={j.status} at={j.requested_at}
        title={`뱅크 임시저장${j.broker_properties?.address ? ` — ${j.broker_properties.address}` : ''}`} who={whoOf(j.requested_by)}
        detail={j.status === 'failed' ? j.error : j.progress}
        onCancel={isOwner && j.status === 'queued' ? () => void cancelBankJob(j) : undefined}
        onRetry={isOwner && j.status === 'failed' ? () => void retryBankJob(j) : undefined} />
    ) })),
  ].sort((a, b) => rank(a.status) - rank(b.status) || b.at.localeCompare(a.at))
  const hiddenDone = Math.max(0, jobRows.filter(r => rank(r.status) === 2).length - DONE_SHOWN)

  // ── 픽셀 사무실의 방과 자리 ──────────────────────────
  const offSay = (at: string | null | undefined) => (at ? `꺼짐 · ${when(at)} 마지막` : '꺼짐')
  const adNote = agents?.note ?? '대기 중'
  const bankRunning = bankJobs.find(j => j.status === 'running')
  const people: Seat[] = members.map((m, i) => {
    const 이름 = m.profiles?.name ?? ''
    const s = { today: todayProps[m.id] ?? 0, total: totalProps[m.id], customers: todayCustomers[m.id] ?? 0,
      bank: todayBank[이름] ?? 0, daangn: todayDaangn[이름] ?? 0 }
    const open = (tasks ?? []).filter(t => t.assignee_broker_id === m.id && t.status === 'open').length
    return {
      key: m.id, kind: 'person', tint: i, mon: STAFF_MON[m.id] ?? NAME_MON[m.profiles?.name ?? ''], pets: NAME_PETS[m.profiles?.name ?? ''], name: m.profiles?.name ?? '이름 없음',
      role: m.id === officeId ? '대표' : '직원',
      // 사람은 PC 처럼 신호를 보내지 않는다 — 오늘 등록한 것이 있으면 일한 것으로 본다.
      state: s.today + s.customers + s.bank + s.daangn > 0 || diaries[m.id] ? 'working' : 'idle',
      // 한 일만 줄로 적는다 — 고객 → 매물 → 뱅크 → 당근 → 업무일지 순(2026-10-30 사장님).
      // 숫자는 1건부터, 업무일지는 썼을 때만(2026-10-26)
      say: [s.customers ? `고객 ${s.customers}명 등록` : '', s.today ? `매물 ${s.today}건 등록` : '',
        s.bank ? `뱅크 ${s.bank}건 등록` : '', s.daangn ? `당근 ${s.daangn}건 올림` : '',
        diaries[m.id] ? '업무일지 등록' : '', open ? `할 일 ${open}건` : '']
        .filter(Boolean).join('\n') || null,
      pin: true,
      note: `오늘 고객 ${s.customers}명 등록(담당 기준) · 매물 ${s.today}건 등록 · 뱅크 ${s.bank}건 등록 · 당근 ${s.daangn}건 올림 · 업무일지 ${diaries[m.id] ? `작성(${hmKST(diaries[m.id])} 고침)` : '아직 안 씀'}`
        + (s.total == null ? '' : ` · 지금까지 등록한 매물 ${s.total.toLocaleString()}건`) + ` · 남은 할 일 ${open}건`,
    }
  })

  /**
   * 광고 PC 프로그램 하나를 하는 일별 로봇으로 나눈다. 그 일의 작업이 돌고 있으면 일하는 중,
   * 걸려 있으면 대기 건수(카페는 다음 글 시각), 없으면 쉬는 중. 프로그램이 꺼졌으면 다 빈자리.
   *
   * 한 작업이 여러 채널을 차례로 올리기도 해서(카페·당근), 채널 로봇은 일꾼이 지금 그 채널을
   * 말하고 있을 때만 일하는 중으로 본다(agents.note = '카페에 올리는 중' 등).
   */
  const visitBy: Record<string, string> = {}
  if (bankRunning?.requested_by) visitBy[bankRunning.requested_by] = 'bank'
  /** today — 오늘 한 일('오늘 3건 올림'). 있으면 영업부 직원처럼 머리 위에 늘 띄운다(2026-10-29 사장님) */
  const robot = (key: string, name: string, kinds: string[], channel: string | null, note: string, tint = 0, today?: string): Seat => {
    const matches = (j: AdJob) => kinds.includes(j.kind)
      && (!channel || (Array.isArray(j.params?.channels) && (j.params!.channels as string[]).includes(channel)))
    const running = adJobs.find(j => j.status === 'running' && matches(j))
    const nowChannel = !channel || !running || (running.params?.channels as string[] | undefined)?.length === 1
      || adNote.includes(CHANNEL_LABEL[channel] ?? channel)
    const queued = adJobs.filter(j => j.status === 'queued' && matches(j))
    const justDone = adJobs.find(j => j.status === 'done' && matches(j) && j.finished_at && now - new Date(j.finished_at).getTime() < FLASH_MS)
    const nextAt = queued.map(j => j.params?.notBefore as string | undefined).filter(Boolean).sort()[0]
    const working = !!running && nowChannel
    if (working && running!.requested_by) visitBy[running!.requested_by] ??= key
    // 누가 무엇을 — 올리는 매물(동네 + 종류)과 그 작업을 건 직원. 사장님이 '홍보부는 누가 무슨 조작을 하는지' 물어(2026-10-27)
    const 무엇 = (j: AdJob) => ((j.params?.bankNos as string[] | undefined) ?? []).map(n => listingNames[String(n)]?.short).filter(Boolean)
    const 누가 = (j: AdJob) => (j.requested_by && requesterName[j.requested_by]) || null
    const 지금 = working ? 무엇(running!) : []
    const 다음 = queued[queued.length - 1]
    const doing = working
      ? [지금.length ? `${지금[0]}${지금.length > 1 ? ` 외 ${지금.length - 1}` : ''} 올리는 중` : (running!.progress?.replace(/^\d{6,}\s*/, '') ?? adNote),
        누가(running!) ? `요청 ${누가(running!)}` : ''].filter(Boolean).join('\n')
      : null
    const waitLine = nextAt ? `${hmKST(nextAt)} 에 다음 글` : queued.length ? `대기 ${queued.length}건` : '대기 중'
    const nextLine = !working && 다음 && 무엇(다음).length ? `다음 ${무엇(다음)[0]}${누가(다음) ? ` · ${누가(다음)}` : ''}` : ''
    return {
      key, kind: 'robot', name, tint,
      note: [note, working && running!.progress ? `지금: ${running!.progress}` : '',
        queued.length ? `줄 선 것 ${queued.length}건 — ${queued.slice().reverse().slice(0, 5).map(j => [무엇(j)[0], 누가(j)].filter(Boolean).join(' · ') || '매물').join(', ')}` : '']
        .filter(Boolean).join(' · '),
      flash: justDone ? (DONE_SAY[justDone.kind] ?? '끝났어요') : null,
      state: !adOn ? 'off' : working ? 'working' : 'idle',
      pin: !!today,
      say: !adOn ? offSay(agents?.last_seen_at)
        : working ? doing
          // 쉬는 중에 오늘 한 일이 있으면 그것부터 — '대기 중' 만 남는 줄은 뺀다
          : today ? [today, queued.length ? waitLine : '', nextLine].filter(Boolean).join('\n')
            : [waitLine, nextLine].filter(Boolean).join('\n'),
    }
  }

  // 직원은 다 영업부 — 김불당도 2026-10-27 상담실에서 영업부로 옮김
  const nameOfId = Object.fromEntries(members.map(m => [m.id, m.profiles?.name ?? '']))
  const deptOf = (id: string) => (id === officeId ? 'boss' : id === DIRECTOR_ID ? 'director'
    : PROMO_STAFF.includes(nameOfId[id]) ? 'promo' : 'sales')
  // 자기가 건 일이 돌고 있으면 그 일꾼 옆으로 걸어가 서 있는다(2026-10-27 '직접 이동하게')
  const userOf = Object.fromEntries(members.map(m => [m.id, m.user_id]))
  const inDept = (d: string) => people.filter(p => deptOf(p.key) === d)
    .map(p => (d === 'director' ? { ...p, role: '이사' } : p))
  // 영업부 앉는 순서(2026-10-29 사장님). 계정이 아직 없는 사람은 '가입 전' 자리로 먼저 앉혀 두고,
  // 같은 이름으로 가입·승인되면 그 자리에 진짜 계정이 앉는다
  const 가입전 = (name: string, tint: number): Seat => ({
    key: `pending-${name}`, kind: 'person', tint, mon: NAME_MON[name], pets: NAME_PETS[name], name, role: '직원', state: 'idle', say: '가입 전',
    note: '아직 부소장 계정이 없습니다 — 이 이름으로 가입하고 승인되면 이 자리에 앉습니다',
  })
  const 자리채움 = (list: Seat[], dept: 'sales' | 'promo') => {
    for (const name of PENDING_STAFF) {
      if ((PROMO_STAFF.includes(name) ? 'promo' : 'sales') === dept && !list.some(p => p.name === name)) list.push(가입전(name, list.length))
    }
    return list
  }
  const 영업부 = 자리채움([...inDept('sales')], 'sales')
  const 순번 = (n: string) => { const i = SALES_ORDER.indexOf(n); return i < 0 ? SALES_ORDER.length : i }
  영업부.sort((a, b) => 순번(a.name) - 순번(b.name))

  const layout: OfficeLayout = {
    clock: hmKST(now),
    guests: todayLoaded ? today.consult : null,
    status: board ?? undefined,
    seats: {
      boss: inDept('boss'),
      director: inDept('director'),
      sales: 영업부,
      // 에이전트실 끝 책상 — 입찰 수집(서버가 3시간마다). 사장님 화면에만
      labEnd: isOwner ? [
        (() => {
          const at = bidRun?.finishedAt ? new Date(bidRun.finishedAt).getTime() : 0
          const stale = !at || now - at > 4 * 3600_000
          return {
            key: 'bid', kind: 'robot', name: '입찰 수집', tint: 1, pin: true,
            state: stale ? 'off' : 'idle',
            say: !at ? '아직 받은 적 없음' : stale ? `${when(bidRun!.finishedAt)} 뒤로 멈춤`
              : `${hmKST(bidRun!.finishedAt)} 받음\n공고 ${bidRun!.notices}·낙찰 ${bidRun!.results}`,
            note: '나라장터 도장·방수 공고와 낙찰결과를 서버가 3시간마다 받습니다'
              + (at ? ` · 마지막 ${when(bidRun!.finishedAt)} — 공고 ${bidRun!.notices}건 · 낙찰 ${bidRun!.results}건${bidRun!.details ? ` · 상세 ${bidRun!.details}건` : ''}${bidRun!.stoppedBy === 'limit' ? ' (오늘 한도에서 멈춤)' : ''}` : ''),
          } satisfies Seat
        })(),
      ] : [],
      // 홍보부 한 줄, 왼쪽부터 — 직원 → 뱅크 담당 → 당근·블로그·카페 → 광고 내리기 → 뱅크 가져오기 → 매물수집(2026-10-29 사장님)
      promo: [
        ...자리채움([...inDept('promo')], 'promo'),
        {
          key: 'bank', kind: 'robot', name: '뱅크 담당',
          state: !bankOn ? 'off' : bankRunning ? 'working' : 'idle',
          // 오늘 뱅크에 올라간 것 — 임시저장해 둔 것·직원이 뱅크에서 바로 올린 것 모두(2026-10-30 사장님). 당근 담당처럼 늘 띄운다
          pin: bankTodayTotal > 0,
          say: !bankOn ? offSay(agents?.bank_draft_seen_at)
            : bankRunning ? (bankRunning.progress ?? '임시저장 중')
              : bankTodayTotal ? `오늘 ${bankTodayTotal}건 올림` : '대기 중',
          note: `오늘 뱅크에 올라간 것 ${bankTodayTotal}건(직원이 바로 올린 것 포함, 뱅크 가져오기 기준) · 임시저장 대기 ${bankJobs.filter(j => j.status === 'queued').length}건`,
          flash: bankJobs.some(j => j.status === 'done' && j.finished_at && now - new Date(j.finished_at).getTime() < FLASH_MS)
            ? '임시저장 끝' : null,
        },
        robot('daangn-post', '당근 담당', ['publish'], 'daangn', `오늘 당근 ${today.daangnPost}건 올림`, 2,
          today.daangnPost ? `오늘 ${today.daangnPost}건 올림` : undefined),
        robot('blog', '블로그 담당', ['publish'], 'blog', `오늘 블로그 ${today.blog}건 임시저장`, 1,
          today.blog ? `오늘 ${today.blog}건 임시저장` : undefined),
        robot('cafe', '카페 담당', ['publish'], 'cafe', `오늘 카페 ${today.cafe}건 올림`, 0,
          today.cafe ? `오늘 ${today.cafe}건 올림` : undefined),
        robot('takedown', KIND_LABEL.takedown, ['takedown'], null, '계약 끝난 매물의 광고를 전 채널에서 내립니다', 3),
        robot('sync', KIND_LABEL.sync, ['sync', 'renew'], null, '뱅크 매물을 광고관리로 가져오고, 만료 매물을 재등록합니다', 2),
        // 네이버·당근 수집은 한 자리 '매물수집'(2026-10-29 사장님) — 둘 중 하나라도 돌면 일하는 중
        robot('collect', '매물수집', ['naver', 'daangn'], null, `오늘 수집한 매물 네이버 ${today.naver}건 · 당근 ${today.daangn}건`, 0,
          today.naver + today.daangn ? `네이버 ${today.naver.toLocaleString()}건\n당근 ${today.daangn.toLocaleString()}건` : undefined),
      ],
      // 사무실 일꾼(PC 프로그램)은 그림에 앉히지 않는다 — 방이 없어 헷갈렸다(2026-10-28). 꺼지면 맨 위 경고로 알린다
      lab: [...visibleSessions(sessions ?? []).map((s): Seat => ({
        key: s.session_id, kind: 'claude',
        name: s.title || '제목 없는 작업',
        state: s.status === 'ended' ? 'off' : s.status,
        say: s.status === 'ended' ? '퇴근' : 말풍선(s.last_action),
        note: `${s.project ?? ''} · ${when(s.updated_at)}`,
        badge: s.order_id ? '지시' : undefined,
        flash: s.status === 'idle' && s.last_action === '일을 마쳤습니다' && now - new Date(s.updated_at).getTime() < FLASH_MS
          ? '끝냈어요' : null,
      }))],
    },
  }

  for (const k of ['boss', 'director', 'sales', 'promo'] as const) {
    layout.seats[k] = layout.seats[k]?.map(p => ({ ...p, visit: visitBy[userOf[p.key] ?? ''] }))
  }
  // [열기] — 일꾼은 그 일 화면, 사람은 그 사람의 오늘 업무일지(남의 일지는 사장님만 열 수 있다)
  for (const k of Object.keys(layout.seats) as (keyof OfficeLayout['seats'])[]) {
    layout.seats[k] = layout.seats[k]?.map(p => {
      const 사람 = p.kind === 'person' && !p.key.startsWith('pending-') && (isOwner || p.key === broker?.id)
      return { ...p, href: SEAT_HREF[p.key] ?? (사람 ? `/broker/diary?date=${todayKST()}&broker=${p.key}` : undefined) }
    })
  }

  return (
    // 사무실 그림은 화면 폭 끝까지(2026-10-26 '꽉 차게'), 그 아래 목록은 읽기 좋은 폭으로
    <div className="w-full px-4 py-6">
      {/* 제목·경고는 그림 틀 안에 — 그림이 화면 높이에 맞춰 가운데로 좁아져서, 밖에 두면 제목만 왼쪽 끝에 붙었다(11-06) */}
      <div className="mb-7">
        <PixelOffice layout={layout} loading={!loaded} header={<>
          <PageHeader title="웹사무실"
            description={<>
              {isOwner ? '직원·PC 일꾼·Claude 가 지금 하는 일' : '직원·PC 일꾼이 지금 하는 일과 내 할 일'}
              {' · '}{loaded ? `${hmKST(now)} 기준, 20초마다 새로 봅니다(현황판은 5분마다)` : '불러오는 중…'}
            </>}
            actions={
              <button onClick={() => void load()} aria-label="지금 새로 보기"
                className="rounded-lg border border-gray-200 p-2 text-gray-500 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-800">
                <RefreshCw className="h-4 w-4" />
              </button>
            } />

          {loaded && alerts.length > 0 && (
            <div className="mb-5 space-y-1.5 rounded-2xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/40">
              {alerts.map(a => (
                <p key={a} className="flex items-start gap-2 text-sm font-semibold text-amber-800 dark:text-amber-300">
                  <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />{a}
                </p>
              ))}
            </div>
          )}
        </>} />
      </div>

      <div className="mx-auto max-w-7xl">
      {/* 다 불러오기 전엔 아래 칸을 그리지 않는다 — 빈 값으로 그리면 '걸린 일이 없습니다'·'장부 변경 승인 전' 이
          잠깐 떠 고장처럼 보였다(2026-10-29 점검) */}
      {!loaded ? <Empty text="불러오는 중…" /> : (<>

      {/* ── 일 목록 ─────────────────────────────────── */}
      <Section icon={RotateCcw} title="걸린 일" hint="대기·하는 중인 일과 최근 하루 기록">
        {adJobs.length + bankJobs.length === 0 ? (
          <Empty text="최근 하루 동안 걸린 일이 없습니다" />
        ) : (
          <>
            <ul className="divide-y divide-gray-100 rounded-2xl border border-gray-200 bg-white dark:divide-gray-800 dark:border-gray-800 dark:bg-gray-900">
              {jobRows.slice(0, showAllDone ? undefined : jobRows.length - hiddenDone).map(x => x.node)}
            </ul>
            {hiddenDone > 0 && (
              <button onClick={() => setShowAllDone(true)} className="mt-2 text-xs font-semibold text-blue-600 hover:underline">
                끝난 일 {hiddenDone}건 더 보기
              </button>
            )}
          </>
        )}
      </Section>

      {/* ── 직원 ─────────────────────────────────────── */}
      {isOwner ? (
        <StaffSection officeId={officeId} members={members} tasks={tasks}
          onChange={() => void loadOnce()} />
      ) : (
        <Section icon={Users} title="내 할 일">
          {tasks === null ? <Empty text="할 일 칸이 아직 준비되지 않았습니다" />
            : myTasks.length === 0 ? <Empty text="배정된 할 일이 없습니다" />
              : <TaskList tasks={myTasks} canDelete={false} onChange={() => void loadOnce()} />}
        </Section>
      )}
      </>)}
      </div>
    </div>
  )
}

/**
 * Claude 에이전트실에 앉힐 세션. 퇴근한 지 한 시간 넘은 세션은 접는다 — 하루치가 다 남으면 지금
 * 일하는 Claude 가 묻힌다. 지시 한 번 없이 켜졌다 꺼진 세션(앱이 뒤에서 잠깐 띄우는 것)도 뺀다.
 */
function visibleSessions(sessions: ClaudeSession[]): ClaudeSession[] {
  return sessions.filter(s => s.status !== 'ended'
    || (!!s.title && Date.now() - new Date(s.updated_at).getTime() < 3600_000))
}

/**
 * 뒤에 같은 일이 다시 걸렸으면 앞의 실패는 뺀다. 이미 다시 해 본 것을 '실패' 로 남겨 두면
 * 맨 위 경고가 늘 켜져 있어, 정말 손봐야 할 실패가 묻힌다.
 */
function dropSuperseded<T extends { status: AdJob['status']; requested_at: string }>(jobs: T[], key: (j: T) => string): T[] {
  const 나중 = new Map<string, string>()
  for (const j of jobs) {
    const k = key(j)
    if (!나중.has(k) || 나중.get(k)! < j.requested_at) 나중.set(k, j.requested_at)
  }
  return jobs.filter(j => j.status !== 'failed' || 나중.get(key(j)) === j.requested_at)
}

/**
 * 일 한 줄의 덧말 — 실패면 이유, 아니면 진행.
 * 매물은 '두정동 상가 외 2' 처럼 이름으로 — params 의 번호는 뱅크 내부 번호라 사장님이 아는 번호가 아니다.
 * 이름을 못 찾으면 건수만. 같은 줄이 여러 개 서도 어느 매물인지 골라 취소할 수 있게(2026-10-28 점검).
 */
function jobDetail(j: AdJob, names: Record<string, { full: string }>): string | null {
  const nos = Array.isArray(j.params?.bankNos) ? (j.params!.bankNos as string[]) : []
  const channels = Array.isArray(j.params?.channels) ? (j.params!.channels as string[]) : []
  const head = [
    channels.map(c => CHANNEL_LABEL[c] ?? c).join('·'),
    nos.length ? (names[String(nos[0])] ? `${names[String(nos[0])].full}${nos.length > 1 ? ` 외 ${nos.length - 1}` : ''}` : `매물 ${nos.length}건`) : '',
  ].filter(Boolean).join(' ')
  // 일꾼 진행 글 맨 앞의 매물번호는 뺀다 — 이름을 위에 적었다.
  // 실패 까닭 앞의 '당근: 2659164418:' 은 위에 채널·매물 이름이 있어 군더더기고, '(화면: C:\…png)' 는 PC 에만 있는 파일이다.
  // 폰에서 이것들이 두 줄을 먼저 차지해 정작 할 일이 잘렸다(11-04)
  const body = j.status === 'failed'
    ? j.error?.replace(/([가-힣]+):\s*\d{6,}:\s*/g, channels.length > 1 ? '$1: ' : '').replace(/\s*\(화면:[^)]*\)/g, '')
    : j.progress?.replace(/^\d{6,}\s*/, '')
  return [head, body].filter(Boolean).join(' · ') || null
}

// ── 직원 ───────────────────────────────────────────────

function StaffSection({ officeId, members, tasks, onChange }: {
  officeId: string
  members: Member[]
  tasks: Task[] | null
  onChange: () => void
}) {
  const supabase = useMemo(() => createClient(), [])
  const toast = useToast()
  const [form, setForm] = useState({ assignee: '', title: '', due: '' })
  const [saving, setSaving] = useState(false)

  const add = async () => {
    if (!form.assignee) return toast.error('누구에게 맡길지 골라 주세요')
    if (!form.title.trim()) return toast.error('할 일을 적어 주세요')
    setSaving(true)
    const { error } = await supabase.from('office_tasks').insert({
      office_broker_id: officeId, assignee_broker_id: form.assignee,
      title: form.title.trim(), due_date: form.due || null,
    })
    setSaving(false)
    if (error) return toast.error(`배정하지 못했습니다: ${error.message}`)
    setForm(f => ({ ...f, title: '', due: '' }))
    toast.success(`${nameOf(form.assignee)}에게 배정했습니다`)
    onChange()
  }

  const nameOf = (id: string) => members.find(m => m.id === id)?.profiles?.name ?? '이름 없음'
  const inputCls = 'rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none dark:border-gray-800 dark:bg-gray-950 dark:text-white'

  return (
    <Section icon={Users} title="할 일 배정">
      {tasks === null ? (
        <Empty text="할 일 칸이 아직 준비되지 않았습니다 (장부 변경 승인 전)" />
      ) : (
        <>
          <div className="flex flex-col gap-2 sm:flex-row">
            <select className={inputCls} value={form.assignee} onChange={e => setForm(f => ({ ...f, assignee: e.target.value }))}>
              <option value="">누구에게</option>
              {members.map(m => <option key={m.id} value={m.id}>{m.profiles?.name ?? '이름 없음'}</option>)}
            </select>
            <input className={`${inputCls} flex-1`} placeholder="예: 쌍용동 상가 사진 찍어 오기" maxLength={200}
              value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) void add() }} />
            <input type="date" min={todayKST()} className={inputCls} value={form.due} onChange={e => setForm(f => ({ ...f, due: e.target.value }))} aria-label="기한" />
            <button onClick={() => void add()} disabled={saving}
              className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-50">
              배정
            </button>
          </div>
          {tasks.length > 0 && (
            <div className="mt-3">
              <TaskList tasks={tasks} nameOf={nameOf} canDelete onChange={onChange} />
            </div>
          )}
        </>
      )}
    </Section>
  )
}

function TaskList({ tasks, nameOf, canDelete, onChange }: {
  tasks: Task[]
  nameOf?: (id: string) => string
  canDelete: boolean
  onChange: () => void
}) {
  const supabase = useMemo(() => createClient(), [])
  const toast = useToast()
  const sorted = [...tasks].sort((a, b) => (a.status === b.status ? b.created_at.localeCompare(a.created_at) : a.status === 'open' ? -1 : 1))

  const toggle = async (t: Task) => {
    const done = t.status === 'open'
    const { error } = await supabase.from('office_tasks')
      .update({ status: done ? 'done' : 'open', done_at: done ? new Date().toISOString() : null }).eq('id', t.id)
    if (error) return toast.error(`바꾸지 못했습니다: ${error.message}`)
    onChange()
  }

  const remove = async (t: Task) => {
    if (!confirm(`'${t.title}' 할 일을 지울까요?`)) return
    const { error } = await supabase.from('office_tasks').delete().eq('id', t.id)
    if (error) return toast.error(`지우지 못했습니다: ${error.message}`)
    onChange()
  }

  const overdue = (t: Task) => t.status === 'open' && !!t.due_date && t.due_date < todayKST()

  return (
    <ul className="divide-y divide-gray-100 rounded-2xl border border-gray-200 bg-white dark:divide-gray-800 dark:border-gray-800 dark:bg-gray-900">
      {sorted.map(t => (
        <li key={t.id} className="flex items-center gap-3 px-4 py-2.5">
          <button onClick={() => void toggle(t)} aria-label={t.status === 'open' ? '완료로 표시' : '다시 열기'}
            className={t.status === 'done' ? 'text-green-600' : 'text-gray-300 hover:text-green-600 dark:text-gray-600'}>
            {t.status === 'done' ? <CheckCircle2 className="h-5 w-5" /> : <Circle className="h-5 w-5" />}
          </button>
          <div className="min-w-0 flex-1">
            <p className={`truncate text-sm ${t.status === 'done' ? 'text-gray-400 line-through' : 'font-semibold text-gray-900 dark:text-white'}`}>{t.title}</p>
            <p className="text-[11px] text-gray-500">
              {nameOf ? `${nameOf(t.assignee_broker_id)} · ` : ''}
              {t.due_date ? <span className={overdue(t) ? 'font-bold text-red-600' : ''}>기한 {t.due_date.slice(5)}{overdue(t) ? ' 지남' : ''}</span> : '기한 없음'}
            </p>
          </div>
          {canDelete && (
            <button onClick={() => void remove(t)} aria-label="지우기" className="text-gray-300 hover:text-red-600 dark:text-gray-600">
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </li>
      ))}
    </ul>
  )
}

// ── 작은 조각 ──────────────────────────────────────────

function Section({ icon: Icon, title, hint, children }: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <section className="mb-7">
      <div className="mb-3 flex items-baseline gap-2">
        <h2 className="flex items-center gap-2 font-bold text-gray-900 dark:text-white"><Icon className="h-5 w-5 text-blue-600" />{title}</h2>
        {hint && <span className="text-xs text-gray-500">{hint}</span>}
      </div>
      {children}
    </section>
  )
}

/**
 * Claude 머리 위 말풍선. 일꾼이 보내는 last_action 은 도구 설명 그대로라 영어 명령 설명·파일 이름
 * ("Click ad-runn…", "029-click_카페_…", "BRIEF.md 읽는 중")이 사무실에 떠 있었다(11-03 점검, 5명 모두).
 * 한글로 된 사람 말만 그대로 두고 나머지는 '일하는 중' 으로 줄인다.
 */
function 말풍선(action: string | null) {
  if (!action) return action
  const 영어 = (action.match(/[A-Za-z]/g) ?? []).length
  const 한글 = (action.match(/[가-힣]/g) ?? []).length
  const 파일 = /[\w-]+\.(md|tsx?|jsx?|mjs|json|png|sql|py|txt|log)\b|[\\/]|\w+_\w+/.test(action)
  return 파일 || 영어 > 한글 ? '일하는 중' : action
}

function JobRow({ status, at, title, who, detail, onCancel, onRetry }: {
  status: AdJob['status']
  at: string
  title: string
  /** 건 사람 이름, 매일 예약이면 '자동' */
  who: string
  detail: string | null
  onCancel?: () => void
  onRetry?: () => void
}) {
  return (
    <li className="flex items-start gap-2 px-4 py-2.5">
      <span className={`mt-0.5 flex-shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-bold ${STATUS_CLS[status]}`}>{STATUS_LABEL[status]}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-gray-900 dark:text-white">
          {title}
          <span className={`ml-1.5 rounded px-1 py-px text-[10px] font-semibold ${who === '자동' ? 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400' : 'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300'}`}>{who}</span>
        </p>
        {/* 실패 까닭은 끝까지 — 맨 뒤에 할 일이 적혀 있다 */}
        {detail && <p className={`text-[11px] ${status === 'failed' ? 'text-red-600' : 'line-clamp-2 text-gray-500'}`}>{detail}</p>}
      </div>
      <span className="flex-shrink-0 text-[11px] text-gray-400">{when(at)}</span>
      {onRetry && (
        <button onClick={onRetry} className="flex-shrink-0 rounded-md border border-gray-200 px-2 py-0.5 text-[11px] font-semibold text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800">
          다시 시도
        </button>
      )}
      {onCancel && (
        <button onClick={onCancel} className="flex-shrink-0 rounded-md border border-gray-200 px-2 py-0.5 text-[11px] font-semibold text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800">
          취소
        </button>
      )}
    </li>
  )
}

function Empty({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-6 text-center text-xs text-gray-500 dark:border-gray-800 dark:bg-gray-900">
      {text}
    </div>
  )
}
