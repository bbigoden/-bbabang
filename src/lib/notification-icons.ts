// 알림 종류별 아이콘. 지금 실제로 생기는 종류만 둔다 — 없는 종류는 🔔.
// 고객 요청·제안·리뷰 알림은 2026-10-30 고객 화면과 함께 없앴다.
export const NOTIFICATION_ICON: Record<string, string> = {
  announcement: '📢',                 // 관리자 공지
  assignee_property_assigned: '🏠',   // 매물 담당자로 지정됨 (DB notify_assignee_change)
  assignee_customer_assigned: '🙋',   // 고객 담당자로 지정됨 (같은 트리거)
  staff_diary_added: '📝',            // 직원 업무일지
  referral_signup: '🎁',              // 추천 가입 (DB handle_new_user)
}
