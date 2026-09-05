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
  //
  // 하나라도 못 받으면 보내지 않는다. 전에는 조용히 빼고 나머지만 보냈는데,
  // 그러면 도면이 빠진 견적서가 나간 줄 아무도 모른다 — 거래처도, 보낸 쪽도.
  const extras: { filename: string; content: Buffer; contentType?: string }[] = []
  const { data: atts } = await supabase
    .from('estimate_attachments').select('path,filename,content_type').eq('estimate_id', id)
  for (const a of atts ?? []) {
    const { data: blob } = await supabase.storage.from('estimate-files').download(a.path)
    if (!blob) {
      return NextResponse.json(
        { ok: false, error: `첨부 "${a.filename}" 을 읽지 못해 보내지 않았습니다. 파일을 다시 올려 주세요.` },
        { status: 502 }
      )
    }
    extras.push({
      filename: a.filename,
      content: Buffer.from(await blob.arrayBuffer()),
      contentType: a.content_type ?? undefined,
    })
  }

  // 파일 하나하나는 10MB 로 막지만 합계는 막는 곳이 없었다. 네이버가 통째로
  // 거부하면 원인을 알기 어려운 오류만 남으므로 보내기 전에 걸러 준다.
  // (메일로 실어 나를 때 3분의 1쯤 불어나므로 한도보다 낮게 잡는다)
  const MAX_TOTAL = 15 * 1024 * 1024
  const totalSize = pdf.length + extras.reduce((s, x) => s + x.content.length, 0)
  if (totalSize > MAX_TOTAL) {
    return NextResponse.json({
      ok: false,
      error: `첨부가 너무 큽니다 (${(totalSize / 1024 / 1024).toFixed(1)}MB). `
        + '15MB 이하로 줄이거나, 큰 파일은 공유 링크로 보내세요.',
    }, { status: 400 })
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

  // 보낸 때는 늘 남기되, 상태는 아직 결론이 안 난 건에서만 '발송'으로 올린다.
  // 수주한 견적서를 거래처가 다시 달라고 해서 보내면 '발송'으로 되돌아가
  // 수주 실적에서 조용히 빠져 버렸다(회사별 수주율까지 틀어진다).
  const settled = estimate.status === 'won' || estimate.status === 'lost'
  await supabase.from('estimates')
    .update({
      sent_at: new Date().toISOString(),
      ...(settled ? {} : { status: 'sent' }),
    })
    .eq('id', id)

  return NextResponse.json({ ok: true, status: settled ? estimate.status : 'sent' })
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
