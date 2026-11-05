import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { deleteOrphanPhotos, shrinkBigPhotos } from '@/lib/storage-tidy'

/**
 * 매물사진 정리 — CRON_SECRET 으로만 부른다(storage-tidy.ts 설명 참고).
 *
 *   ?mode=orphans            고아 사진 지우기. Vercel cron 이 매일 부른다(7일 지난 것만)
 *   ?mode=shrink&limit=40    큰 사진 줄여 덮어쓰기. 한 번에 limit 장 — 남은 장수를 돌려주니 0 될 때까지 다시 부른다
 *   &dry=1                   지우거나 덮어쓰지 않고 셈만
 */
export const maxDuration = 300

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return NextResponse.json({ error: 'configuration_error' }, { status: 500 })
  const supa = createClient(url, key)

  const q = req.nextUrl.searchParams
  const dry = q.get('dry') === '1'
  try {
    if (q.get('mode') === 'shrink') {
      const limit = Math.min(100, Math.max(1, Number(q.get('limit')) || 40))
      return NextResponse.json({ ok: true, mode: 'shrink', ...(await shrinkBigPhotos(supa, { dry, limit })) })
    }
    const minAgeDays = Math.max(1, Number(q.get('days')) || 7)
    return NextResponse.json({ ok: true, mode: 'orphans', minAgeDays, ...(await deleteOrphanPhotos(supa, { dry, minAgeDays })) })
  } catch (e) {
    console.error('[admin/storage-tidy]', e)
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
