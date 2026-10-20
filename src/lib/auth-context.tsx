'use client'

/**
 * 전역 인증·프로필 컨텍스트.
 *
 * 페이지마다 supabase.auth.getUser + profiles + broker_profiles를 따로 fetch하던
 * 패턴을 제거하기 위함. AuthProvider가 root layout에 한 번 mount되어 fetch 1회,
 * 페이지들은 useAuth()로 즉시 접근.
 *
 * 세부:
 * - 마운트 시 supabase.auth.getUser → profile/broker_profile parallel fetch
 * - supabase.auth.onAuthStateChange(SIGNED_IN/SIGNED_OUT/TOKEN_REFRESHED) → 자동 재조회
 * - localStorage 캐시로 새 탭/리로드/앱 재시작 시 즉시 hydrate (round-trip 없이 화면 그림)
 *   sessionStorage는 PWA를 완전히 종료하면 비워져 콜드스타트마다 캐시 미스가 났다.
 *   → localStorage로 두어야 앱을 껐다 켜도 첫 화면이 즉시 뜬다. (로그아웃 시 clearCache)
 * - 재조회 결과가 화면에 든 값과 같으면 state 를 건드리지 않는다 (snapshotKey 참고)
 * - refresh()로 명시적 재조회 가능
 */

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { User as SupabaseUser } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'
import { claimPushSubscription, releasePushSubscription } from '@/lib/push'
import { isProtectedPath } from '@/lib/protected-paths'

export interface Profile {
  id: string
  email?: string | null
  name?: string | null
  phone?: string | null
  role?: string | null
  created_at?: string | null
  notification_preferences?: Record<string, boolean> | null
  account_status?: 'active' | 'suspended' | 'banned' | null
  suspended_until?: string | null
}

export interface BrokerProfile {
  id: string
  user_id: string
  parent_broker_id?: string | null
  office_name?: string | null
  address?: string | null
  district?: string | null
  is_owner?: boolean | null
  is_approved?: boolean | null
  is_verified?: boolean | null
  permissions?: Record<string, any> | null
  col_settings?: Record<string, any> | null
  alert_regions?: unknown
  metrics_updated_at?: string | null
  [k: string]: unknown
}

interface AuthState {
  user: SupabaseUser | null
  profile: Profile | null
  broker: BrokerProfile | null
  loading: boolean
  /** 명시적으로 다시 fetch. 프로필 수정 후 등에 사용. 사무소 등록·합류 뒤엔 await 하고 나서 이동할 것
   *  (안 그러면 화면에 든 broker=null 로 사무소 가드들이 등록 화면으로 되돌려 보낸다). */
  refresh: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

const CACHE_KEY = 'bbabang_auth_ctx_v1'

function readCache(): { user: SupabaseUser; profile: Profile | null; broker: BrokerProfile | null } | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const v = JSON.parse(raw)
    if (!v?.user?.id) return null
    return v
  } catch { return null }
}

function writeCache(user: SupabaseUser, profile: Profile | null, broker: BrokerProfile | null) {
  if (typeof window === 'undefined') return
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ user, profile, broker })) } catch {}
}

function clearCache() {
  if (typeof window === 'undefined') return
  try { localStorage.removeItem(CACHE_KEY); sessionStorage.removeItem(CACHE_KEY) } catch {}
}

/** ms 안에 안 끝나면 'timeout' 으로 푼다 — 로그아웃은 어느 단계가 멈춰도 화면은 넘어가야 한다 */
function within<T>(p: Promise<T>, ms: number): Promise<T | 'timeout'> {
  return Promise.race([p, new Promise<'timeout'>(r => setTimeout(() => r('timeout'), ms))])
}

/**
 * 이 기기의 Supabase 세션 쿠키(@supabase/ssr 기본 이름 sb-<ref>-auth-token, 길면 .0 .1 조각)를 직접 지운다.
 * signOut 이 멈추거나(잠금·네트워크) 실패하면 세션이 남아 '/' 로 가도 로그인된 채라서 마지막 수단으로 쓴다.
 */
