'use client'

import { canManageOffice, isDirector } from '@/lib/office-role'
import { useEffect, useState, useRef, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { fetchAllPaged } from '@/lib/fetch-all-paged'
import { mapLimit } from '@/lib/map-limit'
import { useAuth } from '@/lib/auth-context'
import { getOfficeMembers } from '@/lib/office-members'
import { Header } from '@/components/layout/header'
import { useRouter } from 'next/navigation'
import {
  FolderOpen, Folder, FolderPlus, FolderUp, Plus, FileText, FileSpreadsheet, FileImage, File as FileIcon, Palette,
  Download, Trash2, Upload, X, Search, LayoutGrid, List, ChevronRight, MoreVertical, Pencil, Copy,
  StickyNote, ArrowUpDown, ArrowLeft, ArrowRight, Star, Clock, HardDrive, FolderInput, Link2, Eye, Check, FileArchive,
} from 'lucide-react'
import { formatDate } from '@/lib/utils'
import { useToast } from '@/components/toast'
import { PageHeader } from '@/components/layout/page-header'
import { purgeResourceKeys, RESOURCE_TRASH_DAYS } from '@/lib/resource-trash'
import { ImageLightbox } from '@/components/image-lightbox'

// 구글드라이브처럼 쓰는 사무소 자료실.
// office_resources = 폴더(kind=folder) 또는 메모(kind=memo), parent_id 로 폴더 안에 들어간다.
// office_resource_files = 파일, resource_id 가 비어 있으면 맨 위(자료실)에 있는 파일.
// 권한(DB 가 막는다): 대표=모든 권한(전부 보기·고치기·옮기기·지우기),
// 직원=본인 것+대표 것만 보기, 고치기·옮기기·지우기는 본인 것만.
// 지우기는 휴지통으로(deleted_at) — 30일 지나면 대표나 올린 사람이 다음에 열 때 영구삭제된다.
// 휴지통(되살리기·영구삭제)은 바깥 휴지통 화면 '자료실' 탭에 있다(2026-11-06 합침, lib/resource-trash.ts).

interface ResourceFile {
  id: string
  resource_id: string | null
  office_broker_id: string
  uploader_broker_id: string | null
  storage_path: string
  file_name: string
  file_size: number | null
  file_type: string | null
  sort_order: number
  created_at: string
  deleted_at: string | null
}

interface Resource {
  id: string
  office_broker_id: string
  uploader_broker_id: string | null
  kind: 'folder' | 'memo'
  parent_id: string | null
  title: string
  description: string | null
  created_at: string
  deleted_at: string | null
  position?: number | null // 정해 둔 순서(작을수록 앞). 비면 지정 안 함
}

type Key = string // 'r:<id>' 폴더·메모 / 'f:<id>' 파일
type Tab = 'drive' | 'recent' | 'starred'
type ViewMode = 'grid' | 'list'
type SortMode = 'custom' | 'recent' | 'name' | 'size'
interface Incoming { file: File; rel: string } // rel: 폴더째 올릴 때 'A/B/파일.pdf'

const MAX_FILE_SIZE = 20 * 1024 * 1024 // 20MB per file
const MAX_FILES = 300
const TRASH_DAYS = RESOURCE_TRASH_DAYS
const LINK_DAYS = 7
const BUCKET = 'office-resources'
// '*' — 순서 칸(position)이 DB 에 아직 없어도 깨지지 않게
const SELECT_RESOURCE = '*'
const SELECT_FILE = 'id, resource_id, office_broker_id, uploader_broker_id, storage_path, file_name, file_size, file_type, sort_order, created_at, deleted_at'
const DRAG_TYPE = 'application/x-busojang-items'

function formatFileSize(bytes: number | null | undefined): string {
  if (bytes == null) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

const ext = (name: string) => (name.includes('.') ? name.split('.').pop()!.toLowerCase() : '')
const rKey = (id: string): Key => `r:${id}`
const fKey = (id: string): Key => `f:${id}`
const byName = (a: string, b: string) => a.localeCompare(b, 'ko', { numeric: true })

function isImage(f: ResourceFile) {
  return (f.file_type ?? '').startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext(f.file_name))
}
const isPdf = (f: ResourceFile) => ext(f.file_name) === 'pdf' || f.file_type === 'application/pdf'

// 확장자별 아이콘·색 — 드라이브처럼 한눈에 종류가 보이게
function fileKind(f: ResourceFile): { Icon: typeof FileIcon; color: string; bg: string } {
  const e = ext(f.file_name)
  if (isImage(f)) return { Icon: FileImage, color: 'text-rose-500', bg: 'bg-rose-50 dark:bg-rose-950/40' }
  if (e === 'pdf') return { Icon: FileText, color: 'text-red-600', bg: 'bg-red-50 dark:bg-red-950/40' }
  if (['xls', 'xlsx', 'csv'].includes(e)) return { Icon: FileSpreadsheet, color: 'text-green-600', bg: 'bg-green-50 dark:bg-green-950/40' }
  if (['doc', 'docx'].includes(e)) return { Icon: FileText, color: 'text-blue-600', bg: 'bg-blue-50 dark:bg-blue-950/40' }
  if (['hwp', 'hwpx'].includes(e)) return { Icon: FileText, color: 'text-sky-500', bg: 'bg-sky-50 dark:bg-sky-950/40' }
  if (['ai', 'psd', 'eps'].includes(e)) return { Icon: Palette, color: 'text-orange-500', bg: 'bg-orange-50 dark:bg-orange-950/40' }
  if (['zip', '7z', 'rar'].includes(e)) return { Icon: FileArchive, color: 'text-amber-600', bg: 'bg-amber-50 dark:bg-amber-950/40' }
  return { Icon: FileIcon, color: 'text-gray-500', bg: 'bg-gray-100 dark:bg-gray-800' }
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

function readLocation(): { tab: Tab; folder: string | null } {
  if (typeof window === 'undefined') return { tab: 'drive', folder: null }
  const p = new URLSearchParams(window.location.search)
  const v = p.get('view')
  const tab: Tab = v === 'recent' || v === 'starred' ? v : 'drive'
  return { tab, folder: tab === 'drive' ? p.get('folder') : null }
}

// 끌어다 놓은 것에서 폴더까지 풀어 파일 목록으로 — webkitGetAsEntry 는 drop 이벤트 안에서 바로 불러야 한다
function readDropEntries(dt: DataTransfer): Promise<Incoming[]> {
  const entries = Array.from(dt.items ?? [])
    .map(i => (i.kind === 'file' ? (i as any).webkitGetAsEntry?.() : null))
    .filter(Boolean) as any[]
  if (entries.length === 0) return Promise.resolve(Array.from(dt.files).map(file => ({ file, rel: file.name })))
  const out: Incoming[] = []
  const walk = async (entry: any, prefix: string): Promise<void> => {
    if (entry.isFile) {
      const file: File = await new Promise((res, rej) => entry.file(res, rej))
      out.push({ file, rel: prefix + file.name })
    } else if (entry.isDirectory) {
      const reader = entry.createReader()
      for (;;) {
        const batch: any[] = await new Promise((res, rej) => reader.readEntries(res, rej))
        if (batch.length === 0) break
        for (const child of batch) await walk(child, `${prefix}${entry.name}/`)
      }
    }
  }
  return Promise.all(entries.map(e => walk(e, ''))).then(() => out)
}

// ⋮ 메뉴 — 바깥을 누르면 닫힌다
interface MenuItem { label: string; icon: typeof FileIcon; onClick: () => void; danger?: boolean }
// 메뉴는 화면에 고정해 띄운다 — 파일·메모 칸은 넘치는 부분을 잘라내서(overflow-hidden),
// 칸 안에 그리면 ⋮ 를 눌러도 메뉴가 잘려 아무것도 안 뜨는 것처럼 보였다.
function ItemMenu({ label, items }: { label: string; items: MenuItem[] }) {
  const [pos, setPos] = useState<{ right: number; top?: number; bottom?: number } | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!pos) return
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setPos(null) }
    const shut = () => setPos(null)
    document.addEventListener('mousedown', close)
    window.addEventListener('scroll', shut, true)
    window.addEventListener('resize', shut)
    return () => {
      document.removeEventListener('mousedown', close)
      window.removeEventListener('scroll', shut, true)
      window.removeEventListener('resize', shut)
    }
  }, [pos])
  const toggle = () => {
    if (pos) { setPos(null); return }
    const r = btnRef.current!.getBoundingClientRect()
    const right = Math.max(8, window.innerWidth - r.right)
    // 아래 자리가 모자라면 위로 펼친다
    const need = items.length * 44 + 12
    setPos(window.innerHeight - r.bottom < need && r.top > need
      ? { right, bottom: window.innerHeight - r.top + 4 }
      : { right, top: r.bottom + 4 })
  }
  if (items.length === 0) return null
  return (
    <div ref={ref} className="relative" onClick={e => e.stopPropagation()}>
      <button
        ref={btnRef}
        onClick={toggle}
        aria-label={`${label} 메뉴`}
        className="flex h-11 w-11 items-center justify-center rounded-full text-gray-500 hover:bg-gray-200/70 sm:h-8 sm:w-8 dark:hover:bg-gray-700"
      >
        <MoreVertical className="h-4 w-4" />
      </button>
      {pos && (
        <div style={pos} className="fixed z-50 w-44 overflow-hidden rounded-xl border border-gray-100 bg-white py-1 shadow-lg dark:border-gray-800 dark:bg-gray-900">
          {items.map(it => (
            <button
              key={it.label}
              onClick={() => { setPos(null); it.onClick() }}
              className={`flex w-full items-center gap-2.5 px-3 py-3 text-left text-sm hover:bg-gray-50 sm:py-2 dark:hover:bg-gray-800 ${it.danger ? 'text-red-600' : 'text-gray-700 dark:text-gray-200'}`}
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
  mode: 'folder' | 'memo' | 'renameRes' | 'renameFile' | 'editMemo'
  res?: Resource
  file?: ResourceFile
  parent?: string | null
}

export default function BrokerResourcesPage() {
  const supabase = createClient()
  const router = useRouter()
  const auth = useAuth()
  const toast = useToast()

  const [broker, setBroker] = useState<any>(null)
  const [officeBrokerId, setOfficeBrokerId] = useState<string | null>(null)
  const [resources, setResources] = useState<Resource[]>([])
  const [files, setFiles] = useState<ResourceFile[]>([])
  const [stars, setStars] = useState<Set<Key>>(new Set())
  const [names, setNames] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)

  const [tab, setTab] = useState<Tab>('drive')
  const [folderId, setFolderId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [view, setView] = useState<ViewMode>('grid')
  const [sort, setSort] = useState<SortMode>('recent')
  const [selected, setSelected] = useState<Set<Key>>(new Set())
  const [newOpen, setNewOpen] = useState(false)
  const [dialog, setDialog] = useState<DialogState | null>(null)
  const [dTitle, setDTitle] = useState('')
  const [dText, setDText] = useState('')
  const [saving, setSaving] = useState(false)
  const [memoView, setMemoView] = useState<Resource | null>(null)
  const [moveKeys, setMoveKeys] = useState<Key[] | null>(null)
  const [moveAt, setMoveAt] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [dropTarget, setDropTarget] = useState<string | null>(null) // 'root' | 폴더 id
  const [progress, setProgress] = useState<{ label: string; done: number; total: number } | null>(null)
  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  const [lightbox, setLightbox] = useState<{ urls: string[]; files: ResourceFile[]; index: number } | null>(null)
  const [memoExpanded, setMemoExpanded] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const dirRef = useRef<HTMLInputElement>(null)
  const newRef = useRef<HTMLDivElement>(null)
  const dragDepth = useRef(0)
  const dragKeys = useRef<Key[] | null>(null)
  // 폴더째 올릴 때 방금 만든 폴더를 바로 다시 찾으려고 최신 목록을 들고 있는다
  const resRef = useRef<Resource[]>([])
  resRef.current = resources
  // 올리는 중에 같은 파일을 또 고르면 아직 목록에 없어 중복 검사를 빠져나갔다 — 올리는 중인 것도 따로 들고 있는다
  const filesRef = useRef<ResourceFile[]>([])
  filesRef.current = files
  const uploadingRef = useRef<Set<string>>(new Set())
  // 쓰기 버튼을 빨리 두 번 누르면 같은 요청이 두 번 나갔다 — 쓰는 중에는 다음 누름을 버린다
  const busyRef = useRef(false)
  const exclusive = <A extends unknown[]>(fn: (...a: A) => Promise<void>) => async (...a: A) => {
    if (busyRef.current) return
    busyRef.current = true
    try { await fn(...a) } finally { busyRef.current = false }
  }
  // 휴대폰: 길게 누르면 고르기(드라이브처럼). 그 뒤 따라오는 누름은 열기로 치지 않는다
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressed = useRef(false)

  useEffect(() => {
    if (auth.loading) return
    if (!auth.user) { router.push('/auth/login?redirect=/broker/resources'); return }
    if (!auth.broker) { router.push('/broker/register'); return }
    init()
  }, [auth.loading, auth.user?.id, auth.broker?.id])

  // 보기 방식·정렬은 기기마다 기억. 위치(탭·폴더)는 주소에 담아 뒤로가기가 먹게 한다.
  useEffect(() => {
    setView(readPref<ViewMode>('resources:view', 'grid', ['grid', 'list']))
    setSort(readPref<SortMode>('resources:sort2', 'custom', ['custom', 'recent', 'name', 'size']))
    if (new URLSearchParams(window.location.search).get('view') === 'trash') { router.replace('/broker/trash?tab=resources'); return }
    const loc = readLocation()
    setTab(loc.tab); setFolderId(loc.folder)
    // 창을 연 채 뒤로 가면 창은 그대로인데 위치만 바뀌어, 새 폴더가 엉뚱한 곳에 생겼다 — 창도 닫는다
    const onPop = () => {
      const l = readLocation(); setTab(l.tab); setFolderId(l.folder); setQuery(''); setSelected(new Set())
      setDialog(null); setMoveKeys(null); setMemoView(null); setNewOpen(false)
    }
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

    // 볼 수 있는 범위는 DB 규칙이 정한다(대표=전부, 직원=본인+대표).
    // 한 번에 1000행까지만 와서 넘으면 조용히 잘렸다 — 이어받는다.
    // 폴더·메모는 적어 휴지통 것도 같이 받는다(지운 폴더 안 것이 맨 위로 튀어나오지 않게).
    const [rList, fList, { data: st }] = await Promise.all([
      fetchAllPaged<Resource>((from, to) => supabase.from('office_resources').select(SELECT_RESOURCE).eq('office_broker_id', oid)
        .order('created_at', { ascending: false }).order('id').range(from, to)),
      fetchAllPaged<ResourceFile>((from, to) => supabase.from('office_resource_files').select(SELECT_FILE).eq('office_broker_id', oid)
        .is('deleted_at', null).order('sort_order').order('id').range(from, to)),
      supabase.from('office_resource_stars').select('resource_id, file_id').eq('broker_id', b.id),
    ]).catch(err => { toast.error(`자료실을 불러오지 못했습니다: ${err?.message ?? ''}`); return [[] as Resource[], [] as ResourceFile[], { data: [] as { resource_id: string | null; file_id: string | null }[] }] as const })
    setResources(rList)
    setFiles(fList)
    setStars(new Set((st ?? []).map((s: any) => (s.resource_id ? rKey(s.resource_id) : fKey(s.file_id)))))
    setLoading(false)

    // 사무소 사람 목록은 화면끼리 같이 쓴다(office-members)
    void getOfficeMembers(oid).then(ms => {
      const map: Record<string, string> = {}
      for (const m of ms) if (m.name) map[m.id] = m.name
      setNames(map)
    }, () => {})

    // 30일 지난 내 휴지통은 비운다 — 휴지통 파일은 안 받았으니 30일 넘은 것만 따로 묻는다
    void (async () => {
      const cutoff = Date.now() - TRASH_DAYS * 86400000
      const oldFiles = await fetchAllPaged<ResourceFile>((from, to) => supabase.from('office_resource_files').select(SELECT_FILE)
        .eq('office_broker_id', oid).not('deleted_at', 'is', null).lt('deleted_at', new Date(cutoff).toISOString())
        .order('id').range(from, to)).catch(() => [] as ResourceFile[])
      const old = [
        ...rList.filter(r => r.deleted_at && (canManageOffice(b) || r.uploader_broker_id === b.id) && new Date(r.deleted_at).getTime() < cutoff).map(r => rKey(r.id)),
        ...oldFiles.filter(f => canManageOffice(b) || f.uploader_broker_id === b.id).map(f => fKey(f.id)),
      ]
      if (old.length > 0) void purge(old, rList, [...fList, ...oldFiles], b.id, oid)
    })()
  }


  // ── 권한·관계 ─────────────────────────────────────────
  // 대표·이사(2026-11-05 이사=대표 권한) — DB office_res_can_* 와 같은 규칙
  const isOwnerOfOffice = !!broker && (officeBrokerId === broker.id || isDirector(broker))
  const canManageId = (uploader: string | null) => isOwnerOfOffice || (!!uploader && uploader === broker?.id)
  const resById = useMemo(() => new Map(resources.map(r => [r.id, r])), [resources])
  const fileById = useMemo(() => new Map(files.map(f => [f.id, f])), [files])

  // 위 폴더가 안 보이면(지워졌거나 볼 수 없는 폴더) 맨 위에 있는 것으로 본다
  const parentOfRes = (r: Resource) => (r.parent_id && resById.has(r.parent_id) ? r.parent_id : null)
  const parentOfFile = (f: ResourceFile) => (f.resource_id && resById.has(f.resource_id) ? f.resource_id : null)
  const ancestorTrashed = (id: string | null): boolean => {
    for (let i = 0, cur = id; cur && i < 50; i++) {
      const r = resById.get(cur)
      if (!r) return false
      if (r.deleted_at) return true
      cur = parentOfRes(r)
    }
    return false
  }
  const resLive = (r: Resource) => !r.deleted_at && !ancestorTrashed(parentOfRes(r))
  const fileLive = (f: ResourceFile) => !f.deleted_at && !ancestorTrashed(parentOfFile(f))
  const pathOf = (id: string | null): Resource[] => {
    const out: Resource[] = []
    for (let i = 0, cur = id; cur && i < 50; i++) {
      const r = resById.get(cur)
      if (!r) break
      out.unshift(r)
      cur = parentOfRes(r)
    }
    return out
  }
  const isInside = (id: string | null, ancestor: string): boolean => pathOf(id).some(r => r.id === ancestor)

  const liveRes = useMemo(() => resources.filter(resLive), [resources, resById])
  const liveFiles = useMemo(() => files.filter(fileLive), [files, resById])
  const current = tab === 'drive' && folderId ? resById.get(folderId) ?? null : null
  const currentOk = !folderId || (!!current && current.kind === 'folder' && resLive(current))

  const uploaderOf = (id: string | null) => (id ? names[id] ?? '직원' : '탈퇴한 직원')
  const keyInfo = (k: Key) => k.startsWith('r:') ? resById.get(k.slice(2)) : fileById.get(k.slice(2))
  const canManageKey = (k: Key) => { const it = keyInfo(k); return !!it && canManageId(it.uploader_broker_id) }

  // ── 이동(주소) ───────────────────────────────────────
  const go = (nextTab: Tab, id: string | null = null) => {
    setTab(nextTab)
    setFolderId(nextTab === 'drive' ? id : null)
    setQuery('')
    setSelected(new Set())
    setMemoExpanded(false)
    const p = new URLSearchParams()
    if (nextTab !== 'drive') p.set('view', nextTab)
    else if (id) p.set('folder', id)
    const qs = p.toString()
    window.history.pushState({}, '', qs ? `${window.location.pathname}?${qs}` : window.location.pathname)
    window.scrollTo({ top: 0 })
  }
  const openFolder = (id: string | null) => go('drive', id)

  const changeView = (v: ViewMode) => { setView(v); writePref('resources:view', v) }
  const changeSort = () => {
    const s: SortMode = sort === 'custom' ? 'recent' : sort === 'recent' ? 'name' : sort === 'name' ? 'size' : 'custom'
    setSort(s); writePref('resources:sort2', s)
  }

  const folderSize = (id: string) => liveFiles.filter(f => isInside(parentOfFile(f), id)).reduce((n, f) => n + (f.file_size ?? 0), 0)
  // 지정순: 순서를 정한 것 먼저(작은 수부터), 나머지는 최근 것부터
  const sortRes = (list: Resource[]) => [...list].sort((a, b) =>
    sort === 'custom' ? ((a.position ?? Infinity) - (b.position ?? Infinity) || b.created_at.localeCompare(a.created_at))
      : sort === 'name' ? byName(a.title, b.title)
      : sort === 'size' ? folderSize(b.id) - folderSize(a.id)
        : b.created_at.localeCompare(a.created_at))
  const sortFiles = (list: ResourceFile[]) => [...list].sort((a, b) =>
    sort === 'name' ? byName(a.file_name, b.file_name)
      : sort === 'size' ? (b.file_size ?? 0) - (a.file_size ?? 0)
        : b.created_at.localeCompare(a.created_at))

  // ── 지금 보이는 목록 ──────────────────────────────────
  const q = query.trim().toLowerCase()
  const match = (s: string | null | undefined) => !!s && s.toLowerCase().includes(q)
  let shownFolders: Resource[] = []
  let shownMemos: Resource[] = []
  let shownFiles: ResourceFile[] = []
  let showLocation = false
  if (q) {
    // 검색은 드라이브처럼 자료실 전체에서
    shownFolders = liveRes.filter(r => r.kind === 'folder' && (match(r.title) || match(r.description)))
    shownMemos = liveRes.filter(r => r.kind === 'memo' && (match(r.title) || match(r.description)))
    shownFiles = liveFiles.filter(f => match(f.file_name))
    showLocation = true
  } else if (tab === 'drive') {
    shownFolders = liveRes.filter(r => r.kind === 'folder' && parentOfRes(r) === (folderId ?? null))
    shownMemos = liveRes.filter(r => r.kind === 'memo' && parentOfRes(r) === (folderId ?? null))
    shownFiles = liveFiles.filter(f => parentOfFile(f) === (folderId ?? null))
  } else if (tab === 'recent') {
    shownFiles = [...liveFiles].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 60)
    showLocation = true
  } else if (tab === 'starred') {
    shownFolders = liveRes.filter(r => r.kind === 'folder' && stars.has(rKey(r.id)))
    shownMemos = liveRes.filter(r => r.kind === 'memo' && stars.has(rKey(r.id)))
    shownFiles = liveFiles.filter(f => stars.has(fKey(f.id)))
    showLocation = true
  }
  if (tab !== 'recent') { shownFolders = sortRes(shownFolders); shownMemos = sortRes(shownMemos); shownFiles = sortFiles(shownFiles) }


  const shownKeys: Key[] = [...shownFolders.map(r => rKey(r.id)), ...shownMemos.map(r => rKey(r.id)), ...shownFiles.map(f => fKey(f.id))]

  // 보이는 사진 미리보기 주소를 한 번에 받는다(비공개 저장소라 서명 주소가 필요)
  const imagePaths = shownFiles.filter(isImage).map(f => f.storage_path).filter(p => !thumbs[p])
  const imageKey = imagePaths.join('|')
  useEffect(() => {
    if (imagePaths.length === 0) return
    let cancelled = false
    supabase.storage.from(BUCKET).createSignedUrls(imagePaths.slice(0, 100), 3600).then(({ data }) => {
      if (cancelled || !data) return
      setThumbs(prev => {
        const next = { ...prev }
        data.forEach(d => { if (d.path && d.signedUrl) next[d.path] = d.signedUrl })
        return next
      })
    })
    return () => { cancelled = true }
  }, [imageKey])

  // Esc 로 선택 해제, Delete 로 휴지통
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, textarea')) return
      if (e.key === 'Escape') setSelected(new Set())
      if (e.key === 'Delete' && selected.size > 0) trashKeysAct([...selected])
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  })

  // ── 올리기 ─────────────────────────────────────────
  const prepare = (list: Incoming[]): Incoming[] => {
    const oversized = list.filter(x => x.file.size > MAX_FILE_SIZE)
    if (oversized.length > 0) toast.error(`다음 파일은 20MB를 넘어서 뺐습니다:\n${oversized.slice(0, 10).map(x => `· ${x.file.name}`).join('\n')}`)
    // 같은 경로·크기는 한 번만(같은 파일을 두 번 고르거나 끌어온 경우)
    const ok = list.filter((x, i) => x.file.size <= MAX_FILE_SIZE && list.findIndex(y => y.rel === x.rel && y.file.size === x.file.size) === i)
    if (ok.length > MAX_FILES) toast.error(`한 번에 ${MAX_FILES}개까지 올릴 수 있습니다.`)
    return ok.slice(0, MAX_FILES)
  }

  // 'A/B' 경로의 폴더를 base 아래에 찾거나 만든다(같은 이름 폴더가 있으면 그 안에 넣는다)
  const ensureFolder = async (base: string | null, dir: string, cache: Map<string, string | null>): Promise<string | null> => {
    let parent = base
    let acc = ''
    for (const part of dir.split('/').filter(Boolean)) {
      acc += `/${part}`
      const ck = `${base ?? ''}${acc}`
      if (cache.has(ck)) { parent = cache.get(ck)!; continue }
      const found = resRef.current.find(r => r.kind === 'folder' && !r.deleted_at && (r.parent_id ?? null) === parent && r.title === part)
      if (found) { parent = found.id; cache.set(ck, parent); continue }
      const { data, error } = await supabase
        .from('office_resources')
        .insert({ office_broker_id: officeBrokerId, uploader_broker_id: broker.id, kind: 'folder', parent_id: parent, title: part.slice(0, 120) })
        .select(SELECT_RESOURCE)
        .single()
      if (error || !data) throw new Error(`폴더 "${part}" 만들기 실패: ${error?.message ?? ''}`)
      resRef.current = [data as Resource, ...resRef.current]
      setResources(prev => [data as Resource, ...prev])
      parent = (data as Resource).id
      cache.set(ck, parent)
    }
    return parent
  }

  const uploadTo = async (target: string | null, incoming: Incoming[]) => {
    if (!broker || !officeBrokerId) return
    const list = prepare(incoming)
    if (list.length === 0) return
    const cache = new Map<string, string | null>()
    const skipped: string[] = []
    const added: ResourceFile[] = []
    const mine: string[] = []
    setProgress({ label: '올리는 중', done: 0, total: list.length })
    try {
      for (let i = 0; i < list.length; i++) {
        const { file: f, rel } = list[i]
        const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : ''
        const folder = dir ? await ensureFolder(target, dir, cache) : target
        // 그 폴더에 이미 있거나 지금 올리는 중인 파일(이름·크기 같음)은 다시 올리지 않는다
        const sig = `${folder ?? ''}|${f.name}|${f.size}`
        if (uploadingRef.current.has(sig) || [...filesRef.current, ...added].some(x => !x.deleted_at && (x.resource_id ?? null) === folder && x.file_name === f.name && x.file_size === f.size)) {
          skipped.push(f.name)
          setProgress({ label: '올리는 중', done: i + 1, total: list.length })
          continue
        }
        uploadingRef.current.add(sig)
        mine.push(sig)
        const e = ext(f.name)
        const safeExt = /^[a-z0-9]{1,8}$/.test(e) ? `.${e}` : ''
        const path = `${officeBrokerId}/${broker.id}/${Date.now()}-${i}-${Math.random().toString(36).slice(2)}${safeExt}`
        const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, f, { upsert: false, contentType: f.type || undefined })
        if (upErr) { toast.error(`"${f.name}" 올리기 실패: ${upErr.message}`); continue }
        const { data: row, error: rowErr } = await supabase
          .from('office_resource_files')
          .insert({ resource_id: folder, office_broker_id: officeBrokerId, uploader_broker_id: broker.id, storage_path: path, file_name: f.name, file_size: f.size, file_type: f.type || null, sort_order: i })
          .select(SELECT_FILE)
          .single()
        if (rowErr || !row) {
          toast.error(`"${f.name}" 저장 실패: ${rowErr?.message ?? ''}`)
          await supabase.storage.from(BUCKET).remove([path])
          continue
        }
        added.push(row as ResourceFile)
        setFiles(prev => [...prev, row as ResourceFile])
        setProgress({ label: '올리는 중', done: i + 1, total: list.length })
      }
    } catch (err: any) {
      toast.error(err?.message ?? '올리기 중 오류')
    } finally {
      mine.forEach(s => uploadingRef.current.delete(s))
      setProgress(null)
    }
    if (skipped.length > 0) toast.info(`이미 있어서 뺐습니다:\n${skipped.slice(0, 10).map(n => `· ${n}`).join('\n')}${skipped.length > 10 ? `\n외 ${skipped.length - 10}개` : ''}`)
    if (added.length > 0) toast.success(`${added.length}개 올렸습니다.`)
  }

  const uploadHere = (list: Incoming[]) => {
    if (tab !== 'drive' || !currentOk) { toast.info('내 자료실로 옮겨서 올립니다.'); openFolder(null); void uploadTo(null, list); return }
    void uploadTo(folderId, list)
  }

  const onFilePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    // 폴더째 올릴 때만 '/' 를 폴더 경로로 본다 — 이름에 든 '/' 로 '..' 같은 폴더가 생겼다
    const list = Array.from(e.target.files ?? []).map(file => ({ file, rel: (file as any).webkitRelativePath || file.name.replace(/\//g, '_') }))
    e.target.value = ''
    if (list.length) uploadHere(list)
  }

  const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes('Files')
  const isItemDrag = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes(DRAG_TYPE)
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
    readDropEntries(e.dataTransfer).then(uploadHere)
  }

  // 폴더(또는 위치 표시줄)에 놓기 — 파일을 끌어오면 그 폴더에 올리고, 항목을 끌면 그 폴더로 옮긴다
  const dropProps = (target: string | null) => ({
    onDragOver: (e: React.DragEvent) => {
      const items = isItemDrag(e) && dragKeys.current && dragKeys.current.every(k => k !== (target ? rKey(target) : ''))
      if (!items && !hasFiles(e)) return
      e.preventDefault(); e.stopPropagation()
      e.dataTransfer.dropEffect = items ? 'move' : 'copy'
      setDropTarget(target ?? 'root')
    },
    onDragLeave: () => setDropTarget(t => (t === (target ?? 'root') ? null : t)),
    onDrop: (e: React.DragEvent) => {
      setDropTarget(null)
      if (isItemDrag(e) && dragKeys.current) {
        e.preventDefault(); e.stopPropagation()
        const keys = dragKeys.current
        dragKeys.current = null
        void moveTo(keys, target)
        return
      }
      if (hasFiles(e)) {
        e.preventDefault(); e.stopPropagation()
        dragDepth.current = 0; setIsDragging(false)
        readDropEntries(e.dataTransfer).then(list => uploadTo(target, list))
      }
    },
  })

  const dragProps = (k: Key) => ({
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      const keys = selected.has(k) ? [...selected] : [k]
      dragKeys.current = keys
      e.dataTransfer.setData(DRAG_TYPE, keys.join(','))
      e.dataTransfer.effectAllowed = 'move'
    },
    onDragEnd: () => { dragKeys.current = null; setDropTarget(null) },
    onTouchStart: () => {
      longPressed.current = false
      if (pressTimer.current) clearTimeout(pressTimer.current)
      pressTimer.current = setTimeout(() => {
        longPressed.current = true
        navigator.vibrate?.(20)
        toggleSelect(k)
      }, 500)
    },
    onTouchMove: () => { if (pressTimer.current) clearTimeout(pressTimer.current) },
    onTouchEnd: () => { if (pressTimer.current) clearTimeout(pressTimer.current) },
    onContextMenu: (e: React.MouseEvent) => { if (longPressed.current) e.preventDefault() },
  })

  // ── 만들기·이름·메모 ──────────────────────────────────
  const openDialog = (mode: DialogState['mode'], res?: Resource, file?: ResourceFile) => {
    setNewOpen(false)
    setDTitle(file ? file.file_name : res?.title ?? '')
    setDText(res?.description ?? '')
    // 새로 만들 자리는 창을 연 때의 폴더로 못 박는다
    setDialog({ mode, res, file, parent: tab === 'drive' && currentOk ? folderId : null })
  }

  const submitDialog = exclusive(async () => {
    if (!dialog || !broker || !officeBrokerId) return
    const t = dTitle.trim()
    if (!t) { toast.error('이름을 입력해주세요.'); return }
    if (dialog.mode === 'memo' && !dText.trim()) { toast.error('메모 내용을 입력해주세요.'); return }
    setSaving(true)
    try {
      if (dialog.mode === 'folder' || dialog.mode === 'memo') {
        const parent = dialog.parent ?? null
        const { data, error } = await supabase
          .from('office_resources')
          .insert({
            office_broker_id: officeBrokerId, uploader_broker_id: broker.id, kind: dialog.mode, parent_id: parent,
            title: t, description: dialog.mode === 'memo' ? dText.trim() : null,
          })
          .select(SELECT_RESOURCE)
          .single()
        if (error || !data) { toast.error(`만들기 실패: ${error?.message ?? ''}`); return }
        setResources(prev => [data as Resource, ...prev])
        if (tab !== 'drive' || !currentOk || folderId !== parent) openFolder(parent)
        setDialog(null)
      } else if (dialog.mode === 'renameFile' && dialog.file) {
        const { error } = await supabase.from('office_resource_files').update({ file_name: t.slice(0, 200) }).eq('id', dialog.file.id)
        if (error) { toast.error(`저장 실패: ${error.message}`); return }
        setFiles(prev => prev.map(f => f.id === dialog.file!.id ? { ...f, file_name: t.slice(0, 200) } : f))
        setDialog(null)
      } else if (dialog.res) {
        const patch = dialog.mode === 'renameRes' ? { title: t } : { title: t, description: dText.trim() || null }
        const { error } = await supabase.from('office_resources').update(patch).eq('id', dialog.res.id)
        if (error) { toast.error(`저장 실패: ${error.message}`); return }
        setResources(prev => prev.map(r => r.id === dialog.res!.id ? { ...r, ...patch } : r))
        if (memoView?.id === dialog.res.id) setMemoView(m => m ? { ...m, ...patch } : m)
        setDialog(null)
      }
    } finally {
      setSaving(false)
    }
  })

  // ── 옮기기 ─────────────────────────────────────────
  const moveTo = exclusive(async (keys: Key[], target: string | null) => {
    const mine = keys.filter(canManageKey)
    if (mine.length < keys.length) toast.info('직원은 본인이 올린 것만 옮길 수 있어 나머지는 그대로 뒀습니다.')
    // 폴더를 자기 안으로는 못 옮긴다
    const ok = mine.filter(k => !(k.startsWith('r:') && target && (target === k.slice(2) || isInside(target, k.slice(2)))))
    if (ok.length < mine.length) toast.error('폴더를 그 폴더 안으로는 옮길 수 없습니다.')
    const rIds = ok.filter(k => k.startsWith('r:')).map(k => k.slice(2)).filter(id => (resById.get(id)?.parent_id ?? null) !== target)
    const fIds = ok.filter(k => k.startsWith('f:')).map(k => k.slice(2)).filter(id => (fileById.get(id)?.resource_id ?? null) !== target)
    if (rIds.length + fIds.length === 0) return
    const [r1, r2] = await Promise.all([
      rIds.length ? supabase.from('office_resources').update({ parent_id: target }).in('id', rIds) : Promise.resolve({ error: null }),
      fIds.length ? supabase.from('office_resource_files').update({ resource_id: target }).in('id', fIds) : Promise.resolve({ error: null }),
    ])
    const err = r1.error || r2.error
    if (err) { toast.error(`옮기기 실패: ${err.message}`); return }
    setResources(prev => prev.map(r => rIds.includes(r.id) ? { ...r, parent_id: target } : r))
    setFiles(prev => prev.map(f => fIds.includes(f.id) ? { ...f, resource_id: target } : f))
    setSelected(new Set())
    const where = target ? resById.get(target)?.title ?? '폴더' : '내 자료실'
    toast.success(`${rIds.length + fIds.length}개를 "${where}"(으)로 옮겼습니다.`)
  })

  const startMove = (keys: Key[]) => {
    const mine = keys.filter(canManageKey)
    if (mine.length === 0) { toast.error('직원은 본인이 올린 것만 옮길 수 있습니다.'); return }
    setMoveKeys(mine)
    // 지금 폴더가 옮기는 폴더 자신(또는 그 안)이면 그 바깥에서 시작한다 — 자기 자신이 목적지로 잡혔다
    let at = tab === 'drive' && currentOk ? folderId : null
    for (const k of mine) {
      if (!k.startsWith('r:')) continue
      const id = k.slice(2)
      if (at && (at === id || isInside(at, id))) at = parentOfRes(resById.get(id)!)
    }
    setMoveAt(at)
  }
  const keyParent = (k: Key) => (k.startsWith('r:') ? resById.get(k.slice(2))?.parent_id : fileById.get(k.slice(2))?.resource_id) ?? null

  // ── 휴지통 ─────────────────────────────────────────
  const trashKeysAct = exclusive(async (keys: Key[]) => {
    const mine = keys.filter(canManageKey)
    if (mine.length === 0) { toast.error('직원은 본인이 올린 것만 지울 수 있습니다.'); return }
    if (mine.length < keys.length) toast.info('직원은 본인이 올린 것만 지울 수 있어 그것만 휴지통으로 옮겼습니다.')
    const now = new Date().toISOString()
    const rIds = mine.filter(k => k.startsWith('r:')).map(k => k.slice(2))
    const fIds = mine.filter(k => k.startsWith('f:')).map(k => k.slice(2))
    const [r1, r2] = await Promise.all([
      rIds.length ? supabase.from('office_resources').update({ deleted_at: now }).in('id', rIds) : Promise.resolve({ error: null }),
      fIds.length ? supabase.from('office_resource_files').update({ deleted_at: now }).in('id', fIds) : Promise.resolve({ error: null }),
    ])
    const err = r1.error || r2.error
    if (err) { toast.error(`삭제 실패: ${err.message}`); return }
    setResources(prev => prev.map(r => rIds.includes(r.id) ? { ...r, deleted_at: now } : r))
    setFiles(prev => prev.map(f => fIds.includes(f.id) ? { ...f, deleted_at: now } : f))
    setSelected(new Set())
    if (memoView && rIds.includes(memoView.id)) setMemoView(null)
    if (folderId && (rIds.includes(folderId) || rIds.some(id => isInside(folderId, id)))) openFolder(null)
    toast.success(`${mine.length}개를 휴지통으로 옮겼습니다. ${TRASH_DAYS}일 안에 메뉴의 휴지통에서 되살릴 수 있어요.`)
  })

  // 30일 지난 휴지통 비우기(조용히) — 휴지통 화면과 같은 규칙(lib/resource-trash.ts)
  const purge = exclusive(async (keys: Key[], rList: Resource[], fList: ResourceFile[], me: string, office: string) => {
    const { rIds, fIds, error } = await purgeResourceKeys(supabase, keys, rList, fList, u => office === me || isDirector(broker) || (!!u && u === me))
    if (error) return
    // 지운 폴더 안에 있던 남의 것은 맨 위로
    setFiles(prev => prev.filter(f => !fIds.has(f.id)).map(f => (f.resource_id && rIds.has(f.resource_id) ? { ...f, resource_id: null } : f)))
    setResources(prev => prev.filter(r => !rIds.has(r.id)).map(r => (r.parent_id && rIds.has(r.parent_id) ? { ...r, parent_id: null } : r)))
  })

  // ── 별표 ───────────────────────────────────────────
  const toggleStar = exclusive(async (keys: Key[]) => {
    if (!broker) return
    const allOn = keys.every(k => stars.has(k))
    if (allOn) {
      const rIds = keys.filter(k => k.startsWith('r:')).map(k => k.slice(2))
      const fIds = keys.filter(k => k.startsWith('f:')).map(k => k.slice(2))
      if (rIds.length) await supabase.from('office_resource_stars').delete().eq('broker_id', broker.id).in('resource_id', rIds)
      if (fIds.length) await supabase.from('office_resource_stars').delete().eq('broker_id', broker.id).in('file_id', fIds)
      setStars(prev => { const n = new Set(prev); keys.forEach(k => n.delete(k)); return n })
    } else {
      const add = keys.filter(k => !stars.has(k))
      const { error } = await supabase.from('office_resource_stars').insert(add.map(k => (
        k.startsWith('r:') ? { broker_id: broker.id, resource_id: k.slice(2) } : { broker_id: broker.id, file_id: k.slice(2) }
      )))
      if (error) { toast.error(`별표 실패: ${error.message}`); return }
      setStars(prev => { const n = new Set(prev); add.forEach(k => n.add(k)); return n })
    }
    setSelected(new Set())
  })

  // ── 순서(대표만) ─────────────────────────────────────
  // 같은 자리의 폴더(또는 메모)를 지금 보이는 순서대로 1,2,3… 다시 매기고 바뀐 것만 저장한다
  const hasPositionCol = resources.length > 0 && 'position' in resources[0]
  const canReorder = isOwnerOfOffice && hasPositionCol && tab === 'drive' && !q && sort === 'custom'
  const moveOrder = async (r: Resource, dir: -1 | 1) => {
    const list = r.kind === 'folder' ? shownFolders : shownMemos
    const i = list.findIndex(x => x.id === r.id)
    const j = i + dir
    if (i < 0 || j < 0 || j >= list.length) return
    const next = [...list];
    [next[i], next[j]] = [next[j], next[i]]
    // 순서가 비어 있는 뒤쪽 것은 어차피 정해 둔 것 뒤에 만든 순서로 서니 그대로 둔다 —
    // 처음 한 번 바꿀 때 목록 전체를 한 줄씩 고쳐 쓰던 것을 바꾼 자리까지만으로 줄였다.
    const upto = Math.max(i, j)
    const changed = next
      .map((x, idx) => ({ id: x.id, position: idx + 1, idx }))
      .filter(x => (x.idx <= upto || resById.get(x.id)?.position != null) && resById.get(x.id)?.position !== x.position)
      .map(({ id, position }) => ({ id, position }))
    const results = await mapLimit(changed, 4, c => supabase.from('office_resources').update({ position: c.position }).eq('id', c.id))
    const err = results.find(x => x.error)?.error
    if (err) { toast.error(`순서 바꾸기 실패: ${err.message}`); return }
    setResources(prev => prev.map(x => { const c = changed.find(y => y.id === x.id); return c ? { ...x, position: c.position } : x }))
  }

  // ── 받기·열기·링크 ────────────────────────────────────
  const handleDownload = async (f: ResourceFile) => {
    // download 옵션에 이름을 넘기면 storage-js 가 한 번 인코딩한 뒤 encodeURI 로 또 감싸
    // 한글 이름이 '%EC%A0%84….hwp' 로 저장된다. 이름은 직접 한 번만 인코딩해 붙인다.
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(f.storage_path, 60)
    if (error || !data?.signedUrl) { toast.error(`다운로드 링크 생성 실패: ${error?.message ?? ''}`); return }
    window.open(`${data.signedUrl}&download=${encodeURIComponent(f.file_name)}`, '_blank')
  }

  const previewPdf = async (f: ResourceFile) => {
    // PDF 를 못 보여 주는 브라우저(안드로이드 크롬 등)는 그냥 받는다 — 열면 저장소 이름(1779…pdf)으로 받아졌다
    if (navigator.pdfViewerEnabled === false) { void handleDownload(f); return }
    const w = window.open('', '_blank') // 팝업 차단을 피하려고 누른 순간 창부터 연다
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(f.storage_path, 3600)
    if (error || !data?.signedUrl) { w?.close(); toast.error(`열기 실패: ${error?.message ?? ''}`); return }
    if (w) w.location.href = data.signedUrl; else window.open(data.signedUrl, '_blank')
  }

  const copyLink = async (f: ResourceFile) => {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(f.storage_path, LINK_DAYS * 86400)
    if (error || !data?.signedUrl) { toast.error(`링크 만들기 실패: ${error?.message ?? ''}`); return }
    try {
      await navigator.clipboard.writeText(data.signedUrl)
      toast.success(`링크를 복사했습니다. 받는 사람은 로그인 없이 ${LINK_DAYS}일 동안 열 수 있어요.`)
    } catch { toast.error('복사하지 못했습니다.') }
  }

  const openFile = async (f: ResourceFile) => {
    const imgs = shownFiles.filter(isImage)
    if (isImage(f)) {
      // 미리보기 주소가 다 오기 전에 누르면 받기로 새던 것 — 모자란 주소는 그 자리에서 받아 연다
      const missing = imgs.filter(x => !thumbs[x.storage_path]).map(x => x.storage_path)
      let urls = thumbs
      if (missing.length > 0) {
        const { data } = await supabase.storage.from(BUCKET).createSignedUrls(missing.slice(0, 100), 3600)
        urls = { ...thumbs }
        data?.forEach(d => { if (d.path && d.signedUrl) urls[d.path] = d.signedUrl })
        setThumbs(prev => ({ ...prev, ...urls }))
      }
      const ready = imgs.filter(x => urls[x.storage_path])
      if (ready.includes(f)) {
        setLightbox({ urls: ready.map(x => urls[x.storage_path]), files: ready, index: ready.indexOf(f) })
        return
      }
    }
    if (isPdf(f)) { void previewPdf(f); return }
    void handleDownload(f)
  }

  const copyText = async (s: string) => {
    try { await navigator.clipboard.writeText(s); toast.success('복사했습니다.') }
    catch { toast.error('복사하지 못했습니다. 길게 눌러 직접 복사해주세요.') }
  }

  // 폴더·여러 개를 zip 으로 — 폴더 구조 그대로, 메모는 .txt 로
  const downloadZip = async (keys: Key[], zipName: string) => {
    const entries: { path: string; file?: ResourceFile; text?: string }[] = []
    const addRes = (r: Resource, prefix: string) => {
      if (r.kind === 'memo') { entries.push({ path: `${prefix}${r.title}.txt`, text: r.description ?? '' }); return }
      const base = `${prefix}${r.title}/`
      if (r.description) entries.push({ path: `${base}_폴더메모.txt`, text: r.description })
      liveFiles.filter(f => parentOfFile(f) === r.id).forEach(f => entries.push({ path: base + f.file_name, file: f }))
      liveRes.filter(c => parentOfRes(c) === r.id).forEach(c => addRes(c, base))
    }
    for (const k of keys) {
      const it = keyInfo(k)
      if (!it) continue
      if (k.startsWith('r:')) addRes(it as Resource, '')
      else entries.push({ path: (it as ResourceFile).file_name, file: it as ResourceFile })
    }
    const withFile = entries.filter(e => e.file)
    if (entries.length === 0) { toast.info('받을 파일이 없습니다.'); return }
    // 같은 경로는 (2), (3) 붙이기
    const used = new Map<string, number>()
    for (const e of entries) {
      const n = used.get(e.path) ?? 0
      used.set(e.path, n + 1)
      if (n > 0) e.path = e.path.replace(/(\.[^./]+)?$/, m => ` (${n + 1})${m}`)
    }
    setProgress({ label: '압축 준비', done: 0, total: withFile.length })
    try {
      const { data: signed, error } = withFile.length
        ? await supabase.storage.from(BUCKET).createSignedUrls(withFile.map(e => e.file!.storage_path), 600)
        : { data: [], error: null }
      if (error) throw error
      const urlOf = new Map((signed ?? []).map(s => [s.path, s.signedUrl]))
      const enc = new TextEncoder()
      const data: Record<string, [Uint8Array, { level: 0 }]> = {}
      let done = 0
      for (const e of entries) {
        if (e.text !== undefined) { data[e.path] = [enc.encode(e.text), { level: 0 }]; continue }
        const url = urlOf.get(e.file!.storage_path)
        if (!url) continue
        const res = await fetch(url)
        data[e.path] = [new Uint8Array(await res.arrayBuffer()), { level: 0 }]
        setProgress({ label: '압축 준비', done: ++done, total: withFile.length })
      }
      // 압축 도구는 받기를 누를 때만 불러온다(처음 열기 무게를 줄이려고)
      const { zip } = await import('fflate')
      const out: Uint8Array = await new Promise((res, rej) => zip(data, (err, d) => (err ? rej(err) : res(d))))
      const a = document.createElement('a')
      a.href = URL.createObjectURL(new Blob([out as BlobPart], { type: 'application/zip' }))
      a.download = `${zipName}.zip`
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 10000)
    } catch (err: any) {
      toast.error(`압축 실패: ${err?.message ?? ''}`)
    } finally {
      setProgress(null)
    }
  }

  // ── 선택 ───────────────────────────────────────────
  const toggleSelect = (k: Key) => setSelected(prev => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n })
  const selecting = selected.size > 0
  const activate = (k: Key, open: () => void) => (e: React.MouseEvent | React.KeyboardEvent) => {
    if (longPressed.current) { longPressed.current = false; return }
    if (selecting || ('ctrlKey' in e && (e.ctrlKey || e.metaKey))) { toggleSelect(k); return }
    open()
  }

  // ── 메뉴 ───────────────────────────────────────────
  const resMenu = (r: Resource): MenuItem[] => {
    const k = rKey(r.id)
    const mine = canManageId(r.uploader_broker_id)
    return [
      r.kind === 'folder'
        ? { label: '열기', icon: FolderOpen, onClick: () => openFolder(r.id) }
        : { label: '메모 보기', icon: StickyNote, onClick: () => setMemoView(r) },
      ...(r.kind === 'memo' ? [{ label: '내용 복사', icon: Copy, onClick: () => copyText(r.description ?? '') }] : []),
      ...(mine ? [{ label: '이름 바꾸기', icon: Pencil, onClick: () => openDialog('renameRes', r) }] : []),
      ...(mine ? [{ label: r.kind === 'memo' ? '메모 고치기' : '폴더 메모', icon: StickyNote, onClick: () => openDialog('editMemo', r) }] : []),
      ...(mine ? [{ label: '옮기기', icon: FolderInput, onClick: () => startMove([k]) }] : []),
      { label: stars.has(k) ? '별표 해제' : '별표', icon: Star, onClick: () => toggleStar([k]) },
      ...(r.kind === 'folder' ? [{ label: 'zip으로 받기', icon: Download, onClick: () => downloadZip([k], r.title) }] : []),
      ...(canReorder ? [
        { label: '앞으로', icon: ArrowLeft, onClick: () => moveOrder(r, -1) },
        { label: '뒤로', icon: ArrowRight, onClick: () => moveOrder(r, 1) },
      ] : []),
      { label: '선택', icon: Check, onClick: () => toggleSelect(k) },
      ...(mine ? [{ label: '삭제', icon: Trash2, onClick: () => trashKeysAct([k]), danger: true }] : []),
    ]
  }

  const fileMenu = (f: ResourceFile): MenuItem[] => {
    const k = fKey(f.id)
    const mine = canManageId(f.uploader_broker_id)
    return [
      ...(isPdf(f) || isImage(f) ? [{ label: '미리보기', icon: Eye, onClick: () => (isPdf(f) ? previewPdf(f) : openFile(f)) }] : []),
      { label: '다운로드', icon: Download, onClick: () => handleDownload(f) },
      { label: `링크 복사(${LINK_DAYS}일)`, icon: Link2, onClick: () => copyLink(f) },
      ...(mine ? [{ label: '이름 바꾸기', icon: Pencil, onClick: () => openDialog('renameFile', undefined, f) }] : []),
      ...(mine ? [{ label: '옮기기', icon: FolderInput, onClick: () => startMove([k]) }] : []),
      { label: stars.has(k) ? '별표 해제' : '별표', icon: Star, onClick: () => toggleStar([k]) },
      ...(parentOfFile(f) && (tab !== 'drive' || q) ? [{ label: '파일 위치 열기', icon: FolderOpen, onClick: () => openFolder(parentOfFile(f)) }] : []),
      { label: '선택', icon: Check, onClick: () => toggleSelect(k) },
      ...(mine ? [{ label: '삭제', icon: Trash2, onClick: () => trashKeysAct([k]), danger: true }] : []),
    ]
  }

  if (loading) return (
    <div className="bg-gray-50 dark:bg-gray-950 flex min-h-screen items-center justify-center">
      <div className="text-gray-500 text-sm">불러오는 중...</div>
    </div>
  )

  // ── 조각들(컴포넌트가 아니라 함수 — 다시 그릴 때 메뉴가 닫히지 않게) ──
  const locationText = (pid: string | null) => {
    const p = pathOf(pid)
    return p.length ? p.map(r => r.title).join(' › ') : '내 자료실'
  }

  const checkCircle = (k: Key) => (
    <button
      onClick={e => { e.stopPropagation(); toggleSelect(k) }}
      aria-label={selected.has(k) ? '선택 해제' : '선택'}
      aria-pressed={selected.has(k)}
      // 휴대폰은 마우스를 올릴 수 없으니 고르는 중일 때만 보인다(⋮ → 선택으로 시작)
      className={`h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border-2 transition ${selecting ? 'flex' : 'hidden sm:flex'} ${selected.has(k)
        ? 'border-blue-600 bg-blue-600 text-white'
        : `border-gray-300 bg-white/90 text-transparent hover:border-blue-400 dark:border-gray-600 dark:bg-gray-900/90 ${selecting ? '' : 'opacity-0 group-hover:opacity-100 focus:opacity-100'}`}`}
    >
      <Check className="h-3.5 w-3.5" />
    </button>
  )

  const starMark = (k: Key) => stars.has(k) ? <Star className="h-3.5 w-3.5 flex-shrink-0 fill-amber-400 text-amber-400" aria-label="별표" /> : null

  const tileRing = (k: Key, id?: string) =>
    selected.has(k) ? 'border-blue-500 ring-2 ring-blue-500/30 bg-blue-50/60 dark:bg-blue-950/30'
      : id && dropTarget === id ? 'border-blue-500 ring-2 ring-blue-500/40'
        : 'border-gray-100 dark:border-gray-800'

  const folderTile = (r: Resource) => {
    const k = rKey(r.id)
    const n = liveFiles.filter(f => parentOfFile(f) === r.id).length + liveRes.filter(c => parentOfRes(c) === r.id).length
    return (
      <div
        key={r.id}
        role="button"
        tabIndex={0}
        {...dragProps(k)}
        {...dropProps(r.id)}
        onClick={activate(k, () => openFolder(r.id))}
        onKeyDown={e => { if (e.key === 'Enter') activate(k, () => openFolder(r.id))(e) }}
        className={`group flex cursor-pointer select-none items-center gap-2.5 rounded-xl border [-webkit-touch-callout:none] bg-white py-2.5 pl-2.5 pr-1 hover:bg-blue-50/60 dark:bg-gray-900 dark:hover:bg-gray-800 ${tileRing(k, r.id)}`}
      >
        {checkCircle(k)}
        <Folder className="h-5 w-5 flex-shrink-0 fill-blue-600/15 text-blue-600" />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1 truncate text-sm font-semibold text-gray-900 dark:text-white"><span className="truncate">{r.title}</span>{starMark(k)}</p>
          <p className="truncate text-[11px] text-gray-500">
            {`${n}개 · ${uploaderOf(r.uploader_broker_id)}${r.description ? ' · 메모' : ''}`}
          </p>
        </div>
        <ItemMenu label={r.title} items={resMenu(r)} />
      </div>
    )
  }

  const memoTile = (r: Resource) => {
    const k = rKey(r.id)
    return (
      <div
        key={r.id}
        role="button"
        tabIndex={0}
        {...dragProps(k)}
        onClick={activate(k, () => setMemoView(r))}
        onKeyDown={e => { if (e.key === 'Enter') activate(k, () => setMemoView(r))(e) }}
        className={`group relative flex cursor-pointer select-none flex-col overflow-hidden rounded-xl border [-webkit-touch-callout:none] bg-white hover:shadow-sm dark:bg-gray-900 ${tileRing(k)}`}
      >
        <div className="absolute left-2 top-2">{checkCircle(k)}</div>
        <p className="line-clamp-4 h-[5.5rem] whitespace-pre-wrap bg-amber-50/70 px-3 py-2.5 text-[11px] leading-relaxed text-gray-600 dark:bg-amber-950/20 dark:text-gray-400">
          {r.description}
        </p>
        <div className="flex items-center gap-2 py-1.5 pl-3 pr-1">
          <StickyNote className="h-4 w-4 flex-shrink-0 text-amber-500" />
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1 truncate text-sm font-semibold text-gray-900 dark:text-white"><span className="truncate">{r.title}</span>{starMark(k)}</p>
            <p className="truncate text-[11px] text-gray-500">
              {showLocation ? locationText(parentOfRes(r)) : `${uploaderOf(r.uploader_broker_id)} · ${formatDate(r.created_at)}`}
            </p>
          </div>
          <ItemMenu label={r.title} items={resMenu(r)} />
        </div>
      </div>
    )
  }

  const fileTile = (f: ResourceFile) => {
    const k = fKey(f.id)
    const kind = fileKind(f)
    const thumb = isImage(f) ? thumbs[f.storage_path] : undefined
    return (
      <div
        key={f.id}
        role="button"
        tabIndex={0}
        {...dragProps(k)}
        onClick={activate(k, () => openFile(f))}
        onKeyDown={e => { if (e.key === 'Enter') activate(k, () => openFile(f))(e) }}
        title={f.file_name}
        className={`group relative flex cursor-pointer select-none flex-col overflow-hidden rounded-xl border [-webkit-touch-callout:none] bg-white hover:shadow-sm dark:bg-gray-900 ${tileRing(k)}`}
      >
        <div className="absolute left-2 top-2 z-10">{checkCircle(k)}</div>
        <div className={`flex aspect-[4/3] items-center justify-center overflow-hidden ${thumb ? 'bg-gray-50 dark:bg-gray-800' : kind.bg}`}>
          {thumb
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={thumb} alt="" loading="lazy" draggable={false} className="h-full w-full object-contain p-1" />
            : <kind.Icon className={`h-10 w-10 ${kind.color}`} />}
        </div>
        <div className="flex items-center gap-1.5 py-1.5 pl-2.5 pr-1">
          <kind.Icon className={`h-4 w-4 flex-shrink-0 ${kind.color}`} />
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1 text-xs font-medium text-gray-800 dark:text-gray-200"><span className="truncate">{f.file_name}</span>{starMark(k)}</p>
            <p className="truncate text-[11px] text-gray-500">
              {showLocation ? locationText(parentOfFile(f)) : `${uploaderOf(f.uploader_broker_id)} · ${formatDate(f.created_at)}`}
            </p>
          </div>
          <ItemMenu label={f.file_name} items={fileMenu(f)} />
        </div>
      </div>
    )
  }

  const row = (o: { k: Key; dropId?: string; icon: React.ReactNode; name: string; sub: string; meta: string; onOpen: () => void; menu: MenuItem[] }) => (
    <div
      key={o.k}
      role="button"
      tabIndex={0}
      {...dragProps(o.k)}
      {...(o.dropId ? dropProps(o.dropId) : {})}
      onClick={activate(o.k, o.onOpen)}
      onKeyDown={e => { if (e.key === 'Enter') activate(o.k, o.onOpen)(e) }}
      className={`group flex cursor-pointer select-none items-center gap-3 border-b [-webkit-touch-callout:none] py-2 pl-3 pr-1 last:border-b-0 hover:bg-blue-50/50 dark:hover:bg-gray-800 ${selected.has(o.k) ? 'bg-blue-50/70 dark:bg-blue-950/30' : ''} ${o.dropId && dropTarget === o.dropId ? 'ring-2 ring-inset ring-blue-500' : ''} border-gray-100 dark:border-gray-800`}
    >
      {checkCircle(o.k)}
      <span className="flex-shrink-0">{o.icon}</span>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1 text-sm font-medium text-gray-900 dark:text-white"><span className="truncate">{o.name}</span>{starMark(o.k)}</p>
        <p className="truncate text-[11px] text-gray-500">{o.sub}</p>
      </div>
      <span className="hidden flex-shrink-0 text-xs text-gray-500 sm:block">{o.meta}</span>
      <ItemMenu label={o.name} items={o.menu} />
    </div>
  )

  const resRow = (r: Resource) => row({
    k: rKey(r.id),
    dropId: r.kind === 'folder' ? r.id : undefined,
    icon: r.kind === 'folder' ? <Folder className="h-5 w-5 fill-blue-600/15 text-blue-600" /> : <StickyNote className="h-5 w-5 text-amber-500" />,
    name: r.title,
    sub: showLocation ? locationText(parentOfRes(r)) : `${uploaderOf(r.uploader_broker_id)} · ${formatDate(r.created_at)}`,
    meta: r.kind === 'folder' ? formatFileSize(folderSize(r.id)) : '메모',
    onOpen: () => (r.kind === 'folder' ? openFolder(r.id) : setMemoView(r)),
    menu: resMenu(r),
  })

  const fileRow = (f: ResourceFile) => {
    const kind = fileKind(f)
    return row({
      k: fKey(f.id),
      icon: <kind.Icon className={`h-5 w-5 ${kind.color}`} />,
      name: f.file_name,
      sub: `${showLocation ? `${locationText(parentOfFile(f))} · ` : ''}${uploaderOf(f.uploader_broker_id)} · ${formatDate(f.created_at)}`,
      meta: formatFileSize(f.file_size),
      onOpen: () => openFile(f),
      menu: fileMenu(f),
    })
  }

  const sectionTitle = (children: React.ReactNode) => (
    <h2 className="mb-2 mt-6 text-sm font-semibold text-gray-600 dark:text-gray-400 first:mt-0">{children}</h2>
  )
  const listBox = 'rounded-xl border border-gray-100 bg-white dark:border-gray-800 dark:bg-gray-900'

  const section = (title: string, rs: Resource[], fsList: ResourceFile[], kind: 'folder' | 'memo' | 'file') => {
    if (rs.length + fsList.length === 0) return null
    return (
      <>
        {sectionTitle(title)}
        {view === 'list'
          ? <div className={listBox}>{rs.map(resRow)}{fsList.map(fileRow)}</div>
          : kind === 'folder'
            ? <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{rs.map(folderTile)}</div>
            : kind === 'memo'
              ? <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{rs.map(memoTile)}</div>
              : <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">{fsList.map(fileTile)}</div>}
      </>
    )
  }

  const memoLong = (current?.description?.length ?? 0) > 200 || (current?.description?.split('\n').length ?? 0) > 4
  const crumbs = current ? pathOf(current.id) : []
  const selKeys = [...selected]
  const selAllMine = selKeys.every(canManageKey)

  const tabs: { id: Tab; label: string; icon: typeof FileIcon }[] = [
    { id: 'drive', label: '내 자료실', icon: HardDrive },
    { id: 'recent', label: '최근', icon: Clock },
    { id: 'starred', label: '별표', icon: Star },
  ]

  // 옮기기 창 — 폴더를 따라 들어가며 고른다
  // 옮기는 폴더 자신과 그 안의 폴더는 목적지로 내놓지 않는다
  const movingFolderIds = (moveKeys ?? []).filter(k => k.startsWith('r:')).map(k => k.slice(2))
  const moveFolders = moveKeys
    ? liveRes.filter(r => r.kind === 'folder' && parentOfRes(r) === moveAt && !movingFolderIds.some(id => r.id === id || isInside(r.id, id))).sort((a, b) => byName(a.title, b.title))
    : []
  const moveNoop = !!moveKeys && moveKeys.every(k => keyParent(k) === moveAt)

  return (
    <div className="bg-gray-50 dark:bg-gray-950 min-h-screen" onDragEnter={onDragEnter} onDragOver={e => { if (hasFiles(e)) e.preventDefault() }} onDragLeave={onDragLeave} onDrop={onDrop}>
      <Header user={auth.user} role="broker" />
      <input ref={fileRef} type="file" multiple onChange={onFilePick} className="hidden" />
      <input ref={dirRef} type="file" multiple onChange={onFilePick} className="hidden" {...({ webkitdirectory: '', directory: '' } as any)} />
      <div className="mx-auto max-w-6xl px-4 py-8">
        <PageHeader
          icon={FolderOpen}
          iconColor="text-blue-600"
          title="자료실"
          actions={
            <div ref={newRef} className="relative">
              <button
                onClick={() => setNewOpen(o => !o)}
                className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-2xl bg-white px-4 py-3 text-sm font-bold sm:py-2.5 text-gray-800 shadow-md ring-1 ring-gray-100 hover:bg-blue-50 dark:bg-gray-900 dark:text-gray-100 dark:ring-gray-800"
              >
                <Plus className="h-5 w-5 text-blue-600" />
                새로 만들기
              </button>
              {newOpen && (
                <div className="absolute right-0 top-12 z-30 w-52 overflow-hidden rounded-xl border border-gray-100 bg-white py-1 shadow-lg dark:border-gray-800 dark:bg-gray-900">
                  {[
                    { label: '새 폴더', icon: FolderPlus, onClick: () => openDialog('folder') },
                    { label: '파일 올리기', icon: Upload, onClick: () => { setNewOpen(false); fileRef.current?.click() } },
                    { label: '폴더째 올리기', icon: FolderUp, onClick: () => { setNewOpen(false); dirRef.current?.click() } },
                    { label: '새 메모', icon: StickyNote, onClick: () => openDialog('memo') },
                  ].map(it => (
                    <button key={it.label} onClick={it.onClick}
                      className="flex w-full items-center gap-2.5 px-3.5 py-3 text-left text-sm text-gray-700 hover:bg-gray-50 sm:py-2.5 dark:text-gray-200 dark:hover:bg-gray-800">
                      <it.icon className="h-4 w-4 text-gray-500" />
                      {it.label}
                    </button>
                  ))}
                  <p className="border-t border-gray-100 px-3.5 py-2 text-[11px] text-gray-500 dark:border-gray-800">파일 하나에 {MAX_FILE_SIZE / 1024 / 1024}MB까지 · 한 번에 {MAX_FILES}개까지</p>
                </div>
              )}
            </div>
          }
        />

        {/* 탭: 내 자료실 / 최근 / 별표 / 휴지통 */}
        <div className="mb-4 flex gap-1 overflow-x-auto border-b border-gray-200 dark:border-gray-800" role="tablist">
          {tabs.map(t => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => go(t.id)}
              {...(t.id === 'drive' ? dropProps(null) : {})}
              className={`-mb-px inline-flex flex-shrink-0 items-center gap-1.5 border-b-2 px-3 py-3 text-sm sm:py-2 font-semibold ${tab === t.id
                ? 'border-blue-600 text-blue-700 dark:text-blue-300'
                : 'border-transparent text-gray-500 hover:text-gray-800 dark:hover:text-gray-200'} ${t.id === 'drive' && dropTarget === 'root' ? 'bg-blue-50 dark:bg-blue-950' : ''}`}>
              <t.icon className="h-4 w-4" />
              {t.label}
            </button>
          ))}
          {/* 휴지통은 메뉴의 휴지통 하나로 합쳤다 — 자료실에서 지운 것도 거기 '자료실' 탭에 있다 */}
          <button role="tab" aria-selected={false} onClick={() => router.push('/broker/trash?tab=resources')}
            className="-mb-px inline-flex flex-shrink-0 items-center gap-1.5 border-b-2 border-transparent px-3 py-3 text-sm sm:py-2 font-semibold text-gray-500 hover:text-gray-800 dark:hover:text-gray-200">
            <Trash2 className="h-4 w-4" />휴지통
          </button>
        </div>

        {/* 도구줄 — 고른 게 있으면 선택 도구로 바뀐다 */}
        {selecting ? (
          <div className="sticky top-2 z-20 mb-4 flex flex-wrap items-center gap-1 rounded-full bg-blue-50 px-2 py-1.5 shadow-sm ring-1 ring-blue-100 dark:bg-blue-950 dark:ring-blue-900">
            <button onClick={() => setSelected(new Set())} aria-label="선택 해제" className="flex h-8 w-8 items-center justify-center rounded-full text-gray-600 hover:bg-white dark:text-gray-300 dark:hover:bg-gray-800">
              <X className="h-4 w-4" />
            </button>
            <span className="mr-2 text-sm font-semibold text-blue-800 dark:text-blue-200">{selected.size}개 선택</span>
            <button onClick={() => setSelected(new Set(shownKeys))} className="rounded-full px-2.5 py-1.5 text-xs font-semibold text-blue-700 hover:bg-white dark:text-blue-300 dark:hover:bg-gray-800">전체 선택</button>
            <div className="ml-auto flex flex-wrap items-center gap-0.5">
              <>
                  <button onClick={() => downloadZip(selKeys, `자료실_${selected.size}개`)} title="zip으로 받기" className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-sm font-semibold text-gray-700 hover:bg-white dark:text-gray-200 dark:hover:bg-gray-800"><Download className="h-4 w-4" /><span className="hidden sm:inline">받기</span></button>
                  {selAllMine && <button onClick={() => startMove(selKeys)} title="옮기기" className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-sm font-semibold text-gray-700 hover:bg-white dark:text-gray-200 dark:hover:bg-gray-800"><FolderInput className="h-4 w-4" /><span className="hidden sm:inline">옮기기</span></button>}
                  <button onClick={() => toggleStar(selKeys)} title="별표" className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-sm font-semibold text-gray-700 hover:bg-white dark:text-gray-200 dark:hover:bg-gray-800"><Star className="h-4 w-4" /><span className="hidden sm:inline">별표</span></button>
                  {selAllMine && <button onClick={() => trashKeysAct(selKeys)} title="삭제" className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-sm font-semibold text-red-600 hover:bg-white dark:hover:bg-gray-800"><Trash2 className="h-4 w-4" /><span className="hidden sm:inline">삭제</span></button>}
                </>
            </div>
          </div>
        ) : (
          <div className="mb-4 flex items-center gap-2">
            <label className="relative flex-1">
              <span className="sr-only">자료 검색</span>
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="자료실 전체에서 검색"
                className="w-full rounded-full border border-transparent bg-gray-100 py-2.5 pl-10 pr-9 text-sm focus:border-blue-200 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:bg-gray-800 dark:focus:bg-gray-900"
              />
              {query && (
                <button onClick={() => setQuery('')} aria-label="검색어 지우기"
                  className="absolute right-1 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </label>
            {tab !== 'recent' && (
              <button onClick={changeSort} title="정렬 바꾸기"
                className="inline-flex h-11 flex-shrink-0 items-center gap-1 rounded-full px-3 text-xs font-semibold sm:h-9 text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800">
                <ArrowUpDown className="h-3.5 w-3.5" />
                {sort === 'custom' ? '지정순' : sort === 'recent' ? '최근순' : sort === 'name' ? '이름순' : '크기순'}
              </button>
            )}
            <div className="flex flex-shrink-0 overflow-hidden rounded-full border border-gray-200 dark:border-gray-700">
              {([['grid', LayoutGrid, '바둑판 보기'], ['list', List, '목록 보기']] as const).map(([v, Icon, label]) => (
                <button key={v} onClick={() => changeView(v)} aria-label={label} aria-pressed={view === v}
                  className={`flex h-11 w-11 items-center justify-center sm:h-9 sm:w-10 ${view === v ? 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300' : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800'}`}>
                  <Icon className="h-4 w-4" />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 위치 — 각 칸에 끌어다 놓으면 그리로 옮겨진다 */}
        {tab === 'drive' && !q && (
          <>
            <nav aria-label="현재 위치" className="mb-1 flex min-h-9 flex-wrap items-center gap-0.5 text-lg">
              <button onClick={() => openFolder(null)} {...dropProps(null)}
                className={`rounded-full px-2 py-2 sm:py-0.5 ${dropTarget === 'root' ? 'bg-blue-100 dark:bg-blue-900' : ''} ${current ? 'text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800' : 'font-semibold text-gray-900 dark:text-white'}`}>
                내 자료실
              </button>
              {crumbs.map((c, i) => {
                const last = i === crumbs.length - 1
                return (
                  <span key={c.id} className="flex min-w-0 items-center gap-0.5">
                    <ChevronRight className="h-4 w-4 flex-shrink-0 text-gray-400" />
                    {last ? (
                      <>
                        <span className="truncate rounded-full px-2 py-0.5 font-semibold text-gray-900 dark:text-white">{c.title}</span>
                        {/* 열어 둔 폴더 자신의 앞으로·뒤로는 눌러도 보이는 게 없어 뺀다 */}
                        <ItemMenu label={c.title} items={resMenu(c).filter(it => !['열기', '선택', '앞으로', '뒤로'].includes(it.label))} />
                      </>
                    ) : (
                      <button onClick={() => openFolder(c.id)} {...dropProps(c.id)}
                        className={`truncate rounded-full px-2 py-2 sm:py-0.5 text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800 ${dropTarget === c.id ? 'bg-blue-100 dark:bg-blue-900' : ''}`}>
                        {c.title}
                      </button>
                    )}
                  </span>
                )
              })}
            </nav>
            {current && (
              <p className="mb-3 px-2 text-xs text-gray-500">만든 사람 {uploaderOf(current.uploader_broker_id)} · {formatDate(current.created_at)}</p>
            )}
          </>
        )}
        {(tab !== 'drive' || q) && (
          <h2 className="mb-3 px-1 text-lg font-semibold text-gray-900 dark:text-white">
            {q ? `"${query}" 검색 결과` : tab === 'recent' ? '최근에 올라온 파일' : '별표한 자료'}
          </h2>
        )}
        {tab === 'drive' && !q && !currentOk ? (
          <div className="rounded-2xl border border-gray-100 bg-white p-12 text-center dark:border-gray-800 dark:bg-gray-900">
            <p className="text-sm font-semibold text-gray-500">폴더를 찾을 수 없어요 (휴지통에 있거나 볼 수 없는 폴더)</p>
            <button onClick={() => openFolder(null)} className="mt-3 text-sm font-semibold text-blue-600">내 자료실로 가기</button>
          </div>
        ) : (
          <section aria-label={current ? `${current.title} 폴더` : '자료 목록'}>
            {tab === 'drive' && !q && current?.description && (
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

            {section('폴더', shownFolders, [], 'folder')}
            {section('메모', shownMemos, [], 'memo')}
            {section(tab === 'recent' ? '파일' : `파일 ${shownFiles.length}개`, [], shownFiles, 'file')}

            {shownKeys.length === 0 && (
              q ? <p className="py-10 text-center text-sm text-gray-500">&quot;{query}&quot;에 맞는 자료가 없어요</p>
                : tab === 'starred' ? <p className="py-16 text-center text-sm text-gray-500">⋮ 메뉴에서 별표를 누르면 여기 모입니다</p>
                  : tab === 'recent' ? <p className="py-16 text-center text-sm text-gray-500">아직 올라온 파일이 없어요</p>
                    : (
                      <button onClick={() => fileRef.current?.click()}
                        className="flex w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-gray-200 bg-white py-14 text-sm text-gray-500 hover:border-blue-300 hover:text-blue-600 dark:border-gray-700 dark:bg-gray-900">
                        <Upload className="h-7 w-7" />
                        <span className="font-semibold">{current ? '빈 폴더예요' : '아직 올라온 자료가 없어요'}</span>
                        <span className="text-xs">눌러서 파일을 고르거나, 파일·폴더를 여기로 끌어오세요 · 파일 하나에 {MAX_FILE_SIZE / 1024 / 1024}MB까지</span>
                      </button>
                    )
            )}
          </section>
        )}

        {/* 검색 결과엔 위치 표시줄이 없으니 이 안내도 숨긴다 */}
        {tab === 'drive' && !q && !selecting && shownKeys.length > 0 && (
          <>
            <p className="mt-6 hidden text-center text-[11px] text-gray-400 sm:block">
              끌어서 폴더·위치 표시줄에 놓으면 옮겨집니다 · Ctrl+클릭으로 여러 개 선택 · Delete 로 휴지통
            </p>
            <p className="mt-6 text-center text-[11px] text-gray-400 sm:hidden">
              길게 누르면 여러 개 고를 수 있어요 · 옮기기는 ⋮ 메뉴에서
            </p>
          </>
        )}
      </div>

      {/* 파일 끌어다 놓기 덮개 */}
      {isDragging && !dropTarget && (
        <div className="pointer-events-none fixed inset-0 z-40 flex items-end justify-center bg-blue-600/10 p-8 ring-4 ring-inset ring-blue-500">
          <div className="rounded-2xl bg-blue-600 px-5 py-3 text-sm font-bold text-white shadow-lg">
            {tab === 'drive' && current ? `"${current.title}" 폴더에 놓으세요` : '내 자료실에 놓으세요'}
          </div>
        </div>
      )}

      {/* 진행 */}
      {progress && (
        <div className="fixed bottom-20 right-4 z-40 w-64 rounded-xl bg-gray-900 p-3.5 text-white shadow-xl sm:bottom-6 sm:right-6">
          <p className="text-sm font-semibold">{progress.label} {progress.done}/{progress.total}</p>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/20">
            <div className="h-full bg-blue-400 transition-all" style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
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
              <span className="min-w-0 flex-1 truncate text-xs text-gray-500">{uploaderOf(memoView.uploader_broker_id)} · {formatDate(memoView.created_at)}</span>
              {canManageId(memoView.uploader_broker_id) && (
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

      {/* 옮기기 창 */}
      {moveKeys && (
        <div role="dialog" aria-modal="true" aria-label="옮기기" className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={() => setMoveKeys(null)}>
          <div className="flex max-h-[80vh] w-full max-w-md flex-col rounded-2xl bg-white shadow-xl dark:bg-gray-900" onClick={e => e.stopPropagation()}>
            <div className="border-b border-gray-100 px-4 py-3 dark:border-gray-800">
              <h2 className="font-bold text-gray-900 dark:text-white">{moveKeys.length}개 옮기기</h2>
              <div className="mt-1 flex flex-wrap items-center gap-0.5 text-sm">
                <button onClick={() => setMoveAt(null)} className={`rounded px-2 py-2 sm:py-0.5 ${moveAt ? 'text-blue-600' : 'font-semibold text-gray-900 dark:text-white'}`}>내 자료실</button>
                {pathOf(moveAt).map(c => (
                  <span key={c.id} className="flex items-center gap-0.5">
                    <ChevronRight className="h-3.5 w-3.5 text-gray-400" />
                    <button onClick={() => setMoveAt(c.id)} className={`rounded px-2 py-2 sm:py-0.5 ${c.id === moveAt ? 'font-semibold text-gray-900 dark:text-white' : 'text-blue-600'}`}>{c.title}</button>
                  </span>
                ))}
              </div>
            </div>
            <div className="min-h-[12rem] flex-1 overflow-y-auto py-1">
              {moveFolders.length === 0 && <p className="px-4 py-8 text-center text-sm text-gray-500">이 안에는 폴더가 없어요</p>}
              {moveFolders.map(r => (
                <button key={r.id} onClick={() => setMoveAt(r.id)}
                  className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm text-gray-800 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-800">
                  <Folder className="h-5 w-5 flex-shrink-0 fill-blue-600/15 text-blue-600" />
                  <span className="min-w-0 flex-1 truncate">{r.title}</span>
                  <ChevronRight className="h-4 w-4 text-gray-400" />
                </button>
              ))}
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-gray-100 px-4 py-3 dark:border-gray-800">
              <button onClick={() => setMoveKeys(null)} className="rounded-xl px-4 py-3 text-sm font-semibold text-gray-600 hover:bg-gray-100 sm:py-2 dark:text-gray-300 dark:hover:bg-gray-800">취소</button>
              <button onClick={() => { const k = moveKeys; setMoveKeys(null); void moveTo(k, moveAt) }} disabled={moveNoop}
                className="rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white hover:bg-blue-700 disabled:bg-gray-300 disabled:text-gray-600 sm:py-2 dark:disabled:bg-gray-700 dark:disabled:text-gray-300">
                {moveNoop ? '이미 이 폴더에 있어요' : moveAt ? `"${resById.get(moveAt)?.title}"(으)로 옮기기` : '여기(맨 위)로 옮기기'}
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
              {{ folder: '새 폴더', memo: '새 메모', renameRes: '이름 바꾸기', renameFile: '파일 이름 바꾸기', editMemo: dialog.res?.kind === 'memo' ? '메모 고치기' : '폴더 메모' }[dialog.mode]}
            </h2>
            <label className="mb-1 block text-xs font-semibold text-gray-600 dark:text-gray-400">
              {dialog.mode === 'renameFile' ? '파일 이름' : dialog.mode === 'memo' || dialog.res?.kind === 'memo' ? '제목' : '폴더 이름'}
            </label>
            <input
              autoFocus
              value={dTitle}
              onChange={e => setDTitle(e.target.value.slice(0, dialog.mode === 'renameFile' ? 200 : 120))}
              onFocus={e => {
                // 파일 이름은 확장자 앞까지만 골라 둔다(드라이브처럼)
                const v = e.target.value
                const dot = dialog.mode === 'renameFile' ? v.lastIndexOf('.') : -1
                e.target.setSelectionRange(0, dot > 0 ? dot : v.length)
              }}
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
          names={lightbox.files.map(f => f.file_name)}
        />
      )}
    </div>
  )
}
