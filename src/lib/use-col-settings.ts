'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export interface ColSettings {
  visible: string[]
  order: string[]
  widths: Record<string, number>
  customCols: Array<{ id: string; name: string; type?: 'text' | 'select' }>
  options: Record<string, string[]>
  colTypes: Record<string, 'text' | 'select'>
  /** 다중 선택 허용 여부 (select 칼럼 한정). true면 셀에 칩 여러 개 가능. */
  multi: Record<string, boolean>
  /** 면적 칼럼 단위 (전체 매물에 일괄 적용). DB는 항상 평으로 저장. */
  areaUnit?: '평' | 'm²'
}

type Page = 'properties' | 'customers' | 'diary' | 'diary_cust'

export function useColSettings(
  page: Page,
  brokerId: string | null,
  defaults: ColSettings,
) {
  const [settings, setSettings] = useState<ColSettings>(defaults)
  const [loaded, setLoaded] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const supabase = createClient()

  // Load from DB on mount (once brokerId is available)
  useEffect(() => {
    if (!brokerId) return
    ;(async () => {
      const { data } = await supabase
        .from('broker_profiles')
        .select('col_settings')
        .eq('id', brokerId)
        .single()
      const saved = data?.col_settings?.[page] as Partial<ColSettings> | undefined
      if (saved) {
        setSettings(prev => ({
          visible:    (saved.visible && saved.visible.length > 0) ? saved.visible : prev.visible,
          order:      saved.order      ?? prev.order,
          widths:     { ...prev.widths, ...(saved.widths ?? {}) },
          customCols: saved.customCols ?? prev.customCols,
          options:    { ...prev.options, ...(saved.options ?? {}) },
          colTypes:   { ...prev.colTypes, ...(saved.colTypes ?? {}) },
          multi:      { ...prev.multi,    ...(saved.multi    ?? {}) },
          areaUnit:   saved.areaUnit ?? prev.areaUnit,
        }))
      }
      setLoaded(true)
    })()
  }, [brokerId, page])

  // Debounced DB save
  const update = (partial: Partial<ColSettings> | ((prev: ColSettings) => ColSettings)) => {
    setSettings(prev => {
      const next = typeof partial === 'function' ? partial(prev) : { ...prev, ...partial }

      if (brokerId) {
        if (debounceRef.current) clearTimeout(debounceRef.current)
        debounceRef.current = setTimeout(async () => {
          // Read existing col_settings first to avoid overwriting other pages
          const { data } = await supabase
            .from('broker_profiles')
            .select('col_settings')
            .eq('id', brokerId)
            .single()
          const existing = (data?.col_settings ?? {}) as Record<string, ColSettings>
          await supabase
            .from('broker_profiles')
            .update({ col_settings: { ...existing, [page]: next } })
            .eq('id', brokerId)
        }, 800)
      }

      return next
    })
  }

  return { settings, update, loaded }
}
