import { redirect } from 'next/navigation'

// 중개사 공개 프로필 페이지는 제거됨 — 기존 공유 링크·검색엔진 유입은 홈으로 이동
export default async function BrokerPublicProfileRemoved() {
  redirect('/')
}
