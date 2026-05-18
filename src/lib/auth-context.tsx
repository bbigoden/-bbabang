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
    const [{ data: p }, { data: bp }] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', data.user.id).maybeSingle(),
      supabase.from('broker_profiles').select('*').eq('user_id', data.user.id).maybeSingle(),
    ])
    setProfile(p as Profile | null)
    setBroker(bp as BrokerProfile | null)
    setLoading(false)
    writeCache(data.user, p as Profile | null, bp as BrokerProfile | null)
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
        setUser(null); setProfile(null); setBroker(null)
        clearCache()
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
