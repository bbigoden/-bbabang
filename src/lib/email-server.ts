/**
 * 서버 사이드 이메일 발송 (Resend).
 * RESEND_API_KEY 환경변수 필요.
 * 발신자: EMAIL_FROM 환경변수 (예: '부소장 <noreply@bbabang.kr>')
 * 미설정 시 Resend 기본 onboarding@resend.dev로 발신 (테스트용, 본인에게만 수신).
 */
import { Resend } from 'resend'

interface SendEmailParams {
  to: string
  subject: string
  html: string
  text?: string
}

export async function sendEmail(params: SendEmailParams): Promise<{ ok: boolean; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    return { ok: false, error: 'RESEND_API_KEY 미설정' }
  }
  const from = process.env.EMAIL_FROM || 'onboarding@resend.dev'

  const resend = new Resend(apiKey)
  try {
    const { data, error } = await resend.emails.send({
      from,
      to: params.to,
      subject: params.subject,
      html: params.html,
      ...(params.text && { text: params.text }),
    })
    if (error) return { ok: false, error: error.message }
    return { ok: !!data }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'unknown'
    return { ok: false, error: msg }
  }
}

/**
 * 기본 이메일 템플릿 — 부소장 브랜드.
 */
export function emailTemplate(opts: {
  title: string
  preview?: string
  bodyHtml: string
  ctaLabel?: string
  ctaUrl?: string
}): string {
  const base = 'https://bbabang.vercel.app'
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${opts.title}</title>
</head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Pretendard',sans-serif;">
${opts.preview ? `<div style="display:none;font-size:1px;color:#f9fafb;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${opts.preview}</div>` : ''}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f9fafb;padding:32px 16px;">
  <tr><td align="center">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px;background:#fff;border-radius:16px;box-shadow:0 1px 3px rgba(0,0,0,0.05);overflow:hidden;">
      <tr><td style="background:linear-gradient(135deg,#14274e 0%,#2c5095 100%);padding:24px 32px;">
        <a href="${base}" style="color:#fff;text-decoration:none;font-size:22px;font-weight:900;letter-spacing:-0.5px;">부소<span style="color:#b1c2df;">장</span></a>
      </td></tr>
      <tr><td style="padding:32px;">
        <h1 style="margin:0 0 16px;font-size:20px;font-weight:700;color:#111827;line-height:1.4;">${opts.title}</h1>
        <div style="font-size:15px;color:#4b5563;line-height:1.7;">${opts.bodyHtml}</div>
        ${opts.ctaUrl && opts.ctaLabel ? `
        <div style="margin-top:24px;text-align:center;">
          <a href="${opts.ctaUrl}" style="display:inline-block;background:#14274e;color:#fff;font-weight:700;font-size:15px;padding:12px 28px;border-radius:12px;text-decoration:none;">${opts.ctaLabel}</a>
        </div>` : ''}
      </td></tr>
      <tr><td style="border-top:1px solid #f3f4f6;padding:20px 32px;font-size:12px;color:#9ca3af;text-align:center;">
        이 메일은 부소장 알림 설정에 따라 발송됐어요.<br>
        <a href="${base}/settings/notifications" style="color:#6b7280;text-decoration:underline;">알림 설정 변경</a> · <a href="${base}" style="color:#6b7280;text-decoration:underline;">bbabang.vercel.app</a>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`
}
