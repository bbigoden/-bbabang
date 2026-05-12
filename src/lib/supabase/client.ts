import { createBrowserClient } from '@supabase/ssr'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co'
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-anon-key-placeholder-anon-key-placeholder'

// 브라우저에서 단 하나의 인스턴스만 사용 (채널 충돌 방지)
let _client: ReturnType<typeof createBrowserClient> | null = null

export function createClient() {
  if (typeof window === 'undefined') {
    // SSR 환경에서는 매번 새로 생성
    return createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  }
  if (!_client) {
    _client = createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  }
  return _client
}
