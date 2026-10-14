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
  /** 명시적으로 다시 fetch. 프로필 수정 후 등에 사용. */
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
    if (applied.current?.userId !== data.user.id) setUser(data.user)
    // 한쪽 쿼리 실패해도 다른쪽은 진행 — 네트워크 일시 장애에 강건하게
    const [profileRes, brokerRes] = await Promise.all([
      supabase.from('profiles_visible').select('id,email,name,phone,role,created_at,notification_preferences,account_status,suspended_until').eq('id', data.user.id).maybeSingle()
        .then(r => r, () => ({ data: null })),
      supabase.from('broker_profiles').select('*').eq('user_id', data.user.id).maybeSingle()
        .then(r => r, () => ({ data: null })),
    ])
    const p = profileRes.data as Profile | null
    const bp = brokerRes.data

    // 계정 상태 enforcement
    if (p?.account_status === 'banned') {
      // 차단된 계정 — 즉시 로그아웃. 여기만 기본 scope(global) 유지:
      // 차단은 모든 기기에서 끊는 게 맞다(사용자가 누르는 로그아웃은 local).
      await supabase.auth.signOut()
      if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/account-suspended')) {
        window.location.href = '/account-suspended?reason=banned'
      }
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
    if (keys.profile !== prev?.profile) setProfile(p)
    if (keys.broker !== prev?.broker) setBroker(bp as BrokerProfile | null)
    applied.current = { userId: data.user.id, ...keys }
    setLoading(false)
    // 캐시는 늘 새로 쓴다 — 다른 탭이 지웠을 수도 있고, 지표 같은 뺀 칸도 담아 둔다
    writeCache(data.user, p, bp as BrokerProfile | null)
  }, [supabase])

  // 마운트: 캐시가 있으면 즉시 hydrate, 그 다음 백그라운드 재조회
  useEffect(() => {
    const cached = readCache()
    if (cached) {
      applied.current = { userId: cached.user.id, ...snapshotKeys(cached.user, cached.profile, cached.broker) }
      setUser(cached.user)
      setProfile(cached.profile)
      setBroker(cached.broker)
      setLoading(false)
    }
    fetchAll()

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_OUT') {
        // 토큰 갱신이 일시적으로 실패해도(모바일 네트워크 단절, 여러 탭이 동시에
        // 갱신을 시도해 refresh token rotation이 엇갈림) SIGNED_OUT이 날아온다.
        // 곧바로 세션을 버리면 멀쩡한 로그인이 풀리므로, 잠깐 뒤 실제로 세션이
        // 없는지 다시 확인한 뒤에만 정리한다. 살아있으면 갱신에 성공한 것.
        await new Promise(r => setTimeout(r, 1500))
        const { data: { session } } = await supabase.auth.getSession()
        if (session) { fetchAll(); return }

        const hadUser = loadedUserId.current !== null  // 명시적 로그아웃 vs refresh token 만료 구분
        loadedUserId.current = null
        applied.current = null  // 같은 사람이 다시 로그인해도 비교에 걸려 빈 화면으로 남지 않게
        setUser(null); setProfile(null); setBroker(null)
        clearCache()
        // refresh token 만료로 인한 자동 로그아웃이면 사용자에게 알림 + 로그인 페이지 이동
        // 단, 이미 /auth/* 페이지거나 공개 페이지면 그냥 둠
        if (hadUser && typeof window !== 'undefined') {
          const path = window.location.pathname
          // 중개사 공개 프로필(/broker/[id])·둘러보기(/brokers) 페이지 제거됨
          // → /broker/* 는 모두 보호 경로(중개사 전용)이므로 공개 목록에서 제외
          const isPublic = (
            path.startsWith('/auth/') || path === '/' ||
            path.startsWith('/property/') ||
            path.startsWith('/regions') || path.startsWith('/terms') || path.startsWith('/privacy') ||
            path.startsWith('/support')
          )
          if (!isPublic) {
            const redirect = encodeURIComponent(path + window.location.search)
            window.location.href = `/auth/login?expired=1&redirect=${redirect}`
          }
        }
      } else if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        // 폰은 앱으로 돌아올 때마다 SIGNED_IN 이, 한 시간마다 TOKEN_REFRESHED 가 온다.
        // 같은 사람이면 프로필은 그대로라 다시 받지 않는다 — 받으면 새 객체가 들어가
        // 화면 전체가 다시 그려지고, Auth 서버·DB 왕복 3번이 복귀할 때마다 붙었다.
        if (session?.user.id && session.user.id === loadedUserId.current) return
        fetchAll()
      } else if (event === 'USER_UPDATED') {
        fetchAll()
      }
    })
    return () => subscription.unsubscribe()
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
