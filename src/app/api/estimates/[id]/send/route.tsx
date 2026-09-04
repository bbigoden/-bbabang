/**
 * 견적서 메일 발송 (네이버 SMTP).
 *
 * 시스템 알림용 Resend와 분리되어 있다 — 견적서는 본인 메일 주소로 나가야
 * 거래처가 그대로 답장할 수 있기 때문. 계정·앱 비밀번호는 estimate_mail_settings에
 * 사용자별로 저장되고, RLS 덕분에 이 라우트는 본인 것만 읽는다.
 */

import { NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import nodemailer from 'nodemailer'
import { createClient } from '@/lib/supabase/server'
import { checkRateLimit } from '@/lib/rate-limit'
import { EstimateDocument } from '@/lib/estimate-pdf'
import { loadEstimate, pdfFileName } from '../shared'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface Body {
  to?: string
  cc?: string
  subject?: string
  body?: string
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: '로그인이 필요합니다' }, { status: 401 })

  // 네이버 SMTP를 부르는 라우트다. 폭주하면 계정이 잠길 수 있어 strict(fail-closed)로 막는다.
  if (!await checkRateLimit(`user:${user.id}:estimate-send`, 20, 3600, true)) {
    return NextResponse.json(
      { ok: false, error: '메일 발송이 너무 잦습니다. 잠시 후 다시 시도하세요.' },
      { status: 429 }
    )
  }

  const { to, cc, subject, body }: Body = await req.json().catch(() => ({}))
  if (!to?.trim()) {
    return NextResponse.json({ ok: false, error: '받는 사람 주소가 없습니다' }, { status: 400 })
  }

  const loaded = await loadEstimate(supabase, id)
  if (!loaded) return NextResponse.json({ ok: false, error: '견적서를 찾을 수 없습니다' }, { status: 404 })
  const { estimate, items, company, stampUrl } = loaded

  // 메일 설정 (본인 것만 RLS로 걸러져 옴)
  const { data: settings } = await supabase
    .from('estimate_mail_settings')
    .select('*')
    .eq('owner_broker_id', estimate.owner_broker_id ?? '')
    .maybeSingle()

  if (!settings?.smtp_user || !settings?.smtp_pass) {
    return NextResponse.json(
      { ok: false, error: '메일 설정이 없습니다. 설정에서 네이버 계정과 앱 비밀번호를 등록하세요.' },
      { status: 400 }
    )
  }

  const pdf = await renderToBuffer(
    <EstimateDocument estimate={estimate} items={items} company={company} stampUrl={stampUrl} />
  )

  // 붙여둔 도면·현장사진을 같이 보낸다 (비공개 버킷이라 서버에서 직접 내려받는다)
  const extras: { filename: string; content: Buffer; contentType?: string }[] = []
  const { data: atts } = await supabase
    .from('estimate_attachments').select('path,filename,content_type').eq('estimate_id', id)
  for (const a of atts ?? []) {
    const { data: blob } = await supabase.storage.from('estimate-files').download(a.path)
    if (!blob) continue
    extras.push({
      filename: a.filename,
      content: Buffer.from(await blob.arrayBuffer()),
      contentType: a.content_type ?? undefined,
    })
  }

  const transporter = nodemailer.createTransport({
    host: 'smtp.naver.com',
    port: 465,
    secure: true,
    auth: { user: settings.smtp_user, pass: settings.smtp_pass },
  })

  const fromName = settings.from_name || company?.name || ''
  const ccList = [cc, settings.cc].filter(Boolean).join(',')

  let ok = false
  let error: string | null = null
  try {
    await transporter.sendMail({
      // 네이버는 From 주소가 인증 계정과 같아야 발송을 허용한다
      from: fromName ? `"${fromName}" <${settings.smtp_user}>` : settings.smtp_user,
      to,
      cc: ccList || undefined,
      bcc: settings.bcc || undefined,
      replyTo: settings.smtp_user,
      subject: subject || `견적서 송부 (${estimate.estimate_no})`,
      text: body || '',
      attachments: [
        { filename: pdfFileName(estimate), content: Buffer.from(pdf), contentType: 'application/pdf' },
        ...extras,
      ],
    })
    ok = true
  } catch (e) {
    error = e instanceof Error ? e.message : '발송 실패'
  }

  // 성공·실패 모두 이력에 남긴다 (인증 실패 원인 추적용)
  await supabase.from('estimate_sends').insert({
    estimate_id: id, to_email: to, cc: ccList || null,
    subject: subject ?? null, body: body ?? null, ok, error,
  })

  if (!ok) {
    return NextResponse.json({ ok: false, error: friendlyError(error) }, { status: 502 })
  }

  await supabase.from('estimates')
    .update({ status: 'sent', sent_at: new Date().toISOString() })
    .eq('id', id)

  return NextResponse.json({ ok: true })
}

/** SMTP 원문 오류를 실무에서 알아볼 수 있는 문장으로 */
function friendlyError(raw: string | null): string {
  const m = raw ?? ''
  if (/auth|535|credential/i.test(m)) {
    return '네이버 로그인에 실패했습니다. 메일 설정의 주소·앱 비밀번호와, 네이버 메일의 IMAP/SMTP 사용 설정을 확인하세요.'
  }
  if (/ETIMEDOUT|ECONNREFUSED|ENOTFOUND/i.test(m)) {
    return '네이버 메일 서버에 연결하지 못했습니다. 잠시 후 다시 시도하세요.'
  }
  if (/recipient|550|relay/i.test(m)) {
    return '받는 사람 주소를 확인하세요. 네이버가 수신을 거부했습니다.'
  }
  return m || '메일을 보내지 못했습니다'
}
