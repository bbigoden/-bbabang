'use client'

/**
 * 메일 발송 확인창.
 * 설정에 저장된 제목·본문 템플릿을 치환해 채워두고, 보내기 전에 손볼 수 있게 한다.
 * 실제 발송(SMTP)과 PDF 첨부는 서버 라우트가 처리한다.
 */

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/lib/auth-context'
import { useToast } from '@/components/toast'
import { X, Mail, Paperclip, AlertTriangle } from 'lucide-react'
import {
  DEFAULT_BODY, DEFAULT_SUBJECT, fillTemplate, fmtComma, type Estimate,
} from '@/lib/estimate'

const FIELD = 'w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-200 dark:border-gray-800 dark:bg-gray-900 dark:text-white'
const LABEL = 'mb-1 block text-xs font-semibold text-gray-500 dark:text-gray-400'

interface Props {
  estimate: Estimate
  onClose: () => void
  onSent: () => void
}

export function SendMailDialog({ estimate, onClose, onSent }: Props) {
  const toast = useToast()
  const supabase = useMemo(() => createClient(), [])
  const { broker } = useAuth()

  const [ready, setReady] = useState(false)
  const [configured, setConfigured] = useState(false)
  const [to, setTo] = useState(estimate.client_email ?? '')
  const [cc, setCc] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)

  useEffect(() => {
    if (!broker?.id) return
    let alive = true
    ;(async () => {
      const { data } = await supabase
        .from('estimate_mail_settings')
        .select('smtp_user,from_name,cc,subject_template,body_template')
        .eq('owner_broker_id', broker.id)
        .maybeSingle()

      if (!alive) return
      const company = estimate.company_snapshot
      const vars: Record<string, string> = {
        거래처명: estimate.client_name ?? '',
        담당자: estimate.client_contact ?? '',
        공사명: estimate.project_name ?? '',
        회사명: company?.name ?? '',
        발신자: data?.from_name ?? company?.ceo ?? '',
        견적번호: estimate.estimate_no,
        합계: fmtComma(estimate.total),
      }
      setConfigured(!!data?.smtp_user)
      setCc(data?.cc ?? '')
      setSubject(fillTemplate(data?.subject_template || DEFAULT_SUBJECT, vars))
      setBody(fillTemplate(data?.body_template || DEFAULT_BODY, vars))
      setReady(true)
    })()
    return () => { alive = false }
  }, [broker?.id, estimate, supabase])

  const send = async () => {
    if (!to.trim()) { toast.error('받는 사람 주소를 입력하세요'); return }
    setSending(true)
    try {
      const res = await fetch(`/api/estimates/${estimate.id}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: to.trim(), cc: cc.trim(), subject, body }),
      })
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json.error || '발송 실패')
      toast.success('메일을 보냈습니다')
      onSent()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '메일을 보내지 못했습니다')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div
        onClick={e => e.stopPropagation()}
        className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl dark:bg-gray-900 sm:rounded-2xl"
      >
        <div className="mb-4 flex items-center gap-2">
          <Mail className="h-5 w-5 text-blue-600" />
          <h2 className="text-base font-black text-gray-900 dark:text-white">견적서 메일 발송</h2>
          <button onClick={onClose} aria-label="닫기" className="ml-auto rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800">
            <X className="h-5 w-5" />
          </button>
        </div>

        {!ready ? (
          <p className="py-8 text-center text-sm text-gray-500">불러오는 중…</p>
        ) : !configured ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
            <div className="mb-2 flex items-center gap-2 font-bold">
              <AlertTriangle className="h-4 w-4" />메일 설정이 필요합니다
            </div>
            <p className="mb-3 leading-relaxed">
              네이버 메일 주소와 앱 비밀번호를 설정에 먼저 등록해야 발송할 수 있습니다.
            </p>
            <Link href="/broker/estimates/settings" className="inline-block rounded-lg bg-amber-600 px-3 py-2 text-xs font-bold text-white hover:bg-amber-700">
              메일 설정하러 가기
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className={LABEL} htmlFor="m-to">받는 사람</label>
                <input id="m-to" type="email" value={to} onChange={e => setTo(e.target.value)} className={FIELD} />
              </div>
              <div>
                <label className={LABEL} htmlFor="m-cc">참조 (선택)</label>
                <input id="m-cc" value={cc} onChange={e => setCc(e.target.value)} placeholder="쉼표로 여러 명" className={FIELD} />
              </div>
            </div>
            <div>
              <label className={LABEL} htmlFor="m-subject">제목</label>
              <input id="m-subject" value={subject} onChange={e => setSubject(e.target.value)} className={FIELD} />
            </div>
            <div>
              <label className={LABEL} htmlFor="m-body">본문</label>
              <textarea id="m-body" rows={10} value={body} onChange={e => setBody(e.target.value)}
                className={`${FIELD} resize-y leading-relaxed`} />
            </div>

            <div className="flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-2.5 text-sm text-gray-600 dark:bg-gray-950/50 dark:text-gray-400">
              <Paperclip className="h-4 w-4 shrink-0 text-gray-400" />
              <span className="font-mono text-xs">견적서_{estimate.estimate_no}_{estimate.client_name || '거래처'}.pdf</span>
              <span className="ml-auto text-xs text-gray-400">자동 첨부</span>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button onClick={onClose}
                className="rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300">
                취소
              </button>
              <button onClick={send} disabled={sending}
                className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50">
                <Mail className="h-4 w-4" />{sending ? '보내는 중…' : '보내기'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
