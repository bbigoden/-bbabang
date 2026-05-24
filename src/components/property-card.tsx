import Image from 'next/image'
import Link from 'next/link'
import { Building2 } from 'lucide-react'
import { formatAddress, formatPrice, maskAddressByType } from '@/lib/utils'

export type PropertyCardData = {
  id: string | number
  images?: string[] | null
  deal_type?: string | null
  room_type?: string | null
  address?: string | null
  price?: number | null
  monthly_rent?: number | null
  broker_id?: string | number | null
  broker_profiles?: {
    office_name?: string | null
    profiles?: { name?: string | null } | null
  } | null
}

type Size = 'sm' | 'md' | 'lg'

const HEIGHT_BY_SIZE: Record<Size, string> = {
  sm: 'h-28',
  md: 'h-32',
  lg: 'h-36',
}

type Props = {
  property: PropertyCardData
  href: string
  size?: Size
  showBroker?: boolean
  badge?: React.ReactNode
  overlay?: React.ReactNode
  footer?: React.ReactNode
  className?: string
}

export function PropertyCard({
  property: p,
  href,
  size = 'sm',
  showBroker = true,
  badge,
  overlay,
  footer,
  className,
}: Props) {
  const masked = p.address ? maskAddressByType(formatAddress(p.address), p.room_type) : '주소 미입력'
  const priceLine = !p.price
    ? '가격 협의'
    : p.deal_type === '월세'
      ? `보증금 ${formatPrice(p.price)} / 월 ${formatPrice(p.monthly_rent ?? 0)}`
      : formatPrice(p.price)

  const card = (
    <div className={`block rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden hover:border-blue-300 hover:shadow-sm transition-all ${className ?? ''}`}>
      {p.images?.[0] && (
        <div className={`relative ${HEIGHT_BY_SIZE[size]} w-full`}>
          <Image
            src={p.images[0]}
            alt={`${p.deal_type ?? ''} ${p.room_type ?? '매물'} ${p.address ?? ''}`.trim()}
            fill
            className="object-cover"
            sizes="(max-width: 640px) 100vw, 50vw"
          />
          {badge && <div className="absolute left-3 top-3">{badge}</div>}
        </div>
      )}
      <div className="p-4">
        <div className="flex flex-wrap gap-1.5 mb-1.5">
          {p.deal_type && (
            <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-700">
              {p.deal_type}
            </span>
          )}
          {p.room_type && (
            <span className="rounded-full bg-gray-100 dark:bg-gray-800 px-2 py-0.5 text-[10px] font-medium text-gray-600 dark:text-gray-400">
              {p.room_type}
            </span>
          )}
        </div>
        <p className="text-sm font-semibold text-gray-800 dark:text-gray-100 truncate">{masked}</p>
        <p className="mt-1 text-sm font-black text-blue-600">{priceLine}</p>
        {showBroker && (p.broker_profiles?.profiles?.name || p.broker_profiles?.office_name) && (
          <p className="mt-1 inline-flex items-center gap-1 text-xs text-gray-400 truncate max-w-full">
            <Building2 className="h-3 w-3 flex-shrink-0" />
            <span className="truncate">
              {p.broker_profiles?.profiles?.name}
              {p.broker_profiles?.profiles?.name && p.broker_profiles?.office_name ? ' · ' : ''}
              {p.broker_profiles?.office_name}
            </span>
          </p>
        )}
        {footer && <div className="mt-2">{footer}</div>}
      </div>
    </div>
  )

  if (overlay) {
    return (
      <div className="relative">
        <Link href={href}>{card}</Link>
        <div className="absolute right-3 top-3 z-10">{overlay}</div>
      </div>
    )
  }
  return <Link href={href}>{card}</Link>
}
