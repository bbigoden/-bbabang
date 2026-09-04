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
  /** 직인 서명 URL (버킷이 비공개라 렌더 직전에 만든다). 없으면 null */
  stampUrl: string | null
}

const STAMP_BUCKET = 'estimate-stamps'

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

  // 직인은 비공개 버킷에 있다. PDF 렌더가 실제로 가져갈 수 있도록 짧은 서명 URL을 만든다.
  // 실패해도 견적서는 나와야 하므로(직인만 빠짐) 조용히 null 처리한다.
  let stampUrl: string | null = null
  if (company?.stamp_path) {
    const { data } = await supabase.storage
      .from(STAMP_BUCKET)
      .createSignedUrl(company.stamp_path, 120)
    stampUrl = data?.signedUrl ?? null
  }

  return {
    estimate: estimate as Estimate,
    items: (items as EstimateItem[]) ?? [],
    company,
    stampUrl,
  }
}

/** 견적서_2026-0904-01_○○상사.pdf */
export function pdfFileName(e: Estimate): string {
  const client = (e.client_name || '거래처').replace(/[\\/:*?"<>|]/g, '')
  return `견적서_${e.estimate_no}_${client}.pdf`
}
