'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/lib/auth-context'
import { useToast } from '@/components/toast'
import { formatPrice } from '@/lib/utils'
import {
  Sparkles, ArrowLeft, Megaphone, Building2, Home, Plus, Trash2,
  Eye, EyeOff, ArrowUp, ArrowDown, Search, ExternalLink
} from 'lucide-react'

type Kind = 'banner' | 'featured_property' | 'featured_broker'

interface Curation {
  id: string
  kind: Kind
  title: string | null
  body: string | null
  link: string | null
  image_url: string | null
  ref_id: string | null
  is_active: boolean
  sort_order: number
  starts_at: string | null
  ends_at: string | null
  created_at: string
  // 조인 표시용 (클라이언트 매핑)
  _label?: string
  _sub?: string
}

export default function AdminCurationPage() {
  const router = useRouter()
  const supabaseRef = useRef(createClient())
  const supabase = supabaseRef.current
  const auth = useAuth()
  const toast = useToast()

  const [loading, setLoading] = useState(true)
  const [banners, setBanners] = useState<Curation[]>([])
  const [brokers, setBrokers] = useState<Curation[]>([])
  const [properties, setProperties] = useState<Curation[]>([])

  useEffect(() => {
    if (auth.loading) return
    if (!auth.user) { router.push('/auth/login'); return }
    if (auth.profile?.role !== 'admin') { router.push('/'); return }
  }, [auth.loading, auth.user, auth.profile?.role, router])

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('site_curations')
      .select('*')
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: false })
    const rows = (data ?? []) as Curation[]

    const bannerRows = rows.filter(r => r.kind === 'banner')
    const brokerRows = rows.filter(r => r.kind === 'featured_broker')
    const propRows = rows.filter(r => r.kind === 'featured_property')

    // 참조 라벨 매핑
    const brokerIds = brokerRows.map(r => r.ref_id).filter(Boolean) as string[]
    const propIds = propRows.map(r => r.ref_id).filter(Boolean) as string[]
    if (brokerIds.length > 0) {
      const { data: bp } = await supabase
        .from('broker_profiles')
        .select('id, office_name, profiles(name)')
        .in('id', brokerIds)
      const m = new Map((bp ?? []).map((b: any) => [b.id, b]))
      brokerRows.forEach(r => {
        const b = r.ref_id ? m.get(r.ref_id) : null
        r._label = b?.office_name ?? '(삭제된 사무소)'
        r._sub = b?.profiles?.name ?? ''
      })
    }
    if (propIds.length > 0) {
      const { data: pp } = await supabase
        .from('broker_properties')
        .select('id, address, deal_type, price, monthly_rent')
        .in('id', propIds)
      const m = new Map((pp ?? []).map((p: any) => [p.id, p]))
      propRows.forEach(r => {
        const p = r.ref_id ? m.get(r.ref_id) : null
        r._label = p?.address ?? '(삭제된 매물)'
        r._sub = p ? `${p.deal_type ?? ''} ${p.price ? formatPrice(p.price) : ''}` : ''
      })
    }

    setBanners(bannerRows)
    setBrokers(brokerRows)
    setProperties(propRows)
    setLoading(false)
  }, [supabase])

  useEffect(() => {
    if (auth.profile?.role === 'admin') load()
  }, [auth.profile?.role, load])

  // 공통 액션
  const toggleActive = async (c: Curation) => {
    const { error } = await supabase.from('site_curations').update({ is_active: !c.is_active }).eq('id', c.id)
    if (error) { toast.error('변경 실패: ' + error.message); return }
    await load()
  }
  const remove = async (c: Curation) => {
    if (!window.confirm('이 항목을 메인 노출에서 제거할까요?')) return
    const { error } = await supabase.from('site_curations').delete().eq('id', c.id)
    if (error) { toast.error('삭제 실패: ' + error.message); return }
    toast.success('제거됨')
    await load()
  }
  const move = async (list: Curation[], idx: number, dir: -1 | 1) => {
    const other = idx + dir
    if (other < 0 || other >= list.length) return
    const a = list[idx], b = list[other]
    // sort_order 교환 (동일 값이면 인덱스로 재부여)
    const aOrder = a.sort_order, bOrder = b.sort_order
    await Promise.all([
      supabase.from('site_curations').update({ sort_order: bOrder }).eq('id', a.id),
      supabase.from('site_curations').update({ sort_order: aOrder }).eq('id', b.id),
    ])
    await load()
  }

  if (auth.loading || auth.profile?.role !== 'admin') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-950">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <header className="border-b border-gray-800 bg-gray-900 px-6 py-4">
        <div className="mx-auto flex max-w-5xl items-center gap-3">
          <Link href="/admin" aria-label="관리자 대시보드" className="flex h-9 w-9 items-center justify-center rounded-xl bg-gray-800 hover:bg-gray-700 transition-colors">
            <ArrowLeft className="h-4 w-4 text-gray-300" />
          </Link>
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-pink-500/20">
            <Sparkles className="h-5 w-5 text-pink-400" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-white">메인 노출 관리</h1>
            <p className="text-xs text-gray-500">상단 배너·추천 사무소·추천 매물을 직접 골라 메인에 노출</p>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-6 py-8 space-y-8">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
          </div>
        ) : (
          <>
            <BannerSection banners={banners} onReload={load} supabase={supabase} onToggle={toggleActive} onRemove={remove} onMove={(i, d) => move(banners, i, d)} />
            <FeaturedSection
              kind="featured_broker"
              title="추천 사무소"
              icon={Building2}
              items={brokers}
              onReload={load} supabase={supabase}
              onToggle={toggleActive} onRemove={remove} onMove={(i, d) => move(brokers, i, d)}
            />
            <FeaturedSection
              kind="featured_property"
              title="추천 매물"
              icon={Home}
              items={properties}
              onReload={load} supabase={supabase}
              onToggle={toggleActive} onRemove={remove} onMove={(i, d) => move(properties, i, d)}
            />
          </>
        )}
      </div>
    </div>
  )
}

