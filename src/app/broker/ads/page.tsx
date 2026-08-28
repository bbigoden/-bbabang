'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth-context'
import { createClient } from '@/lib/supabase/client'
import { Header } from '@/components/layout/header'
import { PageHeader } from '@/components/layout/page-header'
import { useToast } from '@/components/toast'
import { Megaphone, RefreshCw, Search, CircleCheck, TriangleAlert } from 'lucide-react'

/**
 * 광고관리 — 부동산뱅크에 등록한 매물 중 카페·블로그·당근에 광고할 것을 선별하고,
 * 어느 채널에 올라가 있는지 추적한다.
 *
 * 매물 원본은 부동산뱅크이며, 목록은 로컬 프로그램(부소장광고/npm run sync)이 채운다.
 * 거래완료로 표시하면 그 프로그램이 3개 채널에서 광고를 내린다.
 * 표시광고법상 계약된 매물의 광고는 즉시 내려야 하므로, 누락이 남지 않게 하는 것이 이 화면의 목적이다.
 */

type Post = {
  id: string
  channel: 'cafe' | 'blog' | 'daangn' | 'bank'
  external_id: string | null
  url: string | null
  status: 'pending' | 'posted' | 'removing' | 'removed' | 'failed'
  error: string | null
}

type Listing = {
  id: string
  bank_no: string
  bank_kind: string | null
  deal_type: string | null
  property_kind: string | null
  region: string | null
  address_detail: string | null
  area_supply: number | null
  area_exclusive: number | null
  price_text: string | null
  bank_period: string | null
  bank_status: string | null
  is_advertising: boolean
  contracted_at: string | null
  synced_at: string | null
  ad_posts: Post[]
}

const CHANNELS: Array<{ key: 'cafe' | 'blog' | 'daangn'; label: string }> = [
  { key: 'cafe', label: '카페' },
  { key: 'blog', label: '블로그' },
  { key: 'daangn', label: '당근' },
]

const CHANNEL_LABEL: Record<string, string> = {
  cafe: '카페', blog: '블로그', daangn: '당근', bank: '뱅크',
}

const m2ToPyeong = (m2: number | null) => (m2 ? (m2 * 0.3025).toFixed(1) : null)

/** 채널 게시 상태를 한 칸으로 표시 */
function ChannelCell({ post }: { post: Post | undefined }) {
  if (!post || post.status === 'pending') {
    return <span className="text-gray-300 dark:text-gray-600">–</span>
  }
  if (post.status === 'posted') {
    const body = <span className="text-green-600 dark:text-green-400">게시중</span>
    return post.url
      ? <a href={post.url} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-green-700">{body}</a>
      : body
  }
  if (post.status === 'removing') return <span className="text-amber-600 dark:text-amber-400">내리는 중</span>
  if (post.status === 'removed') return <span className="text-gray-400">내림</span>
  return <span className="text-red-600 dark:text-red-400" title={post.error ?? ''}>실패</span>
}

