// 플랫폼 지원 메일 — 운영 환경변수(NEXT_PUBLIC_CONTACT_EMAIL)로 교체.
// 폴백은 현 운영 주소: env 미설정 상태에서 문의 버튼이 죽으면 안 되므로 유지하되,
// SaaS 전환 시 이 파일 한 곳만 바꾸면 전체에 반영된다.
export const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? 'bigodennn@gmail.com'
