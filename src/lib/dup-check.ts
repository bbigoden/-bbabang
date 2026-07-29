/**
 * 매물·고객 중복 판정 유틸.
 *
 * 매물 판정 기준은 텔레그램 등록봇(빠방등록/bot.py find_duplicate_property)과 동일:
 *   소재지(정규화) + 거래형태가 같으면 중복. 담당자는 기준에 넣지 않음
 *   (다른 직원이 올린 같은 물건도 중복으로 봐야 하므로).
 * 휴지통(deleted_at) 행은 SELECT RLS가 이미 숨기므로 별도 필터 불필요.
 *
 * 고객 판정 기준: 연락처 숫자만 남겨 비교 ('010-1234-5678' == '01012345678').
 */
import type { SupabaseClient } from '@supabase/supabase-js'

/** 주소 비교용 정규화 — 공백·쉼표·마침표·가운뎃점 제거.
 *  '불당동 1491 502호' 와 '불당동1491  502호' 를 같은 주소로 본다. */
export function normAddr(s: string | null | undefined): string {
  return (s ?? '').replace(/[\s,.·]/g, '')
}

/** PostgREST ilike 패턴 — 동/리/가 이름 + 그 뒤 첫 번지로 후보를 좁힌다.
 *  추출 실패 시 빈 문자열(거래형태로만 조회). */
export function addrLikePattern(addr: string): string {
  const m = /([가-힣]+(?:동|리|가))/.exec(addr)
  if (!m) return ''
  const num = /\d+(?:-\d+)?/.exec(addr.slice(m.index + m[1].length))
  return num ? `%${m[1]}%${num[0]}%` : `%${m[1]}%`
}

export interface DupProperty {
  id: string
  address: string
  deal_type: string
  assignee: string | null
}

/** 사무소 전체(brokerIds)에서 소재지+거래형태가 같은 기존 매물을 찾는다 (없으면 null).
 *  dealType이 비어 있으면(새 행에서 아직 미입력) 거래형태 무관하게 같은 소재지를 찾는다. */
export async function findDuplicateProperty(
  supabase: SupabaseClient,
  brokerIds: string[],
  address: string,
  dealType: string | null,
  excludeId?: string,
): Promise<DupProperty | null> {
  const target = normAddr(address)
  if (!target || brokerIds.length === 0) return null
  let q = supabase
    .from('broker_properties')
    .select('id, address, deal_type, assignee')
    .in('broker_id', brokerIds)
    .limit(500)
  const pat = addrLikePattern(address)
  if (pat) q = q.ilike('address', pat)
  if (dealType) q = q.eq('deal_type', dealType)
  if (excludeId) q = q.neq('id', excludeId)
  const { data } = await q
  return (data as DupProperty[] | null)?.find(r => normAddr(r.address) === target) ?? null
}

/** 연락처 비교용 정규화 — 숫자만 남김. */
export function normContact(s: string | null | undefined): string {
  return (s ?? '').replace(/\D/g, '')
}

export interface DupCustomer {
  id: string
  client_name: string
  contact: string | null
  assignee: string | null
}

/** 사무소 전체(brokerIds)에서 같은 연락처의 고객을 찾는다.
 *  끝 4자리 ilike로 후보를 좁힌 뒤 전체 숫자 일치로 확정 (7자리 미만은 메모성 입력으로 보고 패스). */
export async function findDuplicateCustomers(
  supabase: SupabaseClient,
  brokerIds: string[],
  contact: string,
  excludeId?: string,
): Promise<DupCustomer[]> {
  const digits = normContact(contact)
  if (digits.length < 7 || brokerIds.length === 0) return []
  let q = supabase
    .from('broker_customers')
    .select('id, client_name, contact, assignee')
    .in('broker_id', brokerIds)
    .ilike('contact', `%${digits.slice(-4)}%`)
    .limit(50)
  if (excludeId) q = q.neq('id', excludeId)
  const { data } = await q
  return ((data as DupCustomer[] | null) ?? []).filter(r => normContact(r.contact) === digits)
}
