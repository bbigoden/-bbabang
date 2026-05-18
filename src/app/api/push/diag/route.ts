import { NextResponse } from 'next/server'

// 임시 진단용 — 환경변수 boolean만 반환 (값은 노출하지 않음)
export async function GET() {
  return NextResponse.json({
    NEXT_PUBLIC_VAPID_PUBLIC_KEY: !!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY: !!process.env.VAPID_PRIVATE_KEY,
    VAPID_SUBJECT: !!process.env.VAPID_SUBJECT,
    SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
  })
}
