'use client'

import { useState, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Header } from '@/components/layout/header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatDate, formatPrice, maskAddress, cn } from '@/lib/utils'
import Image from 'next/image'
import {
  MapPin, Star, MessageCircle, Home, CheckCircle,
  Pencil, Archive, XCircle, X, AlertTriangle, GitCompare, Check
} from 'lucide-react'
import { CloseRequestButton } from '@/components/close-request-button'
import { ReopenRequestButton } from '@/components/reopen-request-button'
import { ShareButton } from '@/components/share-button'
import { ChatPanel } from '@/components/chat-panel'
import { ReportButton } from '@/components/report-button'
import { ViewTracker } from '@/components/view-tracker'
import Link from 'next/link'

// ── 메인 클라이언트 컴포넌트 ────────────────────────
interface Props {
  request: any
  proposals: any[]
  user: any
  userRole: string | null
}

export function RequestDetailClient({ request, proposals: initialProposals, user, userRole }: Props) {
  const supabaseRef = useRef(createClient())
  const supabase = supabaseRef.current
  const [proposals, setProposals] = useState(initialProposals)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [isCreatingProposal, setIsCreatingProposal] = useState(false)
  const [mobileTab, setMobileTab] = useState<'proposals' | 'chat'>('proposals')
  const [rejectingProposal, setRejectingProposal] = useState<any>(null)
  const [compareIds, setCompareIds] = useState<Set<string>>(new Set())
  const [showCompare, setShowCompare] = useState(false)
  const isOwner = user?.id === request.user_id

  const toggleCompare = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setCompareIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else if (next.size < 3) next.add(id)
      return next
    })
  }

  const handleSelect = (id: string) => { setSelectedId(id); setMobileTab('chat') }

  const handleAccept = async (e: React.MouseEvent, proposalId: string) => {
    e.stopPropagation()
    const proposal = proposals.find(p => p.id === proposalId)
    await supabase.from('proposals').update({ status: 'accepted' }).eq('id', proposalId)
    // 중개사에게 알림
    if (proposal?.broker_profiles?.user_id) {
      await supabase.from('notifications').insert({
        user_id: proposal.broker_profiles.user_id,
        type: 'proposal_accepted',
        title: '제안이 수락되었어요! ✅',
        body: '고객이 회원님의 제안을 수락했습니다.',
        link: `/chat/${proposalId}`,
      })
    }
    setProposals(prev => prev.map(p => p.id === proposalId ? { ...p, status: 'accepted' } : p))
  }

  const handleReject = (e: React.MouseEvent, proposalId: string) => {
    e.stopPropagation()
    const proposal = proposals.find(p => p.id === proposalId)
    if (proposal) setRejectingProposal(proposal)
  }

  const confirmReject = async (reason: string) => {
    if (!rejectingProposal) return
    const proposalId = rejectingProposal.id
    await supabase
      .from('proposals')
      .update({ status: 'rejected', reject_reason: reason || null, rejected_at: new Date().toISOString() })
      .eq('id', proposalId)
    // 중개사에게 알림 (사유 포함)
    if (rejectingProposal.broker_profiles?.user_id) {
      await supabase.from('notifications').insert({
        user_id: rejectingProposal.broker_profiles.user_id,
        type: 'proposal_rejected',
        title: '제안이 거절되었습니다 ❌',
        body: reason ? `사유: ${reason}` : '고객이 제안을 거절했습니다.',
        link: `/chat/${proposalId}`,
      })
    }
    setProposals(prev => prev.map(p =>
      p.id === proposalId ? { ...p, status: 'rejected', reject_reason: reason || null } : p
    ))
    setRejectingProposal(null)
  }

  const handleProposeClick = async () => {
    if (!user || isCreatingProposal) return
    setIsCreatingProposal(true)
    try {
      const { data: broker } = await supabase.from('broker_profiles').select('id').eq('user_id', user.id).single()
      if (!broker) return

      // 이미 제안한 경우 기존 채팅방으로 이동
      const { data: existing } = await supabase.from('proposals').select('id').eq('request_id', request.id).eq('broker_id', broker.id).maybeSingle()
      if (existing) { setSelectedId(existing.id); setMobileTab('chat'); return }

      // 제안 생성
      const { data: proposal } = await supabase.from('proposals').insert({
        request_id: request.id, broker_id: broker.id,
        price: 0, description: '', property_address: null, property_images: [], status: 'pending',
      }).select().single()
      if (!proposal) return

      // proposal_count 업데이트 + 고객 알림
      const { data: reqData } = await supabase.from('request_posts').select('proposal_count, user_id').eq('id', request.id).single()
      if (reqData) {
        await supabase.from('request_posts').update({ proposal_count: (reqData.proposal_count ?? 0) + 1 }).eq('id', request.id)
        if (reqData.user_id) {
          await supabase.from('notifications').insert({
            user_id: reqData.user_id, type: 'new_proposal',
            title: '새 제안이 도착했어요! 📨',
            body: '중개사가 새로운 매물을 제안했습니다.',
            link: `/request/${request.id}`,
          })
        }
      }

      setSelectedId(proposal.id)
      setMobileTab('chat')
    } finally {
      setIsCreatingProposal(false)
    }
  }

  return (
    <div className="flex flex-col bg-gray-50" style={{ height: '100dvh' }}>
      <Header user={user} role={userRole} />
      <ViewTracker type="request" id={request.id} />

      <div className="flex flex-1 overflow-hidden">
        {/* ── 왼쪽 패널: 요청 정보 + 제안 목록 ── */}
        <div className={cn(
          'flex flex-col border-r border-gray-200 bg-white overflow-y-auto flex-shrink-0',
          'w-full md:w-[380px] lg:w-[420px]',
          mobileTab === 'chat' ? 'hidden md:flex' : 'flex'
        )}>
          {/* 요청 요약 */}
          <div className="px-4 py-4 border-b border-gray-100">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {request.is_co_broker && <Badge variant="default" className="bg-purple-100 text-purple-700 border-purple-200">공동중개</Badge>}
                  <Badge variant={request.status === 'active' ? 'success' : 'default'}>
                    {request.status === 'active' ? '모집 중' : '마감'}
                  </Badge>
                  {(request.deal_type?.split(',') ?? []).map((t: string) => <Badge key={t} variant="info">{t.trim()}</Badge>)}
                  {(request.room_type?.split(',') ?? []).slice(0, 2).map((t: string) => <Badge key={t} variant="default">{t.trim()}</Badge>)}
                </div>
                <h1 className="text-lg font-bold text-gray-900">{request.city} {request.district}</h1>
                <div className="text-xl font-black text-blue-600 mt-0.5">{formatPrice(request.min_price)}~{formatPrice(request.max_price)}</div>
                {request.min_monthly && (
                  <div className="text-xs text-gray-500 mt-0.5">월세 {formatPrice(request.min_monthly)}~{formatPrice(request.max_monthly)}</div>
                )}
              </div>
              <ShareButton
                title={`${request.city} ${request.district} 구합니다`}
                text={`빠방에서 ${request.city} ${request.district} 매물을 찾고 있어요!`}
                url={`https://bbabang.vercel.app/request/${request.id}`}
              />
            </div>
            {request.description && (
              <p className="mt-2 text-sm text-gray-700 dark:text-gray-300 leading-relaxed line-clamp-3">{request.description}</p>
            )}
            <div className="mt-2 flex flex-wrap gap-3 text-xs text-gray-500">
              {request.min_size && <span>최소 {request.min_size}평</span>}
              {request.max_size && <span>최대 {request.max_size}평</span>}
              {request.move_in_date && <span>입주 희망: {String(request.move_in_date)}</span>}
            </div>

            {/* 마감 배너 */}
            {request.status === 'closed' && (
              <div className="mt-3 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                <Archive className="h-4 w-4 text-amber-500 flex-shrink-0" />
                <div>
                  <p className="text-xs font-semibold text-amber-800">마감된 요청입니다</p>
                  <p className="text-[10px] text-amber-600">새 제안을 받지 않으며, 기존 제안만 확인할 수 있어요</p>
                </div>
              </div>
            )}

            {/* 수정/마감 버튼 */}
            {isOwner && request.status === 'active' && (
              <div className="mt-3 flex gap-2">
                <CloseRequestButton requestId={request.id} />
                <Link href={`/request/${request.id}/edit`}>
                  <Button variant="outline" size="sm">
                    <Pencil className="mr-1 h-3.5 w-3.5" />수정
                  </Button>
                </Link>
              </div>
            )}

            {/* 재오픈 버튼 — 마감된 요청 본인에게만 */}
            {isOwner && request.status === 'closed' && (
              <div className="mt-3">
                <ReopenRequestButton requestId={request.id} />
              </div>
            )}

            {/* 본인 요청이 아닐 때만 신고 버튼 노출 */}
            {!isOwner && user && (
              <div className="mt-3 flex justify-end">
                <ReportButton type="request" id={request.id} variant="text" />
              </div>
            )}

            {/* 중개사: 제안하기 버튼 */}
            {userRole === 'broker' && request.status === 'active' && (
              <button
                onClick={handleProposeClick}
                disabled={isCreatingProposal}
                className="mt-3 w-full flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 transition-colors disabled:opacity-60"
              >
                {isCreatingProposal
                  ? <><div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />준비 중...</>
                  : <><Home className="h-4 w-4" />이 고객에게 매물 제안하기</>
                }
              </button>
            )}
          </div>

          {/* 제안 목록 */}
          <div className="px-4 py-3 flex-1">
            <h2 className="text-sm font-bold text-gray-700 mb-3 flex items-center gap-2">
              중개사 제안
              <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-bold text-blue-700">{proposals.length}</span>
            </h2>

            {proposals.length === 0 ? (
              <div className="py-12 text-center">
                <Home className="mx-auto mb-2 h-8 w-8 text-gray-200" />
                <p className="text-sm text-gray-500">아직 제안이 없습니다</p>
                <p className="mt-1 text-xs text-gray-500">인근 중개사들에게 알림이 발송됩니다</p>
              </div>
            ) : (
              <div className="space-y-2 pb-4">
                {proposals.map((proposal: any) => {
                  const broker = proposal.broker_profiles
                  const brokerProfile = broker?.profiles
                  const isSelected = selectedId === proposal.id
                  const isCompared = compareIds.has(proposal.id)
                  return (
                    <button key={proposal.id} onClick={() => handleSelect(proposal.id)}
                      className={cn(
                        'w-full text-left rounded-xl border p-3 transition-all relative',
                        isSelected ? 'border-blue-400 bg-blue-50 ring-2 ring-blue-200' : 'border-gray-200 bg-white hover:border-blue-200 hover:bg-blue-50/40'
                      )}
                    >
                      {/* 비교 체크박스 (고객 본인만 노출) */}
                      {isOwner && (
                        <button
                          type="button"
                          onClick={(e) => toggleCompare(proposal.id, e)}
                          aria-label={isCompared ? '비교에서 빼기' : '비교에 추가'}
                          className={cn(
                            'absolute top-2 right-2 z-10 flex h-5 w-5 items-center justify-center rounded border transition-colors',
                            isCompared
                              ? 'bg-amber-500 border-amber-500 text-white'
                              : 'bg-white border-gray-300 text-transparent hover:border-amber-400'
                          )}
                        >
                          <Check className="h-3 w-3" />
                        </button>
                      )}
                      <div className="flex items-center gap-2.5">
                        <Link href={`/broker/${broker?.id}`} onClick={e => e.stopPropagation()}>
                          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-700 font-bold text-sm hover:ring-2 hover:ring-blue-300 transition-all">
                            {brokerProfile?.name?.[0] ?? 'B'}
                          </div>
                        </Link>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1">
                            <span className="text-sm font-bold text-gray-900 truncate">{broker?.office_name ?? brokerProfile?.name ?? '중개사'}</span>
                            {broker?.is_verified && <CheckCircle className="h-3.5 w-3.5 text-blue-500 flex-shrink-0" />}
                          </div>
                          <p className="text-xs text-gray-500 truncate">{broker?.office_name && broker?.is_owner !== false ? brokerProfile?.name : ''}</p>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <div className="text-sm font-black text-blue-600">{formatPrice(proposal.price)}</div>
                          <div className="flex items-center gap-0.5 justify-end mt-0.5">
                            <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />
                            <span className="text-xs text-gray-500">{broker?.rating?.toFixed(1) ?? '신규'}</span>
                          </div>
                        </div>
                      </div>

                      {proposal.property_address && (
                        <div className="mt-1.5 flex items-center gap-1 text-xs text-gray-500">
                          <MapPin className="h-3 w-3 flex-shrink-0" />
                          <span className="truncate">{maskAddress(proposal.property_address)}</span>
                        </div>
                      )}
                      {proposal.description && (
                        <p className="mt-1.5 text-xs text-gray-500 line-clamp-2">{proposal.description}</p>
                      )}

                      <div className="mt-2 flex items-center justify-between">
                        <span className="text-[10px] text-gray-500">{formatDate(proposal.created_at)}</span>
                        {proposal.status === 'accepted' && (
                          <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-semibold text-green-700">✓ 수락됨</span>
                        )}
                        {proposal.status === 'rejected' && (
                          <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-600">✕ 거절됨</span>
                        )}
                      </div>

                      {proposal.status === 'rejected' && proposal.reject_reason && (
                        <p className="mt-1.5 text-[11px] text-gray-500 italic">&quot;{proposal.reject_reason}&quot;</p>
                      )}

                      {isOwner && proposal.status === 'pending' && (
                        <div className="mt-2 flex gap-1.5" onClick={e => e.stopPropagation()}>
                          <button
                            onClick={e => handleAccept(e, proposal.id)}
                            className="flex-1 rounded-lg bg-blue-600 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 transition-colors"
                          >
                            수락
                          </button>
                          <button
                            onClick={e => handleReject(e, proposal.id)}
                            className="flex-1 rounded-lg border border-gray-200 py-1.5 text-xs font-semibold text-gray-500 hover:bg-gray-50 transition-colors"
                          >
                            거절
                          </button>
                        </div>
                      )}

                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* ── 오른쪽 패널: 채팅 ── */}
        <div className={cn(
          'flex-1 flex flex-col overflow-hidden',
          mobileTab === 'proposals' ? 'hidden md:flex' : 'flex'
        )}>
          {selectedId && user ? (
            <ChatPanel
              key={selectedId}
              proposalId={selectedId}
              currentUser={user}
              isOwner={isOwner}
              onBack={() => setMobileTab('proposals')}
            />
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center text-center px-4 bg-gray-50">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-100">
                <MessageCircle className="h-8 w-8 text-blue-500" />
              </div>
              {!user ? (
                <>
                  <h3 className="text-base font-bold text-gray-800">로그인 후 대화할 수 있어요</h3>
                  <Link href="/auth/login" className="mt-4 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 transition-colors">
                    로그인하기
                  </Link>
                </>
              ) : (
                <>
                  <h3 className="text-base font-bold text-gray-800">제안을 선택하세요</h3>
                  <p className="mt-1.5 text-sm text-gray-500">왼쪽에서 중개사 제안을 클릭하면<br />바로 대화를 시작할 수 있어요</p>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 모바일 하단 탭 */}
      <div className="md:hidden flex border-t border-gray-200 bg-white flex-shrink-0">
        <button
          onClick={() => setMobileTab('proposals')}
          className={cn('flex-1 py-3 text-sm font-semibold transition-colors',
            mobileTab === 'proposals' ? 'text-blue-600 border-t-2 border-blue-600 -mt-px' : 'text-gray-500')}
        >
          제안 목록 ({proposals.length})
        </button>
        <button
          onClick={() => selectedId && setMobileTab('chat')}
          className={cn('flex-1 py-3 text-sm font-semibold transition-colors',
            mobileTab === 'chat' ? 'text-blue-600 border-t-2 border-blue-600 -mt-px' : selectedId ? 'text-gray-500' : 'text-gray-300')}
        >
          {selectedId ? '대화' : '대화 (제안 선택)'}
        </button>
      </div>

      {rejectingProposal && (
        <RejectModal
          proposal={rejectingProposal}
          onClose={() => setRejectingProposal(null)}
          onConfirm={confirmReject}
        />
      )}

      {/* 비교 fixed bar — 1개 이상 선택 시 노출 */}
      {isOwner && compareIds.size > 0 && (
        <div className="fixed bottom-14 md:bottom-4 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 rounded-2xl border border-amber-200 bg-white px-4 py-2.5 shadow-xl">
          <GitCompare className="h-4 w-4 text-amber-500" />
          <span className="text-sm font-semibold text-gray-700">
            <span className="text-amber-600">{compareIds.size}</span>개 선택 (최대 3개)
          </span>
          <button onClick={() => setShowCompare(true)} disabled={compareIds.size < 2}
            className="rounded-xl bg-amber-500 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-600 disabled:opacity-50 transition-colors">
            비교하기
          </button>
          <button onClick={() => setCompareIds(new Set())} aria-label="선택 해제"
            className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {showCompare && (
        <CompareModal
          proposals={proposals.filter(p => compareIds.has(p.id))}
          onClose={() => setShowCompare(false)}
          onSelect={(id) => { setSelectedId(id); setMobileTab('chat'); setShowCompare(false) }}
        />
      )}
    </div>
  )
}

function CompareModal({ proposals, onClose, onSelect }: {
  proposals: any[]
  onClose: () => void
  onSelect: (id: string) => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-2 md:p-4" onClick={onClose}>
      <div className="w-full max-w-5xl max-h-[95vh] overflow-hidden rounded-2xl bg-white shadow-2xl flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3.5 flex-shrink-0">
          <h3 className="flex items-center gap-2 font-bold text-gray-900">
            <GitCompare className="h-4 w-4 text-amber-500" />
            제안 비교 ({proposals.length}개)
          </h3>
          <button onClick={onClose} aria-label="닫기" className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="overflow-x-auto overflow-y-auto flex-1">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white z-10 border-b border-gray-100">
              <tr>
                <th className="w-24 px-3 py-2 text-left text-xs font-semibold text-gray-500 align-top">항목</th>
                {proposals.map(p => {
                  const broker = p.broker_profiles
                  return (
                    <th key={p.id} className="px-3 py-2 text-left align-top min-w-[180px]">
                      <button onClick={() => onSelect(p.id)} className="text-left w-full">
                        <p className="font-bold text-gray-900 truncate hover:text-blue-600">{broker?.office_name ?? '(상호 없음)'}</p>
                        <p className="text-xs text-gray-500 truncate">{broker?.profiles?.name}</p>
                        {p.status === 'accepted' && <span className="mt-1 inline-block rounded-full bg-green-100 px-1.5 py-0.5 text-[10px] font-semibold text-green-700">수락됨</span>}
                        {p.status === 'rejected' && <span className="mt-1 inline-block rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-600">거절됨</span>}
                      </button>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              <Row label="가격" values={proposals.map(p => p.price ? formatPrice(p.price) : '협의')} highlight="lowest" raw={proposals.map(p => p.price || Number.MAX_SAFE_INTEGER)} />
              <Row label="주소" values={proposals.map(p => p.property_address ? maskAddress(p.property_address) : '—')} />
              <Row label="제안 내용" values={proposals.map(p => p.description || '—')} pre />
              <Row label="평점" values={proposals.map(p => p.broker_profiles?.rating ? `★ ${Number(p.broker_profiles.rating).toFixed(1)}` : '신규')} />
              <Row label="후기" values={proposals.map(p => `${p.broker_profiles?.review_count ?? 0}개`)} />
              <Row label="누적 거래" values={proposals.map(p => `${p.broker_profiles?.deal_count ?? 0}건`)} />
              <Row label="제안일" values={proposals.map(p => formatDate(p.created_at))} />
              {proposals.some(p => p.property_images?.length > 0) && (
                <tr className="border-t border-gray-100">
                  <td className="px-3 py-2.5 text-xs font-semibold text-gray-500 align-top">사진</td>
                  {proposals.map(p => (
                    <td key={p.id} className="px-3 py-2.5 align-top">
                      {p.property_images?.length > 0 ? (
                        <div className="flex gap-1.5 overflow-x-auto">
                          {p.property_images.slice(0, 3).map((url: string, i: number) => (
                            <div key={i} className="relative h-14 w-14 flex-shrink-0 overflow-hidden rounded-lg">
                              <Image src={url} alt="" fill className="object-cover" sizes="56px" />
                            </div>
                          ))}
                        </div>
                      ) : <span className="text-xs text-gray-500">없음</span>}
                    </td>
                  ))}
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex justify-end gap-2 border-t border-gray-100 px-5 py-3 flex-shrink-0">
          <button onClick={onClose} className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50">
            닫기
          </button>
        </div>
      </div>
    </div>
  )
}

function Row({ label, values, pre, highlight, raw }: {
  label: string
  values: string[]
  pre?: boolean
  highlight?: 'lowest' | 'highest'
  raw?: number[]
}) {
  let bestIdx = -1
  if (highlight && raw) {
    bestIdx = raw.reduce((best, v, i) => {
      if (highlight === 'lowest') return v < (raw[best] ?? Infinity) ? i : best
      return v > (raw[best] ?? -Infinity) ? i : best
    }, 0)
  }
  return (
    <tr className="border-t border-gray-100">
      <td className="px-3 py-2.5 text-xs font-semibold text-gray-500 align-top">{label}</td>
      {values.map((v, i) => (
        <td key={i} className={`px-3 py-2.5 align-top ${pre ? 'whitespace-pre-line text-xs text-gray-600' : 'text-sm text-gray-800'} ${i === bestIdx ? 'bg-amber-50 font-bold text-amber-700' : ''}`}>
          {v}
        </td>
      ))}
    </tr>
  )
}

const REJECT_REASONS = [
  '예산이 맞지 않아요',
  '원하는 지역이 아니에요',
  '매물 조건이 다르네요',
  '이미 다른 곳과 계약했어요',
  '소통이 어려워요',
  '기타',
]

function RejectModal({ proposal, onClose, onConfirm }: {
  proposal: any
  onClose: () => void
  onConfirm: (reason: string) => Promise<void>
}) {
  const [reason, setReason] = useState<string>('')
  const [custom, setCustom] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setBusy(true)
    const finalReason = reason === '기타' ? custom.trim() : reason
    await onConfirm(finalReason)
    setBusy(false)
  }

  const brokerName = proposal.broker_profiles?.profiles?.name ?? proposal.broker_profiles?.office_name ?? '중개사'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={() => !busy && onClose()}>
      <div className="w-full max-w-md rounded-2xl bg-white shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <h3 className="font-bold text-gray-900 flex items-center gap-2">
            <XCircle className="h-4 w-4 text-red-500" />
            제안 거절
          </h3>
          <button onClick={onClose} disabled={busy} aria-label="닫기"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 py-5 space-y-4">
          <div className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2.5">
            <AlertTriangle className="h-4 w-4 text-amber-500 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-amber-700 leading-relaxed">
              {brokerName} 중개사에게 거절 사유를 알려주면, 다음 제안 시 더 잘 맞는 매물을 받을 수 있어요.
            </p>
          </div>

          <div>
            <p className="mb-2 text-sm font-medium text-gray-700">거절 사유 <span className="text-gray-500 font-normal">(선택)</span></p>
            <div className="grid grid-cols-2 gap-2">
              {REJECT_REASONS.map(r => (
                <button key={r} type="button" onClick={() => setReason(r)}
                  className={`rounded-xl border px-3 py-2.5 text-xs font-medium transition-all text-left ${
                    reason === r ? 'border-red-300 bg-red-50 text-red-600' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                  }`}>
                  {r}
                </button>
              ))}
            </div>
          </div>

          {reason === '기타' && (
            <textarea
              value={custom}
              onChange={e => setCustom(e.target.value)}
              maxLength={200}
              rows={3}
              placeholder="직접 입력 (선택)"
              className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 resize-none"
            />
          )}
        </div>

        <div className="flex gap-2 border-t border-gray-100 px-5 py-4">
          <button onClick={onClose} disabled={busy}
            className="flex-1 rounded-xl border border-gray-200 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50">
            취소
          </button>
          <button onClick={submit} disabled={busy}
            className="flex-1 rounded-xl bg-red-500 py-2.5 text-sm font-semibold text-white hover:bg-red-600 disabled:opacity-50">
            {busy ? '처리 중...' : '거절하기'}
          </button>
        </div>
      </div>
    </div>
  )
}