function dropSessionCookies() {
  try {
    for (const part of document.cookie.split(';')) {
      const name = part.split('=')[0].trim()
      if (/^sb-.+-auth-token(-code-verifier)?(\.\d+)?$/.test(name)) document.cookie = `${name}=; path=/; max-age=0`
    }
  } catch {}
}

let leaving: Promise<void> | null = null

/**
 * 모든 로그아웃 버튼이 쓰는 공용 로그아웃. 순서가 중요하다.
 * 1) auth 캐시를 먼저 지운다 — 예전엔 SIGNED_OUT 콜백에만 맡겨, 콜백이 막히면 이전 사람의
 *    이름·사무소가 다음 로드까지 남았다.
 * 2) 이 기기 푸시 구독 행을 뗀다(세션이 살아 있어야 지울 수 있어 signOut 앞).
 * 3) signOut. 기본 scope 'local' — 'global' 은 그 계정의 모든 세션을 지워 PC 에서
 *    로그아웃하면 폰 PWA 까지 풀린다. 차단·탈퇴처럼 전 기기를 끊어야 할 때만 'global'.
 * 4) 이동. 앞 단계가 멈추거나 실패해도 시간을 정해 두고 넘어간다(전체 새로고침이라
 *    메모리에 남은 이전 사용자 상태·구독 채널도 함께 버려진다).
 * to=null 이면 이동하지 않는다(이미 가야 할 화면에 있을 때).
 */
export function signOutAndLeave(opts: { scope?: 'local' | 'global'; to?: string | null } = {}): Promise<void> {
  const { scope = 'local', to = '/' } = opts
  // 버튼을 두 번 눌러도 로그아웃은 한 번만. 이동 없는 로그아웃(정지 화면의 차단 처리) 중에
  // 누른 버튼은 그게 끝난 뒤 이동시킨다 — 같은 promise 만 돌려주면 버튼이 먹통이 된다.
  if (leaving) return leaving.then(() => { if (to !== null) window.location.href = to })
  leaving = (async () => {
    clearCache()
    try { await within(releasePushSubscription(), 2500) } catch {}
    let signedOut = false
    try {
      const r = await within(createClient().auth.signOut({ scope }), 3000)
      signedOut = r !== 'timeout' && !r.error
    } catch {}
    if (!signedOut) dropSessionCookies()
    clearCache()  // 기다리는 사이 다른 재조회가 캐시를 다시 썼을 수 있다
    // router.push 가 아니라 전체 새로고침이어야 이전 사용자 상태가 메모리에 안 남는다
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    if (to !== null) {
      window.location.href = to
      // 이동이 취소되면(작성 중 화면의 '머무르기') 버튼이 다시 듣게 풀어 둔다
      setTimeout(() => { leaving = null }, 4000)
    } else leaving = null
  })()
  return leaving
}

/**
 * 화면에 넣은 값과 새로 받은 값이 같은지 볼 때 쓰는 직렬화. 셋을 따로 견줘 바뀐 것만 넣는다.
 * - user.updated_at·last_sign_in_at 은 뺀다. Auth 서버가 토큰을 갱신할 때마다 updated_at 을
 *   올려서(한 시간마다), 넣으면 콜드스타트마다 늘 '바뀜'으로 나왔다. 앱에서 읽는 곳이 없다.
 * - broker 의 성과 지표(acceptance_rate·avg_response_hours·metrics_updated_at)도 뺀다.
 *   대시보드 패널이 갱신할 때마다 바뀌는데, 그걸로 화면 전체를 다시 그릴 일은 아니다.
 *   캐시에는 그대로 담기므로 다음에 켤 때 새 값이 들어간다.
 */
