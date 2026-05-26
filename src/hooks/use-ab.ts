'use client'

import { useEffect, useState } from 'react'
import { AB_COOKIE_PREFIX } from '@/lib/ab-experiments'

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`))
  return match ? decodeURIComponent(match[1]) : null
}

/**
 * A/B 실험 variant를 읽는 클라이언트 훅.
 *
 * @param experimentId  EXPERIMENTS 배열의 id (예: 'home_cta_v1')
 * @returns variant id (예: 'control' | 'treatment') 또는 null (미배정 / 비활성)
 *
 * @example
 * const variant = useAb('home_cta_v1')
 * return variant === 'treatment' ? <ButtonNew /> : <ButtonOld />
 */
export function useAb(experimentId: string): string | null {
  const [variant, setVariant] = useState<string | null>(null)

  useEffect(() => {
    setVariant(readCookie(`${AB_COOKIE_PREFIX}${experimentId}`))
  }, [experimentId])

  return variant
}
