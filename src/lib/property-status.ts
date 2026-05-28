// 매물 상태 단일 진실원 (DB: broker_properties.status)
// 모든 화면에서 동일한 라벨·색상을 사용하도록 이 상수에서 import 한다.

export type PropertyStatus = 'available' | 'contracted' | 'hidden'

export interface PropertyStatusMeta {
  label: string
  // tailwind 토큰: badge 배경+텍스트 (border 포함)
  badge: string
  // 단색 클래스만 필요할 때 (배경+텍스트, border 없음)
  pill: string
}

export const PROPERTY_STATUS_META: Record<PropertyStatus, PropertyStatusMeta> = {
  available:  { label: '거래가능', badge: 'bg-green-500/20 text-green-400 border-green-500/30', pill: 'bg-green-500/20 text-green-400' },
  contracted: { label: '계약완료', badge: 'bg-blue-500/20 text-blue-400 border-blue-500/30',     pill: 'bg-blue-500/20 text-blue-400' },
  hidden:     { label: '숨김',     badge: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30', pill: 'bg-yellow-500/20 text-yellow-400' },
}

export const propertyStatusLabel = (s: string): string =>
  (PROPERTY_STATUS_META as Record<string, PropertyStatusMeta>)[s]?.label ?? s