function snapshotKeys(user: SupabaseUser, profile: Profile | null, broker: BrokerProfile | null) {
  const { updated_at: _u, last_sign_in_at: _l, ...stableUser } = user
  let stableBroker: Record<string, unknown> | null = null
  if (broker) {
    const { acceptance_rate: _a, avg_response_hours: _h, metrics_updated_at: _m, ...rest } = broker
    stableBroker = rest
  }
  return { user: JSON.stringify(stableUser), profile: JSON.stringify(profile), broker: JSON.stringify(stableBroker) }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const supabase = useRef(createClient()).current
  const [user, setUser] = useState<SupabaseUser | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [broker, setBroker] = useState<BrokerProfile | null>(null)
  const [loading, setLoading] = useState(true)
  // 마지막으로 프로필까지 다 받아 둔 사용자 id — 리스너 클로저의 user 는 마운트 시점 값이라 못 쓴다
  const loadedUserId = useRef<string | null>(null)
  // 지금 화면에 들어가 있는 {user, profile, broker} 의 snapshotKeys.
  // 콜드스타트에 캐시로 그린 뒤 재조회 결과가 내용은 같아도 새 객체라, 그대로 넣으면
  // auth.user·auth.broker 에 걸린 effect 가 전부 다시 돌아 첫 데이터 로드가 두 번씩 났다.
  const applied = useRef<({ userId: string } & ReturnType<typeof snapshotKeys>) | null>(null)
  // 이 페이지에서 푸시 구독을 이미 다시 붙인 사용자 — 마운트·SIGNED_IN 이 겹쳐 두 번 보내지 않게
  const pushClaimedFor = useRef<string | null>(null)

  const fetchAll = useCallback(async () => {
    const { data } = await supabase.auth.getUser()
    if (!data.user) {
      loadedUserId.current = null
      applied.current = null
      setUser(null); setProfile(null); setBroker(null); setLoading(false)
      clearCache()
      return
    }
    loadedUserId.current = data.user.id
    // 다른 사람(또는 처음)이면 프로필을 기다리지 않고 user 부터 넣는다.
    // 같은 사람이면 이미 그려져 있으니 끝에서 통째로 비교한 뒤에만 넣는다.
    // 다른 사람이면 이전 사람의 프로필·사무소도 같이 비운다 — 안 비우면 user=B·broker=A 가
    // 잠깐 섞여 화면들이 A 의 사무소 id 로 조회를 시작했다.
    const switched = applied.current?.userId !== data.user.id
    if (switched) { setUser(data.user); setProfile(null); setBroker(null); setLoading(true) }
    // 한쪽 쿼리 실패해도 다른쪽은 진행 — 네트워크 일시 장애에 강건하게
    const [profileRes, brokerRes] = await Promise.all([
      supabase.from('profiles_visible').select('id,email,name,phone,role,created_at,notification_preferences,account_status,suspended_until').eq('id', data.user.id).maybeSingle()
        .then(r => r, () => ({ data: null, error: { message: 'fetch_failed' } })),
      supabase.from('broker_profiles').select('*').eq('user_id', data.user.id).maybeSingle()
        .then(r => r, () => ({ data: null, error: { message: 'fetch_failed' } })),
    ])
    // 그사이 로그아웃이 시작됐으면 이전 사람 정보를 화면·캐시에 다시 넣지 않는다
    if (leaving) return
    const p = profileRes.data as Profile | null
    const bp = brokerRes.data
    // 조회가 실패한 칸은 '없음'으로 덮어쓰지 않는다. 망이 잠깐 끊겨 broker=null 이 들어가면
    // 사무소 가드(매물·고객·업무일지…)가 멀쩡한 중개사를 빈 등록 양식으로 보냈고, 그 null 이 캐시에도 남았다.
    const profileFailed = !!profileRes.error
    const brokerFailed = !!brokerRes.error

    // 계정 상태 enforcement
    if (p?.account_status === 'banned') {
      // 차단된 계정 — 즉시 로그아웃. 여기만 global: 차단은 모든 기기에서 끊는 게 맞다
      // (사용자가 누르는 로그아웃은 local). 만료가 아니라 일부러 끊는 것이라
      // SIGNED_OUT 쪽의 '세션 만료 → 로그인 화면' 이동은 타지 않게 먼저 비워 둔다.
      loadedUserId.current = null
      applied.current = null
      const onSuspendedPage = typeof window !== 'undefined' && window.location.pathname.startsWith('/account-suspended')
      await signOutAndLeave({ scope: 'global', to: onSuspendedPage ? null : '/account-suspended?reason=banned' })
      return
    }
    if (p?.account_status === 'suspended') {
      const until = p.suspended_until ? new Date(p.suspended_until).getTime() : 0
      const now = Date.now()
      if (until > now) {
        if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/account-suspended') && !window.location.pathname.startsWith('/auth')) {
          window.location.href = `/account-suspended?reason=suspended&until=${encodeURIComponent(p.suspended_until ?? '')}`
        }
      }
      // 정지 기간이 지났으면 정상 진행 (어드민이 수동으로 active 처리해야 함)
    }

    const keys = snapshotKeys(data.user, p, bp as BrokerProfile | null)
    const prev = applied.current?.userId === data.user.id ? applied.current : null
    if (keys.user !== prev?.user) setUser(data.user)
    if (!profileFailed && keys.profile !== prev?.profile) setProfile(p)
    if (!brokerFailed && keys.broker !== prev?.broker) setBroker(bp as BrokerProfile | null)
    applied.current = {
      userId: data.user.id,
      user: keys.user,
      profile: profileFailed && prev ? prev.profile : keys.profile,
      broker: brokerFailed && prev ? prev.broker : keys.broker,
    }
    setLoading(false)
    // 새로 로그인한 사람에게 이 기기 푸시 구독을 다시 붙인다(로그아웃 때 떼어 둠). 실패해도 그만.
    // 같은 사람의 콜드스타트(캐시 있음)에는 switched 가 아니라 요청이 안 나간다.
    if (switched && pushClaimedFor.current !== data.user.id) {
      pushClaimedFor.current = data.user.id
      claimPushSubscription().catch(() => {})
    }
    // 캐시는 늘 새로 쓴다 — 다른 탭이 지웠을 수도 있고, 지표 같은 뺀 칸도 담아 둔다.
    // 단 한쪽이라도 조회가 실패했으면 쓰지 않는다(실패로 빈 값을 다음 콜드스타트까지 끌고 가지 않게).
    if (!profileFailed && !brokerFailed) writeCache(data.user, p, bp as BrokerProfile | null)
  }, [supabase])

  // 마운트: 캐시가 있으면 즉시 hydrate, 그 다음 백그라운드 재조회
  useEffect(() => {
    const cached = readCache()
    // 캐시가 '중개사인데 사무소 없음'이면 화면은 그려 두되 loading 은 새 값이 올 때까지 쥐고 있는다.
    // 사무소를 막 등록했거나(다른 탭·기기 포함) 등록 직후 새로고침하면 캐시만 옛것이라, 가드들이
    // 이 옛 값으로 먼저 판정해 매물목록·고객목록이 빈 등록 양식으로 튕겼다(다시 로그인해야 풀림).
    // 사무소가 있는 사람·고객은 예전처럼 캐시로 바로 연다 — 기다리는 건 등록 전 중개사뿐이다.
    const waitForFresh = !!cached && cached.profile?.role === 'broker' && !cached.broker
    if (cached) {
      applied.current = { userId: cached.user.id, ...snapshotKeys(cached.user, cached.profile, cached.broker) }
      setUser(cached.user)
      setProfile(cached.profile)
      setBroker(cached.broker)
      if (!waitForFresh) setLoading(false)
    }
    // 재조회가 통째로 실패해도 화면이 영영 로딩에 머물지는 않게.
    // 새 값을 기다리는 경우(등록 전 중개사)도 시간을 정해 둔다 — getUser 가 잠금에 걸려 안 돌아오면
    // (아래 onAuthStateChange 주석의 그 잠금) 등록 화면까지 스피너에 영영 갇혔다. 시간이 지나면
    // 가드·잠김 안내가 캐시 값으로라도 그리게 풀고, fetchAll 은 뒤늦게 끝나도 제 값을 넣는다.
    const first = fetchAll()
    if (waitForFresh) {
      within(first, 8000).then(r => { if (r === 'timeout') setLoading(false) }).catch(() => setLoading(false))
    } else {
      first.catch(() => setLoading(false))
    }

    let disposed = false
    // 이 콜백은 async 로 두지 않고 supabase 메서드도 여기서 기다리지 않는다. auth-js 는 잠금을 쥔 채
    // 콜백이 끝나길 기다리는데, 콜백이 getSession 처럼 같은 잠금을 쓰는 걸 기다리면 서로 기다려
    // signOut·토큰 갱신이 영영 안 끝났다(로그아웃 버튼 먹통, 그 탭의 모든 쿼리가 멈춤).
    // 할 일은 setTimeout 으로 넘겨 콜백은 바로 끝낸다.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        // 토큰 갱신이 일시적으로 실패해도(모바일 네트워크 단절, 여러 탭이 동시에
        // 갱신을 시도해 refresh token rotation이 엇갈림) SIGNED_OUT이 날아온다.
        // 곧바로 세션을 버리면 멀쩡한 로그인이 풀리므로, 잠깐 뒤 실제로 세션이
        // 없는지 다시 확인한 뒤에만 정리한다. 살아있으면 갱신에 성공한 것.
        setTimeout(() => { if (!disposed) confirmSignedOut() }, 1500)
      } else if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        // 폰은 앱으로 돌아올 때마다 SIGNED_IN 이, 한 시간마다 TOKEN_REFRESHED 가 온다.
        // 같은 사람이면 프로필은 그대로라 다시 받지 않는다 — 받으면 새 객체가 들어가
        // 화면 전체가 다시 그려지고, Auth 서버·DB 왕복 3번이 복귀할 때마다 붙었다.
        if (session?.user.id && session.user.id === loadedUserId.current) return
        setTimeout(() => { if (!disposed) fetchAll() }, 0)
      } else if (event === 'USER_UPDATED') {
        setTimeout(() => { if (!disposed) fetchAll() }, 0)
      }
    })

    async function confirmSignedOut() {
      const { data: { session } } = await supabase.auth.getSession()
      if (session) { fetchAll(); return }

      const hadUser = loadedUserId.current !== null  // 명시적 로그아웃 vs refresh token 만료 구분
      loadedUserId.current = null
      applied.current = null  // 같은 사람이 다시 로그인해도 비교에 걸려 빈 화면으로 남지 않게
      setUser(null); setProfile(null); setBroker(null)
      clearCache()
      // 사용자가 누른 로그아웃이면 이동은 signOutAndLeave 가 한다. 여기서 보내면 느린 망에서
      // '/' 로 가던 길이 '세션이 만료됐어요' 로그인 화면으로 덮어써졌다.
      if (leaving) return
      // refresh token 만료로 인한 자동 로그아웃이면 사용자에게 알림 + 로그인 페이지 이동.
      // 로그인 전용 화면(proxy 와 같은 목록)에서만 보낸다. 예전엔 여기만 따로 든 짧은 '공개'
      // 목록 밖이면 다 보내서, /explore·/jobs·공유 링크(/request/<id>, /r/<id>, /e/<token>)를
      // 보던 사람도 로그인 화면으로 튕겼다.
      // 공개 화면은 그 자리에서 다시 불러 손님 화면으로 그린다. 위에서 비운 상태만으론 부족하다 —
      // /request/<id> 처럼 서버가 그릴 때 받은 user 를 그대로 쓰는 화면은 로그인된 모양(로그아웃
      // 버튼·수락/거절·채팅창)으로 남고, 누르는 것마다 손님 권한으로 조용히 실패했다. 세션 쿠키는
      // 이미 없어서(getSession 이 null) 다시 불러도 hadUser 가 false 라 되풀이되지 않는다.
      if (hadUser && typeof window !== 'undefined') {
        const path = window.location.pathname
        if (isProtectedPath(path)) {
          const redirect = encodeURIComponent(path + window.location.search)
          window.location.href = `/auth/login?expired=1&redirect=${redirect}`
        } else {
          window.location.reload()
        }
      }
    }
    return () => { disposed = true; subscription.unsubscribe() }
  }, [fetchAll, supabase])

  return (
    <AuthContext.Provider value={{ user, profile, broker, loading, refresh: fetchAll }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthState {
  const v = useContext(AuthContext)
  if (!v) throw new Error('useAuth는 AuthProvider 내부에서만 호출하세요.')
  return v
}

/** AuthProvider 없는 곳(랜딩 등)에서도 안전하게 호출 — provider 없으면 null/loading=false 반환 */
export function useAuthOptional(): AuthState {
  const v = useContext(AuthContext)
  return v ?? { user: null, profile: null, broker: null, loading: false, refresh: async () => {} }
}
