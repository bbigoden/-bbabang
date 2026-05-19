'use client'

/**
 * 시트형 페이지(매물 / 고객 / 업무일지)의 **새 행 추가 방향** 페이지별 설정.
 *
 * - 위(up): 새 행이 목록 맨 위에 오고, 정렬도 최신 위
 * - 아래(down): 새 행이 목록 맨 아래에 오고, 정렬도 최신 아래
 *
 * broker_profiles.col_settings._shared.add_direction[scope] 에 저장.
 * scope: 'properties' | 'customers' | 'diary' 로 페이지별로 분리.
 * (예전엔 세 페이지가 같은 값을 공유했지만 사용자가 각자 다르게 쓰고 싶어해 분리됨)
 *
 * 이전 버전 호환: _shared.add_direction 이 문자열로 저장되어 있으면 모든
 * scope에 같은 값으로 마이그레이션해서 읽음 (저장 시점부터 객체 형태로 새로 씀).
 */
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export type AddDirection = 'up' | 'down'
export type SheetScope = 'properties' | 'customers' | 'diary'

export function useSheetDirection(brokerId: string | null, scope: SheetScope = 'properties') {
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
      const shared = (data?.col_settings as Record<string, unknown> | null)?._shared as
        | { add_direction?: AddDirection | Record<string, AddDirection> }
        | undefined
      const raw = shared?.add_direction
      let resolved: AddDirection | undefined
      if (typeof raw === 'string') {
        // 이전 버전 — 단일 문자열을 전 페이지에 공유. 그대로 읽고 다음 저장 때 객체로 분리됨.
        resolved = raw === 'down' ? 'down' : 'up'
      } else if (raw && typeof raw === 'object') {
        const v = raw[scope]
        if (v === 'up' || v === 'down') resolved = v
      }
      if (resolved) setDirection(resolved)
      setLoaded(true)
    })()
  }, [brokerId, scope])

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
    // 기존 add_direction이 string이면 무시하고 객체로 새로 쓰기. 객체면 머지.
    const prevDirMap = (typeof sharedExisting.add_direction === 'object' && sharedExisting.add_direction !== null)
      ? (sharedExisting.add_direction as Record<string, AddDirection>)
      : {}
    await supabase
      .from('broker_profiles')
      .update({
        col_settings: {
          ...existing,
          _shared: {
            ...sharedExisting,
            add_direction: { ...prevDirMap, [scope]: next },
          },
        },
      })
      .eq('id', brokerId)
  }

  return { direction, updateDirection, loaded }
}
