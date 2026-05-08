'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Card, CardBody } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatDate } from '@/lib/utils'
import {
  Users, Building2, FileText, MessageCircle,
  CheckCircle, XCircle, Shield, LogOut, ExternalLink, StickyNote, MapPin
} from 'lucide-react'
import Link from 'next/link'

export default function AdminPage() {
  const router = useRouter()
  const supabase = createClient()

  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState({ users: 0, brokers: 0, requests: 0, proposals: 0 })
  const [brokers, setBrokers] = useState<any[]>([])
  const [recentUsers, setRecentUsers] = useState<any[]>([])
  const [recentRequests, setRecentRequests] = useState<any[]>([])
  const [verifying, setVerifying] = useState<string | null>(null)
  const [brokerProperties, setBrokerProperties] = useState<any[]>([])
  const [selectedBrokerId, setSelectedBrokerId] = useState<string | null>(null)

  useEffect(() => { init() }, [])

  const init = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/auth/login'); return }

    const { data: profile } = await supabase
      .from('profiles').select('role').eq('id', user.id).single()

    if (profile?.role !== 'admin') { router.push('/'); return }

    try {
      await Promise.all([loadStats(), loadBrokers(), loadRecentUsers(), loadRecentRequests(), loadBrokerProperties()])
    } catch (e) {
      console.error('관리자 페이지 데이터 로드 오류:', e)
    } finally {
      setLoading(false)
    }
  }

  const loadStats = async () => {
    const [
      { count: users },
      { count: brokers },
      { count: requests },
      { count: proposals },
    ] = await Promise.all([
      supabase.from('profiles').select('*', { count: 'exact', head: true }),
      supabase.from('broker_profiles').select('*', { count: 'exact', head: true }),
      supabase.from('request_posts').select('*', { count: 'exact', head: true }),
      supabase.from('proposals').select('*', { count: 'exact', head: true }),
    ])
    setStats({ users: users ?? 0, brokers: brokers ?? 0, requests: requests ?? 0, proposals: proposals ?? 0 })
  }

  const loadBrokers = async () => {
    const { data } = await supabase
      .from('broker_profiles')
      .select('*, profiles(name, email)')
      .order('created_at', { ascending: false })
    setBrokers(data ?? [])
  }

  const loadRecentUsers = async () => {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(10)
    setRecentUsers(data ?? [])
  }

  const loadBrokerProperties = async () => {
    const { data } = await supabase
      .from('broker_properties')
      .select('*, broker_profiles(office_name, profiles(name))')
      .order('created_at', { ascending: false })
      .limit(50)
    setBrokerProperties(data ?? [])
  }

  const loadRecentRequests = async () => {
    const { data } = await supabase
      .from('request_posts')
      .select('*, profiles(name)')
      .order('created_at', { ascending: false })
      .limit(10)
    setRecentRequests(data ?? [])
  }

  const toggleVerify = async (brokerId: string, current: boolean) => {
    setVerifying(brokerId)
    const { error } = await supabase
      .from('broker_profiles')
      .update({ is_verified: !current })
      .eq('id', brokerId)
    if (!error) {
      setBrokers(prev => prev.map(b =>
        b.id === brokerId ? { ...b, is_verified: !current } : b
      ))
    } else {
      alert('처리에 실패했어요. 다시 시도해주세요.')
    }
    setVerifying(null)
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/')
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-950">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
      </div>
    )
  }

  const unverifiedBrokers = brokers.filter(b => !b.is_verified)
  const verifiedBrokers = brokers.filter(b => b.is_verified)

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">

      {/* 헤더 */}
      <header className="border-b border-gray-800 bg-gray-900 px-6 py-4">
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-600">
              <Shield className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-white">빠방 관리자</h1>
              <p className="text-xs text-gray-400">Admin Dashboard</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/" target="_blank">
              <Button variant="outline" size="sm" className="border-gray-700 text-gray-300 hover:bg-gray-800">
                <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                사이트 보기
              </Button>
            </Link>
            <button
              onClick={handleLogout}
              className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-gray-400 hover:bg-gray-800 hover:text-white transition-colors"
            >
              <LogOut className="h-4 w-4" />
              로그아웃
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-6 py-8 space-y-8">

        {/* 통계 */}
        <div className="grid grid-cols-4 gap-4">
          {[
            { label: '전체 회원', value: stats.users, icon: Users, color: 'bg-blue-500/10 text-blue-400' },
            { label: '중개사', value: stats.brokers, icon: Building2, color: 'bg-purple-500/10 text-purple-400' },
            { label: '매물 요청', value: stats.requests, icon: FileText, color: 'bg-green-500/10 text-green-400' },
            { label: '제안', value: stats.proposals, icon: MessageCircle, color: 'bg-yellow-500/10 text-yellow-400' },
          ].map(stat => (
            <div key={stat.label} className="rounded-2xl border border-gray-800 bg-gray-900 p-5">
              <div className={`mb-3 inline-flex h-10 w-10 items-center justify-center rounded-xl ${stat.color}`}>
                <stat.icon className="h-5 w-5" />
              </div>
              <div className="text-3xl font-black text-white">{stat.value}</div>
              <div className="mt-1 text-sm text-gray-400">{stat.label}</div>
            </div>
          ))}
        </div>

        {/* 중개사 인증 관리 */}
        <div>
          <div className="mb-4 flex items-center gap-3">
            <h2 className="text-lg font-bold text-white">중개사 인증 관리</h2>
            {unverifiedBrokers.length > 0 && (
              <span className="rounded-full bg-red-500/20 px-2.5 py-0.5 text-xs font-bold text-red-400">
                미인증 {unverifiedBrokers.length}명
              </span>
            )}
          </div>

          <div className="rounded-2xl border border-gray-800 bg-gray-900 overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-800">
                  <th className="px-5 py-3.5 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">이름</th>
                  <th className="px-5 py-3.5 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">사무소</th>
                  <th className="px-5 py-3.5 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">자격증 번호</th>
                  <th className="px-5 py-3.5 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">담당 지역</th>
                  <th className="px-5 py-3.5 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">가입일</th>
                  <th className="px-5 py-3.5 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">상태</th>
                  <th className="px-5 py-3.5 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">액션</th>
                </tr>
              </thead>
              <tbody>
                {brokers.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-5 py-10 text-center text-gray-500">등록된 중개사가 없습니다</td>
                  </tr>
                ) : (
                  brokers.map(broker => (
                    <tr key={broker.id} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                      <td className="px-5 py-4">
                        <div className="font-semibold text-white">{broker.profiles?.name}</div>
                        <div className="text-xs text-gray-400">{broker.profiles?.email}</div>
                      </td>
                      <td className="px-5 py-4 text-gray-300">{broker.office_name}</td>
                      <td className="px-5 py-4 text-gray-300 font-mono text-sm">{broker.license_number}</td>
                      <td className="px-5 py-4">
                        <div className="flex flex-wrap gap-1">
                          {broker.district?.split(',').slice(0, 2).map((d: string) => (
                            <span key={d} className="rounded-md bg-gray-700 px-2 py-0.5 text-xs text-gray-300">{d.trim()}</span>
                          ))}
                        </div>
                      </td>
                      <td className="px-5 py-4 text-sm text-gray-400">{formatDate(broker.created_at)}</td>
                      <td className="px-5 py-4">
                        {broker.is_verified ? (
                          <span className="flex items-center gap-1.5 text-sm font-medium text-green-400">
                            <CheckCircle className="h-4 w-4" /> 인증됨
                          </span>
                        ) : (
                          <span className="flex items-center gap-1.5 text-sm font-medium text-yellow-400">
                            <XCircle className="h-4 w-4" /> 미인증
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-4">
                        <button
                          onClick={() => toggleVerify(broker.id, broker.is_verified)}
                          disabled={verifying === broker.id}
                          className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
                            broker.is_verified
                              ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                              : 'bg-green-500/20 text-green-400 hover:bg-green-500/30'
                          } disabled:opacity-50`}
                        >
                          {verifying === broker.id ? '처리 중...' : broker.is_verified ? '인증 취소' : '인증 승인'}
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="grid gap-8 lg:grid-cols-2">

          {/* 최근 가입 회원 */}
          <div>
            <h2 className="mb-4 text-lg font-bold text-white">최근 가입 회원</h2>
            <div className="rounded-2xl border border-gray-800 bg-gray-900 overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-800">
                    <th className="px-5 py-3.5 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">이름</th>
                    <th className="px-5 py-3.5 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">역할</th>
                    <th className="px-5 py-3.5 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">가입일</th>
                  </tr>
                </thead>
                <tbody>
                  {recentUsers.length === 0 ? (
                    <tr><td colSpan={3} className="px-5 py-8 text-center text-gray-500">회원이 없습니다</td></tr>
                  ) : (
                    recentUsers.map(u => (
                      <tr key={u.id} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                        <td className="px-5 py-3.5">
                          <div className="font-medium text-white">{u.name || '(이름 없음)'}</div>
                          <div className="text-xs text-gray-400">{u.email}</div>
                        </td>
                        <td className="px-5 py-3.5">
                          <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${
                            u.role === 'admin' ? 'bg-red-500/20 text-red-400' :
                            u.role === 'broker' ? 'bg-purple-500/20 text-purple-400' :
                            'bg-blue-500/20 text-blue-400'
                          }`}>
                            {u.role === 'admin' ? '관리자' : u.role === 'broker' ? '중개사' : '일반'}
                          </span>
                        </td>
                        <td className="px-5 py-3.5 text-sm text-gray-400">{formatDate(u.created_at)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* 최근 매물 요청 */}
          <div>
            <h2 className="mb-4 text-lg font-bold text-white">최근 매물 요청</h2>
            <div className="rounded-2xl border border-gray-800 bg-gray-900 overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-800">
                    <th className="px-5 py-3.5 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">요청자</th>
                    <th className="px-5 py-3.5 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">지역/유형</th>
                    <th className="px-5 py-3.5 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">상태</th>
                  </tr>
                </thead>
                <tbody>
                  {recentRequests.length === 0 ? (
                    <tr><td colSpan={3} className="px-5 py-8 text-center text-gray-500">요청이 없습니다</td></tr>
                  ) : (
                    recentRequests.map(req => (
                      <tr key={req.id} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                        <td className="px-5 py-3.5">
                          <div className="font-medium text-white">{req.profiles?.name || '(알 수 없음)'}</div>
                          <div className="text-xs text-gray-400">{formatDate(req.created_at)}</div>
                        </td>
                        <td className="px-5 py-3.5">
                          <div className="text-sm text-white">{req.city} {req.district}</div>
                          <div className="text-xs text-gray-400">{req.deal_type?.split(',')[0]}</div>
                        </td>
                        <td className="px-5 py-3.5">
                          <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${
                            req.status === 'active' ? 'bg-green-500/20 text-green-400' :
                            req.status === 'matched' ? 'bg-blue-500/20 text-blue-400' :
                            'bg-gray-500/20 text-gray-400'
                          }`}>
                            {req.status === 'active' ? '모집 중' : req.status === 'matched' ? '매칭 완료' : '종료'}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

        </div>

        {/* 중개사 매물장 (메모 포함) */}
        <div>
          <div className="mb-4 flex items-center gap-3">
            <h2 className="text-lg font-bold text-white">중개사 매물장</h2>
            <span className="rounded-full bg-gray-700 px-2.5 py-0.5 text-xs text-gray-300">{brokerProperties.length}건</span>
          </div>

          {/* 브로커 필터 */}
          <div className="mb-3 flex flex-wrap gap-2">
            <button
              onClick={() => setSelectedBrokerId(null)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
                selectedBrokerId === null ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
              }`}
            >전체</button>
            {brokers.map(b => (
              <button
                key={b.id}
                onClick={() => setSelectedBrokerId(b.id)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
                  selectedBrokerId === b.id ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                }`}
              >{b.profiles?.name || b.office_name}</button>
            ))}
          </div>

          <div className="rounded-2xl border border-gray-800 bg-gray-900 overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-800">
                  <th className="px-5 py-3.5 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">중개사</th>
                  <th className="px-5 py-3.5 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">매물 정보</th>
                  <th className="px-5 py-3.5 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">상태</th>
                  <th className="px-5 py-3.5 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">🔒 중개사 메모</th>
                </tr>
              </thead>
              <tbody>
                {(selectedBrokerId
                  ? brokerProperties.filter(p => p.broker_id === selectedBrokerId)
                  : brokerProperties
                ).length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-5 py-10 text-center text-gray-500">등록된 매물이 없습니다</td>
                  </tr>
                ) : (
                  (selectedBrokerId
                    ? brokerProperties.filter(p => p.broker_id === selectedBrokerId)
                    : brokerProperties
                  ).map(property => (
                    <tr key={property.id} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                      <td className="px-5 py-4">
                        <div className="font-medium text-white">{property.broker_profiles?.profiles?.name}</div>
                        <div className="text-xs text-gray-400">{property.broker_profiles?.office_name}</div>
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-1.5 text-sm text-white">
                          <MapPin className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
                          {property.address}
                        </div>
                        <div className="mt-0.5 text-xs text-gray-400">
                          {property.deal_type} · {property.room_type}
                          {property.size_pyeong ? ` · ${property.size_pyeong}평` : ''}
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${
                          property.status === 'available' ? 'bg-green-500/20 text-green-400' :
                          property.status === 'contracted' ? 'bg-blue-500/20 text-blue-400' :
                          'bg-yellow-500/20 text-yellow-400'
                        }`}>
                          {property.status === 'available' ? '매물 있음' : property.status === 'contracted' ? '계약 완료' : '숨김'}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        {property.memo ? (
                          <div className="flex items-start gap-1.5 rounded-lg bg-orange-500/10 border border-orange-500/20 px-3 py-2 max-w-xs">
                            <StickyNote className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-orange-400" />
                            <p className="text-xs text-orange-300 line-clamp-3">{property.memo}</p>
                          </div>
                        ) : (
                          <span className="text-xs text-gray-600">—</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Supabase 바로가기 */}
        <div className="rounded-2xl border border-gray-800 bg-gray-900 p-5">
          <h3 className="mb-3 font-bold text-white">🔗 Supabase 직접 관리</h3>
          <p className="mb-4 text-sm text-gray-400">데이터 직접 수정, 삭제 등 세부 작업은 Supabase Table Editor를 사용하세요</p>
          <div className="flex flex-wrap gap-3">
            {[
              { label: 'Table Editor', url: 'https://supabase.com/dashboard/project/wovxcdfxxnsljdhrgonh/editor' },
              { label: 'Auth Users', url: 'https://supabase.com/dashboard/project/wovxcdfxxnsljdhrgonh/auth/users' },
              { label: 'SQL Editor', url: 'https://supabase.com/dashboard/project/wovxcdfxxnsljdhrgonh/sql' },
              { label: 'Logs', url: 'https://supabase.com/dashboard/project/wovxcdfxxnsljdhrgonh/logs/explorer' },
            ].map(link => (
              <a key={link.label} href={link.url} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1.5 rounded-lg border border-gray-700 px-3 py-2 text-sm text-gray-300 hover:bg-gray-800 hover:text-white transition-colors">
                <ExternalLink className="h-3.5 w-3.5" />
                {link.label}
              </a>
            ))}
          </div>
        </div>

      </div>
    </div>
  )
}
