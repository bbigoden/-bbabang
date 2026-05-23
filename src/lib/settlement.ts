// 정산 계산 유틸
// 입력 컬럼: seller_fee, buyer_fee (VAT 포함 원 단위), settlement_rate (0.5/0.55/0.6/0.7…)
// 자동 계산: 총수수료 → 공급가 → VAT → 담당자수수료 → 원천공제 → 실수령 → 지점수익
//
// 수식 (엑셀 기준):
//   total       = seller_fee + buyer_fee
//   supply      = total / 1.1                  (공급가 = VAT 별도)
//   vat         = total - supply
//   assignee    = supply * settlement_rate     (담당자 수수료, VAT 제외 공급가 × 정산비)
//   withhold    = 소득세 3% + 지방세 0.3% (각각 10원 단위 절사)
//   takeHome    = assignee - withhold          (실수령)
//   officeShare = supply - assigneeSum         (지점 수익 — 공동중개면 담당자들 합 제외)

/** 10원 단위 절사 */
const floorTo10 = (n: number) => Math.floor(n / 10) * 10

/** 한 행의 자동 계산 */
export interface SettlementInput {
  seller_fee: number          // 매도/임대 수수료 (VAT 포함)
  buyer_fee:  number          // 매수/임차 수수료 (VAT 포함)
  settlement_rate: number     // 정산비 (예: 0.55)
  withhold_exempt?: boolean   // 원천 면제 여부
}

export interface SettlementCalc {
  total:    number   // 총수수료 (= H + I)
  supply:   number   // 공급가  (= total / 1.1)
  vat:      number   // VAT     (= total - supply)
  assignee: number   // 담당자수수료 (= supply × rate)
  withhold: number   // 원천공제 (3.3%, 10원 단위 절사)
  takeHome: number   // 실수령액 (= assignee - withhold)
}

export function calcSettlement(input: SettlementInput): SettlementCalc {
  const total    = Math.max(0, Math.round((input.seller_fee || 0) + (input.buyer_fee || 0)))
  const supply   = Math.round(total / 1.1)
  const vat      = total - supply
  const assignee = Math.round(supply * (input.settlement_rate || 0))
  const incomeTax    = floorTo10(assignee * 0.03)
  const localTax     = floorTo10(assignee * 0.003)
  const withhold = input.withhold_exempt ? 0 : (incomeTax + localTax)
  const takeHome = assignee - withhold
  return { total, supply, vat, assignee, withhold, takeHome }
}

/** 공동중개 — 같은 계약(같은 contract_no) 여러 행을 받아 지점 수익 계산 */
export interface SettlementRow extends SettlementInput {
  id?: string
  contract_no: number
}

export function calcOfficeShare(rows: SettlementRow[]): number {
  if (rows.length === 0) return 0
  // 한 계약의 공급가는 모든 행이 같지만 안전하게 첫 행 기준
  const first = rows[0]
  const total  = Math.max(0, Math.round((first.seller_fee || 0) + (first.buyer_fee || 0)))
  const supply = Math.round(total / 1.1)
  const assigneeSum = rows.reduce((s, r) => s + calcSettlement(r).assignee, 0)
  return supply - assigneeSum
}

/** 통화 표시 — 천 단위 콤마 + 원 */
export function fmtWon(n: number): string {
  if (!Number.isFinite(n)) return '-'
  const sign = n < 0 ? '-' : ''
  return sign + Math.abs(Math.round(n)).toLocaleString('ko-KR') + '원'
}

/** 표·엑셀에서 쓰는 짧은 콤마 표기 (원 없음) */
export function fmtComma(n: number): string {
  if (!Number.isFinite(n)) return ''
  return Math.round(n).toLocaleString('ko-KR')
}
