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
