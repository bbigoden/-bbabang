'use client'

import { useCallback, useEffect, useState } from 'react'
import { getColSettings, patchColSettings } from '@/lib/col-settings-store'
import { SOURCE_OPTIONS } from '@/lib/customer-sources'

// 사무실 공통 '유입' 선택지 — 대표만 화면에서 고치고, 직원은 대표가 정한 목록을 그대로 쓴다.
// 대표 broker_profiles.col_settings.office.sourceOptions 에 둔다(DB 변경 없이, 매물장 업종과 같은 길).
// 칼럼 설정(col_settings[page])과 다른 키라 useColSettings 저장이 덮어쓰지 않는다.
// 아직 저장한 적이 없으면 코드 기본값(SOURCE_OPTIONS)을 쓴다.
export function useOfficeSources(officeId: string | null, isOwner: boolean) {
  const [options, setOptions] = useState<string[]>(SOURCE_OPTIONS)

  useEffect(() => {
    if (!officeId) return
    let alive = true
    getColSettings(officeId)
      .then(cs => {
        const saved = cs.office?.sourceOptions
        if (alive && Array.isArray(saved) && saved.length > 0) setOptions(saved)
      })
    return () => { alive = false }
  }, [officeId])

  const save = useCallback(async (opts: string[]) => {
    if (!officeId) return
    setOptions(opts)
    await patchColSettings(officeId, existing => ({ ...existing, office: { ...(existing.office ?? {}), sourceOptions: opts } }))
  }, [officeId])

  return { sourceOptions: options, saveSourceOptions: isOwner ? save : undefined }
}
