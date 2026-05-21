'use client'

import { CheckCircle2, AlertCircle, Ban, ShieldCheck, ShieldOff } from 'lucide-react'
import { formatDate } from '@/lib/utils'

/**
 * 사무소 소속 직원 한 줄 공통 컴포넌트.
 * 어드민/사무소 운영자 화면 모두에서 동일한 모양으로 직원을 표시.
 */

export interface EmployeeRowData {
  id: string
  name?: string | null
  email?: string | null
  phone?: string | null
  is_approved?: boolean | null            // 대표 승인 여부 (broker_profiles)
  is_verified?: boolean | null            // 어드민 인증 여부 (broker_profiles) — 직원은 보통 X
  account_status?: 'active' | 'suspended' | 'banned' | null
  created_at?: string | null
}

export interface EmployeeRowProps {
  employee: EmployeeRowData
  onClick?: () => void
  rightSlot?: React.ReactNode
  showApprovalBadge?: boolean             // 승인/대기 뱃지 표시 (기본 true)
  showStatusBadge?: boolean               // 계정 정지/차단 뱃지 표시 (기본 true)
  className?: string
}

const STATUS_BADGE = {
  active: null,
  suspended: { label: '일시 정지', cls: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30', icon: AlertCircle },
  banned: { label: '영구 차단', cls: 'bg-red-500/20 text-red-400 border-red-500/30', icon: Ban },
}

export function EmployeeRow({
  employee,
  onClick,
  rightSlot,
  showApprovalBadge = true,
  showStatusBadge = true,
  className = '',
}: EmployeeRowProps) {
  const statusBadge = showStatusBadge && employee.account_status && employee.account_status !== 'active'
    ? STATUS_BADGE[employee.account_status]
    : null
  const StatusIcon = statusBadge?.icon

  const inner = (
    <div className={`w-full flex items-center gap-3 px-5 py-3 text-left ${onClick ? 'hover:bg-gray-800/40 cursor-pointer transition-colors' : ''} ${className}`}>
      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-indigo-500/20 text-xs font-bold text-indigo-300">
        {(employee.name || employee.email || '?')[0]?.toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <p className="text-sm font-medium text-gray-200 truncate">
            {employee.name ?? '(이름 없음)'}
          </p>
          <span className="rounded-md bg-indigo-500/20 px-1.5 py-0.5 text-[10px] font-bold text-indigo-300">직원</span>
          {showApprovalBadge && typeof employee.is_approved === 'boolean' && (
            employee.is_approved ? (
              <span className="inline-flex items-center gap-0.5 rounded-md bg-green-500/20 px-1.5 py-0.5 text-[10px] font-bold text-green-400">
                <CheckCircle2 className="h-3 w-3" /> 승인
              </span>
            ) : (
              <span className="inline-flex items-center gap-0.5 rounded-md bg-orange-500/20 px-1.5 py-0.5 text-[10px] font-bold text-orange-400">
                <AlertCircle className="h-3 w-3" /> 승인 대기
              </span>
            )
          )}
          {statusBadge && StatusIcon && (
            <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-bold ${statusBadge.cls}`}>
              <StatusIcon className="h-3 w-3" /> {statusBadge.label}
            </span>
          )}
        </div>
        <p className="text-[11px] text-gray-500 truncate">
          {employee.email ?? '—'}
          {employee.phone && ` · ${employee.phone}`}
        </p>
      </div>
      {rightSlot ?? (employee.created_at && (
        <span className="text-[11px] text-gray-500 flex-shrink-0">{formatDate(employee.created_at)}</span>
      ))}
    </div>
  )

  return onClick ? (
    <button type="button" onClick={onClick} className="w-full">{inner}</button>
  ) : inner
}
