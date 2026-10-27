'use client'

/**
 * 사무실 — 사람 직원·PC 일꾼·Claude 가 지금 무엇을 하는지 한 화면에서 보고 부린다.
 *
 * 화면은 장부를 읽기만 한다. 실제 일은 지금처럼 PC 가 한다:
 *   광고 일꾼(agent-worker)      ad_jobs 를 집어 뱅크·카페·당근·수집을 돌린다
 *   뱅크 임시저장 일꾼            bank_draft_jobs 를 집는다
 *   사무실 일꾼(office-worker)    Claude 의 hooks 기록을 claude_sessions 로 옮기고,
 *                                claude_orders(이 화면의 지시)를 집어 Claude 를 돌린다
 * 버튼은 그 줄에 한 줄 넣거나(지금 실행·다시 시도) 상태를 바꾸는(취소) 것뿐이다.
 *
 * 대표는 전부 보고, 직원은 일꾼 상태와 자기 할 일만 본다(Claude 두 표는 RLS 가 대표만 연다).
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Bot, Users, AlertTriangle, RotateCcw, X, Play, Send, CheckCircle2, Circle, Trash2,
  GitBranch, RefreshCw,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/lib/auth-context'
import { useToast } from '@/components/toast'
import { pollWhileVisible } from '@/lib/poll-visible'
import { todayKST, hmKST, ymdKST } from '@/lib/date-kst'
import { PixelOffice, type OfficeLayout, type RoomKey, type Seat } from '@/components/broker/pixel-office'

/**
 * 이사실에 앉는 사람(권세현 이사)의 broker_profiles.id.
 * 직급 칸이 따로 없어 여기서 정한다 — 다른 사무소에 팔 때는 사무소 설정으로 옮겨야 한다.
 */
const DIRECTOR_ID = '6581efd5-6ec9-46ea-a391-7e6537cc6345'

