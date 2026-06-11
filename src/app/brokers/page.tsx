import { redirect } from 'next/navigation'

// 중개사 둘러보기 페이지는 제거됨 — 기존 링크·검색엔진 유입은 홈으로 이동
export default function BrokersRemoved() {
  redirect('/')
}
