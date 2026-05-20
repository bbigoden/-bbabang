'use client'

import { useEffect, useState, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/lib/auth-context'
import { Header } from '@/components/layout/header'
import { useRouter } from 'next/navigation'
import { FolderOpen, Plus, FileText, Download, Trash2, Link as LinkIcon, Paperclip, X } from 'lucide-react'
import { formatDate } from '@/lib/utils'

interface Resource {
  id: string
  office_broker_id: string
  uploader_broker_id: string | null
  title: string
  description: string | null
  file_url: string | null
  file_name: string | null
  file_size: number | null
  file_type: string | null
  storage_path: string | null
  created_at: string
  uploader?: { profiles?: { name: string | null } | null } | null
}

const MAX_FILE_SIZE = 20 * 1024 * 1024 // 20MB

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

  const [user, setUser] = useState<any>(null)
  const [broker, setBroker] = useState<any>(null)
  const [officeBrokerId, setOfficeBrokerId] = useState<string | null>(null)
  const [resources, setResources] = useState<Resource[]>([])
  const [loading, setLoading] = useState(true)

  const [showForm, setShowForm] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

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

    const { data } = await supabase
      .from('office_resources')
      .select('*, uploader:broker_profiles!office_resources_uploader_broker_id_fkey(profiles(name))')
      .eq('office_broker_id', oid)
      .order('created_at', { ascending: false })

    setResources((data ?? []) as unknown as Resource[])
    setLoading(false)
  }

  const acceptFile = (f: File | undefined | null) => {
    if (!f) return
    if (f.size > MAX_FILE_SIZE) {
      alert(`파일은 ${formatFileSize(MAX_FILE_SIZE)}까지 업로드 가능합니다.`)
      return
    }
    setFile(f)
    if (!title) setTitle(f.name.replace(/\.[^.]+$/, ''))
  }

  const onFilePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    if (f.size > MAX_FILE_SIZE) {
      e.target.value = ''
    }
    acceptFile(f)
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
    const f = e.dataTransfer.files?.[0]
    acceptFile(f)
  }

  const resetForm = () => {
    setTitle(''); setDescription(''); setFile(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  const save = async () => {
    if (!broker || !officeBrokerId) return
    if (!title.trim()) { alert('제목을 입력해주세요.'); return }
    if (!file && !description.trim()) { alert('파일을 첨부하거나 메모 내용을 입력해주세요.'); return }

    setSaving(true)
    let file_url: string | null = null
    let file_name: string | null = null
    let file_size: number | null = null
    let file_type: string | null = null
    let storage_path: string | null = null

    try {
      if (file) {
        const safeName = file.name.replace(/[^a-zA-Z0-9.\-_가-힣]/g, '_')
        const path = `${officeBrokerId}/${broker.id}/${Date.now()}-${Math.random().toString(36).slice(2)}-${safeName}`
        const { error: upErr } = await supabase.storage
          .from('office-resources')
          .upload(path, file, { upsert: false, contentType: file.type || undefined })
        if (upErr) {
          alert(`파일 업로드 실패: ${upErr.message}`)
          setSaving(false)
          return
        }
        const { data: signed } = await supabase.storage
          .from('office-resources')
          .createSignedUrl(path, 60 * 60 * 24 * 365 * 5)
        file_url = signed?.signedUrl ?? null
        file_name = file.name
        file_size = file.size
        file_type = file.type || null
        storage_path = path
      }

      const { data: inserted, error } = await supabase
        .from('office_resources')
        .insert({
          office_broker_id: officeBrokerId,
          uploader_broker_id: broker.id,
          title: title.trim(),
          description: description.trim() || null,
          file_url, file_name, file_size, file_type, storage_path,
        })
        .select('*, uploader:broker_profiles!office_resources_uploader_broker_id_fkey(profiles(name))')
        .single()

      if (error) {
        alert(`저장 실패: ${error.message}`)
        if (storage_path) {
          await supabase.storage.from('office-resources').remove([storage_path])
        }
        setSaving(false)
        return
      }

      setResources(prev => [inserted as unknown as Resource, ...prev])
      resetForm()
      setShowForm(false)
    } finally {
      setSaving(false)
    }
  }

  const handleDownload = async (r: Resource) => {
    if (!r.storage_path) return
    const { data, error } = await supabase.storage
      .from('office-resources')
      .createSignedUrl(r.storage_path, 60)
    if (error || !data?.signedUrl) {
      alert(`다운로드 링크 생성 실패: ${error?.message ?? ''}`)
      return
    }
    window.open(data.signedUrl, '_blank')
  }

  const remove = async (r: Resource) => {
    if (!confirm(`"${r.title}" 자료를 삭제할까요?`)) return
    if (r.storage_path) {
      await supabase.storage.from('office-resources').remove([r.storage_path])
    }
    const { error } = await supabase.from('office_resources').delete().eq('id', r.id)
    if (error) {
      alert(`삭제 실패: ${error.message}`)
      return
    }
    setResources(prev => prev.filter(x => x.id !== r.id))
  }

  if (loading) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-gray-400 text-sm">불러오는 중...</div>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-50">
      <Header user={user} role="broker" />
      <div className="mx-auto max-w-3xl px-4 py-8">
        <div className="mb-6 flex items-end justify-between">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-black text-gray-900">
              <FolderOpen className="h-6 w-6 text-blue-600" />
              자료실
            </h1>
            <p className="mt-0.5 text-sm text-gray-400">{broker?.office_name} · 사무소 내부 공유</p>
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
          <div className="mb-6 rounded-2xl border border-blue-100 bg-white p-5 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-bold text-gray-800">새 자료 올리기</h2>
              <button onClick={() => { setShowForm(false); resetForm() }}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-300 hover:bg-gray-100 hover:text-gray-500">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-gray-600">제목 *</label>
                <input
                  value={title}
                  onChange={e => setTitle(e.target.value.slice(0, 120))}
                  placeholder="예: 2025 표준 임대차계약서"
                  maxLength={120}
                  className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-gray-600">설명·메모 (선택)</label>
                <textarea
                  value={description}
                  onChange={e => setDescription(e.target.value.slice(0, 2000))}
                  placeholder="자료 설명, 링크, 메모 등을 자유롭게 입력하세요"
                  rows={4}
                  maxLength={2000}
                  className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
                <p className="mt-1 text-[11px] text-gray-400">{description.length}/2000</p>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-gray-600">파일 첨부 (선택, 최대 20MB)</label>
                <input ref={fileRef} type="file" onChange={onFilePick} className="hidden" />
                {file ? (
                  <div className="flex items-center justify-between rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm">
                    <div className="flex items-center gap-2 min-w-0">
                      <Paperclip className="h-4 w-4 flex-shrink-0 text-gray-400" />
                      <span className="truncate text-gray-700">{file.name}</span>
                      <span className="flex-shrink-0 text-xs text-gray-400">({formatFileSize(file.size)})</span>
                    </div>
                    <button onClick={() => { setFile(null); if (fileRef.current) fileRef.current.value = '' }}
                      className="flex h-6 w-6 items-center justify-center rounded-md text-gray-400 hover:bg-gray-200 hover:text-gray-600">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : (
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
                )}
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => { setShowForm(false); resetForm() }}
                  className="flex-1 rounded-xl border border-gray-200 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50"
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
          <div className="rounded-2xl border border-gray-200 bg-white p-12 text-center">
            <FolderOpen className="mx-auto h-10 w-10 text-gray-200 mb-3" />
            <p className="text-sm font-semibold text-gray-500">아직 올라온 자료가 없어요</p>
            <p className="mt-1 text-xs text-gray-400">같은 사무소 직원과 계약서 양식·매물지·교육자료를 공유해보세요</p>
          </div>
        ) : (
          <div className="space-y-2">
            {resources.map(r => {
              const canDelete = r.uploader_broker_id === broker?.id || officeBrokerId === broker?.id
              const uploaderName = r.uploader?.profiles?.name ?? '—'
              return (
                <div key={r.id} className="rounded-2xl border border-gray-200 bg-white p-4 hover:border-blue-200 hover:shadow-sm transition-all">
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                      {r.storage_path ? <FileText className="h-5 w-5" /> : <LinkIcon className="h-5 w-5" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="font-bold text-gray-900 break-keep">{r.title}</h3>
                        {canDelete && (
                          <button onClick={() => remove(r)}
                            className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-gray-300 hover:bg-red-50 hover:text-red-500 transition-colors">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                      {r.description && (
                        <p className="mt-1 whitespace-pre-wrap text-sm text-gray-600">{r.description}</p>
                      )}
                      <div className="mt-2 flex items-center gap-3 text-xs text-gray-400">
                        <span>{uploaderName}</span>
                        <span>·</span>
                        <span>{formatDate(r.created_at)}</span>
                        {r.file_size != null && (
                          <>
                            <span>·</span>
                            <span>{formatFileSize(r.file_size)}</span>
                          </>
                        )}
                      </div>
                      {r.storage_path && (
                        <button
                          onClick={() => handleDownload(r)}
                          className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-gray-50 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-blue-50 hover:text-blue-700 transition-colors"
                        >
                          <Download className="h-3.5 w-3.5" />
                          {r.file_name ?? '파일'} 다운로드
                        </button>
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
