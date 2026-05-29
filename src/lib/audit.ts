import type { SupabaseClient } from '@supabase/supabase-js'

export type AuditAction =
  | 'broker.verify'
  | 'broker.unverify'
  | 'broker.reject'
  | 'user.suspend'
  | 'user.unsuspend'
  | 'user.ban'
  | 'user.role_change'
  | 'user.note_update'
  | 'property.delete'
  | 'property.status_change'
  | 'error.status_change'
  | 'report.status_change'
  | 'announcement.publish'
  | 'announcement.recall'

export type AuditTargetType = 'broker' | 'user' | 'property' | 'error' | 'report' | 'announcement'

/** 액션 → 한글 라벨 + 색상 (활동 로그 뷰어용) */
export const AUDIT_ACTION_META: Record<string, { label: string; tone: 'green' | 'red' | 'blue' | 'yellow' | 'gray' | 'purple' }> = {
  'broker.verify':           { label: '사무소 인증 승인', tone: 'green' },
  'broker.unverify':         { label: '사무소 인증 취소', tone: 'red' },
  'broker.reject':           { label: '사무소 인증 반려', tone: 'yellow' },
  'user.suspend':            { label: '회원 일시정지',    tone: 'yellow' },
  'user.unsuspend':          { label: '회원 정지해제',    tone: 'green' },
  'user.ban':                { label: '회원 영구차단',    tone: 'red' },
  'user.role_change':        { label: '회원 역할변경',    tone: 'purple' },
  'user.note_update':        { label: '회원 메모수정',    tone: 'gray' },
  'property.delete':         { label: '매물 삭제',        tone: 'red' },
  'property.status_change':  { label: '매물 상태변경',    tone: 'blue' },
  'error.status_change':     { label: '에러 상태변경',    tone: 'gray' },
  'report.status_change':    { label: '신고 처리',        tone: 'blue' },
  'announcement.publish':    { label: '공지 발행',        tone: 'green' },
  'announcement.recall':     { label: '공지 회수',        tone: 'red' },
}

export const auditActionLabel = (action: string): string =>
  AUDIT_ACTION_META[action]?.label ?? action

/** 대상 타입 한글 라벨 */
export const AUDIT_TARGET_LABEL: Record<string, string> = {
  broker: '사무소',
  user: '회원',
  property: '매물',
  error: '에러',
  report: '신고',
  announcement: '공지',
}

type AuditInput = {
  action: AuditAction
  targetType: AuditTargetType
  targetId: string
  metadata?: Record<string, unknown>
}

/**
 * 관리자 위험 액션 감사 로그 기록.
 * 호출 실패해도 사용자 액션을 막지 않음 (best-effort 기록).
 */
export async function logAdminAction(
  supabase: SupabaseClient,
  adminUserId: string,
  input: AuditInput,
): Promise<void> {
  try {
    await supabase.from('admin_action_logs').insert({
      admin_user_id: adminUserId,
      action: input.action,
      target_type: input.targetType,
      target_id: input.targetId,
      metadata: input.metadata ?? null,
    })
  } catch (e) {
    console.error('[audit] failed to log admin action', { input, error: e })
  }
}
