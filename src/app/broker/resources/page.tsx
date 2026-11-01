'use client'

import { useEffect, useState, useRef, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/lib/auth-context'
import { Header } from '@/components/layout/header'
import { useRouter } from 'next/navigation'
import {
  FolderOpen, Folder, FolderPlus, Plus, FileText, FileSpreadsheet, FileImage, File as FileIcon, Palette,
  Download, Trash2, Upload, X, Search, LayoutGrid, List, ChevronRight, MoreVertical, Pencil, Copy,
  StickyNote, ArrowUpDown,
} from 'lucide-react'
import { formatDate } from '@/lib/utils'
import { useToast } from '@/components/toast'
import { PageHeader } from '@/components/layout/page-header'
import { ImageLightbox } from '@/components/image-lightbox'

// 구글드라이브처럼 보이게 하되 DB 는 그대로다.
// 자료(office_resources) 하나 = 폴더 하나, 첨부(office_resource_files) = 폴더 안의 파일.
// 파일 없이 글만 있는 자료는 '메모'로 보여준다. 폴더에 적힌 설명은 폴더 안 맨 위에 메모로 뜬다.

interface ResourceFile {
  id: string
  storage_path: string
  file_name: string
  file_size: number | null
  file_type: string | null
  sort_order: number
  created_at?: string
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

type ViewMode = 'grid' | 'list'
type SortMode = 'recent' | 'name'

const MAX_FILE_SIZE = 20 * 1024 * 1024 // 20MB per file
const MAX_FILES = 50
const BUCKET = 'office-resources'
const SELECT_RESOURCE = 'id, office_broker_id, uploader_broker_id, title, description, created_at, uploader:broker_profiles!office_resources_uploader_broker_id_fkey(profiles(name))'
const SELECT_FILE = 'id, storage_path, file_name, file_size, file_type, sort_order, created_at'

function formatFileSize(bytes: number | null | undefined): string {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

const ext = (name: string) => (name.includes('.') ? name.split('.').pop()!.toLowerCase() : '')

function isImage(f: ResourceFile) {
  return (f.file_type ?? '').startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext(f.file_name))
}

// 확장자별 아이콘·색 — 드라이브처럼 한눈에 종류가 보이게
function fileKind(f: ResourceFile): { Icon: typeof FileIcon; color: string; bg: string } {
  const e = ext(f.file_name)
  if (isImage(f)) return { Icon: FileImage, color: 'text-rose-500', bg: 'bg-rose-50 dark:bg-rose-950/40' }
  if (e === 'pdf') return { Icon: FileText, color: 'text-red-600', bg: 'bg-red-50 dark:bg-red-950/40' }
  if (['xls', 'xlsx', 'csv'].includes(e)) return { Icon: FileSpreadsheet, color: 'text-green-600', bg: 'bg-green-50 dark:bg-green-950/40' }
  if (['doc', 'docx'].includes(e)) return { Icon: FileText, color: 'text-blue-600', bg: 'bg-blue-50 dark:bg-blue-950/40' }
  if (['hwp', 'hwpx'].includes(e)) return { Icon: FileText, color: 'text-sky-500', bg: 'bg-sky-50 dark:bg-sky-950/40' }
  if (['ai', 'psd', 'eps'].includes(e)) return { Icon: Palette, color: 'text-orange-500', bg: 'bg-orange-50 dark:bg-orange-950/40' }
  return { Icon: FileIcon, color: 'text-gray-500', bg: 'bg-gray-100 dark:bg-gray-800' }
}

const byName = (a: string, b: string) => a.localeCompare(b, 'ko', { numeric: true })

function readFolderParam(): string | null {
  if (typeof window === 'undefined') return null
  return new URLSearchParams(window.location.search).get('folder')
}

function readPref<T extends string>(key: string, fallback: T, allowed: T[]): T {
  try {
    const v = localStorage.getItem(key) as T | null
    return v && allowed.includes(v) ? v : fallback
  } catch { return fallback }
}

function writePref(key: string, v: string) {
  try { localStorage.setItem(key, v) } catch {}
}

// ⋮ 메뉴 — 바깥을 누르면 닫힌다
function ItemMenu({ label, items }: { label: string; items: { label: string; icon: typeof FileIcon; onClick: () => void; danger?: boolean }[] }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])
  if (items.length === 0) return null
  return (
    <div ref={ref} className="relative" onClick={e => e.stopPropagation()}>
      <button
        onClick={() => setOpen(o => !o)}
        aria-label={`${label} 메뉴`}
        className="flex h-8 w-8 items-center justify-center rounded-full text-gray-500 hover:bg-gray-200/70 dark:hover:bg-gray-700"
      >
        <MoreVertical className="h-4 w-4" />
      </button>
      {open && (
        <div className="absolute right-0 top-9 z-30 w-40 overflow-hidden rounded-xl border border-gray-100 bg-white py-1 shadow-lg dark:border-gray-800 dark:bg-gray-900">
          {items.map(it => (
            <button
              key={it.label}
              onClick={() => { setOpen(false); it.onClick() }}
              className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-gray-800 ${it.danger ? 'text-red-600' : 'text-gray-700 dark:text-gray-200'}`}
            >
              <it.icon className="h-4 w-4" />
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

interface DialogState {
  mode: 'folder' | 'rename' | 'memo' | 'editMemo'
  target?: Resource
  files?: File[]
}

export default function BrokerResourcesPage() {
  const supabase = createClient()
  const router = useRouter()
  const auth = useAuth()
  const toast = useToast()

  const [broker, setBroker] = useState<any>(null)
  const [officeBrokerId, setOfficeBrokerId] = useState<string | null>(null)
  const [resources, setResources] = useState<Resource[]>([])
  const [loading, setLoading] = useState(true)

  const [folderId, setFolderId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [view, setView] = useState<ViewMode>('grid')
  const [sort, setSort] = useState<SortMode>('recent')
  const [newOpen, setNewOpen] = useState(false)
  const [dialog, setDialog] = useState<DialogState | null>(null)
  const [dTitle, setDTitle] = useState('')
  const [dText, setDText] = useState('')
  const [saving, setSaving] = useState(false)
  const [memoView, setMemoView] = useState<Resource | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  const [lightbox, setLightbox] = useState<{ urls: string[]; files: ResourceFile[]; index: number } | null>(null)
  const [memoExpanded, setMemoExpanded] = useState(false)
  const [names, setNames] = useState<Record<string, string>>({})
  const fileRef = useRef<HTMLInputElement>(null)
  const newRef = useRef<HTMLDivElement>(null)
  const dragDepth = useRef(0)

  useEffect(() => {
    if (auth.loading) return
    if (!auth.user) { router.push('/auth/login?redirect=/broker/resources'); return }
    if (!auth.broker) { router.push('/broker/register'); return }
    init()
  }, [auth.loading, auth.user?.id, auth.broker?.id])

  // 보기 방식·정렬은 기기마다 기억. 폴더는 주소(?folder=)에 담아 뒤로가기가 먹게 한다.
  useEffect(() => {
    setView(readPref<ViewMode>('resources:view', 'grid', ['grid', 'list']))
    setSort(readPref<SortMode>('resources:sort', 'recent', ['recent', 'name']))
    setFolderId(readFolderParam())
    const onPop = () => { setFolderId(readFolderParam()); setQuery('') }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  useEffect(() => {
    if (!newOpen) return
    const close = (e: MouseEvent) => { if (!newRef.current?.contains(e.target as Node)) setNewOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [newOpen])

  const init = async () => {
    const b = auth.broker!
    setBroker(b)

    const isOwner = b.is_owner !== false
    const oid = isOwner ? b.id : (b.parent_broker_id ?? b.id)
    setOfficeBrokerId(oid)

    // 룰: 대표=사무소 전체. 직원=대표가 올린 자료 + 본인이 올린 자료(다른 직원이 올린 건 안 보임).
    let q = supabase
      .from('office_resources')
      .select(`${SELECT_RESOURCE}, files:office_resource_files(${SELECT_FILE})`)
      .eq('office_broker_id', oid)
    if (!isOwner) {
      const allowed = [b.id, b.parent_broker_id].filter(Boolean) as string[]
      q = q.in('uploader_broker_id', allowed)
    }
    const { data } = await q.order('created_at', { ascending: false })

    const list = (data ?? []).map((r: any) => ({
      ...r,
      files: Array.isArray(r.files) ? [...r.files].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)) : [],
    }))
    setResources(list as Resource[])
    setLoading(false)

    // 파일마다 누가 넣었는지 — 남의 폴더에도 파일을 넣을 수 있어서 폴더 주인과 다를 수 있다.
    // 저장 경로 두 번째 칸이 넣은 사람(broker id)이라 사무소 사람 이름만 받아 맞춘다. 화면은 기다리지 않는다.
    void (async () => {
      const { data: people } = await supabase
        .from('broker_profiles')
        .select('id, profiles(name)')
        .or(`id.eq.${oid},parent_broker_id.eq.${oid}`)
      const map: Record<string, string> = {}
      for (const p of (people ?? []) as any[]) if (p.profiles?.name) map[p.id] = p.profiles.name
      setNames(map)
    })()
  }

  const isOwnerOfOffice = officeBrokerId === broker?.id
  const canDelete = (r: Resource) => r.uploader_broker_id === broker?.id || isOwnerOfOffice
  // 수정(이름·메모)은 DB 규칙상 올린 본인만 된다
  const canEdit = (r: Resource) => r.uploader_broker_id === broker?.id

  const isMemo = (r: Resource) => (r.files?.length ?? 0) === 0 && !!r.description?.trim()
  const folders = useMemo(() => resources.filter(r => !isMemo(r)), [resources])
  const memos = useMemo(() => resources.filter(isMemo), [resources])
  const current = folderId ? resources.find(r => r.id === folderId) ?? null : null

  const openFolder = (id: string | null) => {
    setFolderId(id)
    setQuery('')
    setMemoExpanded(false)
    const url = id ? `${window.location.pathname}?folder=${id}` : window.location.pathname
    window.history.pushState({}, '', url)
    window.scrollTo({ top: 0 })
  }

  const changeView = (v: ViewMode) => { setView(v); writePref('resources:view', v) }
  const changeSort = () => { const s = sort === 'recent' ? 'name' : 'recent'; setSort(s); writePref('resources:sort', s) }

  const sortResources = (list: Resource[]) =>
    [...list].sort((a, b) => sort === 'name' ? byName(a.title, b.title) : b.created_at.localeCompare(a.created_at))
  const sortFiles = (list: ResourceFile[]) =>
    sort === 'name' ? [...list].sort((a, b) => byName(a.file_name, b.file_name)) : list

  // 폴더를 열면 그 안 사진의 미리보기 주소를 한 번에 받는다(비공개 버킷이라 서명 주소가 필요)
  useEffect(() => {
    const imgs = (current?.files ?? []).filter(isImage).filter(f => !thumbs[f.storage_path])
    if (imgs.length === 0) return
    let cancelled = false
    supabase.storage.from(BUCKET).createSignedUrls(imgs.map(f => f.storage_path), 3600).then(({ data }) => {
      if (cancelled || !data) return
      setThumbs(prev => {
        const next = { ...prev }
        data.forEach(d => { if (d.path && d.signedUrl) next[d.path] = d.signedUrl })
        return next
      })
    })
    return () => { cancelled = true }
  }, [current?.id, current?.files?.length])

  // ── 올리기 ─────────────────────────────────────────
  const checkFiles = (incoming: FileList | File[] | null | undefined): File[] => {
    const arr = Array.from(incoming ?? [])
    const oversized = arr.filter(f => f.size > MAX_FILE_SIZE)
    if (oversized.length > 0) {
      toast.error(`다음 파일은 20MB를 넘어서 뺐습니다:\n${oversized.map(f => `· ${f.name}`).join('\n')}`)
    }
    // 같은 이름·크기는 한 번만(같은 파일을 두 번 고르거나 끌어온 경우)
    const ok = arr.filter((f, i) => f.size <= MAX_FILE_SIZE && arr.findIndex(g => g.name === f.name && g.size === f.size) === i)
    if (ok.length > MAX_FILES) toast.error(`한 번에 ${MAX_FILES}개까지 올릴 수 있습니다.`)
    return ok.slice(0, MAX_FILES)
  }

  const uploadInto = async (target: Resource, incoming: File[]) => {
    if (!broker || !officeBrokerId || incoming.length === 0) return
    // 폴더에 이미 있는 파일(이름·크기 같음)은 다시 올리지 않는다
    const dup = incoming.filter(f => (target.files ?? []).some(x => x.file_name === f.name && x.file_size === f.size))
    if (dup.length > 0) toast.info(`이미 폴더에 있어서 뺐습니다:\n${dup.map(f => `· ${f.name}`).join('\n')}`)
    const list = incoming.filter(f => !dup.includes(f))
    if (list.length === 0) return
    const startOrder = Math.max(-1, ...(target.files ?? []).map(f => f.sort_order ?? 0)) + 1
    const added: ResourceFile[] = []
    setProgress({ done: 0, total: list.length })
    for (let i = 0; i < list.length; i++) {
      const f = list[i]
      const e = ext(f.name)
      const safeExt = /^[a-z0-9]{1,8}$/.test(e) ? `.${e}` : ''
      const path = `${officeBrokerId}/${broker.id}/${Date.now()}-${i}-${Math.random().toString(36).slice(2)}${safeExt}`
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, f, { upsert: false, contentType: f.type || undefined })
      if (upErr) { toast.error(`"${f.name}" 올리기 실패: ${upErr.message}`); continue }
      const { data: row, error: rowErr } = await supabase
        .from('office_resource_files')
        .insert({ resource_id: target.id, storage_path: path, file_name: f.name, file_size: f.size, file_type: f.type || null, sort_order: startOrder + i })
        .select(SELECT_FILE)
        .single()
      if (rowErr || !row) {
        toast.error(`"${f.name}" 저장 실패: ${rowErr?.message ?? ''}`)
        await supabase.storage.from(BUCKET).remove([path])
        continue
      }
      added.push(row as ResourceFile)
      setProgress({ done: i + 1, total: list.length })
    }
    setProgress(null)
    if (added.length > 0) {
      setResources(prev => prev.map(r => r.id === target.id ? { ...r, files: [...(r.files ?? []), ...added] } : r))
      toast.success(`${added.length}개 올렸습니다.`)
    }
  }

  // 폴더 안이면 바로 그 폴더에, 맨 위(자료실)면 새 폴더 이름부터 묻는다
  const handleIncoming = (incoming: FileList | File[] | null | undefined) => {
    const list = checkFiles(incoming)
    if (list.length === 0) return
    if (current && !isMemo(current)) { uploadInto(current, list); return }
    setDTitle(list[0].name.replace(/\.[^.]+$/, ''))
    setDText('')
    setDialog({ mode: 'folder', files: list })
  }

  const onFilePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleIncoming(e.target.files)
    e.target.value = ''
  }

  const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes('Files')
  const onDragEnter = (e: React.DragEvent) => {
    if (!hasFiles(e)) return
    e.preventDefault()
    dragDepth.current++
    setIsDragging(true)
  }
  const onDragLeave = (e: React.DragEvent) => {
    if (!hasFiles(e)) return
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setIsDragging(false)
  }
  const onDrop = (e: React.DragEvent) => {
    if (!hasFiles(e)) return
    e.preventDefault()
    dragDepth.current = 0
    setIsDragging(false)
    handleIncoming(e.dataTransfer.files)
  }

  // ── 만들기·고치기 ────────────────────────────────────
  const openDialog = (mode: DialogState['mode'], target?: Resource) => {
    setNewOpen(false)
    setDTitle(target?.title ?? '')
    setDText(target?.description ?? '')
    setDialog({ mode, target })
  }

  const submitDialog = async () => {
    if (!dialog || !broker || !officeBrokerId) return
    const t = dTitle.trim()
    if (!t) { toast.error('이름을 입력해주세요.'); return }
    if (dialog.mode === 'memo' && !dText.trim()) { toast.error('메모 내용을 입력해주세요.'); return }
    setSaving(true)
    try {
      if (dialog.mode === 'folder' || dialog.mode === 'memo') {
        const { data, error } = await supabase
          .from('office_resources')
          .insert({ office_broker_id: officeBrokerId, uploader_broker_id: broker.id, title: t, description: dialog.mode === 'memo' ? dText.trim() : null })
          .select(SELECT_RESOURCE)
          .single()
        if (error || !data) { toast.error(`만들기 실패: ${error?.message ?? ''}`); return }
        const created: Resource = { ...(data as any), files: [] }
        setResources(prev => [created, ...prev])
        setDialog(null)
        if (dialog.mode === 'folder') {
          openFolder(created.id)
          if (dialog.files?.length) await uploadInto(created, dialog.files)
        }
      } else if (dialog.target) {
        const patch = dialog.mode === 'rename' ? { title: t } : { title: t, description: dText.trim() || null }
        const { error } = await supabase.from('office_resources').update(patch).eq('id', dialog.target.id)
        if (error) { toast.error(`저장 실패: ${error.message}`); return }
        setResources(prev => prev.map(r => r.id === dialog.target!.id ? { ...r, ...patch } : r))
        if (memoView?.id === dialog.target.id) setMemoView(m => m ? { ...m, ...patch } : m)
        setDialog(null)
      }
    } finally {
      setSaving(false)
    }
  }

  // ── 받기·지우기 ──────────────────────────────────────
  const handleDownload = async (f: ResourceFile) => {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(f.storage_path, 60, { download: f.file_name })
    if (error || !data?.signedUrl) { toast.error(`다운로드 링크 생성 실패: ${error?.message ?? ''}`); return }
    window.open(data.signedUrl, '_blank')
  }

  const openFile = (f: ResourceFile, list: ResourceFile[]) => {
    const imgs = list.filter(isImage)
    if (isImage(f) && imgs.every(x => thumbs[x.storage_path])) {
      setLightbox({ urls: imgs.map(x => thumbs[x.storage_path]), files: imgs, index: imgs.indexOf(f) })
      return
    }
    handleDownload(f)
  }

  const removeResource = async (r: Resource) => {
    const n = r.files?.length ?? 0
    if (!confirm(`"${r.title}"${isMemo(r) ? ' 메모를' : ' 폴더를'} 삭제할까요?${n > 0 ? ` 안에 있는 파일 ${n}개도 함께 지워집니다.` : ''}`)) return
    const paths = (r.files ?? []).map(f => f.storage_path)
    if (paths.length > 0) await supabase.storage.from(BUCKET).remove(paths)
    const { error } = await supabase.from('office_resources').delete().eq('id', r.id)
    if (error) { toast.error(`삭제 실패: ${error.message}`); return }
    setResources(prev => prev.filter(x => x.id !== r.id))
    if (folderId === r.id) openFolder(null)
    if (memoView?.id === r.id) setMemoView(null)
  }

  const removeFile = async (r: Resource, f: ResourceFile) => {
    if (!confirm(`"${f.file_name}" 파일을 삭제할까요?`)) return
    const { error } = await supabase.from('office_resource_files').delete().eq('id', f.id)
    if (error) { toast.error(`삭제 실패: ${error.message}`); return }
    await supabase.storage.from(BUCKET).remove([f.storage_path])
    setResources(prev => prev.map(x => x.id === r.id ? { ...x, files: (x.files ?? []).filter(y => y.id !== f.id) } : x))
  }

  const copyText = async (s: string) => {
    try { await navigator.clipboard.writeText(s); toast.success('복사했습니다.') }
    catch { toast.error('복사하지 못했습니다. 길게 눌러 직접 복사해주세요.') }
  }

  const uploaderName = (r: Resource) => r.uploader?.profiles?.name ?? '—'
  const fileUploader = (r: Resource, f: ResourceFile) => {
    const id = f.storage_path.split('/')[1]
    return names[id] ?? (id === r.uploader_broker_id ? uploaderName(r) : '직원')
  }

  const resourceMenu = (r: Resource) => [
    ...(!isMemo(r) ? [{ label: '열기', icon: FolderOpen, onClick: () => openFolder(r.id) }] : [{ label: '메모 보기', icon: StickyNote, onClick: () => setMemoView(r) }]),
    ...(isMemo(r) ? [{ label: '내용 복사', icon: Copy, onClick: () => copyText(r.description ?? '') }] : []),
    ...(canEdit(r) ? [{ label: '이름 바꾸기', icon: Pencil, onClick: () => openDialog('rename', r) }] : []),
    ...(canEdit(r) ? [{ label: isMemo(r) ? '메모 고치기' : '폴더 메모', icon: StickyNote, onClick: () => openDialog('editMemo', r) }] : []),
    ...(canDelete(r) ? [{ label: '삭제', icon: Trash2, onClick: () => removeResource(r), danger: true }] : []),
  ]

  const fileMenu = (r: Resource, f: ResourceFile) => [
    { label: '다운로드', icon: Download, onClick: () => handleDownload(f) },
    ...(canDelete(r) ? [{ label: '삭제', icon: Trash2, onClick: () => removeFile(r, f), danger: true }] : []),
  ]

  // ── 검색 ───────────────────────────────────────────
  const q = query.trim().toLowerCase()
  const match = (s: string | null | undefined) => !!s && s.toLowerCase().includes(q)
  const rootFolders = sortResources(q ? folders.filter(r => match(r.title) || match(r.description)) : folders)
  const rootMemos = sortResources(q ? memos.filter(r => match(r.title) || match(r.description)) : memos)
  const fileHits = q
    ? folders.flatMap(r => (r.files ?? []).filter(f => match(f.file_name)).map(f => ({ r, f })))
    : []
  const folderFiles = current ? sortFiles((current.files ?? []).filter(f => !q || match(f.file_name))) : []

  if (loading) return (
    <div className="bg-gray-50 dark:bg-gray-950 flex items-center justify-center">
      <div className="text-gray-500 text-sm">불러오는 중...</div>
    </div>
  )

  // ── 조각들 ─────────────────────────────────────────
  const folderTile = (r: Resource) => (
    <div
      key={r.id}
      role="button"
      tabIndex={0}
      onClick={() => openFolder(r.id)}
      onKeyDown={e => { if (e.key === 'Enter') openFolder(r.id) }}
      className="group flex cursor-pointer items-center gap-3 rounded-xl border border-gray-100 bg-white py-2.5 pl-3.5 pr-1.5 hover:bg-blue-50/60 hover:border-blue-100 dark:border-gray-800 dark:bg-gray-900 dark:hover:bg-gray-800"
    >
      <Folder className="h-5 w-5 flex-shrink-0 fill-blue-600/15 text-blue-600" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-gray-900 dark:text-white">{r.title}</p>
        <p className="truncate text-[11px] text-gray-500">파일 {r.files?.length ?? 0}개 · {uploaderName(r)}{r.description ? ' · 메모' : ''}</p>
      </div>
      <ItemMenu label={r.title} items={resourceMenu(r)} />
    </div>
  )

  const memoTile = (r: Resource) => (
    <div
      key={r.id}
      role="button"
      tabIndex={0}
      onClick={() => setMemoView(r)}
      onKeyDown={e => { if (e.key === 'Enter') setMemoView(r) }}
      className="flex cursor-pointer flex-col overflow-hidden rounded-xl border border-gray-100 bg-white hover:border-amber-200 hover:shadow-sm dark:border-gray-800 dark:bg-gray-900"
    >
      <p className="line-clamp-4 h-[5.5rem] whitespace-pre-wrap bg-amber-50/70 px-3 py-2.5 text-[11px] leading-relaxed text-gray-600 dark:bg-amber-950/20 dark:text-gray-400">
        {r.description}
      </p>
      <div className="flex items-center gap-2 py-1.5 pl-3 pr-1">
        <StickyNote className="h-4 w-4 flex-shrink-0 text-amber-500" />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-gray-900 dark:text-white">{r.title}</span>
        <ItemMenu label={r.title} items={resourceMenu(r)} />
      </div>
    </div>
  )

  const fileTile = (r: Resource, f: ResourceFile, list: ResourceFile[]) => {
    const k = fileKind(f)
    const thumb = isImage(f) ? thumbs[f.storage_path] : undefined
    return (
      <div
        key={f.id}
        role="button"
        tabIndex={0}
        onClick={() => openFile(f, list)}
        onKeyDown={e => { if (e.key === 'Enter') openFile(f, list) }}
        title={f.file_name}
        className="flex cursor-pointer flex-col overflow-hidden rounded-xl border border-gray-100 bg-white hover:border-blue-200 hover:shadow-sm dark:border-gray-800 dark:bg-gray-900"
      >
        <div className={`flex aspect-[4/3] items-center justify-center overflow-hidden ${thumb ? 'bg-gray-100 dark:bg-gray-800' : k.bg}`}>
          {thumb
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={thumb} alt="" loading="lazy" className="h-full w-full object-contain p-1" />
            : <k.Icon className={`h-10 w-10 ${k.color}`} />}
        </div>
        <div className="flex items-center gap-1.5 py-1.5 pl-2.5 pr-1">
          <k.Icon className={`h-4 w-4 flex-shrink-0 ${k.color}`} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium text-gray-800 dark:text-gray-200">{f.file_name}</p>
            <p className="truncate text-[11px] text-gray-500">{fileUploader(r, f)}{f.created_at ? ` · ${formatDate(f.created_at)}` : ''}</p>
          </div>
          <ItemMenu label={f.file_name} items={fileMenu(r, f)} />
        </div>
      </div>
    )
  }

  const row = ({ id, icon, name, sub, meta, onOpen, menu }: { id: string; icon: React.ReactNode; name: string; sub?: string; meta: string; onOpen: () => void; menu: React.ReactNode }) => (
    <div
      key={id}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={e => { if (e.key === 'Enter') onOpen() }}
      className="flex cursor-pointer items-center gap-3 border-b border-gray-100 py-2 pl-3 pr-1 last:border-b-0 hover:bg-blue-50/50 dark:border-gray-800 dark:hover:bg-gray-800"
    >
      <span className="flex-shrink-0">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-gray-900 dark:text-white">{name}</p>
        {sub && <p className="truncate text-[11px] text-gray-500">{sub}</p>}
      </div>
      <span className="hidden flex-shrink-0 text-xs text-gray-500 sm:block">{meta}</span>
      {menu}
    </div>
  )

  const sectionTitle = (children: React.ReactNode) => (
    <h2 className="mb-2 mt-6 text-sm font-semibold text-gray-600 dark:text-gray-400 first:mt-0">{children}</h2>
  )

  const listBox = 'overflow-visible rounded-xl border border-gray-100 bg-white dark:border-gray-800 dark:bg-gray-900'
  const fileGrid = 'grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5'

  const renderFiles = (r: Resource, list: ResourceFile[], showFolder?: boolean) => view === 'grid'
    ? <div className={fileGrid}>{list.map(f => fileTile(r, f, list))}</div>
    : (
      <div className={listBox}>
        {list.map(f => {
          const k = fileKind(f)
          return (
            row({ id: f.id,
              icon: <k.Icon className={`h-5 w-5 ${k.color}`} />,
              name: f.file_name,
              sub: `${showFolder ? `📁 ${r.title} · ` : ''}${fileUploader(r, f)}${f.created_at ? ` · ${formatDate(f.created_at)}` : ''}`,
              meta: formatFileSize(f.file_size),
              onOpen: () => openFile(f, list),
              menu: <ItemMenu label={f.file_name} items={fileMenu(r, f)} />,
            })
          )
        })}
      </div>
    )

  const memoLong = (current?.description?.length ?? 0) > 200 || (current?.description?.split('\n').length ?? 0) > 4

  return (
    <div className="bg-gray-50 dark:bg-gray-950 min-h-screen" onDragEnter={onDragEnter} onDragOver={e => { if (hasFiles(e)) e.preventDefault() }} onDragLeave={onDragLeave} onDrop={onDrop}>
      <Header user={auth.user} role="broker" />
      <input ref={fileRef} type="file" multiple onChange={onFilePick} className="hidden" />
      <div className="mx-auto max-w-6xl px-4 py-8">
        <PageHeader
          icon={FolderOpen}
          iconColor="text-blue-600"
          title="자료실"
          description={broker?.office_name ? `${broker.office_name} · 사무소 내부 공유` : '사무소 내부 공유'}
          actions={
            <div ref={newRef} className="relative">
              <button
                onClick={() => setNewOpen(o => !o)}
                className="inline-flex items-center gap-1.5 rounded-2xl bg-white px-4 py-2.5 text-sm font-bold text-gray-800 shadow-md ring-1 ring-gray-100 hover:bg-blue-50 dark:bg-gray-900 dark:text-gray-100 dark:ring-gray-800"
              >
                <Plus className="h-5 w-5 text-blue-600" />
                새로 만들기
              </button>
              {newOpen && (
                <div className="absolute right-0 top-12 z-30 w-48 overflow-hidden rounded-xl border border-gray-100 bg-white py-1 shadow-lg dark:border-gray-800 dark:bg-gray-900">
                  {[
                    { label: current && !isMemo(current) ? '이 폴더에 파일 올리기' : '파일 올리기', icon: Upload, onClick: () => { setNewOpen(false); fileRef.current?.click() } },
                    { label: '새 폴더', icon: FolderPlus, onClick: () => openDialog('folder') },
                    { label: '새 메모', icon: StickyNote, onClick: () => openDialog('memo') },
                  ].map(it => (
                    <button key={it.label} onClick={it.onClick}
                      className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-sm text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-800">
                      <it.icon className="h-4 w-4 text-gray-500" />
                      {it.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          }
        />

        {/* 검색 + 보기 도구 */}
        <div className="mb-4 flex items-center gap-2">
          <label className="relative flex-1">
            <span className="sr-only">자료 검색</span>
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={current ? `${current.title} 안에서 검색` : '폴더·파일·메모 검색'}
              className="w-full rounded-full border border-transparent bg-gray-100 py-2.5 pl-10 pr-9 text-sm focus:border-blue-200 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:bg-gray-800 dark:focus:bg-gray-900"
            />
            {query && (
              <button onClick={() => setQuery('')} aria-label="검색어 지우기"
                className="absolute right-2.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </label>
          <button onClick={changeSort} title="정렬 바꾸기"
            className="inline-flex flex-shrink-0 items-center gap-1 rounded-full px-3 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800">
            <ArrowUpDown className="h-3.5 w-3.5" />
            {sort === 'recent' ? '최근순' : '이름순'}
          </button>
          <div className="flex flex-shrink-0 overflow-hidden rounded-full border border-gray-200 dark:border-gray-700">
            {([['grid', LayoutGrid, '바둑판 보기'], ['list', List, '목록 보기']] as const).map(([v, Icon, label]) => (
              <button key={v} onClick={() => changeView(v)} aria-label={label} aria-pressed={view === v}
                className={`flex h-9 w-10 items-center justify-center ${view === v ? 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300' : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800'}`}>
                <Icon className="h-4 w-4" />
              </button>
            ))}
          </div>
        </div>

        {/* 위치(빵부스러기) */}
        <nav aria-label="현재 위치" className="mb-4 flex min-h-9 items-center gap-1 text-lg">
          <button onClick={() => openFolder(null)}
            className={`rounded-full px-2 py-0.5 ${current ? 'text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800' : 'font-semibold text-gray-900 dark:text-white'}`}>
            자료실
          </button>
          {current && (
            <>
              <ChevronRight className="h-4 w-4 flex-shrink-0 text-gray-400" />
              <span className="truncate font-semibold text-gray-900 dark:text-white">{current.title}</span>
              <ItemMenu label={current.title} items={resourceMenu(current).filter(i => i.label !== '열기')} />
              <span className="ml-auto hidden flex-shrink-0 text-xs text-gray-500 sm:block">{uploaderName(current)} · {formatDate(current.created_at)}</span>
            </>
          )}
        </nav>
        {current && (
          <p className="-mt-3 mb-4 px-2 text-xs text-gray-500 sm:hidden">만든 사람 {uploaderName(current)} · {formatDate(current.created_at)}</p>
        )}

        {folderId && !current ? (
          <div className="rounded-2xl border border-gray-100 bg-white p-12 text-center dark:border-gray-800 dark:bg-gray-900">
            <p className="text-sm font-semibold text-gray-500">폴더를 찾을 수 없어요 (지워졌거나 볼 수 없는 폴더)</p>
            <button onClick={() => openFolder(null)} className="mt-3 text-sm font-semibold text-blue-600">자료실로 가기</button>
          </div>
        ) : current ? (
          /* ── 폴더 안 ── */
          <section aria-label={`${current.title} 폴더`}>
            {current.description && (
              <div className="mb-5 rounded-xl border border-amber-100 bg-amber-50/70 p-3.5 dark:border-amber-900/40 dark:bg-amber-950/20">
                <div className="mb-1 flex items-center gap-1.5">
                  <StickyNote className="h-4 w-4 text-amber-500" />
                  <span className="text-xs font-semibold text-amber-700 dark:text-amber-400">폴더 메모</span>
                  <button onClick={() => copyText(current.description ?? '')}
                    className="ml-auto inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-amber-700 hover:bg-amber-100 dark:text-amber-400 dark:hover:bg-amber-900/40">
                    <Copy className="h-3.5 w-3.5" />복사
                  </button>
                </div>
                <p className={`whitespace-pre-wrap text-sm text-gray-700 dark:text-gray-300 ${memoLong && !memoExpanded ? 'line-clamp-4' : ''}`}>{current.description}</p>
                {memoLong && (
                  <button onClick={() => setMemoExpanded(v => !v)} className="mt-1 text-xs font-semibold text-blue-600">
                    {memoExpanded ? '접기' : '더보기'}
                  </button>
                )}
              </div>
            )}

            {folderFiles.length > 0 ? (
              <>
                {sectionTitle(<>파일 {folderFiles.length}개</>)}
                {renderFiles(current, folderFiles)}
              </>
            ) : q ? (
              <p className="py-10 text-center text-sm text-gray-500">&quot;{query}&quot;에 맞는 파일이 없어요</p>
            ) : (
              <button onClick={() => fileRef.current?.click()}
                className="flex w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-gray-200 bg-white py-14 text-sm text-gray-500 hover:border-blue-300 hover:text-blue-600 dark:border-gray-700 dark:bg-gray-900">
                <Upload className="h-7 w-7" />
                <span className="font-semibold">빈 폴더예요</span>
                <span className="text-xs">파일을 여기로 끌어오거나 눌러서 고르세요</span>
              </button>
            )}
          </section>
        ) : (
          /* ── 자료실 맨 위 ── */
          <>
            {resources.length === 0 ? (
              <button onClick={() => openDialog('folder')}
                className="flex w-full flex-col items-center justify-center rounded-2xl border border-gray-100 bg-white p-12 text-center dark:border-gray-800 dark:bg-gray-900">
                <FolderOpen className="mx-auto mb-3 h-10 w-10 text-gray-200" />
                <span className="text-sm font-semibold text-gray-500">아직 올라온 자료가 없어요</span>
                <span className="mt-1 text-xs text-gray-500">폴더를 만들거나 파일을 끌어다 놓으세요</span>
              </button>
            ) : (
              <>
                {rootFolders.length > 0 && (
                  <>
                    {sectionTitle(<>폴더</>)}
                    {view === 'grid' ? (
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                        {rootFolders.map(r => folderTile(r))}
                      </div>
                    ) : (
                      <div className={listBox}>
                        {rootFolders.map(r => (
                          row({ id: r.id,
                            icon: <Folder className="h-5 w-5 fill-blue-600/15 text-blue-600" />,
                            name: r.title,
                            sub: `파일 ${r.files?.length ?? 0}개 · ${uploaderName(r)}`,
                            meta: formatDate(r.created_at),
                            onOpen: () => openFolder(r.id),
                            menu: <ItemMenu label={r.title} items={resourceMenu(r)} />,
                          })
                        ))}
                      </div>
                    )}
                  </>
                )}

                {rootMemos.length > 0 && (
                  <>
                    {sectionTitle(<>메모</>)}
                    {view === 'grid' ? (
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                        {rootMemos.map(r => memoTile(r))}
                      </div>
                    ) : (
                      <div className={listBox}>
                        {rootMemos.map(r => (
                          row({ id: r.id,
                            icon: <StickyNote className="h-5 w-5 text-amber-500" />,
                            name: r.title,
                            sub: r.description?.split('\n')[0],
                            meta: formatDate(r.created_at),
                            onOpen: () => setMemoView(r),
                            menu: <ItemMenu label={r.title} items={resourceMenu(r)} />,
                          })
                        ))}
                      </div>
                    )}
                  </>
                )}

                {fileHits.length > 0 && (
                  <>
                    {sectionTitle(<>파일 {fileHits.length}개</>)}
                    <div className={listBox}>
                      {fileHits.map(({ r, f }) => {
                        const k = fileKind(f)
                        return (
                          row({ id: f.id,
                            icon: <k.Icon className={`h-5 w-5 ${k.color}`} />,
                            name: f.file_name,
                            sub: `📁 ${r.title} · ${fileUploader(r, f)}`,
                            meta: formatFileSize(f.file_size),
                            onOpen: () => openFolder(r.id),
                            menu: <ItemMenu label={f.file_name} items={fileMenu(r, f)} />,
                          })
                        )
                      })}
                    </div>
                  </>
                )}

                {q && rootFolders.length + rootMemos.length + fileHits.length === 0 && (
                  <p className="py-10 text-center text-sm text-gray-500">&quot;{query}&quot;에 맞는 자료가 없어요</p>
                )}
              </>
            )}
          </>
        )}
      </div>

      {/* 끌어다 놓기 덮개 */}
      {isDragging && (
        <div className="pointer-events-none fixed inset-0 z-40 flex items-end justify-center bg-blue-600/10 p-8 ring-4 ring-inset ring-blue-500">
          <div className="rounded-2xl bg-blue-600 px-5 py-3 text-sm font-bold text-white shadow-lg">
            {current && !isMemo(current) ? `"${current.title}" 폴더에 놓으세요` : '놓으면 새 폴더에 올립니다'}
          </div>
        </div>
      )}

      {/* 올리는 중 */}
      {progress && (
        <div className="fixed bottom-6 right-6 z-40 w-64 rounded-xl bg-gray-900 p-3.5 text-white shadow-xl">
          <p className="text-sm font-semibold">올리는 중 {progress.done}/{progress.total}</p>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/20">
            <div className="h-full bg-blue-400 transition-all" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
          </div>
        </div>
      )}

      {/* 메모 보기 */}
      {memoView && (
        <div role="dialog" aria-modal="true" aria-label={memoView.title} className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setMemoView(null)}>
          <div className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-2xl bg-white shadow-xl dark:bg-gray-900" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-3 dark:border-gray-800">
              <StickyNote className="h-5 w-5 flex-shrink-0 text-amber-500" />
              <h2 className="min-w-0 flex-1 truncate font-bold text-gray-900 dark:text-white">{memoView.title}</h2>
              <button onClick={() => setMemoView(null)} aria-label="닫기" className="flex h-8 w-8 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800">
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="flex-1 overflow-y-auto whitespace-pre-wrap px-4 py-3 text-sm leading-relaxed text-gray-700 dark:text-gray-300">{memoView.description}</p>
            <div className="flex items-center gap-2 border-t border-gray-100 px-4 py-3 dark:border-gray-800">
              <span className="min-w-0 flex-1 truncate text-xs text-gray-500">{uploaderName(memoView)} · {formatDate(memoView.created_at)}</span>
              {canEdit(memoView) && (
                <button onClick={() => openDialog('editMemo', memoView)} className="inline-flex items-center gap-1 rounded-xl px-3 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800">
                  <Pencil className="h-4 w-4" />고치기
                </button>
              )}
              <button onClick={() => copyText(memoView.description ?? '')} className="inline-flex items-center gap-1 rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700">
                <Copy className="h-4 w-4" />전체 복사
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 만들기·고치기 창 */}
      {dialog && (
        <div role="dialog" aria-modal="true" className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={() => !saving && setDialog(null)}>
          <form
            className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl dark:bg-gray-900"
            onClick={e => e.stopPropagation()}
            onSubmit={e => { e.preventDefault(); submitDialog() }}
          >
            <h2 className="mb-3 font-bold text-gray-900 dark:text-white">
              {{ folder: dialog.files?.length ? `새 폴더에 ${dialog.files.length}개 올리기` : '새 폴더', rename: '이름 바꾸기', memo: '새 메모', editMemo: dialog.target && isMemo(dialog.target) ? '메모 고치기' : '폴더 메모' }[dialog.mode]}
            </h2>
            <label className="mb-1 block text-xs font-semibold text-gray-600 dark:text-gray-400">{dialog.mode === 'memo' || (dialog.mode === 'editMemo' && dialog.target && isMemo(dialog.target)) ? '제목' : '폴더 이름'}</label>
            <input
              autoFocus
              value={dTitle}
              onChange={e => setDTitle(e.target.value.slice(0, 120))}
              onFocus={e => e.target.select()}
              maxLength={120}
              placeholder={dialog.mode === 'memo' ? '예: 표시광고 복붙' : '예: 계약서 양식'}
              className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700 dark:bg-gray-900"
            />
            {(dialog.mode === 'memo' || dialog.mode === 'editMemo') && (
              <>
                <label className="mb-1 mt-3 block text-xs font-semibold text-gray-600 dark:text-gray-400">내용</label>
                <textarea
                  value={dText}
                  onChange={e => setDText(e.target.value.slice(0, 2000))}
                  rows={8}
                  maxLength={2000}
                  placeholder="자주 복사하는 문구, 링크, 체크리스트 등"
                  className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700 dark:bg-gray-900"
                />
                <p className="mt-1 text-right text-[11px] text-gray-500">{dText.length}/2000</p>
              </>
            )}
            {dialog.files && dialog.files.length > 0 && (
              <ul className="mt-3 max-h-32 space-y-1 overflow-y-auto text-xs text-gray-600 dark:text-gray-400">
                {dialog.files.map((f, i) => <li key={i} className="truncate">· {f.name} <span className="text-gray-400">({formatFileSize(f.size)})</span></li>)}
              </ul>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setDialog(null)} disabled={saving}
                className="rounded-xl px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800">
                취소
              </button>
              <button type="submit" disabled={saving}
                className="rounded-xl bg-blue-600 px-5 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50">
                {saving ? '저장 중...' : dialog.mode === 'folder' || dialog.mode === 'memo' ? '만들기' : '저장'}
              </button>
            </div>
          </form>
        </div>
      )}

      {lightbox && (
        <ImageLightbox
          images={lightbox.urls}
          index={lightbox.index}
          onClose={() => setLightbox(null)}
          onNext={() => setLightbox(l => l && { ...l, index: (l.index + 1) % l.urls.length })}
          onPrev={() => setLightbox(l => l && { ...l, index: (l.index - 1 + l.urls.length) % l.urls.length })}
          onGoTo={i => setLightbox(l => l && { ...l, index: i })}
          onDownload={i => handleDownload(lightbox.files[i])}
        />
      )}
    </div>
  )
}
