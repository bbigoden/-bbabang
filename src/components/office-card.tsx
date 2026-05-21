'use client'

import { Building2, ShieldCheck, ShieldOff, Users, ChevronRight } from 'lucide-react'
import { formatDate } from '@/lib/utils'

/**
 * 사무소 정보 공통 카드.
 * 어드민·일반 사용자 화면 어디서든 사용해서 일관된 정보 표시를 보장.
 *
 * variant:
 *  - 'admin': 어드민용 (이메일·자격증·사업자번호까지 노출, 검수 액션 슬롯)
 *  - 'public': 일반 사용자용 (등록번호·연락처 위주, 찜·연락 액션 슬롯)
 *
 * 자식(children)으로 본문 아래에 직원 명단·매물 목록 등을 붙일 수 있어요.
 */

export interface OfficeCardData {
  id: string                          // broker_profile.id (대표)
  office_name?: string | null
  owner_name?: string | null
  owner_email?: string | null
  owner_phone?: string | null
  license_number?: string | null
  business_reg_number?: string | null
  office_reg_number?: string | null
  address?: string | null
  districts?: string[]                // 담당 지역
  is_verified?: boolean | null
  created_at?: string | null
  employee_count?: number
  rating?: number | null
  review_count?: number | null
}

export interface OfficeCardProps {
  office: OfficeCardData
  variant?: 'admin' | 'public'
  onClick?: () => void                // 헤더 클릭 액션
  href?: string                       // 헤더 클릭 시 이동 (onClick 대신)
  rightSlot?: React.ReactNode         // 우측 (날짜·뱃지·버튼 등)
  actionSlot?: React.ReactNode        // 하단 액션 영역 (인증/찜 버튼 등)
  children?: React.ReactNode          // 카드 아래 추가 영역 (직원 명단·매물 등)
  showChevron?: boolean
  className?: string
}

export function OfficeCard({
  office,
  variant = 'admin',
  onClick,
  href,
  rightSlot,
  actionSlot,
  children,
  showChevron = true,
  className = '',
}: OfficeCardProps) {
  const isClickable = !!(onClick || href)
  const interactive = isClickable ? 'hover:bg-gray-800/60 cursor-pointer transition-colors' : ''

  const HeaderInner = (
    <div className={`w-full flex items-start gap-3 px-5 py-4 text-left ${interactive}`}>
      <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-purple-500/20 text-purple-400">
        <Building2 className="h-5 w-5" />
      </div>
      <div className="flex-1 min-w-0">
        {/* 사무소명 + 인증 뱃지 + 직원 수 */}
        <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
          <p className="text-sm font-bold text-white truncate">
            {office.office_name ?? '(사무소명 없음)'}
          </p>
          {typeof office.is_verified === 'boolean' && (
            office.is_verified ? (
              <span className="inline-flex items-center gap-0.5 rounded-md bg-blue-500/20 px-1.5 py-0.5 text-[10px] font-bold text-blue-400">
                <ShieldCheck className="h-3 w-3" /> 인증
              </span>
            ) : (
              <span className="inline-flex items-center gap-0.5 rounded-md bg-yellow-500/20 px-1.5 py-0.5 text-[10px] font-bold text-yellow-400">
                <ShieldOff className="h-3 w-3" /> 미인증
              </span>
            )
          )}
          {typeof office.employee_count === 'number' && (
            <span className="inline-flex items-center gap-0.5 rounded-md bg-gray-700 px-1.5 py-0.5 text-[10px] font-medium text-gray-300">
              <Users className="h-3 w-3" /> 직원 {office.employee_count}
            </span>
          )}
        </div>

        {/* 대표 정보 */}
        <p className="text-xs text-gray-400 truncate">
          대표 · {office.owner_name ?? '(이름 없음)'}
          {variant === 'admin' && office.owner_email && (
            <span className="text-gray-500"> · {office.owner_email}</span>
          )}
          {variant === 'public' && office.owner_phone && (
            <span className="text-gray-500"> · {office.owner_phone}</span>
          )}
        </p>

        {/* 자격증·사업자번호·등록번호·주소 */}
        <div className="mt-1 flex items-center gap-2 text-[11px] text-gray-500 flex-wrap">
          {office.license_number && <span className="font-mono">자격 {office.license_number}</span>}
          {variant === 'admin' && office.business_reg_number && (
            <span className="font-mono">사업 {office.business_reg_number}</span>
          )}
          {office.office_reg_number && <span className="font-mono">등록 {office.office_reg_number}</span>}
          {office.address && <span className="truncate max-w-[240px]">{office.address}</span>}
        </div>

        {/* 담당 지역 */}
        {office.districts && office.districts.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {office.districts.slice(0, 4).map(d => (
              <span key={d} className="rounded-md bg-gray-700 px-1.5 py-0.5 text-[10px] text-gray-300">{d}</span>
            ))}
            {office.districts.length > 4 && (
              <span className="text-[10px] text-gray-500">+{office.districts.length - 4}</span>
            )}
          </div>
        )}

        {/* 평점·리뷰 (public 위주) */}
        {variant === 'public' && (office.rating != null || office.review_count != null) && (
          <div className="mt-1 flex items-center gap-2 text-[11px] text-gray-400">
            {office.rating != null && <span>⭐ {Number(office.rating).toFixed(1)}</span>}
            {office.review_count != null && <span>리뷰 {office.review_count}</span>}
          </div>
        )}
      </div>

      {rightSlot ?? (office.created_at && (
        <span className="text-xs text-gray-500 flex-shrink-0">{formatDate(office.created_at)}</span>
      ))}
      {showChevron && isClickable && <ChevronRight className="h-4 w-4 text-gray-600 flex-shrink-0 mt-1.5" />}
    </div>
  )

  const baseClass = `rounded-2xl border border-gray-800 bg-gray-900 overflow-hidden ${className}`

  const headerElement = onClick ? (
    <button type="button" onClick={onClick} className="w-full">{HeaderInner}</button>
  ) : href ? (
    <a href={href} className="block">{HeaderInner}</a>
  ) : HeaderInner

  return (
    <div className={baseClass}>
      {headerElement}
      {actionSlot && <div className="border-t border-gray-800 px-5 py-3">{actionSlot}</div>}
      {children}
    </div>
  )
}
