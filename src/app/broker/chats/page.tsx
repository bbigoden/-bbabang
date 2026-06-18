import { redirect } from 'next/navigation'

// 고객 채팅은 '대화'(/broker/messenger)의 '고객 상담' 탭으로 통합됨 — 기존 링크 보존용 리다이렉트
export default function BrokerChatsPage() {
  redirect('/broker/messenger')
}
