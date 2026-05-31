'use client'

import { useEffect, useState, useRef } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { formatPrice } from '@/lib/utils'
import { Sparkles, X, Building2, Star, ArrowRight } from 'lucide-react'

interface CurationRow {
  id: string
  kind: string
  title: string | null
  body: string | null
  link: string | null
  ref_id: string | null
  is_active: boolean
  sort_order: number
  starts_at: string | null
  ends_at: string | null
}

function withinWindow(c: CurationRow, nowMs: number): boolean {
  if (c.starts_at && new Date(c.starts_at).getTime() > nowMs) return false
  if (c.ends_at && new Date(c.ends_at).getTime() < nowMs) return false
  return true
}

// ── 상단 띠 배너 ──────────────────────────────────────
export function SiteBanner() {
  const supabaseRef = useRef(createClient())
  const [banner, setBanner] = useState<CurationRow | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const { data } = await supabaseRef.current
        .from('site_curations')
        .select('*')
        .eq('kind', 'banner')
        .eq('is_active', true)
        .order('sort_order', { ascending: true })
      if (cancelled) return
      const now = Date.now()
      const active = (data ?? []).find((c: any) => withinWindow(c, now)) ?? null
      if (active) {
        try {
          if (localStorage.getItem(`bbabang_banner_dismissed_${active.id}`)) {
            setDismissed(true)
          }
        } catch { /* localStorage 접근 불가 무시 */ }
      }
      setBanner(active)
    })()
    return () => { cancelled = true }
  }, [])

  if (!banner || dismissed) return null

  const close = () => {
    setDismissed(true)
    try { localStorage.setItem(`bbabang_banner_dismissed_${banner.id}`, '1') } catch { /* 무시 */ }
  }

  const inner = (
    <div className="flex items-center gap-2 text-sm">
      <Sparkles className="h-4 w-4 flex-shrink-0 text-yellow-300" />
      <span className="font-semibold">{banner.title}</span>
      {banner.body && <span className="hidden text-blue-100 sm:inline">· {banner.body}</span>}
      {banner.link && <ArrowRight className="h-3.5 w-3.5 flex-shrink-0" />}
    </div>
  )

  return (
    <div className="relative z-30 bg-gradient-to-r from-blue-600 to-indigo-700 px-4 py-2.5 text-white">
      <div className="mx-auto flex max-w-5xl items-center justify-center pr-6">
        {banner.link ? (
          <Link href={banner.link} className="hover:underline underline-offset-4">{inner}</Link>
        ) : inner}
      </div>
      <button onClick={close} aria-label="배너 닫기"
        className="absolute right-3 top-1/2 -translate-y-1/2 flex h-6 w-6 items-center justify-center rounded-md text-white/80 hover:bg-white/15 hover:text-white">
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}

// ── 메인 추천 사무소·매물 ─────────────────────────────
interface FeaturedBroker { id: string; office_name: string | null; name: string | null; rating: number | null; review_count: number | null; district: string | null }
interface FeaturedProperty { id: string; address: string | null; deal_type: string | null; room_type: string | null; price: number | null; monthly_rent: number | null; images: string[] | null }

export function FeaturedMain() {
  const supabaseRef = useRef(createClient())
  const [brokers, setBrokers] = useState<FeaturedBroker[]>([])
  const [properties, setProperties] = useState<FeaturedProperty[]>([])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const { data: cur } = await supabaseRef.current
        .from('site_curations')
        .select('*')
        .in('kind', ['featured_broker', 'featured_property'])
        .eq('is_active', true)
        .order('sort_order', { ascending: true })
      if (cancelled || !cur) return
      const now = Date.now()
      const active = (cur as CurationRow[]).filter(c => withinWindow(c, now))
      const brokerIds = active.filter(c => c.kind === 'featured_broker').map(c => c.ref_id).filter(Boolean) as string[]
      const propIds = active.filter(c => c.kind === 'featured_property').map(c => c.ref_id).filter(Boolean) as string[]

      if (brokerIds.length > 0) {
        const { data } = await supabaseRef.current
          .from('broker_profiles')
          .select('id, office_name, rating, review_count, district, profiles(name)')
          .in('id', brokerIds)
        if (!cancelled && data) {
          // 큐레이션 순서 유지
          const order = new Map(brokerIds.map((id, i) => [id, i]))
          const rows = data.map((b: any) => ({ id: b.id, office_name: b.office_name, name: b.profiles?.name ?? null, rating: b.rating, review_count: b.review_count, district: b.district }))
          rows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
          setBrokers(rows)
        }
      }
      if (propIds.length > 0) {
        const { data } = await supabaseRef.current
          .from('broker_properties')
          .select('id, address, deal_type, room_type, price, monthly_rent, images')
          .in('id', propIds)
          .eq('status', 'available')
        if (!cancelled && data) {
          const order = new Map(propIds.map((id, i) => [id, i]))
          const rows = data as FeaturedProperty[]
          rows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
          setProperties(rows)
        }
      }
    })()
    return () => { cancelled = true }
  }, [])

  if (brokers.length === 0 && properties.length === 0) return null

  return (
    <section className="bg-white dark:bg-gray-900 px-4 py-16">
      <div className="mx-auto max-w-5xl space-y-12">
        {brokers.length > 0 && (
          <div>
            <div className="mb-6 flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-pink-500" />
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white">빠방 추천 중개사</h2>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {brokers.map(b => (
                <Link key={b.id} href={`/broker/${b.id}`}
                  className="rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 p-5 hover:border-blue-200 hover:shadow-md transition-all">
                  <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-xl bg-purple-50 dark:bg-purple-500/10 text-purple-600 dark:text-purple-400">
                    <Building2 className="h-5 w-5" />
                  </div>
                  <p className="font-bold text-gray-900 dark:text-white truncate">{b.office_name ?? '사무소'}</p>
                  <p className="text-sm text-gray-500 truncate">{b.name ?? ''}{b.district ? ` · ${b.district.split(',')[0]}` : ''}</p>
                  <div className="mt-2 flex items-center gap-1 text-sm">
                    <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />
                    <span className="font-semibold text-gray-900 dark:text-white">{b.rating ? Number(b.rating).toFixed(1) : '신규'}</span>
                    {(b.review_count ?? 0) > 0 && <span className="text-gray-500">({b.review_count})</span>}
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {properties.length > 0 && (
          <div>
            <div className="mb-6 flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-pink-500" />
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white">추천 매물</h2>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {properties.map(p => (
                <Link key={p.id} href={`/property/${p.id}`}
                  className="overflow-hidden rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 hover:border-blue-200 hover:shadow-md transition-all">
                  {p.images?.[0] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.images[0]} alt="" className="h-40 w-full object-cover" />
                  ) : (
                    <div className="flex h-40 w-full items-center justify-center bg-gray-100 dark:bg-gray-800 text-gray-500">이미지 없음</div>
                  )}
                  <div className="p-4">
                    <div className="mb-1 flex items-center gap-1.5">
                      {p.deal_type && <span className="rounded-md bg-blue-50 dark:bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-bold text-blue-600 dark:text-blue-400">{p.deal_type}</span>}
                      {p.room_type && <span className="text-[11px] text-gray-500">{p.room_type}</span>}
                    </div>
                    <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">{p.address ?? '주소 비공개'}</p>
                    <p className="mt-0.5 text-sm font-bold text-blue-600 dark:text-blue-400">
                      {!p.price ? '가격 협의'
                        : p.deal_type === '월세' ? `${formatPrice(p.price)} / 월 ${formatPrice(p.monthly_rent ?? 0)}`
                        : formatPrice(p.price)}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
