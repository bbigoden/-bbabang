// 정산 계산 유틸
// 입력 컬럼: seller_fee, buyer_fee (VAT 포함 원 단위), settlement_rate (0.5/0.55/0.6/0.7…)
// 자동 계산: 총수수료 → 공급가 → VAT → 담당자수수료 → 원천공제 → 실수령 → 지점수익
//
// 수식 (엑셀 기준):
//   total       = seller_fee + buyer_fee
//   supply      = total / 1.1                  (공급가 = VAT 별도)
//   vat         = total - supply
//   assignee    = supply * settlement_rate     (담당자 수수료, VAT 제외 공급가 × 정산비 — 정산비는 0~1로 자름)
//   withhold    = 소득세 3% + 지방세 0.3% (각각 10원 단위 절사)
//   takeHome    = assignee - withhold          (실수령)
//   officeShare = supply - assigneeSum         (지점 수익 — 공동중개면 담당자들 합 제외)

import { todayKST } from './date-kst'

/** 10원 단위 절사 */
const floorTo10 = (n: number) => Math.floor(n / 10) * 10

/**
 * 정산비는 0~1. 화면 입력만 막으면 REST 로 9.999 를 넣었을 때 담당자수수료가 공급가의
 * 10배로 잡혀 요약·통계·CSV 가 통째로 틀어지므로 계산에서도 한 번 더 자른다(DB CHECK 와 이중).
 * 숫자가 아니면 0.
 */
export const clampRate = (v: unknown): number => Math.min(1, Math.max(0, Number(v) || 0))

/**
 * 정산 기록월(record_month) 기준 '이번 달' YYYY-MM — 한국 날짜로 센다.
 * getMonth() 로 세면 UTC 기기에선 매월 1일 아침 9시 전까지 지난달로 열리고 새 행도 지난달에 들어간다.
 */
export const thisRecordMonth = (now = new Date()): string => todayKST(now).slice(0, 7)

/**
 * 사무실 손익 분배 행 여부 — contract_address가 "YYYY-MM 사무실 손익 분배" 형식.
 * 분배 행은 동업 지분 배당이지 매출·실적이 아니므로 모든 정산 집계에서 제외한다 (2026-07-28 확정).
 */
export const isDistributionRow = (r: { contract_address?: string | null }) =>
  !!r.contract_address?.endsWith('사무실 손익 분배')

/** 한 행의 자동 계산 */
export interface SettlementInput {
  seller_fee: number                  // 매도/임대 수수료 (기본: VAT 포함)
  buyer_fee:  number                  // 매수/임차 수수료 (기본: VAT 포함)
  settlement_rate: number             // 정산비 (예: 0.55)
  withhold_exempt?: boolean           // 원천 면제 여부
  vat_override?: number | null        // VAT 수동값. null/undefined면 total/11 자동. 0이면 현금(VAT 없음) 케이스
}

export interface SettlementCalc {
  total:    number   // 총수수료 (= H + I)
  supply:   number   // 공급가  (자동: total / 1.1, 수동: total - vat_override)
  vat:      number   // VAT     (자동: total - supply, 수동: vat_override)
  assignee: number   // 담당자수수료 (= supply × rate)
  withhold: number   // 원천공제 (3.3%, 10원 단위 절사)
  takeHome: number   // 실수령액 (= assignee - withhold)
}

export function calcSettlement(input: SettlementInput): SettlementCalc {
  // 음수 허용 — 손실 달의 분배 행(마이너스 정산) 표시용
  const total = Math.round((input.seller_fee || 0) + (input.buyer_fee || 0))
  let supply: number, vat: number
  if (input.vat_override != null) {
    vat = Math.max(0, Math.round(input.vat_override))
    supply = total - vat
  } else {
    supply = Math.round(total / 1.1)
    vat = total - supply
  }
  const assignee = Math.round(supply * clampRate(input.settlement_rate))
  const withhold = input.withhold_exempt ? 0 : calcWithhold(assignee)
  const takeHome = assignee - withhold
  return { total, supply, vat, assignee, withhold, takeHome }
}

/** 원천공제액 (소득세 3% + 지방세 0.3%, 각각 10원 단위 절사). 음수/0이면 0 */
export function calcWithhold(amount: number): number {
  if (amount <= 0) return 0
  return floorTo10(amount * 0.03) + floorTo10(amount * 0.003)
}

/**
 * 월별 사무실 수익(공급가 − 담당자수수료) 합. 키는 record_month.
 * 분배 행은 뺀다 — 분배 행의 매도칸이 바로 이 값이라, 넣으면 분배에 분배가 섞여 돈다.
 */
export function sumOfficeProfitByMonth(
  rows: Array<SettlementInput & { contract_address?: string | null; record_month?: string | null }>,
): Map<string, number> {
  const m = new Map<string, number>()
  for (const r of rows) {
    if (isDistributionRow(r)) continue
    const c = calcSettlement(r)
    const key = r.record_month ?? ''
    m.set(key, (m.get(key) ?? 0) + (c.supply - c.assignee))
  }
  return m
}

/**
 * CSV 글자 칸 하나. 쉼표·따옴표·줄바꿈은 따옴표로 감싸고,
 * = + - @ 탭 CR 로 시작하면 앞에 ' 를 붙여 엑셀이 수식으로 실행하지 못하게 한다.
 * 금액 칸은 이걸 거치지 않으므로(숫자 그대로) 음수 금액이 글자로 바뀌지 않는다.
 */
export function csvCell(s: string | null | undefined): string {
  let v = s ?? ''
  if (/^[=+\-@\t\r]/.test(v)) v = "'" + v
  return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v
}

/** 표·엑셀에서 쓰는 짧은 콤마 표기 (원 없음) */
export function fmtComma(n: number): string {
  if (!Number.isFinite(n)) return ''
  return Math.round(n).toLocaleString('ko-KR')
}
