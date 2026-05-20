'use client'

import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import QRCode from 'qrcode'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/lib/auth-context'
import { Header } from '@/components/layout/header'
import {
  ArrowLeft, Building2, Phone, Mail, MapPin, Star, ShieldCheck,
  Printer, Download, Share2, Copy, Check
} from 'lucide-react'

interface BrokerData {
  id: string
  office_name: string | null
  license_number: string | null
  address: string | null
  district: string | null
  rating: number | null
  review_count: number | null
  deal_count: number | null
  is_verified: boolean | null
  bio: string | null
  profiles: { name: string | null; email: string | null; phone: string | null } | null
}

export default function BrokerCardPage() {
  const router = useRouter()
  const supabaseRef = useRef(createClient())
  const supabase = supabaseRef.current
  const auth = useAuth()

  const [broker, setBroker] = useState<BrokerData | null>(null)
  const [qrUrl, setQrUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (auth.loading) return
    if (!auth.user) { router.push('/auth/login'); return }
    if (auth.profile?.role !== 'broker') { router.push('/'); return }
  }, [auth.loading, auth.user, auth.profile?.role, router])

  useEffect(() => {
    if (!auth.user || auth.profile?.role !== 'broker') return
    ;(async () => {
      const { data } = await supabase
        .from('broker_profiles')
        .select('id, office_name, license_number, address, district, rating, review_count, deal_count, is_verified, bio, profiles(name, email, phone)')
        .eq('user_id', auth.user!.id)
        .single()
      if (data) {
        setBroker(data as any)
        const profileUrl = `https://bbabang.vercel.app/broker/${data.id}`
        try {
          const url = await QRCode.toDataURL(profileUrl, {
            width: 280, margin: 1,
            color: { dark: '#1e40af', light: '#ffffff' },
          })
          setQrUrl(url)
        } catch {}
      }
      setLoading(false)
    })()
  }, [auth.user, auth.profile?.role, supabase])

  const profileUrl = broker ? `https://bbabang.vercel.app/broker/${broker.id}` : ''

  const copyLink = async () => {
    if (!profileUrl) return
    try {
      await navigator.clipboard.writeText(profileUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {}
  }

  const share = async () => {
    if (!broker || !profileUrl) return
    const text = `${broker.profiles?.name ?? '공인중개사'} (${broker.office_name ?? ''}) — 빠방`
    if (navigator.share) {
      try { await navigator.share({ title: text, text, url: profileUrl }) } catch {}
    } else {
      copyLink()
    }
  }

  const downloadQr = () => {
    if (!qrUrl) return
    const a = document.createElement('a')
    a.href = qrUrl
    a.download = `bbabang-broker-${broker?.id?.slice(0, 8)}.png`
    a.click()
  }

  if (loading || !broker) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-950">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
      </div>
    )
  }

  const districts = broker.district?.split(',').map(d => d.trim()).filter(Boolean) ?? []

  return (
    <>
      <div className="min-h-screen bg-gray-50 print:bg-white dark:bg-gray-950 print-hide-bg">
        <div className="print:hidden">
          <Header />
        </div>

        <div className="mx-auto max-w-3xl px-4 py-8 print:max-w-none print:p-0">
          {/* 액션 바 — 인쇄 시 숨김 */}
          <div className="mb-5 flex items-center justify-between print:hidden">
            <Link href="/dashboard/broker" className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700">
              <ArrowLeft className="h-4 w-4" />
              대시보드
            </Link>
            <div className="flex gap-2">
              <button onClick={copyLink}
                className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50">
                {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? '복사됨' : '링크'}
              </button>
              <button onClick={share}
                className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50">
                <Share2 className="h-3.5 w-3.5" />
                공유
              </button>
              <button onClick={downloadQr}
                className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50">
                <Download className="h-3.5 w-3.5" />
                QR 저장
              </button>
              <button onClick={() => window.print()}
                className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-3 py-2 text-xs font-bold text-white hover:bg-blue-700">
                <Printer className="h-3.5 w-3.5" />
                인쇄
              </button>
            </div>
          </div>

          {/* 명함 (대형 — 디지털 명함) */}
          <article className="business-card relative overflow-hidden rounded-3xl border border-gray-200 bg-gradient-to-br from-white to-blue-50 shadow-xl print:shadow-none print:rounded-none print:border-0">
            {/* 헤더 그라데이션 */}
            <div className="absolute top-0 left-0 right-0 h-32 bg-gradient-to-br from-blue-600 to-indigo-700" />
            <div className="absolute top-3 right-4 text-white/80 text-xs font-bold tracking-widest">빠방</div>

            <div className="relative pt-12 pb-8 px-8">
              {/* 본인 사진 자리 */}
              <div className="mb-4 flex h-24 w-24 items-center justify-center rounded-2xl bg-white border-4 border-white shadow-md text-3xl font-black text-blue-600">
                {broker.profiles?.name?.[0] ?? 'B'}
              </div>

              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-1">
                    <h1 className="text-2xl font-black text-gray-900">{broker.profiles?.name ?? '공인중개사'}</h1>
                    {broker.is_verified && (
                      <span className="inline-flex items-center gap-0.5 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-700">
                        <ShieldCheck className="h-3 w-3" /> 인증
                      </span>
                    )}
                  </div>
                  <p className="text-sm font-semibold text-gray-600">공인중개사</p>
                  <p className="mt-0.5 text-base font-bold text-blue-700">{broker.office_name ?? ''}</p>
                </div>

                {qrUrl && (
                  <div className="flex flex-col items-center flex-shrink-0">
                    <img src={qrUrl} alt="빠방 프로필 QR" className="h-24 w-24 rounded-lg bg-white p-1.5 border border-gray-200" />
                    <p className="mt-1 text-[10px] text-gray-500 text-center">스캔하여<br />프로필 보기</p>
                  </div>
                )}
              </div>

              {/* 연락처 */}
              <div className="mt-5 space-y-1.5 text-sm">
                {broker.profiles?.phone && (
                  <p className="flex items-center gap-2 text-gray-700">
                    <Phone className="h-3.5 w-3.5 text-blue-500" />
                    <a href={`tel:${broker.profiles.phone}`} className="hover:underline">{broker.profiles.phone}</a>
                  </p>
                )}
                {broker.profiles?.email && (
                  <p className="flex items-center gap-2 text-gray-700">
                    <Mail className="h-3.5 w-3.5 text-blue-500" />
                    <a href={`mailto:${broker.profiles.email}`} className="hover:underline">{broker.profiles.email}</a>
                  </p>
                )}
                {broker.address && (
                  <p className="flex items-center gap-2 text-gray-700">
                    <MapPin className="h-3.5 w-3.5 text-blue-500" />
                    <span>{broker.address}</span>
                  </p>
                )}
                {broker.license_number && (
                  <p className="flex items-center gap-2 text-gray-700">
                    <Building2 className="h-3.5 w-3.5 text-blue-500" />
                    <span className="font-mono text-xs">자격증 {broker.license_number}</span>
                  </p>
                )}
              </div>

              {/* 담당 지역 */}
              {districts.length > 0 && (
                <div className="mt-4">
                  <p className="text-[11px] font-bold text-gray-500 mb-1.5">담당 지역</p>
                  <div className="flex flex-wrap gap-1.5">
                    {districts.map(d => (
                      <span key={d} className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-700">{d}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* 실적 */}
              {(broker.rating || broker.review_count || broker.deal_count) ? (
                <div className="mt-5 grid grid-cols-3 gap-2 border-t border-gray-200 pt-4">
                  <div className="text-center">
                    <p className="text-lg font-black text-blue-600 flex items-center justify-center gap-0.5">
                      <Star className="h-3 w-3 fill-current" />
                      {broker.rating ? Number(broker.rating).toFixed(1) : '—'}
                    </p>
                    <p className="text-[10px] text-gray-500 font-medium">평점</p>
                  </div>
                  <div className="text-center">
                    <p className="text-lg font-black text-blue-600">{broker.review_count ?? 0}</p>
                    <p className="text-[10px] text-gray-500 font-medium">후기</p>
                  </div>
                  <div className="text-center">
                    <p className="text-lg font-black text-blue-600">{broker.deal_count ?? 0}</p>
                    <p className="text-[10px] text-gray-500 font-medium">거래</p>
                  </div>
                </div>
              ) : null}

              {/* 소개글 */}
              {broker.bio && (
                <div className="mt-4 rounded-xl bg-white/80 px-3 py-2.5">
                  <p className="text-xs text-gray-600 leading-relaxed line-clamp-3">{broker.bio}</p>
                </div>
              )}

              <p className="mt-5 text-center text-[10px] text-gray-400 tracking-wider">
                빠방 인증 공인중개사 · bbabang.vercel.app
              </p>
            </div>
          </article>

          <p className="mt-5 text-center text-xs text-gray-400 print:hidden">
            QR을 스캔하면 빠방 프로필이 열리고 고객이 바로 채팅·후기를 볼 수 있어요.
          </p>
        </div>
      </div>

      <style jsx global>{`
        @media print {
          @page { size: A4; margin: 1cm; }
          body { background: white !important; }
          .business-card { box-shadow: none !important; }
        }
      `}</style>
    </>
  )
}