export default function AdsPage() {
  const router = useRouter()
  const auth = useAuth()
  const toast = useToast()
  const supabase = createClient()

  const [listings, setListings] = useState<Listing[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [tab, setTab] = useState<'all' | 'advertising' | 'takedown'>('all')

  useEffect(() => {
    if (auth.loading) return
    if (!auth.user) { router.push('/auth/login?redirect=/broker/ads'); return }
    if (!auth.broker) { router.push('/broker/register'); return }
    load()
  }, [auth.loading, auth.user?.id, auth.broker?.id])

  async function load() {
    setLoading(true)
    const { data, error } = await supabase
      .from('ad_listings')
      .select('*, ad_posts(id, channel, external_id, url, status, error)')
      .order('is_advertising', { ascending: false })
      .order('bank_no', { ascending: false })
    if (error) toast.error(`목록을 불러오지 못했습니다: ${error.message}`)
    setListings((data as Listing[]) ?? [])
    setLoading(false)
  }

  async function toggleAd(l: Listing) {
    const next = !l.is_advertising
    setListings(prev => prev.map(x => x.id === l.id ? { ...x, is_advertising: next } : x))
    const { error } = await supabase
      .from('ad_listings')
      .update({ is_advertising: next, updated_at: new Date().toISOString() })
      .eq('id', l.id)
    if (error) {
      setListings(prev => prev.map(x => x.id === l.id ? { ...x, is_advertising: !next } : x))
      toast.error(`변경하지 못했습니다: ${error.message}`)
    }
  }

  /** 거래완료 표시 — 실제 광고 내리기는 로컬 프로그램이 수행한다. */
  async function markContracted(l: Listing) {
    const live = l.ad_posts.filter(p => p.status === 'posted')
    const msg = live.length
      ? `${l.bank_no} 매물을 거래완료로 표시합니다.\n\n광고 중인 ${live.length}곳(${live.map(p => CHANNEL_LABEL[p.channel] ?? p.channel).join(', ')})에서 내려야 합니다.\n계속할까요?`
      : `${l.bank_no} 매물을 거래완료로 표시할까요?`
    if (!confirm(msg)) return

    const { error } = await supabase
      .from('ad_listings')
      .update({ contracted_at: new Date().toISOString(), is_advertising: false })
      .eq('id', l.id)
    if (error) { toast.error(`처리하지 못했습니다: ${error.message}`); return }
    toast.success(live.length ? '거래완료로 표시했습니다. 광고 내리기를 실행하세요.' : '거래완료로 표시했습니다.')
    load()
  }

  const filtered = useMemo(() => {
    const key = q.trim().toLowerCase()
    return listings.filter(l => {
      if (tab === 'advertising' && !l.is_advertising) return false
      if (tab === 'takedown') {
        const live = l.ad_posts.some(p => p.status === 'posted' || p.status === 'failed')
        if (!l.contracted_at || !live) return false
      }
      if (!key) return true
      return [l.bank_no, l.region, l.address_detail, l.property_kind, l.deal_type]
        .filter(Boolean).some(v => String(v).toLowerCase().includes(key))
    })
  }, [listings, q, tab])

  // 표시광고법상 즉시 내려야 하는 건들 — 화면 최상단에 경고로 띄운다
  const takedownCount = listings.filter(l =>
    l.contracted_at && l.ad_posts.some(p => p.status === 'posted' || p.status === 'failed')
  ).length
  const adCount = listings.filter(l => l.is_advertising).length

  if (auth.loading || !auth.broker) return null

  return (
    <>
      <Header />
      <main className="mx-auto max-w-7xl px-4 py-6">
        <PageHeader
          icon={Megaphone}
          title="광고관리"
          description="부동산뱅크 매물 중 카페·블로그·당근에 광고할 것을 선별하고, 게시 상태를 추적합니다."
        />

        {takedownCount > 0 && (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 p-3 text-sm dark:border-red-900 dark:bg-red-950">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
            <div>
              <p className="font-medium text-red-800 dark:text-red-300">
                거래완료된 매물 {takedownCount}건이 아직 광고 중입니다.
              </p>
              <p className="mt-0.5 text-red-700 dark:text-red-400">
                표시광고법상 즉시 내려야 합니다. 로컬 프로그램에서 <code className="rounded bg-red-100 px-1 dark:bg-red-900">npm run takedown</code> 을 실행하세요.
              </p>
            </div>
          </div>
        )}

        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-gray-200 dark:border-gray-800">
            {([
              ['all', `전체 ${listings.length}`],
              ['advertising', `광고중 ${adCount}`],
              ['takedown', `내려야 함 ${takedownCount}`],
            ] as const).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`px-3 py-1.5 text-sm first:rounded-l-lg last:rounded-r-lg ${
                  tab === key
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-600 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800'
                }`}
              >{label}</button>
            ))}
          </div>

          <div className="relative flex-1 min-w-[200px]">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="매물번호, 지역, 종류로 검색"
              className="w-full rounded-lg border border-gray-200 bg-white py-1.5 pl-8 pr-3 text-sm outline-none focus:ring-2 focus:ring-blue-300 dark:border-gray-800 dark:bg-gray-900"
            />
          </div>

          <button
            onClick={load}
            className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            <RefreshCw className="h-4 w-4" /> 새로고침
          </button>
        </div>

        {loading ? (
          <p className="py-16 text-center text-sm text-gray-500">불러오는 중…</p>
        ) : !listings.length ? (
          <div className="rounded-lg border border-dashed border-gray-300 py-16 text-center dark:border-gray-700">
            <p className="text-sm text-gray-500">아직 가져온 매물이 없습니다.</p>
            <p className="mt-1 text-xs text-gray-400">
              부소장광고 폴더에서 <code className="rounded bg-gray-100 px-1 dark:bg-gray-800">npm run sync</code> 를 실행하면
              부동산뱅크 매물을 가져옵니다.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-800">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="bg-gray-50 text-left text-xs text-gray-500 dark:bg-gray-900 dark:text-gray-400">
                <tr>
                  <th className="px-3 py-2 font-medium">광고</th>
                  <th className="px-3 py-2 font-medium">매물번호</th>
                  <th className="px-3 py-2 font-medium">종류</th>
                  <th className="px-3 py-2 font-medium">소재지</th>
                  <th className="px-3 py-2 font-medium">면적</th>
                  <th className="px-3 py-2 font-medium">가격</th>
                  <th className="px-3 py-2 font-medium">뱅크상태</th>
                  {CHANNELS.map(c => <th key={c.key} className="px-3 py-2 font-medium">{c.label}</th>)}
                  <th className="px-3 py-2 font-medium">거래</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {filtered.map(l => {
                  const done = !!l.contracted_at
                  return (
                    <tr key={l.id} className={done ? 'bg-gray-50/60 text-gray-400 dark:bg-gray-900/40' : ''}>
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={l.is_advertising}
                          disabled={done}
                          onChange={() => toggleAd(l)}
                          className="h-4 w-4 cursor-pointer accent-blue-600 disabled:cursor-not-allowed"
                        />
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">{l.bank_no}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {l.property_kind}
                        <span className="ml-1 text-xs text-gray-400">{l.deal_type}</span>
                      </td>
                      <td className="px-3 py-2">
                        {l.region}
                        {l.address_detail && <span className="ml-1 text-xs text-gray-400">{l.address_detail}</span>}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-xs">
                        {l.area_exclusive ? `전용 ${m2ToPyeong(l.area_exclusive)}평` : '–'}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">{l.price_text ?? '–'}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-xs text-gray-500">{l.bank_status ?? '–'}</td>
                      {CHANNELS.map(c => (
                        <td key={c.key} className="px-3 py-2 whitespace-nowrap text-xs">
                          <ChannelCell post={l.ad_posts.find(p => p.channel === c.key)} />
                        </td>
                      ))}
                      <td className="px-3 py-2">
                        {done ? (
                          <span className="flex items-center gap-1 whitespace-nowrap text-xs text-gray-400">
                            <CircleCheck className="h-3.5 w-3.5" /> 완료
                          </span>
                        ) : (
                          <button
                            onClick={() => markContracted(l)}
                            className="whitespace-nowrap rounded border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:border-blue-400 hover:text-blue-600 dark:border-gray-700 dark:text-gray-300"
                          >거래완료</button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {!filtered.length && (
              <p className="py-10 text-center text-sm text-gray-500">조건에 맞는 매물이 없습니다.</p>
            )}
          </div>
        )}
      </main>
    </>
  )
}