/** 직원이 앉는 부서 (broker_profiles.id → 방). 여기 없는 직원은 영업부. 2026-10-22 사장님이 정함. */
const STAFF_DEPT: Record<string, RoomKey> = {
  'ee4e2c98-6fd1-43db-8cbf-2acb25aae02d': 'consult',   // 김불당
  'c7e58900-e6bb-4f88-b3bf-d1879f8a6050': 'sales',     // 이예리
  'e21e1f46-6492-4f1d-964c-ba7da59a5372': 'sales',     // 박혜성
  '2afe278a-d326-4996-83df-6d26bb98a91d': 'sales',     // 문지혜
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
const POLL_MS = 10_000

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

interface ClaudeOrder {
  id: string
  prompt: string
  status: AdJob['status']
  progress: string | null
  result: string | null
  branch: string | null
  error: string | null
  requested_at: string
  finished_at: string | null
}

const KIND_LABEL: Record<string, string> = {
  sync: '뱅크 매물 가져오기',
  publish: '광고 올리기',
  takedown: '광고 내리기',
  renew: '뱅크 재등록',
  naver: '네이버 매물 수집',
  daangn: '당근 매물 수집',
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

/** 화면의 [지금 실행] — 광고 일꾼이 이미 아는 일만 건다. */
const RUN_NOW: { kind: string; label: string }[] = [
  { kind: 'sync', label: '뱅크 가져오기' },
  { kind: 'naver', label: '네이버 수집' },
  { kind: 'daangn', label: '당근 수집' },
  { kind: 'takedown', label: '못 내린 광고 내리기' },
]

/** 표가 아직 없을 때(장부 변경 전) Supabase 가 주는 오류. 화면은 그 칸만 '준비 전' 으로 둔다. */
const isMissingTable = (e: { code?: string } | null) => e?.code === '42P01' || e?.code === 'PGRST205'

const alive = (at: string | null | undefined, now: number) =>
  !!at && now - new Date(at).getTime() < ALIVE_MS

/** 오늘(한국) 0시의 순간. 저장된 시각과 비교한다. */
const todayStartIso = () => new Date(`${todayKST()}T00:00:00+09:00`).toISOString()

const when = (at: string) => (ymdKST(at) === todayKST() ? hmKST(at) : `${ymdKST(at).slice(5)} ${hmKST(at)}`)

export default function OfficePage() {
  const auth = useAuth()
  const { broker, loading } = auth
  const toast = useToast()
  const supabase = useMemo(() => createClient(), [])

  const isOwner = broker?.is_owner !== false
  const officeId = broker?.parent_broker_id ?? broker?.id ?? null

  const [now, setNow] = useState(() => Date.now())
  const [agents, setAgents] = useState<Agents | null>(null)
  const [adJobs, setAdJobs] = useState<AdJob[]>([])
  /** 뱅크 번호 → '성월리 상가' — 홍보부 말풍선에 지금 올리는 매물을 적는다 */
  const [listingNames, setListingNames] = useState<Record<string, string>>({})
  const [bankJobs, setBankJobs] = useState<BankJob[]>([])
  const [today, setToday] = useState({ cafe: 0, blog: 0, daangnPost: 0, naver: 0, daangn: 0, consult: 0 })
  const [partners, setPartners] = useState<{ id: string; name: string; month: number }[]>([])
  /** 오늘 업무일지를 쓴 사람 → 마지막으로 고친 시각 */
  const [diaries, setDiaries] = useState<Record<string, string>>({})
  const [members, setMembers] = useState<Member[]>([])
  const [memberStats, setMemberStats] = useState<Record<string, { today: number; total: number }>>({})
  const [tasks, setTasks] = useState<Task[] | null>(null)
  const [sessions, setSessions] = useState<ClaudeSession[] | null>(null)
  const [orders, setOrders] = useState<ClaudeOrder[] | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [showAllDone, setShowAllDone] = useState(false)

  const load = useCallback(async () => {
    if (!officeId) return
    const since = todayStartIso()
    const day = new Date(Date.now() - 24 * 3600_000).toISOString()

    const [ag, aj, bj, posts, nv, dg, ts, consult] = await Promise.all([
      supabase.from('ad_agents').select('*').eq('broker_id', officeId).maybeSingle(),
      supabase.from('ad_jobs')
        .select('id, kind, status, params, progress, error, requested_at, finished_at, requested_by')
        .eq('broker_id', officeId)
        .or(`status.in.(queued,running),requested_at.gte.${day}`)
        .order('requested_at', { ascending: false }).limit(40),
      supabase.from('bank_draft_jobs')
        .select('id, property_id, status, progress, error, requested_at, finished_at, broker_properties(address)')
        .eq('office_broker_id', officeId)
        .or(`status.in.(queued,running),requested_at.gte.${day}`)
        .order('requested_at', { ascending: false }).limit(20),
      // 채널마다 오늘 올린 수 — 홍보부 로봇마다 따로 적는다. 하루치라 줄이 많지 않다.
      supabase.from('ad_posts').select('channel').gte('posted_at', since).limit(1000),
      supabase.from('naver_articles').select('article_no', { count: 'exact', head: true }).gte('first_seen_at', since),
      supabase.from('daangn_articles').select('article_no', { count: 'exact', head: true }).gte('first_seen_at', since),
      supabase.from('office_tasks')
        .select('id, assignee_broker_id, title, note, due_date, status, created_at, done_at')
        .eq('office_broker_id', officeId)
        .or(`status.eq.open,done_at.gte.${day}`)
        .order('created_at', { ascending: false }).limit(100),
      // 상담실 손님 — 오늘 업무일지에 적힌 고객
      // 상담실 손님 — 오늘 고객목록에 새로 등록된 고객(휴지통 제외)
      supabase.from('broker_customers').select('id', { count: 'exact', head: true })
        .eq('office_broker_id', officeId).is('deleted_at', null).gte('created_at', since),
    ])

    setAgents((ag.data as Agents | null) ?? null)
    const jobs = dropSuperseded((aj.data as AdJob[] | null) ?? [], j => `${j.kind}|${JSON.stringify(j.params?.bankNos ?? null)}|${JSON.stringify(j.params?.channels ?? null)}`)
    setAdJobs(jobs)
    // 돌거나 줄 선 광고 작업의 매물 이름 — '성월리 상가'(동네 + 종류). 번지·호수는 말풍선에 안 적는다(번지로 시작하면 읍면동)
    const 번호들 = [...new Set(jobs.filter(j => j.status === 'running' || j.status === 'queued')
      .flatMap(j => (j.params?.bankNos as string[] | undefined) ?? []).map(String))].slice(0, 100)
    if (번호들.length) {
      const { data: ls } = await supabase.from('ad_listings').select('bank_no, region, address_detail, property_kind').in('bank_no', 번호들)
      setListingNames(Object.fromEntries(((ls ?? []) as { bank_no: string; region: string | null; address_detail: string | null; property_kind: string | null }[])
        .map(l => [l.bank_no, [(/[가-힣]/.test(l.address_detail?.split(' ')[0] ?? '') ? l.address_detail!.split(' ')[0] : null) || l.region?.split(' ').pop(), l.property_kind?.replace(/점포$/, '')].filter(Boolean).join(' ')])))
    }
    setBankJobs(dropSuperseded((bj.data as unknown as BankJob[] | null) ?? [], j => j.property_id))
    const 채널 = (ch: string) => ((posts.data ?? []) as { channel: string }[]).filter(p => p.channel === ch).length
    setToday({
      cafe: 채널('cafe'), blog: 채널('blog'), daangnPost: 채널('daangn'),
      naver: nv.count ?? 0, daangn: dg.count ?? 0,
      consult: consult.count ?? 0,
    })
    setTasks(isMissingTable(ts.error) ? null : ((ts.data as Task[] | null) ?? []))

    if (isOwner) {
      const [ms, props, ss, os, cos, ests, dys] = await Promise.all([
        supabase.from('broker_profiles')
          .select('id, user_id, is_owner, is_approved, profiles:profiles_visible(name)')
          .or(`id.eq.${officeId},parent_broker_id.eq.${officeId}`),
        supabase.from('broker_properties').select('broker_id, created_at')
          .eq('office_broker_id', officeId).is('deleted_at', null).limit(5000),
        supabase.from('claude_sessions')
          .select('session_id, project, title, status, last_action, order_id, updated_at')
          .eq('office_broker_id', officeId).gte('updated_at', day)
          .order('updated_at', { ascending: false }).limit(20),
        supabase.from('claude_orders')
          .select('id, prompt, status, progress, result, branch, error, requested_at, finished_at')
          .eq('office_broker_id', officeId)
          .order('requested_at', { ascending: false }).limit(15),
        // 협력업체 — 견적서 명의 회사들과 이번 달 견적 수
        supabase.from('estimate_companies').select('id, name').eq('owner_broker_id', officeId).order('sort_order'),
        supabase.from('estimates').select('company_id').eq('owner_broker_id', officeId)
          .gte('issue_date', `${todayKST().slice(0, 7)}-01`).limit(1000),
        // 오늘 업무일지 — 쓴 사람과 고친 시각만 본다. 내용엔 비밀번호 같은 것이 섞여 이 화면엔 옮기지 않는다
        supabase.from('broker_diary').select('broker_id, sections_content, work_summary, content, updated_at').eq('date', todayKST()),
      ])
      const 쓴일지: Record<string, string> = {}
      for (const d of (dys.data ?? []) as { broker_id: string; sections_content: Record<string, unknown> | null; work_summary: string | null; content: string | null; updated_at: string }[]) {
        // 날짜를 열기만 해도 빈 줄이 생긴다 — 무엇이라도 적었을 때만 '썼다'
        const 글 = [...Object.values(d.sections_content ?? {}), d.work_summary, d.content].some(v => typeof v === 'string' && v.trim())
        if (글) 쓴일지[d.broker_id] = d.updated_at
      }
      setDiaries(쓴일지)
      const 견적 = (ests.data ?? []) as { company_id: string | null }[]
      setPartners(((cos.data ?? []) as { id: string; name: string }[])
        .map(c => ({ ...c, month: 견적.filter(e => e.company_id === c.id).length })))
      const list = ((ms.data as unknown as Member[] | null) ?? [])
        .filter(m => m.id === officeId || m.is_approved)
        .sort((a, b) => (a.id === officeId ? -1 : b.id === officeId ? 1 : 0))
      setMembers(list)
      const stats: Record<string, { today: number; total: number }> = {}
      const todayYmd = todayKST()
      for (const p of (props.data ?? []) as { broker_id: string; created_at: string }[]) {
        const s = (stats[p.broker_id] ??= { today: 0, total: 0 })
        s.total++
        if (ymdKST(p.created_at) === todayYmd) s.today++
      }
      setMemberStats(stats)
      setSessions(isMissingTable(ss.error) ? null : ((ss.data as ClaudeSession[] | null) ?? []))
      setOrders(isMissingTable(os.error) ? null : ((os.data as ClaudeOrder[] | null) ?? []))
    }

    setNow(Date.now())
    setLoaded(true)
  }, [supabase, officeId, isOwner])

  useEffect(() => {
    void load()
    return pollWhileVisible(() => { void load() }, POLL_MS)
  }, [load])

  // ── 일꾼 조작 ─────────────────────────────────────────
  const runNow = async (kind: string, label: string) => {
    if (!officeId) return
    // 이미 걸려 있으면 또 걸지 않는다 — 같은 수집이 두 번 돌면 막힐 일만 는다.
    if (adJobs.some(j => j.kind === kind && (j.status === 'queued' || j.status === 'running') && !j.params?.listingId)) {
      return toast.error(`${label}은(는) 이미 대기 중이거나 하는 중입니다`)
    }
    const { error } = await supabase.from('ad_jobs').insert({ broker_id: officeId, kind, requested_by: auth.user?.id })
    if (error) return toast.error(`요청하지 못했습니다: ${error.message}`)
    toast.success(`${label}을(를) 걸었습니다`)
    void load()
  }

  const cancelAdJob = async (j: AdJob) => {
    // 대기 중인 것만 — 하는 중인 것은 PC 가 이미 브라우저를 띄웠다. 거기서 끊으면 올라갔는지 모른다.
    const { error } = await supabase.from('ad_jobs')
      .update({ status: 'canceled', finished_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', j.id).eq('status', 'queued')
    if (error) return toast.error(`취소하지 못했습니다: ${error.message}`)
    void load()
  }

  const retryAdJob = async (j: AdJob) => {
    if (!officeId) return
    // 카페 간격으로 미뤄졌던 시각은 버린다 — 다시 걸 때 일꾼이 간격을 새로 잰다.
    const params = j.params ? { ...j.params } : null
    if (params) delete params.notBefore
    const { error } = await supabase.from('ad_jobs')
      .insert({ broker_id: officeId, kind: j.kind, params, requested_by: auth.user?.id })
    if (error) return toast.error(`다시 걸지 못했습니다: ${error.message}`)
    toast.success('다시 걸었습니다')
    void load()
  }

  const cancelBankJob = async (j: BankJob) => {
    const { error } = await supabase.from('bank_draft_jobs')
      .update({ status: 'canceled', finished_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', j.id).eq('status', 'queued')
    if (error) return toast.error(`취소하지 못했습니다: ${error.message}`)
    void load()
  }

  const retryBankJob = async (j: BankJob) => {
    if (!officeId) return
    const { error } = await supabase.from('bank_draft_jobs')
      .insert({ office_broker_id: officeId, property_id: j.property_id, requested_by: auth.user?.id })
    if (error) return toast.error(`다시 걸지 못했습니다: ${error.message}`)
    toast.success('다시 걸었습니다')
    void load()
  }

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
  if (isOwner && orders !== null && !officeOn) alerts.push('사무실 일꾼이 꺼져 있습니다 — Claude 지시와 활동 표시가 멈춥니다')
  if (failedAd.length + failedBank.length) alerts.push(`최근 하루 실패한 일 ${failedAd.length + failedBank.length}건 — 아래에서 다시 시도할 수 있습니다`)
  if (waitingClaude.length) alerts.push(`Claude ${waitingClaude.length}명이 사장님 대답을 기다립니다`)

  const myTasks = (tasks ?? []).filter(t => t.assignee_broker_id === broker.id)

  // 걸린 일: 대기·하는 중 → 실패 → 끝난 것 순. 끝난 것은 앞 몇 건만 보인다.
  const rank = (s: AdJob['status']) => (s === 'running' || s === 'queued' ? 0 : s === 'failed' ? 1 : 2)
  const jobRows = [
    ...adJobs.map(j => ({ at: j.requested_at, status: j.status, node: (
      <JobRow key={`a${j.id}`} status={j.status} at={j.requested_at}
        title={KIND_LABEL[j.kind] ?? j.kind} detail={jobDetail(j)}
        onCancel={isOwner && j.status === 'queued' ? () => void cancelAdJob(j) : undefined}
        onRetry={isOwner && j.status === 'failed' ? () => void retryAdJob(j) : undefined} />
    ) })),
    ...bankJobs.map(j => ({ at: j.requested_at, status: j.status, node: (
      <JobRow key={`b${j.id}`} status={j.status} at={j.requested_at}
        title={`뱅크 임시저장${j.broker_properties?.address ? ` — ${j.broker_properties.address}` : ''}`}
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
  const orderRunning = (orders ?? []).some(o => o.status === 'running')
  const people: Seat[] = members.map((m, i) => {
    const s = memberStats[m.id] ?? { today: 0, total: 0 }
    const open = (tasks ?? []).filter(t => t.assignee_broker_id === m.id && t.status === 'open').length
    return {
      key: m.id, kind: 'person', tint: i, name: m.profiles?.name ?? '이름 없음',
      role: m.id === officeId ? '대표' : '직원',
      // 사람은 PC 처럼 신호를 보내지 않는다 — 오늘 등록한 것이 있으면 일한 것으로 본다.
      state: s.today > 0 || diaries[m.id] ? 'working' : 'idle',
      // 한 일만 줄로 적는다 — 매물은 1건부터, 업무일지는 썼을 때만(2026-10-26 사장님이 정함)
      say: [s.today ? `매물 ${s.today}건 등록` : '', diaries[m.id] ? '업무일지 등록' : '', open ? `할 일 ${open}건` : '']
        .filter(Boolean).join('\n') || null,
      pin: true,
      note: `오늘 매물 ${s.today}건 등록 · 업무일지 ${diaries[m.id] ? `작성(${hmKST(diaries[m.id])} 고침)` : '아직 안 씀'}`
        + ` · 지금까지 등록한 매물 ${s.total}건 · 남은 할 일 ${open}건`,
    }
  })
  const openTasks = (tasks ?? []).filter(t => t.status === 'open').length
  const requesterName: Record<string, string> = Object.fromEntries(members
    .filter(m => m.user_id && m.profiles?.name).map(m => [m.user_id!, m.profiles!.name!]))

  /**
   * 광고 PC 프로그램 하나를 하는 일별 로봇으로 나눈다. 그 일의 작업이 돌고 있으면 일하는 중,
   * 걸려 있으면 대기 건수(카페는 다음 글 시각), 없으면 쉬는 중. 프로그램이 꺼졌으면 다 빈자리.
   *
   * 한 작업이 여러 채널을 차례로 올리기도 해서(카페·당근), 채널 로봇은 일꾼이 지금 그 채널을
   * 말하고 있을 때만 일하는 중으로 본다(agents.note = '카페에 올리는 중' 등).
   */
  const robot = (key: string, name: string, kinds: string[], channel: string | null, note: string, tint = 0): Seat => {
    const matches = (j: AdJob) => kinds.includes(j.kind)
      && (!channel || (Array.isArray(j.params?.channels) && (j.params!.channels as string[]).includes(channel)))
    const running = adJobs.find(j => j.status === 'running' && matches(j))
    const nowChannel = !channel || !running || (running.params?.channels as string[] | undefined)?.length === 1
      || adNote.includes(CHANNEL_LABEL[channel] ?? channel)
    const queued = adJobs.filter(j => j.status === 'queued' && matches(j))
    const justDone = adJobs.find(j => j.status === 'done' && matches(j) && j.finished_at && now - new Date(j.finished_at).getTime() < FLASH_MS)
    const nextAt = queued.map(j => j.params?.notBefore as string | undefined).filter(Boolean).sort()[0]
    const working = !!running && nowChannel
    // 누가 무엇을 — 올리는 매물(동네 + 종류)과 그 작업을 건 직원. 사장님이 '홍보부는 누가 무슨 조작을 하는지' 물어(2026-10-27)
    const 무엇 = (j: AdJob) => ((j.params?.bankNos as string[] | undefined) ?? []).map(n => listingNames[String(n)]).filter(Boolean)
    const 누가 = (j: AdJob) => (j.requested_by && requesterName[j.requested_by]) || null
    const 지금 = working ? 무엇(running!) : []
    const 다음 = queued[queued.length - 1]
    const doing = working
      ? [지금.length ? `${지금[0]}${지금.length > 1 ? ` 외 ${지금.length - 1}` : ''} 올리는 중` : (running!.progress ?? adNote),
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
      say: !adOn ? offSay(agents?.last_seen_at)
        : working ? doing
          : [waitLine, nextLine].filter(Boolean).join('\n'),
    }
  }

  const deptOf = (id: string) => (id === officeId ? 'boss' : id === DIRECTOR_ID ? 'director' : STAFF_DEPT[id] ?? 'sales')
  const inDept = (d: string) => people.filter(p => deptOf(p.key) === d)
    .map(p => (d === 'director' ? { ...p, role: '이사' } : d === 'consult' ? { ...p, role: '상담 담당' } : p))

  const layout: OfficeLayout = {
    clock: hmKST(now),
    guests: today.consult,
    board: [
      `광고 올림  카페 ${today.cafe} · 블로그 ${today.blog} · 당근 ${today.daangnPost}`,
      `오늘 수집한 매물  네이버 ${today.naver} · 당근 ${today.daangn}`,
      isOwner ? `남은 할 일 ${openTasks}건` : `내 할 일 ${myTasks.filter(t => t.status === 'open').length}건`,
    ],
    seats: {
      boss: inDept('boss'),
      director: inDept('director'),
      sales: inDept('sales'),
      consult: inDept('consult'),
      promo: [
        robot('cafe', '카페 담당', ['publish'], 'cafe', `오늘 카페 ${today.cafe}건 올림`),
        robot('blog', '블로그 담당', ['publish'], 'blog', `오늘 블로그 ${today.blog}건 임시저장`, 1),
        robot('daangn-post', '당근 담당', ['publish'], 'daangn', `오늘 당근 ${today.daangnPost}건 올림`, 2),
        robot('takedown', '광고 회수', ['takedown'], null, '계약 끝난 매물의 광고를 전 채널에서 내립니다', 3),
      ],
      research: [
        robot('naver', '네이버 수집', ['naver'], null, `오늘 수집한 네이버 매물 ${today.naver}건`),
        robot('daangn', '당근 수집', ['daangn'], null, `오늘 수집한 당근 매물 ${today.daangn}건`, 1),
      ],
      register: [
        {
          key: 'bank', kind: 'robot', name: '뱅크 등록',
          state: !bankOn ? 'off' : bankRunning ? 'working' : 'idle',
          say: bankOn ? (bankRunning ? (bankRunning.progress ?? '임시저장 중') : '대기 중') : offSay(agents?.bank_draft_seen_at),
          note: `뱅크 임시저장 대기 ${bankJobs.filter(j => j.status === 'queued').length}건`,
          flash: bankJobs.some(j => j.status === 'done' && j.finished_at && now - new Date(j.finished_at).getTime() < FLASH_MS)
            ? '임시저장 끝' : null,
        },
        robot('sync', '뱅크 동기화', ['sync', 'renew'], null, '뱅크 매물을 광고관리로 가져오고, 만료 매물을 재등록합니다', 2),
      ],
      server: isOwner ? [{
        key: 'office', kind: 'robot', name: '사무실 일꾼',
        state: !officeOn ? 'off' : orderRunning ? 'working' : 'idle',
        say: officeOn ? (orderRunning ? 'Claude 에게 지시 전달 중' : '대기 중') : offSay(agents?.office_seen_at),
        note: 'Claude 활동을 옮기고, 화면의 지시를 Claude 에게 전합니다',
        flash: (orders ?? []).some(o => o.status === 'done' && o.finished_at && now - new Date(o.finished_at).getTime() < FLASH_MS)
          ? '지시 끝' : null,
      }] : [],
      partner: partners.map((c, i) => ({
        key: `partner-${c.id}`, kind: 'person', tint: 5 + i, name: c.name.replace(/\s*주식회사\s*|\(주\)/g, ''),
        role: '협력업체', state: 'idle', say: null, note: `이번 달 견적서 ${c.month}건`,
      })),
      lab: visibleSessions(sessions ?? []).map(s => ({
      key: s.session_id, kind: 'claude',
      name: s.title || '제목 없는 작업',
      state: s.status === 'ended' ? 'off' : s.status,
      say: s.status === 'ended' ? '퇴근' : s.last_action,
      note: `${s.project ?? ''} · ${when(s.updated_at)}`,
      badge: s.order_id ? '지시' : undefined,
      flash: s.status === 'idle' && s.last_action === '일을 마쳤습니다' && now - new Date(s.updated_at).getTime() < FLASH_MS
        ? '끝냈어요' : null,
    })),
    },
  }

  return (
    // 사무실 그림은 화면 폭 끝까지(2026-10-26 '꽉 차게'), 그 아래 목록은 읽기 좋은 폭으로
    <div className="w-full px-4 py-6">
      <div className="mb-5 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">사무실</h1>
          <p className="mt-0.5 text-xs text-gray-500">
            {isOwner ? '직원·PC 일꾼·Claude 가 지금 하는 일' : 'PC 일꾼 상태와 내 할 일'}
            {loaded && <> · {hmKST(now)} 기준, 10초마다 새로 봅니다</>}
          </p>
        </div>
        <button onClick={() => void load()} aria-label="지금 새로 보기"
          className="rounded-lg border border-gray-200 p-2 text-gray-500 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-800">
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>

      {loaded && alerts.length > 0 && (
        <div className="mb-5 space-y-1.5 rounded-2xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/40">
          {alerts.map(a => (
            <p key={a} className="flex items-start gap-2 text-sm font-semibold text-amber-800 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />{a}
            </p>
          ))}
        </div>
      )}

      {/* ── 픽셀 사무실 ─────────────────────────────── */}
      <div className="mb-7">
        <PixelOffice layout={layout} />

        {isOwner && (
          // 사무실 그림과 같은 폭·위치에(pxo-fit) — 따로 두면 그림은 가운데, 버튼은 왼쪽 끝이라 삐져나와 보였다
          <div className="pxo-fit mt-3 flex flex-wrap gap-2">
            {RUN_NOW.map(r => (
              <button key={r.kind} onClick={() => void runNow(r.kind, r.label)}
                className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800">
                <Play className="h-3.5 w-3.5" /> {r.label}
              </button>
            ))}
            {!adOn && <span className="self-center text-[11px] text-gray-500">꺼져 있어도 걸어 두면 켤 때 실행됩니다</span>}
          </div>
        )}
      </div>

      <div className="mx-auto max-w-7xl">

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
          onChange={() => void load()} />
      ) : (
        <Section icon={Users} title="내 할 일">
          {tasks === null ? <Empty text="할 일 칸이 아직 준비되지 않았습니다" />
            : myTasks.length === 0 ? <Empty text="배정된 할 일이 없습니다" />
              : <TaskList tasks={myTasks} canDelete={false} onChange={() => void load()} />}
        </Section>
      )}

      {/* ── Claude ───────────────────────────────────── */}
      {isOwner && (
        <ClaudeSection officeId={officeId} sessions={sessions} orders={orders} workerOn={officeOn}
          onChange={() => void load()} />
      )}
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
 * 매물은 건수만 적는다. params 의 번호는 뱅크 내부 번호라 사장님이 아는 번호가 아니다.
 */
function jobDetail(j: AdJob): string | null {
  const nos = Array.isArray(j.params?.bankNos) ? (j.params!.bankNos as string[]) : []
  const channels = Array.isArray(j.params?.channels) ? (j.params!.channels as string[]) : []
  const head = [
    channels.map(c => CHANNEL_LABEL[c] ?? c).join('·'),
    nos.length ? `매물 ${nos.length}건` : '',
  ].filter(Boolean).join(' ')
  const body = j.status === 'failed' ? j.error : j.progress
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
            <input type="date" className={inputCls} value={form.due} onChange={e => setForm(f => ({ ...f, due: e.target.value }))} aria-label="기한" />
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

// ── Claude ─────────────────────────────────────────────

function ClaudeSection({ officeId, sessions, orders, workerOn, onChange }: {
  officeId: string
  sessions: ClaudeSession[] | null
  orders: ClaudeOrder[] | null
  workerOn: boolean
  onChange: () => void
}) {
  const supabase = useMemo(() => createClient(), [])
  const toast = useToast()
  const [prompt, setPrompt] = useState('')
  const [sending, setSending] = useState(false)
  const [open, setOpen] = useState<string | null>(null)

  const send = async () => {
    const p = prompt.trim()
    if (p.length < 2) return toast.error('지시를 적어 주세요')
    setSending(true)
    const { error } = await supabase.from('claude_orders').insert({ office_broker_id: officeId, prompt: p })
    setSending(false)
    if (error) return toast.error(`보내지 못했습니다: ${error.message}`)
    setPrompt('')
    toast.success(workerOn ? 'Claude 에게 보냈습니다' : '보냈습니다 — 사무실 일꾼이 켜지면 시작합니다')
    onChange()
  }

  const cancel = async (o: ClaudeOrder) => {
    const { error } = await supabase.from('claude_orders')
      .update({ status: 'canceled', finished_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', o.id).eq('status', 'queued')
    if (error) return toast.error(`취소하지 못했습니다: ${error.message}`)
    onChange()
  }

  if (sessions === null || orders === null) {
    return (
      <Section icon={Bot} title="Claude 에게 지시">
        <Empty text="Claude 칸이 아직 준비되지 않았습니다 (장부 변경 승인 전)" />
      </Section>
    )
  }

  return (
    <Section icon={Bot} title="Claude 에게 지시" hint="일하는 모습은 위 에이전트실에 보입니다">
      <div className="rounded-2xl border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
        <textarea value={prompt} onChange={e => setPrompt(e.target.value)} maxLength={4000} rows={3}
          placeholder="예: 매물수집 화면에 '오늘 새로 들어온 것만' 보기 버튼을 만들어 줘"
          className="w-full resize-y rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none dark:border-gray-800 dark:bg-gray-950 dark:text-white" />
        <div className="mt-2 flex items-center justify-between gap-3">
          <p className="text-[11px] leading-relaxed text-gray-500">
            부소장 코드를 따로 갈래(branch)에서 고치고 결과만 적어 둡니다. 배포·DB 변경·커밋 올리기는 하지 않습니다 —
            반영은 채팅에서 확인하고 합니다.
          </p>
          <button onClick={() => void send()} disabled={sending}
            className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-50">
            <Send className="h-3.5 w-3.5" /> 보내기
          </button>
        </div>
      </div>

      {orders.length > 0 && (
        <ul className="mt-3 divide-y divide-gray-100 rounded-2xl border border-gray-200 bg-white dark:divide-gray-800 dark:border-gray-800 dark:bg-gray-900">
          {orders.map(o => (
            <li key={o.id} className="px-4 py-3">
              <div className="flex items-start gap-2">
                <span className={`mt-0.5 flex-shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-bold ${STATUS_CLS[o.status]}`}>{STATUS_LABEL[o.status]}</span>
                <button onClick={() => setOpen(open === o.id ? null : o.id)} className="min-w-0 flex-1 text-left">
                  <p className={`text-sm text-gray-900 dark:text-white ${open === o.id ? 'whitespace-pre-wrap' : 'truncate'}`}>{o.prompt}</p>
                  <p className="text-[11px] text-gray-500">
                    {when(o.requested_at)}
                    {o.status === 'running' && o.progress ? ` · ${o.progress}` : ''}
                    {o.status === 'failed' && o.error ? ` · ${o.error}` : ''}
                  </p>
                </button>
                {o.status === 'queued' && (
                  <button onClick={() => void cancel(o)} aria-label="취소" className="text-gray-400 hover:text-red-600"><X className="h-4 w-4" /></button>
                )}
              </div>
              {open === o.id && (o.result || o.branch) && (
                <div className="mt-2 rounded-lg bg-gray-50 p-3 text-xs text-gray-700 dark:bg-gray-950 dark:text-gray-300">
                  {o.branch && (
                    <p className="mb-2 flex items-center gap-1 font-semibold"><GitBranch className="h-3.5 w-3.5" /> 고친 갈래: <code>{o.branch}</code></p>
                  )}
                  {o.result && <p className="whitespace-pre-wrap">{o.result}</p>}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Section>
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

function JobRow({ status, at, title, detail, onCancel, onRetry }: {
  status: AdJob['status']
  at: string
  title: string
  detail: string | null
  onCancel?: () => void
  onRetry?: () => void
}) {
  return (
    <li className="flex items-start gap-2 px-4 py-2.5">
      <span className={`mt-0.5 flex-shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-bold ${STATUS_CLS[status]}`}>{STATUS_LABEL[status]}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-gray-900 dark:text-white">{title}</p>
        {detail && <p className={`line-clamp-2 text-[11px] ${status === 'failed' ? 'text-red-600' : 'text-gray-500'}`}>{detail}</p>}
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
