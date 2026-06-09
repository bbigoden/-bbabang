'use client'

import { useEffect, useState, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/lib/auth-context'
import { Header } from '@/components/layout/header'
import { useRouter } from 'next/navigation'
import { FolderOpen, Plus, FileText, Download, Trash2, Link as LinkIcon, Paperclip, X } from 'lucide-react'
import { formatDate } from '@/lib/utils'
import { useToast } from '@/components/toast'

interface ResourceFile {
  id: string
  storage_path: string
  file_name: string
  file_size: number | null
  file_type: string | null
  sort_order: number
}

interface Resource {
  id: string
  office_broker_id: string
  uploader_broker_id: string | null
  title: string
  description: string | null
  created_at: string
  uploader?: { profiles?: { name: string | null } | null } | null
  files?: ResourceFile[] | null
}

const MAX_FILE_SIZE = 20 * 1024 * 1024 // 20MB per file
const MAX_FILES = 20

function formatFileSize(bytes: number | null | undefined): string {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export default function BrokerResourcesPage() {
  const supabase = createClient()
  const router = useRouter()
  const auth = useAuth()
  const toast = useToast()

  const [user, setUser] = useState<any>(null)
  const [broker, setBroker] = useState<any>(null)
  const [officeBrokerId, setOfficeBrokerId] = useState<string | null>(null)
  const [resources, setResources] = useState<Resource[]>([])
  const [loading, setLoading] = useState(true)

  const [showForm, setShowForm] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [saving, setSaving] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const fileRef = useRef<HTMLInputElement>(null)

  const toggleExpand = (id: string) => setExpanded(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  // description이 길면(3줄 초과 추정) 접기 처리. 줄바꿈 3개 이상이거나 140자 초과면 길다고 판단.
  const isLongDesc = (s: string | null | undefined) => {
    if (!s) return false
    const lines = s.split('\n').length
    return s.length > 140 || lines > 3
  }

  useEffect(() => {
    if (auth.loading) return
    if (!auth.user) { router.push('/auth/login?redirect=/broker/resources'); return }
    if (!auth.broker) { router.push('/broker/register'); return }
    init()
  }, [auth.loading, auth.user?.id, auth.broker?.id])

  const init = async () => {
    const u = auth.user!
    const b = auth.broker!
    setUser(u)
    setBroker(b)

    const isOwner = b.is_owner !== false
    const oid = isOwner ? b.id : (b.parent_broker_id ?? b.id)
    setOfficeBrokerId(oid)

    // 룰: 대표=사무소 전체. 직원=대표가 올린 자료 + 본인이 올린 자료(다른 직원이 올린 건 안 보임).
    let query = supabase
      .from('office_resources')
      .select('id, office_broker_id, uploader_broker_id, title, description, created_at, uploader:broker_profiles!office_resources_uploader_broker_id_fkey(profiles(name)), files:office_resource_files(id, storage_path, file_name, file_size, file_type, sort_order)')
      .eq('office_broker_id', oid)
    if (!isOwner) {
      const allowed = [b.id, b.parent_broker_id].filter(Boolean) as string[]
      query = query.in('uploader_broker_id', allowed)
    }
    const { data } = await query.order('created_at', { ascending: false })

    // 첨부파일 sort_order로 정렬
    const list = (data ?? []).map((r: any) => ({
      ...r,
      files: Array.isArray(r.files)
        ? [...r.files].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
        : [],
    }))
    setResources(list as Resource[])
    setLoading(false)
  }

  const acceptFiles = (incoming: FileList | File[] | null | undefined) => {
    if (!incoming) return
    const arr = Array.from(incoming)
    if (arr.length === 0) return

    const oversized = arr.filter(f => f.size > MAX_FILE_SIZE)
    if (oversized.length > 0) {
      toast.error(`다음 파일은 20MB를 초과해서 제외됐습니다:\n${oversized.map(f => `· ${f.name}`).join('\n')}`)
    }
    const ok = arr.filter(f => f.size <= MAX_FILE_SIZE)
    if (ok.length === 0) return

    setFiles(prev => {
      const merged = [...prev]
      for (const f of ok) {
        // 같은 이름+크기는 중복 제외
        if (!merged.some(p => p.name === f.name && p.size === f.size)) merged.push(f)
        if (merged.length >= MAX_FILES) break
      }
      if (merged.length >= MAX_FILES) {
        toast.error(`한 자료에는 최대 ${MAX_FILES}개까지 첨부할 수 있습니다.`)
      }
      return merged.slice(0, MAX_FILES)
    })
    if (!title && ok[0]) setTitle(ok[0].name.replace(/\.[^.]+$/, ''))
  }

  const onFilePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    acceptFiles(e.target.files)
    e.target.value = ''
  }

  const removeFileAt = (idx: number) => {
    setFiles(prev => prev.filter((_, i) => i !== idx))
  }

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    if (!isDragging) setIsDragging(true)
  }
  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    acceptFiles(e.dataTransfer.files)
  }

  const resetForm = () => {
    setTitle(''); setDescription(''); setFiles([])
    if (fileRef.current) fileRef.current.value = ''
  }

  const save = async () => {
    if (!broker || !officeBrokerId) return
    if (!title.trim()) { toast.error('제목을 입력해주세요.'); return }
    if (files.length === 0 && !description.trim()) { toast.error('파일을 첨부하거나 메모 내용을 입력해주세요.'); return }

    setSaving(true)
    const uploadedPaths: string[] = []

    try {
      // 1) 자료 row 먼저 생성
      const { data: inserted, error: insErr } = await supabase
        .from('office_resources')
        .insert({
          office_broker_id: officeBrokerId,
          uploader_broker_id: broker.id,
          title: title.trim(),
          description: description.trim() || null,
        })
        .select('id, office_broker_id, uploader_broker_id, title, description, created_at, uploader:broker_profiles!office_resources_uploader_broker_id_fkey(profiles(name))')
        .single()

      if (insErr || !inserted) {
        toast.error(`저장 실패: ${insErr?.message ?? '알 수 없는 오류'}`)
        setSaving(false)
        return
      }

      // 2) 파일들 Storage 업로드 → DB row insert
      const fileRows: ResourceFile[] = []
      for (let i = 0; i < files.length; i++) {
        const f = files[i]
        const extRaw = (f.name.includes('.') ? f.name.split('.').pop() : '') ?? ''
        const ext = /^[a-zA-Z0-9]{1,8}$/.test(extRaw) ? `.${extRaw.toLowerCase()}` : ''
        const path = `${officeBrokerId}/${broker.id}/${Date.now()}-${i}-${Math.random().toString(36).slice(2)}${ext}`

        const { error: upErr } = await supabase.storage
          .from('office-resources')
          .upload(path, f, { upsert: false, contentType: f.type || undefined })
        if (upErr) {
          toast.error(`"${f.name}" 업로드 실패: ${upErr.message}`)
          // 롤백
          if (uploadedPaths.length > 0) await supabase.storage.from('office-resources').remove(uploadedPaths)
          await supabase.from('office_resources').delete().eq('id', inserted.id)
          setSaving(false)
          return
        }
        uploadedPaths.push(path)

        const { data: fileRow, error: fileErr } = await supabase
          .from('office_resource_files')
          .insert({
            resource_id: inserted.id,
            storage_path: path,
            file_name: f.name,
            file_size: f.size,
            file_type: f.type || null,
            sort_order: i,
          })
          .select('id, storage_path, file_name, file_size, file_type, sort_order')
          .single()

        if (fileErr || !fileRow) {
          toast.error(`첨부 메타 저장 실패: ${fileErr?.message ?? ''}`)
          if (uploadedPaths.length > 0) await supabase.storage.from('office-resources').remove(uploadedPaths)
          await supabase.from('office_resources').delete().eq('id', inserted.id)
          setSaving(false)
          return
        }
        fileRows.push(fileRow as ResourceFile)
      }

      const newResource: Resource = { ...(inserted as any), files: fileRows }
      setResources(prev => [newResource, ...prev])
      resetForm()
      setShowForm(false)
    } finally {
      setSaving(false)
    }
  }

  const handleDownload = async (f: ResourceFile) => {
    const { data, error } = await supabase.storage
      .from('office-resources')
      .createSignedUrl(f.storage_path, 60, { download: f.file_name })
    if (error || !data?.signedUrl) {
      toast.error(`다운로드 링크 생성 실패: ${error?.message ?? ''}`)
      return
    }
    window.open(data.signedUrl, '_blank')
  }

  const removeResource = async (r: Resource) => {
    if (!confirm(`"${r.title}" 자료를 삭제할까요? 첨부 파일도 함께 삭제됩니다.`)) return
    const paths = (r.files ?? []).map(f => f.storage_path)
    if (paths.length > 0) {
      await supabase.storage.from('office-resources').remove(paths)
    }
    const { error } = await supabase.from('office_resources').delete().eq('id', r.id)
    if (error) {
      toast.error(`삭제 실패: ${error.message}`)
      return
    }
    setResources(prev => prev.filter(x => x.id !== r.id))
  }

  if (loading) return (
    <div className="bg-gray-50 dark:bg-gray-950 flex items-center justify-center">
      <div className="text-gray-500 text-sm">불러오는 중...</div>
    </div>
  )

  return (
    <div className="bg-gray-50 dark:bg-gray-950">
      <Header user={user} role="broker" />
      <div className="mx-auto max-w-5xl px-4 py-8">
        <div className="mb-6 flex items-end justify-between">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-black text-gray-900 dark:text-white">
              <FolderOpen className="h-6 w-6 text-blue-600" />
              자료실
            </h1>
            <p className="mt-0.5 text-sm text-gray-500">{broker?.office_name} · 사무소 내부 공유</p>
          </div>
          {!showForm && (
            <button
              onClick={() => setShowForm(true)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-700 transition-colors"
            >
              <Plus className="h-4 w-4" />
              자료 올리기
            </button>
          )}
        </div>

        {showForm && (
          <div className="mb-6 rounded-2xl border border-blue-100 bg-white dark:bg-gray-900 p-5 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-bold text-gray-800 dark:text-gray-100">새 자료 올리기</h2>
              <button onClick={() => { setShowForm(false); resetForm() }}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 dark:bg-gray-800 hover:text-gray-500">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-gray-600 dark:text-gray-500">제목 *</label>
                <input
                  value={title}
                  onChange={e => setTitle(e.target.value.slice(0, 120))}
                  placeholder="예: 2025 표준 임대차계약서 패키지"
                  maxLength={120}
                  className="w-full rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-gray-600 dark:text-gray-500">설명·메모 (선택)</label>
                <textarea
                  value={description}
                  onChange={e => setDescription(e.target.value.slice(0, 2000))}
                  placeholder="자료 설명, 링크, 메모 등을 자유롭게 입력하세요"
                  rows={4}
                  maxLength={2000}
                  className="w-full rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
                <p className="mt-1 text-[11px] text-gray-500">{description.length}/2000</p>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-gray-600 dark:text-gray-500">
                  파일 첨부 (선택, 최대 {MAX_FILES}개, 각 20MB)
                </label>
                <input ref={fileRef} type="file" multiple onChange={onFilePick} className="hidden" />

                {/* 드롭존 — 파일 있어도 계속 보이게 해서 추가 첨부 가능 */}
                <div
                  onClick={() => fileRef.current?.click()}
                  onDragOver={onDragOver}
                  onDragEnter={onDragOver}
                  onDragLeave={onDragLeave}
                  onDrop={onDrop}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') fileRef.current?.click() }}
                  className={`flex w-full flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed px-3 py-5 text-sm font-medium cursor-pointer transition-colors ${
                    isDragging
                      ? 'border-blue-400 bg-blue-50 text-blue-700'
                      : 'border-gray-200 bg-gray-50 text-gray-500 hover:border-blue-300 hover:bg-blue-50/40 hover:text-blue-600'
                  }`}
                >
                  <Paperclip className="h-5 w-5" />
                  <span>{isDragging ? '여기에 놓으세요' : '파일을 끌어놓거나 클릭해 선택'}</span>
                </div>

                {/* 선택된 파일 목록 */}
                {files.length > 0 && (
                  <div className="mt-2 space-y-1.5">
                    {files.map((f, i) => (
                      <div key={`${f.name}-${i}`} className="flex items-center justify-between rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-950 px-3 py-2 text-sm">
                        <div className="flex items-center gap-2 min-w-0">
                          <Paperclip className="h-4 w-4 flex-shrink-0 text-gray-500" />
                          <span className="truncate text-gray-700 dark:text-gray-300">{f.name}</span>
                          <span className="flex-shrink-0 text-xs text-gray-500">({formatFileSize(f.size)})</span>
                        </div>
                        <button onClick={() => removeFileAt(i)}
                          className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md text-gray-500 hover:bg-gray-200 hover:text-gray-600 dark:text-gray-500">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                    <p className="text-[11px] text-gray-500">총 {files.length}개</p>
                  </div>
                )}
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => { setShowForm(false); resetForm() }}
                  className="flex-1 rounded-xl border border-gray-200 dark:border-gray-800 py-2.5 text-sm font-medium text-gray-600 dark:text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 dark:bg-gray-950"
                >
                  취소
                </button>
                <button
                  onClick={save}
                  disabled={saving}
                  className="flex-1 rounded-xl bg-blue-600 py-2.5 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {saving ? '올리는 중...' : '올리기'}
                </button>
              </div>
            </div>
          </div>
        )}

        {resources.length === 0 ? (
          <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-12 text-center">
            <FolderOpen className="mx-auto h-10 w-10 text-gray-200 mb-3" />
            <p className="text-sm font-semibold text-gray-500">아직 올라온 자료가 없어요</p>
            <p className="mt-1 text-xs text-gray-500">같은 사무소 직원과 계약서 양식·매물지·교육자료를 공유해보세요</p>
          </div>
        ) : (
          <div className="space-y-2">
            {resources.map(r => {
              const canDelete = r.uploader_broker_id === broker?.id || officeBrokerId === broker?.id
              const uploaderName = r.uploader?.profiles?.name ?? '—'
              const attachmentCount = r.files?.length ?? 0
              return (
                <div key={r.id} className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 hover:border-blue-200 hover:shadow-sm transition-all">
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                      {attachmentCount > 0 ? <FileText className="h-5 w-5" /> : <LinkIcon className="h-5 w-5" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="font-bold text-gray-900 dark:text-white break-keep">{r.title}</h3>
                        {canDelete && (
                          <button onClick={() => removeResource(r)} aria-label={`${r.title} 자료 삭제`} title="자료 삭제"
                            className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-gray-300 hover:bg-red-50 hover:text-red-500 transition-colors">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                      {r.description && (() => {
                        const long = isLongDesc(r.description)
                        const open = expanded.has(r.id)
                        return (
                          <>
                            <p
                              className={`mt-1 whitespace-pre-wrap text-sm text-gray-600 dark:text-gray-500 ${
                                long && !open ? 'line-clamp-3' : ''
                              }`}
                            >
                              {r.description}
                            </p>
                            {long && (
                              <button
                                onClick={() => toggleExpand(r.id)}
                                className="mt-1 text-xs font-semibold text-blue-600 hover:text-blue-700"
                              >
                                {open ? '접기' : '더보기'}
                              </button>
                            )}
                          </>
                        )
                      })()}
                      <div className="mt-2 flex items-center gap-3 text-xs text-gray-500">
                        <span>{uploaderName}</span>
                        <span>·</span>
                        <span>{formatDate(r.created_at)}</span>
                        {attachmentCount > 0 && (
                          <>
                            <span>·</span>
                            <span>첨부 {attachmentCount}개</span>
                          </>
                        )}
                      </div>
                      {attachmentCount > 0 && (
                        <div className="mt-3 space-y-1.5">
                          {r.files!.map(f => (
                            <button
                              key={f.id}
                              onClick={() => handleDownload(f)}
                              className="flex w-full items-center justify-between rounded-lg bg-gray-50 dark:bg-gray-950 px-3 py-1.5 text-xs font-semibold text-gray-700 dark:text-gray-300 hover:bg-blue-50 hover:text-blue-700 transition-colors"
                            >
                              <span className="flex min-w-0 items-center gap-1.5">
                                <Download className="h-3.5 w-3.5 flex-shrink-0" />
                                <span className="truncate">{f.file_name}</span>
                              </span>
                              <span className="flex-shrink-0 text-[11px] text-gray-500">{formatFileSize(f.file_size)}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
