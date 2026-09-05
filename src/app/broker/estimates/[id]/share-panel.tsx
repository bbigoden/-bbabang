'use client'

/**
 * 링크 공유 + 첨부파일.
 *
 * 공유: PDF 를 붙이는 대신 링크를 카톡으로 보낸다. 거래처가 열어봤는지 보인다.
 * 첨부: 도면·현장사진을 메일 보낼 때 견적서와 함께 나가게 한다.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/components/toast'
import {
  Link2, Copy, Eye, Ban, Paperclip, Upload, Trash2, Download, FileText,
} from 'lucide-react'

const MAX_FILE = 10 * 1024 * 1024   // 10MB — 메일 첨부까지 감안한 상한
const BUCKET = 'estimate-files'

interface ShareRow {
  id: string
  token: string
  revoked: boolean
  view_count: number
  first_viewed_at: string | null
  last_viewed_at: string | null
  created_at: string
}

interface FileRow {
  id: string
  path: string
  filename: string
  size: number
  content_type: string | null
}

const fmtSize = (n: number) => n >= 1024 * 1024
  ? `${(n / 1024 / 1024).toFixed(1)}MB`
  : `${Math.max(1, Math.round(n / 1024))}KB`

export function SharePanel({ estimateId, brokerId, refreshKey = 0 }: {
  estimateId: string
  brokerId: string
  /** 상단 '공유' 버튼이 링크를 만들면 올라간다 — 그때 여기도 다시 읽는다 */
  refreshKey?: number
}) {
  const toast = useToast()
  const supabase = useMemo(() => createClient(), [])
  const [shares, setShares] = useState<ShareRow[]>([])
  const [files, setFiles] = useState<FileRow[]>([])
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    const [sh, fl] = await Promise.all([
      supabase.from('estimate_shares').select('*').eq('estimate_id', estimateId).order('created_at', { ascending: false }),
      supabase.from('estimate_attachments').select('*').eq('estimate_id', estimateId).order('created_at'),
    ])
    setShares((sh.data as ShareRow[]) ?? [])
    setFiles((fl.data as FileRow[]) ?? [])
  }, [estimateId, supabase])

  useEffect(() => { load() }, [load, refreshKey])

  // origin 은 렌더 중에 읽으면 안 된다 — 'use client' 라도 서버에서 한 번 그려지므로
  // window 가 없어 페이지가 통째로 죽는다
  const [origin, setOrigin] = useState('')
  useEffect(() => { setOrigin(window.location.origin) }, [])

  const live = shares.find(s => !s.revoked)
  const shareUrl = live && origin ? `${origin}/e/${live.token}` : ''

  const createLink = async () => {
    setBusy(true)
    // 추측할 수 없을 만큼 긴 토큰
    const token = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '').slice(0, 8)
    const { error } = await supabase.from('estimate_shares').insert({ estimate_id: estimateId, token })
    setBusy(false)
    if (error) { toast.error('링크를 만들지 못했습니다'); return }
    toast.success('공유 링크를 만들었습니다')
    load()
  }

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl)
      toast.success('링크를 복사했습니다. 카톡에 붙여넣으세요.')
    } catch {
      toast.error('복사하지 못했습니다. 주소를 길게 눌러 복사해주세요.')
    }
  }

  /**
   * 살아 있는 링크를 전부 회수한다.
   *
   * 눌린 줄 하나만 죽이면 위험하다 — 화면은 살아 있는 링크 중 하나만 보여주므로,
   * 어쩌다 두 개가 생겼을 때 하나를 회수하고는 다 막았다고 믿게 된다.
   * 그 사이 거래처는 나머지 주소로 계속 열어 본다. 회수는 "더 못 보게" 하는
   * 뜻이니 전부 막는 게 맞다.
   */
  const revoke = async () => {
    if (!confirm('링크를 회수할까요?\n이미 보낸 링크로는 더 이상 열 수 없게 됩니다.')) return
    const { error } = await supabase.from('estimate_shares')
      .update({ revoked: true }).eq('estimate_id', estimateId).eq('revoked', false)
    if (error) { toast.error('회수하지 못했습니다'); return }
    setShares(prev => prev.map(s => ({ ...s, revoked: true })))
    toast.success('링크를 회수했습니다')
  }

  const upload = async (file: File) => {
    if (file.size > MAX_FILE) { toast.error('10MB 이하 파일만 첨부할 수 있습니다'); return }
    setBusy(true)
    // 저장 경로는 ASCII 로만 만든다 — Supabase Storage 는 키에 한글을 받지 않는다
    // ("Invalid key"). 도면·사진은 대부분 한글 이름이라 그대로 쓰면 전부 실패한다.
    // 보여주고 내려받을 때 쓰는 원래 이름은 filename 컬럼에 따로 남긴다.
    const ext = (file.name.match(/\.[A-Za-z0-9]{1,8}$/)?.[0] ?? '').toLowerCase()
    const path = `${brokerId}/${estimateId}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}${ext}`
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type || undefined })
    if (upErr) { setBusy(false); toast.error('파일을 올리지 못했습니다'); return }

    const { error } = await supabase.from('estimate_attachments').insert({
      estimate_id: estimateId, path, filename: file.name,
      size: file.size, content_type: file.type || null,
    })
    setBusy(false)
    if (error) {
      await supabase.storage.from(BUCKET).remove([path])   // 기록 실패 시 올린 파일도 되돌린다
      toast.error('파일을 저장하지 못했습니다')
      return
    }
    toast.success('첨부했습니다')
    load()
  }

  const openFile = async (row: FileRow) => {
    // 경로는 ASCII 라 그냥 열면 뜻 모를 이름으로 받아진다. 원래 이름으로 내려받게 한다
    const { data } = await supabase.storage.from(BUCKET).createSignedUrl(row.path, 120, { download: row.filename })
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
    else toast.error('파일을 열지 못했습니다')
  }

  const removeFile = async (row: FileRow) => {
    if (!confirm(`"${row.filename}" 을(를) 지울까요?`)) return
    await supabase.storage.from(BUCKET).remove([row.path])
    const { error } = await supabase.from('estimate_attachments').delete().eq('id', row.id)
    if (error) { toast.error('삭제하지 못했습니다'); return }
    setFiles(prev => prev.filter(f => f.id !== row.id))
  }

  return (
    <section className="rounded-2xl border border-gray-100 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
      <h2 className="mb-3 flex items-center gap-1.5 text-sm font-bold text-gray-900 dark:text-white">
        <Link2 className="h-4 w-4 text-gray-500" />공유 · 첨부
      </h2>

      {/* 링크 공유 */}
      {live ? (
        <div className="mb-4">
          <div className="flex flex-wrap items-center gap-2">
            <input readOnly value={shareUrl} aria-label="공유 링크"
              onFocus={e => e.currentTarget.select()}
              className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 font-mono text-xs text-gray-700 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-300" />
            <button onClick={copyLink}
              className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-bold text-white hover:bg-blue-700">
              <Copy className="h-4 w-4" />복사
            </button>
            <button onClick={revoke} title="링크 회수" aria-label="링크 회수"
              className="rounded-lg border border-gray-200 bg-white p-2 text-gray-500 hover:bg-red-50 hover:text-red-600 dark:border-gray-800 dark:bg-gray-900">
              <Ban className="h-4 w-4" />
            </button>
          </div>
          <p className="mt-2 flex items-center gap-1.5 text-xs text-gray-500">
            <Eye className="h-3.5 w-3.5" />
            {live.view_count > 0
              ? <>거래처가 {live.view_count}번 열어봤습니다 · 마지막 {new Date(live.last_viewed_at!).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' })}</>
              : '아직 열어보지 않았습니다'}
          </p>
        </div>
      ) : (
        <div className="mb-4">
          <button onClick={createLink} disabled={busy}
            className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300">
            <Link2 className="h-4 w-4" />공유 링크 만들기
          </button>
          <p className="mt-1.5 text-xs text-gray-500">
            로그인 없이 열리는 링크입니다. 카톡·문자로 보내면 거래처가 바로 볼 수 있고, 열어봤는지 여기 표시됩니다.
          </p>
        </div>
      )}

      {/* 첨부파일 */}
      <div className="border-t border-gray-100 pt-3 dark:border-gray-800">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="flex items-center gap-1.5 text-xs font-bold text-gray-600 dark:text-gray-400">
            <Paperclip className="h-3.5 w-3.5" />첨부파일
            {files.length > 0 && <span className="text-gray-500">({files.length})</span>}
          </h3>
          <input ref={fileRef} type="file" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = '' }} />
          <button onClick={() => fileRef.current?.click()} disabled={busy}
            className="flex items-center gap-1 text-xs font-semibold text-blue-600 hover:underline disabled:opacity-50">
            <Upload className="h-3.5 w-3.5" />파일 추가
          </button>
        </div>

        {files.length === 0 ? (
          <p className="py-2 text-xs text-gray-500">도면·현장사진을 붙여두면 메일 보낼 때 견적서와 함께 나갑니다. (10MB 이하)</p>
        ) : (
          <ul className="space-y-1">
            {files.map(f => (
              <li key={f.id} className="flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-2 text-sm dark:bg-gray-950/50">
                <FileText className="h-4 w-4 shrink-0 text-gray-500" />
                <span className="min-w-0 flex-1 truncate text-gray-700 dark:text-gray-300">{f.filename}</span>
                <span className="shrink-0 text-xs text-gray-500">{fmtSize(f.size)}</span>
                <button onClick={() => openFile(f)} title="열기" aria-label="파일 열기"
                  className="rounded p-1 text-gray-500 hover:bg-gray-200 hover:text-blue-600 dark:hover:bg-gray-800">
                  <Download className="h-3.5 w-3.5" />
                </button>
                <button onClick={() => removeFile(f)} title="삭제" aria-label="첨부 삭제"
                  className="rounded p-1 text-gray-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
