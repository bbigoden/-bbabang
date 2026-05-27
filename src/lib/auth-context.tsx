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
 * - sessionStorage 캐시로 새 탭/리로드 시 즉시 hydrate (round-trip 없이 화면 그림)
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
    const raw = sessionStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const v = JSON.parse(raw)
    if (!v?.user?.id) return null
    return v
  } catch { return null }
}

function writeCache(user: SupabaseUser, profile: Profile | null, broker: BrokerProfile | null) {
  if (typeof window === 'undefined') return
  try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ user, profile, broker })) } catch {}
}

function clearCache() {
  if (typeof window === 'undefined') return
  try { sessionStorage.removeItem(CACHE_KEY) } catch {}
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const supabase = useRef(createClient()).current
  const [user, setUser] = useState<SupabaseUser | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [broker, setBroker] = useState<BrokerProfile | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchAll = useCallback(async () => {
    const { data } = await supabase.auth.getUser()
    if (!data.user) {
      setUser(null); setProfile(null); setBroker(null); setLoading(false)
      clearCache()
      return
    }
    setUser(data.user)
    // 한쪽 쿼리 실패해도 다른쪽은 진행 — 네트워크 일시 장애에 강건하게
    const [profileRes, brokerRes] = await Promise.all([
      supabase.from('profiles').select('id,email,name,phone,role,created_at,notification_preferences,account_status,suspended_until').eq('id', data.user.id).maybeSingle()
        .then(r => r, () => ({ data: null })),
      supabase.from('broker_profiles').select('*').eq('user_id', data.user.id).maybeSingle()
        .then(r => r, () => ({ data: null })),
    ])
    const p = profileRes.data as Profile | null
    const bp = brokerRes.data

    // 계정 상태 enforcement
    if (p?.account_status === 'banned') {
      // 차단된 계정 — 즉시 로그아웃
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

    setProfile(p)
    setBroker(bp as BrokerProfile | null)
    setLoading(false)
    writeCache(data.user, p, bp as BrokerProfile | null)
  }, [supabase])

  // 마운트: 캐시가 있으면 즉시 hydrate, 그 다음 백그라운드 재조회
  useEffect(() => {
    const cached = readCache()
    if (cached) {
      setUser(cached.user)
      setProfile(cached.profile)
      setBroker(cached.broker)
      setLoading(false)
    }
    fetchAll()

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        const hadUser = user !== null  // 명시적 로그아웃 vs refresh token 만료 구분
        setUser(null); setProfile(null); setBroker(null)
        clearCache()
        // refresh token 만료로 인한 자동 로그아웃이면 사용자에게 알림 + 로그인 페이지 이동
        // 단, 이미 /auth/* 페이지거나 공개 페이지면 그냥 둠
        if (hadUser && typeof window !== 'undefined') {
          const path = window.location.pathname
          // /broker/[id] 공개 프로필만 허용 (보호 경로 /broker/properties 등은 prefix로 빠지지 않도록)
          // /broker/[id]는 정확히 한 세그먼트의 ID여야 함 — /broker/abc, /broker/123 OK
          // /broker/properties, /broker/customers 등은 보호 경로
          const BROKER_PROTECTED_PATHS = [
            '/broker/properties', '/broker/customers', '/broker/diary', '/broker/team',
            '/broker/settings', '/broker/resources', '/broker/chats', '/broker/trash',
            '/broker/register', '/broker/settlement',
          ]
          const isProtectedBrokerPath = BROKER_PROTECTED_PATHS.some(p => path === p || path.startsWith(p + '/'))
          const isPublic = !isProtectedBrokerPath && (
            path.startsWith('/auth/') || path === '/' || path.startsWith('/brokers') ||
            path.startsWith('/broker/') || path.startsWith('/property/') ||
            path.startsWith('/regions') || path.startsWith('/terms') || path.startsWith('/privacy') ||
            path.startsWith('/support')
          )
          if (!isPublic) {
            const redirect = encodeURIComponent(path + window.location.search)
            window.location.href = `/auth/login?expired=1&redirect=${redirect}`
          }
        }
      } else if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
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
