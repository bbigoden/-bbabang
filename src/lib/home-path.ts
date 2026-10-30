/**
 * 로그인한 사람의 첫 화면. 고객 화면(/dashboard/user 등)은 2026-10-30 걷어내, 중개사도 관리자도 아닌
 * 계정(예전 고객 가입)은 사무소 등록으로 보낸다 — 등록하면 role 이 broker 로 바뀐다.
 */
export function homePath(role: string | null | undefined): string {
  if (role === 'admin') return '/admin'
  if (role === 'broker') return '/dashboard/broker'
  return '/broker/register'
}
