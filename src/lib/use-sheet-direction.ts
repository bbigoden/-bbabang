'use client'

/**
 * 시트형 페이지(매물 / 고객 / 업무일지)의 **새 행 추가 방향** 글로벌 설정.
 *
 * - 위(up): 새 행이 목록 맨 위에 오고, 정렬도 최신 위
 * - 아래(down): 새 행이 목록 맨 아래에 오고, 정렬도 최신 아래
 *
 * broker_profiles.col_settings._shared.add_direction 에 저장한다.
 * 세 페이지가 동일 키를 공유 → 한 곳에서 토글하면 세 페이지 모두 즉시 반영.
 */
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export type AddDirection = 'up' | 'down'

export function useSheetDirection(brokerId: string | null) {
  const [direction, setDirection] = useState<AddDirection>('up')
  const [loaded, setLoaded] = useState(false)
  const supabase = createClient()

  useEffect(() => {
    if (!brokerId) return
    ;(async () => {
      const { data } = await supabase
        .from('broker_profiles')
        .select('col_settings')
        .eq('id', brokerId)
        .single()
      const d = (data?.col_settings as Record<string, unknown> | null)?._shared as { add_direction?: AddDirection } | undefined
      if (d?.add_direction === 'up' || d?.add_direction === 'down') {
        setDirection(d.add_direction)
      }
      setLoaded(true)
    })()
  }, [brokerId])

  const updateDirection = async (next: AddDirection) => {
    setDirection(next)
    if (!brokerId) return
    const { data } = await supabase
      .from('broker_profiles')
      .select('col_settings')
      .eq('id', brokerId)
      .single()
    const existing = (data?.col_settings ?? {}) as Record<string, unknown>
    const sharedExisting = (existing._shared ?? {}) as Record<string, unknown>
    await supabase
      .from('broker_profiles')
      .update({
        col_settings: {
          ...existing,
          _shared: { ...sharedExisting, add_direction: next },
        },
      })
      .eq('id', brokerId)
  }

  return { direction, updateDirection, loaded }
}
