'use client'

/**
 * 네이버 메일(SMTP) 설정 + 메일 문구 템플릿.
 * 앱 비밀번호는 저장 후 화면에 다시 표시하지 않는다 (등록 여부만 보여줌).
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/components/toast'
import { CheckCircle2, ExternalLink, Send, Info } from 'lucide-react'
import { DEFAULT_BODY, DEFAULT_SUBJECT } from '@/lib/estimate'

const FIELD = 'w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-200 dark:border-gray-800 dark:bg-gray-900 dark:text-white'
const LABEL = 'mb-1 block text-xs font-semibold text-gray-500 dark:text-gray-400'

export function MailTab({ brokerId }: { brokerId: string }) {
  const toast = useToast()
  const supabase = useMemo(() => createClient(), [])

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [hasPass, setHasPass] = useState(false)

  const [user, setUser] = useState('')
  const [pass, setPass] = useState('')
  const [fromName, setFromName] = useState('')
  const [cc, setCc] = useState('')
  const [bcc, setBcc] = useState('')
  const [subject, setSubject] = useState(DEFAULT_SUBJECT)
  const [body, setBody] = useState(DEFAULT_BODY)

  const load = useCallback(async () => {
    const { data } = await supabase.from('estimate_mail_settings')
      .select('*').eq('owner_broker_id', brokerId).maybeSingle()
    if (data) {
      setUser(data.smtp_user ?? '')
      setHasPass(!!data.smtp_pass)
      setFromName(data.from_name ?? '')
      setCc(data.cc ?? '')
      setBcc(data.bcc ?? '')
      setSubject(data.subject_template || DEFAULT_SUBJECT)
      setBody(data.body_template || DEFAULT_BODY)
    }
    setLoading(false)
  }, [brokerId, supabase])

  useEffect(() => { load() }, [load])

  const save = async () => {
    setSaving(true)
    const payload: Record<string, unknown> = {
      owner_broker_id: brokerId,
      smtp_user: user.trim() || null,
      from_name: fromName.trim() || null,
      cc: cc.trim() || null,
      bcc: bcc.trim() || null,
      subject_template: subject,
      body_template: body,
      updated_at: new Date().toISOString(),
    }
    // 비워둔 채 저장하면 기존 비밀번호를 유지한다
    if (pass.trim()) payload.smtp_pass = pass.trim()

    const { error } = await supabase.from('estimate_mail_settings')
      .upsert(payload, { onConflict: 'owner_broker_id' })
    setSaving(false)
    if (error) { toast.error('저장하지 못했습니다'); return }
    if (pass.trim()) { setHasPass(true); setPass('') }
    toast.success('저장했습니다')
  }

  const sendTest = async () => {
    setTesting(true)
    try {
      const res = await fetch('/api/estimates/mail-test', { method: 'POST' })
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json.error || '발송 실패')
      toast.success('테스트 메일을 보냈습니다. 받은편지함을 확인하세요.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '테스트 발송에 실패했습니다')
    } finally {
      setTesting(false)
    }
  }

  if (loading) return <p className="py-8 text-center text-sm text-gray-500">불러오는 중…</p>

  return (
    <div className="max-w-3xl space-y-5">
      {/* 안내 */}
      <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-4 text-sm text-blue-900 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-200">
        <div className="mb-2 flex items-center gap-2 font-bold">
          <Info className="h-4 w-4" />네이버 메일로 보내기 전 준비
        </div>
        <ol className="ml-4 list-decimal space-y-1 leading-relaxed">
          <li>네이버 메일 → 환경설정 → <b>POP3/IMAP 설정</b>에서 <b>IMAP/SMTP 사용함</b>으로 변경</li>
          <li>2단계 인증을 쓰고 있다면 네이버 <b>내정보 → 보안설정 → 애플리케이션 비밀번호</b>에서 발급</li>
          <li>아래에 메일 주소와 그 비밀번호를 입력하고 저장</li>
        </ol>
        <a href="https://mail.naver.com" target="_blank" rel="noreferrer"
          className="mt-2 inline-flex items-center gap-1 text-xs font-semibold underline">
          네이버 메일 열기 <ExternalLink className="h-3 w-3" />
        </a>
      </div>

      {/* 계정 */}
      <section className="rounded-2xl border border-gray-100 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
        <h2 className="mb-3 text-sm font-bold text-gray-900 dark:text-white">발신 계정</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={LABEL} htmlFor="m-user">네이버 메일 주소</label>
            <input id="m-user" type="email" value={user} onChange={e => setUser(e.target.value)}
              placeholder="myid@naver.com" className={FIELD} />
          </div>
          <div>
            <label className={LABEL} htmlFor="m-pass">
              앱 비밀번호 {hasPass && <span className="text-emerald-600">· 등록됨</span>}
            </label>
            <input id="m-pass" type="password" value={pass} onChange={e => setPass(e.target.value)}
              placeholder={hasPass ? '바꿀 때만 입력하세요' : '앱 비밀번호'}
              autoComplete="new-password" className={FIELD} />
          </div>
          <div>
            <label className={LABEL} htmlFor="m-from">발신자 표시 이름</label>
            <input id="m-from" value={fromName} onChange={e => setFromName(e.target.value)}
              placeholder="예: ○○건설 김대표" className={FIELD} />
          </div>
          <div>
            <label className={LABEL} htmlFor="m-cc">항상 참조 (선택)</label>
            <input id="m-cc" value={cc} onChange={e => setCc(e.target.value)} className={FIELD} />
          </div>
          <div>
            <label className={LABEL} htmlFor="m-bcc">항상 숨은참조 (선택)</label>
            <input id="m-bcc" value={bcc} onChange={e => setBcc(e.target.value)}
              placeholder="본인 주소를 넣으면 보낸 기록이 남습니다" className={FIELD} />
          </div>
        </div>

        {hasPass && (
          <div className="mt-3 flex items-center gap-2">
            <button onClick={sendTest} disabled={testing}
              className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300">
              <Send className="h-4 w-4" />{testing ? '보내는 중…' : '나에게 테스트 발송'}
            </button>
            <span className="text-xs text-gray-400">설정이 맞는지 본인 주소로 한 통 보내봅니다.</span>
          </div>
        )}
      </section>

      {/* 문구 */}
      <section className="rounded-2xl border border-gray-100 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
        <h2 className="mb-1 text-sm font-bold text-gray-900 dark:text-white">메일 문구</h2>
        <p className="mb-3 text-xs text-gray-500">
          {'{거래처명} {담당자} {공사명} {회사명} {발신자} {견적번호} {합계}'} 는 발송할 때 자동으로 채워집니다.
        </p>
        <div className="space-y-3">
          <div>
            <label className={LABEL} htmlFor="m-subj">제목</label>
            <input id="m-subj" value={subject} onChange={e => setSubject(e.target.value)} className={FIELD} />
          </div>
          <div>
            <label className={LABEL} htmlFor="m-body">본문</label>
            <textarea id="m-body" rows={10} value={body} onChange={e => setBody(e.target.value)}
              className={`${FIELD} resize-y leading-relaxed`} />
          </div>
          <button onClick={() => { setSubject(DEFAULT_SUBJECT); setBody(DEFAULT_BODY) }}
            className="text-xs font-semibold text-gray-400 hover:text-blue-600">
            기본 문구로 되돌리기
          </button>
        </div>
      </section>

      <div className="flex items-center gap-3">
        <button onClick={save} disabled={saving}
          className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50">
          {saving ? '저장 중…' : '저장'}
        </button>
        {hasPass && (
          <span className="flex items-center gap-1 text-xs text-emerald-600">
            <CheckCircle2 className="h-4 w-4" />발송 준비됨
          </span>
        )}
      </div>
    </div>
  )
}
