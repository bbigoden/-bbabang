/**
 * PDF·메일 라우트가 함께 쓰는 조회 헬퍼.
 * (app 디렉토리 안이지만 route.ts/page.tsx가 아니므로 라우트로 잡히지 않는다)
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Estimate, EstimateCompany, EstimateItem } from '@/lib/estimate'

export interface LoadedEstimate {
  estimate: Estimate
  items: EstimateItem[]
  company: Partial<EstimateCompany> | null
}

/**
 * 견적서 + 내역 + 발행 회사 정보를 읽는다.
 * 회사 정보는 발행 당시 스냅샷을 우선 쓰고, 없을 때만 현재 회사 레코드로 대체한다.
 */
export async function loadEstimate(
  supabase: SupabaseClient,
  id: string
): Promise<LoadedEstimate | null> {
  const { data: estimate } = await supabase
    .from('estimates').select('*').eq('id', id).maybeSingle()
  if (!estimate) return null

  const { data: items } = await supabase
    .from('estimate_items').select('*').eq('estimate_id', id).order('sort_order')

  let company: Partial<EstimateCompany> | null = estimate.company_snapshot ?? null
  if (!company && estimate.company_id) {
    const { data } = await supabase
      .from('estimate_companies').select('*').eq('id', estimate.company_id).maybeSingle()
    company = data ?? null
  }

  return {
    estimate: estimate as Estimate,
    items: (items as EstimateItem[]) ?? [],
    company,
  }
}

/** 견적서_2026-0904-01_○○상사.pdf */
export function pdfFileName(e: Estimate): string {
  const client = (e.client_name || '거래처').replace(/[\\/:*?"<>|]/g, '')
  return `견적서_${e.estimate_no}_${client}.pdf`
}