// ── 배너 섹션 ──────────────────────────────────────────
function BannerSection({ banners, onReload, supabase, onToggle, onRemove, onMove }: {
  banners: Curation[]
  onReload: () => Promise<void>
  supabase: ReturnType<typeof createClient>
  onToggle: (c: Curation) => Promise<void>
  onRemove: (c: Curation) => Promise<void>
  onMove: (idx: number, dir: -1 | 1) => Promise<void>
}) {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [link, setLink] = useState('')
  const [busy, setBusy] = useState(false)

  const add = async () => {
    if (!title.trim()) return
    setBusy(true)
    const maxOrder = banners.reduce((m, b) => Math.max(m, b.sort_order), 0)
    const { error } = await supabase.from('site_curations').insert({
      kind: 'banner',
      title: title.trim(),
      body: body.trim() || null,
      link: link.trim() || null,
      sort_order: maxOrder + 1,
      is_active: true,
    })
    setBusy(false)
    if (error) return
    setTitle(''); setBody(''); setLink('')
    await onReload()
  }

  return (
    <section className="rounded-2xl border border-gray-800 bg-gray-900 p-5">
      <div className="mb-4 flex items-center gap-2">
        <Megaphone className="h-4 w-4 text-amber-400" />
        <h2 className="font-bold text-white">상단 배너</h2>
        <span className="text-xs text-gray-500">메인 최상단 띠 배너</span>
      </div>

      {/* 작성 */}
      <div className="space-y-2 rounded-xl border border-gray-800 bg-gray-800/40 p-4">
        <input value={title} onChange={e => setTitle(e.target.value)} maxLength={80}
          placeholder="배너 문구 * (예: 신규 가입 시 첫 제안 무료!)"
          className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none" />
        <input value={body} onChange={e => setBody(e.target.value)} maxLength={120}
          placeholder="보조 설명 (선택)"
          className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none" />
        <div className="flex gap-2">
          <input value={link} onChange={e => setLink(e.target.value)}
            placeholder="클릭 시 이동 링크 (선택, 예: /event)"
            className="flex-1 rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none" />
          <button onClick={add} disabled={busy || !title.trim()}
            className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
            <Plus className="h-4 w-4" /> 추가
          </button>
        </div>
      </div>

      {/* 목록 */}
      {banners.length === 0 ? (
        <p className="mt-4 py-6 text-center text-sm text-gray-500">등록된 배너가 없어요</p>
      ) : (
        <ul className="mt-4 space-y-2">
          {banners.map((b, i) => (
            <li key={b.id} className={`flex items-center gap-3 rounded-xl border border-gray-800 p-3 ${b.is_active ? 'bg-gray-800/40' : 'bg-gray-900 opacity-60'}`}>
              <div className="flex flex-col gap-0.5">
                <button onClick={() => onMove(i, -1)} disabled={i === 0} className="text-gray-500 hover:text-white disabled:opacity-30"><ArrowUp className="h-3.5 w-3.5" /></button>
                <button onClick={() => onMove(i, 1)} disabled={i === banners.length - 1} className="text-gray-500 hover:text-white disabled:opacity-30"><ArrowDown className="h-3.5 w-3.5" /></button>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-white truncate">{b.title}</p>
                {b.body && <p className="text-xs text-gray-500 truncate">{b.body}</p>}
                {b.link && <p className="text-[11px] text-blue-400 truncate">{b.link}</p>}
              </div>
              <CurationControls c={b} onToggle={onToggle} onRemove={onRemove} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

// ── 추천 사무소/매물 공통 섹션 ──────────────────────────
function FeaturedSection({ kind, title, icon: Icon, items, onReload, supabase, onToggle, onRemove, onMove }: {
  kind: 'featured_broker' | 'featured_property'
  title: string
  icon: React.ComponentType<{ className?: string }>
  items: Curation[]
  onReload: () => Promise<void>
  supabase: ReturnType<typeof createClient>
  onToggle: (c: Curation) => Promise<void>
  onRemove: (c: Curation) => Promise<void>
  onMove: (idx: number, dir: -1 | 1) => Promise<void>
}) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<any[]>([])
  const [searching, setSearching] = useState(false)

  const search = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!q.trim()) return
    setSearching(true)
    if (kind === 'featured_broker') {
      const { data } = await supabase
        .from('broker_profiles')
        .select('id, office_name, profiles(name)')
        .eq('is_owner', true)
        .ilike('office_name', `%${q.trim()}%`)
        .limit(10)
      setResults((data ?? []).map((b: any) => ({ id: b.id, label: b.office_name, sub: b.profiles?.name ?? '' })))
    } else {
      const { data } = await supabase
        .from('broker_properties')
        .select('id, address, deal_type, price')
        .eq('status', 'available')
        .ilike('address', `%${q.trim()}%`)
        .limit(10)
      setResults((data ?? []).map((p: any) => ({ id: p.id, label: p.address, sub: `${p.deal_type ?? ''} ${p.price ? formatPrice(p.price) : ''}` })))
    }
    setSearching(false)
  }

  const addRef = async (refId: string) => {
    if (items.some(it => it.ref_id === refId)) return
    const maxOrder = items.reduce((m, it) => Math.max(m, it.sort_order), 0)
    const { error } = await supabase.from('site_curations').insert({
      kind, ref_id: refId, sort_order: maxOrder + 1, is_active: true,
    })
    if (error) return
    setQ(''); setResults([])
    await onReload()
  }

  return (
    <section className="rounded-2xl border border-gray-800 bg-gray-900 p-5">
      <div className="mb-4 flex items-center gap-2">
        <Icon className="h-4 w-4 text-purple-400" />
        <h2 className="font-bold text-white">{title}</h2>
        <span className="text-xs text-gray-500">{items.length}개 노출 중</span>
      </div>

      {/* 검색 추가 */}
      <form onSubmit={search} className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
          <input value={q} onChange={e => setQ(e.target.value)}
            placeholder={kind === 'featured_broker' ? '사무소명 검색' : '매물 주소 검색'}
            className="w-full rounded-lg border border-gray-700 bg-gray-800 pl-9 pr-3 py-2 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none" />
        </div>
        <button type="submit" disabled={searching} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">검색</button>
      </form>

      {results.length > 0 && (
        <ul className="mt-2 rounded-xl border border-gray-800 bg-gray-800/40 divide-y divide-gray-800 overflow-hidden">
          {results.map(r => {
            const already = items.some(it => it.ref_id === r.id)
            return (
              <li key={r.id} className="flex items-center gap-3 px-3 py-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white truncate">{r.label}</p>
                  {r.sub && <p className="text-xs text-gray-500 truncate">{r.sub}</p>}
                </div>
                <button onClick={() => addRef(r.id)} disabled={already}
                  className="inline-flex items-center gap-1 rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-purple-700 disabled:opacity-40">
                  {already ? '추가됨' : <><Plus className="h-3.5 w-3.5" /> 추가</>}
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {/* 노출 목록 */}
      {items.length === 0 ? (
        <p className="mt-4 py-6 text-center text-sm text-gray-500">노출 중인 항목이 없어요</p>
      ) : (
        <ul className="mt-4 space-y-2">
          {items.map((it, i) => (
            <li key={it.id} className={`flex items-center gap-3 rounded-xl border border-gray-800 p-3 ${it.is_active ? 'bg-gray-800/40' : 'bg-gray-900 opacity-60'}`}>
              <div className="flex flex-col gap-0.5">
                <button onClick={() => onMove(i, -1)} disabled={i === 0} className="text-gray-500 hover:text-white disabled:opacity-30"><ArrowUp className="h-3.5 w-3.5" /></button>
                <button onClick={() => onMove(i, 1)} disabled={i === items.length - 1} className="text-gray-500 hover:text-white disabled:opacity-30"><ArrowDown className="h-3.5 w-3.5" /></button>
              </div>
              <span className="text-xs font-bold text-gray-500 w-5 text-center">{i + 1}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-white truncate">{it._label}</p>
                {it._sub && <p className="text-xs text-gray-500 truncate">{it._sub}</p>}
              </div>
              {it.ref_id && (
                <Link href={kind === 'featured_broker' ? `/broker/${it.ref_id}` : `/property/${it.ref_id}`} target="_blank"
                  className="text-gray-500 hover:text-white"><ExternalLink className="h-4 w-4" /></Link>
              )}
              <CurationControls c={it} onToggle={onToggle} onRemove={onRemove} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function CurationControls({ c, onToggle, onRemove }: {
  c: Curation
  onToggle: (c: Curation) => Promise<void>
  onRemove: (c: Curation) => Promise<void>
}) {
  return (
    <div className="flex items-center gap-1 flex-shrink-0">
      <button onClick={() => onToggle(c)}
        title={c.is_active ? '노출 끄기' : '노출 켜기'}
        className={`flex h-8 w-8 items-center justify-center rounded-lg ${c.is_active ? 'text-green-400 hover:bg-green-500/10' : 'text-gray-500 hover:bg-gray-800'}`}>
        {c.is_active ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
      </button>
      <button onClick={() => onRemove(c)} title="제거"
        className="flex h-8 w-8 items-center justify-center rounded-lg text-red-400 hover:bg-red-500/10">
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  )
}
