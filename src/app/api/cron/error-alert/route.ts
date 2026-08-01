import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@supabase/supabase-js'
import { sendEmail, emailTemplate } from '@/lib/email-server'

/**
 * 후속1: 미확인 에러 자동 알림.
 *
 * Vercel cron이 호출 (vercel.json). 매일 09:00.
 * - error_logs 중 alerted_at IS NULL 행 일괄 조회 (최근 24h)
 * - 동일 message로 그룹핑 (스팸 방지)
 * - 관리자 이메일(ALERT_EMAIL_TO 또는 EMAIL_FROM의 노트)로 요약 발송
 * - 발송된 행은 alerted_at = now() 마킹
 * - 90일 경과 로그 자동 DELETE (retention)
 */
export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? ''
  const secret = process.env.CRON_SECRET
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const alertTo = process.env.ALERT_EMAIL_TO ?? process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? 'bigodennn@gmail.com'
  if (!url || !serviceKey) {
    return NextResponse.json({ error: 'configuration_error' }, { status: 500 })
  }
  const supa = createServerClient(url, serviceKey)

  // 미알림 에러 (최근 24시간) — 너무 오래된 건 무시
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { data: unalerted, error } = await supa
    .from('error_logs')
    .select('id, message, source, url, user_agent, created_at')
    .is('alerted_at', null)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(200)

  if (error) {
    console.error('[error-alert] select failed', error)
    return NextResponse.json({ error: 'db_error' }, { status: 500 })
  }
  if (!unalerted || unalerted.length === 0) {
    return NextResponse.json({ ok: true, sent: 0, reason: 'no_new_errors' })
  }

  // message로 그룹핑
  const groups = new Map<string, { count: number; first: string; latest: string; sources: Set<string>; urls: Set<string> }>()
  for (const e of unalerted) {
    const key = (e.message ?? '').slice(0, 200)
    if (!groups.has(key)) {
      groups.set(key, { count: 0, first: e.created_at, latest: e.created_at, sources: new Set(), urls: new Set() })
    }
    const g = groups.get(key)!
    g.count++
    if (e.source) g.sources.add(e.source)
    if (e.url) g.urls.add(e.url)
    if (e.created_at > g.latest) g.latest = e.created_at
    if (e.created_at < g.first) g.first = e.created_at
  }

  // HTML 요약
  const rows = Array.from(groups.entries())
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 20)
    .map(([msg, g]) => `
      <tr style="border-bottom:1px solid #e5e7eb;">
        <td style="padding:8px 4px;font-weight:700;color:#dc2626;">${g.count}회</td>
        <td style="padding:8px 4px;font-family:monospace;font-size:13px;color:#111827;">${escapeHtml(msg)}</td>
        <td style="padding:8px 4px;font-size:11px;color:#6b7280;">
          ${Array.from(g.sources).join(', ')}<br>
          ${new Date(g.latest).toLocaleString('ko-KR')}
        </td>
      </tr>`).join('')

  const bodyHtml = `
    <p>최근 24시간 내 발생한 미확인 클라이언트 에러 <strong>${unalerted.length}건</strong> (${groups.size}종)</p>
    <table style="width:100%;border-collapse:collapse;margin-top:12px;">
      <thead>
        <tr style="border-bottom:2px solid #d1d5db;text-align:left;">
          <th style="padding:8px 4px;font-size:12px;color:#374151;">횟수</th>
          <th style="padding:8px 4px;font-size:12px;color:#374151;">메시지</th>
          <th style="padding:8px 4px;font-size:12px;color:#374151;">소스·최근</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <p style="margin-top:16px;font-size:13px;color:#6b7280;">
      관리자 페이지 → 에러 로그에서 상세 확인 후 처리해주세요.
    </p>`

  const html = emailTemplate({
    title: `⚠️ 부소장 에러 ${unalerted.length}건 발생`,
    preview: `${groups.size}종 ${unalerted.length}건의 미확인 에러가 누적됐어요`,
    bodyHtml,
    ctaLabel: '에러 로그 확인',
    ctaUrl: 'https://bbabang.vercel.app/admin/errors',
  })

  const result = await sendEmail({
    to: alertTo,
    subject: `[부소장 알림] 에러 ${unalerted.length}건 (${groups.size}종)`,
    html,
  })

  if (!result.ok) {
    console.error('[error-alert] send failed', result.error)
    return NextResponse.json({ ok: false, error: result.error }, { status: 500 })
  }

  // 발송 완료 표시
  const ids = unalerted.map(e => e.id)
  await supa.from('error_logs').update({ alerted_at: new Date().toISOString() }).in('id', ids)

  // 보관 정책: 90일 경과 로그 자동 삭제 (무한 적재 방지)
  const retentionCutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
  const { count: deletedCount } = await supa
    .from('error_logs')
    .delete({ count: 'exact' })
    .lt('created_at', retentionCutoff)

  return NextResponse.json({
    ok: true,
    errors: unalerted.length,
    groups: groups.size,
    sentTo: alertTo,
    purged: deletedCount ?? 0,
  })
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]!))
}
