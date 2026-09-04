/**
 * 메일 설정 확인용 테스트 발송 — 본인 주소로 한 통 보낸다.
 * 견적서를 실제로 보내기 전에 아이디·앱 비밀번호가 맞는지 확인하는 용도.
 */

import { NextResponse } from 'next/server'
import nodemailer from 'nodemailer'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: '로그인이 필요합니다' }, { status: 401 })

  // RLS가 본인 행만 돌려준다
  const { data: settings } = await supabase
    .from('estimate_mail_settings')
    .select('smtp_user,smtp_pass,from_name')
    .maybeSingle()

  if (!settings?.smtp_user || !settings?.smtp_pass) {
    return NextResponse.json({ ok: false, error: '메일 주소와 앱 비밀번호를 먼저 저장하세요' }, { status: 400 })
  }

  const transporter = nodemailer.createTransport({
    host: 'smtp.naver.com',
    port: 465,
    secure: true,
    auth: { user: settings.smtp_user, pass: settings.smtp_pass },
  })

  try {
    await transporter.sendMail({
      from: settings.from_name ? `"${settings.from_name}" <${settings.smtp_user}>` : settings.smtp_user,
      to: settings.smtp_user,
      subject: '[부소장] 견적서 메일 설정 테스트',
      text: '이 메일이 도착했다면 견적서 메일 발송 설정이 정상입니다.\n\n부소장 견적서',
    })
    return NextResponse.json({ ok: true })
  } catch (e) {
    const msg = e instanceof Error ? e.message : ''
    const friendly = /auth|535|credential/i.test(msg)
      ? '네이버 로그인에 실패했습니다. 주소·앱 비밀번호와 IMAP/SMTP 사용 설정을 확인하세요.'
      : msg || '테스트 발송에 실패했습니다'
    return NextResponse.json({ ok: false, error: friendly }, { status: 502 })
  }
}
