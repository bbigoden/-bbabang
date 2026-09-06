/**
 * 견적서 (건설·인테리어) 공용 타입·계산·프리셋.
 *
 * 화면(작성/미리보기)과 서버(PDF·메일)가 같은 계산을 써야 하므로
 * 합계 로직은 전부 여기 모아둔다.
 */

import { addDays, todayKST } from './date-kst'

export type VatMode = 'add' | 'none'
export type EstimateStatus = 'draft' | 'sent' | 'won' | 'lost'

export interface EstimateItem {
  id?: string
  sort_order: number
  is_header: boolean
  category: string | null
  name: string | null
  spec: string | null
  unit: string | null
  qty: number
  /** 거래처에 청구하는 단가. 나눠 적었으면 material_price + labor_price 와 같다 */
  unit_price: number
  /** 단가 중 재료비 (0 이면 나누지 않은 것) */
  material_price: number
  /** 단가 중 인건비 (0 이면 나누지 않은 것) */
  labor_price: number
  /** 원가 (내부용). 견적서 PDF 에는 절대 내보내지 않는다 */
  cost_price: number
  amount: number
  remark: string | null
}

/**
 * 재료비·인건비를 나눠 적었는지.
 *
 * 둘 다 0 이면 예전처럼 단가 하나만 쓴 것이다. 그때는 견적서에도 단가 한 칸으로
 * 찍어 표를 좁게 쓴다 — 안 쓰는 칸을 두 개나 벌려 둘 이유가 없다.
 */
export function isSplitPricing(
  items: Pick<EstimateItem, 'is_header' | 'material_price' | 'labor_price'>[]
): boolean {
  return items.some(it =>
    !it.is_header && ((Number(it.material_price) || 0) > 0 || (Number(it.labor_price) || 0) > 0))
}

/**
 * 나눠 적었으면 재료비+인건비를 단가로 삼는다.
 * 한쪽만 적었을 때도 합이 곧 단가다(인건비만 드는 일도 흔하다).
 */
export function effectiveUnitPrice(
  it: Pick<EstimateItem, 'unit_price' | 'material_price' | 'labor_price'>
): number {
  const m = Number(it.material_price) || 0
  const l = Number(it.labor_price) || 0
  return m + l > 0 ? m + l : (Number(it.unit_price) || 0)
}

/** 내역 전체의 재료비·인건비 합 (나눠 적은 줄만 센다) */
export function splitTotals(
  items: Pick<EstimateItem, 'is_header' | 'qty' | 'material_price' | 'labor_price'>[]
): { material: number; labor: number } {
  let material = 0
  let labor = 0
  for (const it of items) {
    if (it.is_header) continue
    const q = Number(it.qty) || 0
    material += Math.round(q * (Number(it.material_price) || 0))
    labor += Math.round(q * (Number(it.labor_price) || 0))
  }
  return { material, labor }
}

/** 품목 사전 — 내역에서 품명을 치면 과거에 쓴 항목이 단가·원가와 함께 뜬다 */
export interface CatalogItem {
  id: string
  category: string | null
  name: string
  spec: string | null
  unit: string | null
  unit_price: number
  material_price: number
  labor_price: number
  cost_price: number
  use_count: number
}

export interface EstimateCompany {
  id: string
  name: string
  biz_no: string | null
  ceo: string | null
  address: string | null
  biz_type: string | null
  biz_item: string | null
  phone: string | null
  fax: string | null
  email: string | null
  manager_name: string | null
  manager_phone: string | null
  bank_account: string | null
  /** 직인 이미지의 버킷 내 경로. 버킷이 비공개라 URL이 아니라 경로를 보관한다 */
  stamp_path: string | null
  default_notes: string | null
  is_default: boolean
  sort_order: number
}

export interface EstimateClient {
  id: string
  name: string
  contact_name: string | null
  phone: string | null
  email: string | null
  address: string | null
  memo: string | null
}

export interface Estimate {
  id: string
  owner_broker_id?: string
  /** 수정 견적의 뿌리. 원본은 자기 자신을 가리키지 않고 null 이다 */
  root_estimate_id?: string | null
  revision?: number
  company_id: string | null
  client_id: string | null
  estimate_no: string
  issue_date: string
  company_snapshot: Partial<EstimateCompany> | null
  client_name: string | null
  client_contact: string | null
  client_phone: string | null
  client_email: string | null
  site_address: string | null
  project_name: string | null
  period: string | null
  valid_days: number
  payment_terms: string | null
  notes: string | null
  overhead_rate: number
  discount: number
  vat_mode: VatMode
  subtotal: number
  overhead_amount: number
  supply_amount: number
  vat: number
  total: number
  /** 원가 합계 (내부용) */
  total_cost: number
  status: EstimateStatus
  sent_at: string | null
  created_at?: string
}

export type InvoiceKind = 'deposit' | 'interim' | 'balance' | 'full'

export const INVOICE_KIND_LABEL: Record<InvoiceKind, string> = {
  deposit: '계약금',
  interim: '중도금',
  balance: '잔금',
  full: '전액',
}

/** 회차별 기본 비율 — 실무에서 가장 흔한 3:4:3 */
export const INVOICE_KIND_RATIO: Record<InvoiceKind, number> = {
  deposit: 0.3,
  interim: 0.4,
  balance: 0.3,
  full: 1,
}

export interface EstimateInvoice {
  id: string
  owner_broker_id?: string
  estimate_id: string | null
  invoice_no: string
  issue_date: string
  kind: InvoiceKind
  ratio: number | null
  company_snapshot: Partial<EstimateCompany> | null
  client_name: string | null
  client_contact: string | null
  client_phone: string | null
  client_email: string | null
  site_address: string | null
  project_name: string | null
  supply_amount: number
  vat: number
  total: number
  vat_mode: VatMode
  due_date: string | null
  paid_at: string | null
  notes: string | null
  created_at?: string
}

/** 견적 합계에서 회차 비율만큼 떼어 청구 금액을 낸다 */
export function invoiceAmounts(
  supplyAmount: number,
  ratio: number,
  vatMode: VatMode
): { supply_amount: number; vat: number; total: number } {
  const supply = Math.round(supplyAmount * ratio)
  const vat = vatMode === 'none' ? 0 : Math.round(supply * 0.1)
  return { supply_amount: supply, vat, total: supply + vat }
}

/** 원본 견적번호에 리비전을 붙인다: 2026-0904-01 → 2026-0904-01-r2 */
export function revisionNo(baseNo: string, revision: number): string {
  return `${baseNo.replace(/-r\d+$/, '')}-r${revision}`
}

export const STATUS_LABEL: Record<EstimateStatus, string> = {
  draft: '작성중',
  sent: '발송함',
  won: '수주',
  lost: '실주',
}

// ── 계산 ────────────────────────────────────────────────────────
// 소계 → 경비 → 할인 → 공급가액 → 부가세 → 합계
// 금액은 전부 원 단위 정수. 줄 금액은 수량×단가를 반올림.

export function lineAmount(qty: number, unitPrice: number): number {
  return Math.round((Number(qty) || 0) * (Number(unitPrice) || 0))
}

export interface EstimateTotals {
  subtotal: number
  overhead_amount: number
  supply_amount: number
  vat: number
  total: number
}

export function calcTotals(
  items: Pick<EstimateItem, 'is_header' | 'amount'>[],
  opts: { overhead_rate?: number; discount?: number; vat_mode?: VatMode }
): EstimateTotals {
  const subtotal = items.reduce((s, it) => (it.is_header ? s : s + (Number(it.amount) || 0)), 0)
  const overhead_amount = Math.round(subtotal * (Number(opts.overhead_rate) || 0))
  const discount = Number(opts.discount) || 0
  const supply_amount = subtotal + overhead_amount - discount
  const vat = opts.vat_mode === 'none' ? 0 : Math.round(supply_amount * 0.1)
  return { subtotal, overhead_amount, supply_amount, vat, total: supply_amount + vat }
}

export interface EstimateMargin {
  /** 원가 합계 */
  cost: number
  /** 이익 = 공급가액 - 원가 (부가세는 남는 돈이 아니라 빼고 본다) */
  profit: number
  /** 이익률. 공급가액이 0이면 null */
  rate: number | null
}

/** 원가를 한 줄이라도 넣었을 때만 의미가 있다 — 전부 0이면 null 을 돌려준다 */
export function calcMargin(
  items: Pick<EstimateItem, 'is_header' | 'qty' | 'cost_price'>[],
  supplyAmount: number
): EstimateMargin | null {
  const cost = items.reduce(
    (s, it) => it.is_header ? s : s + Math.round((Number(it.qty) || 0) * (Number(it.cost_price) || 0)),
    0
  )
  if (cost === 0) return null
  const profit = supplyAmount - cost
  return { cost, profit, rate: supplyAmount > 0 ? profit / supplyAmount : null }
}

export interface SectionSum {
  /** 이 줄 바로 뒤에 소계를 넣는다 */
  afterIndex: number
  /** 어느 공종인지 (머리줄 이름) */
  name: string
  amount: number
}

/**
 * 공종별 소계.
 *
 * 거래처는 총액보다 "방수만 얼마요?" 를 먼저 묻는다. 공종 구분(머리줄)으로
 * 나뉜 구간마다 금액을 더해 그 끝에 찍어 준다.
 *
 * 구분이 하나뿐이면 전체 합계와 똑같아 군더더기이므로 내지 않는다.
 * 머리줄 뒤에 내역이 없는 구간도 건너뛴다.
 */
export function sectionSums(
  items: Pick<EstimateItem, 'is_header' | 'name' | 'amount'>[]
): SectionSum[] {
  if (items.filter(i => i.is_header).length < 2) return []

  const out: SectionSum[] = []
  let name: string | null = null
  let sum = 0
  let last = -1

  const flush = () => {
    if (name !== null && last >= 0) out.push({ afterIndex: last, name, amount: sum })
  }

  items.forEach((it, i) => {
    if (it.is_header) {
      flush()
      name = it.name ?? ''
      sum = 0
      last = -1
      return
    }
    sum += Number(it.amount) || 0
    last = i
  })
  flush()

  // 소계를 다 더해도 전체와 맞지 않으면 아예 내지 않는다.
  //
  // 첫 구분보다 앞에 적힌 줄은 어느 구간에도 들어가지 않는다. 그대로 두면
  // 거래처가 소계를 더해 보고 "왜 총액과 다르냐"고 묻게 된다.
  // 맞지 않는 소계를 보여 주느니 안 보여 주는 편이 낫다.
  const covered = out.reduce((s, x) => s + x.amount, 0)
  const all = items.reduce((s, it) => it.is_header ? s : s + (Number(it.amount) || 0), 0)
  if (covered !== all) return []

  return out
}

export const fmtComma = (n: number | null | undefined): string =>
  (Number(n) || 0).toLocaleString('ko-KR')

/** 유효기간 만료일 = 발행일 + valid_days */
export function validUntil(issueDate: string, days: number): string {
  return addDays(issueDate, days)
}

/**
 * 유효기간이 지났는지. 오늘이 만료일을 넘긴 경우만 true.
 * 이미 수주·실주로 결론난 건은 만료를 따지지 않는다.
 */
export function isExpired(e: Pick<Estimate, 'issue_date' | 'valid_days' | 'status'>, today = new Date()): boolean {
  if (e.status === 'won' || e.status === 'lost') return false
  const until = validUntil(e.issue_date, e.valid_days)
  if (!until) return false
  // '오늘'은 사장님이 계신 한국 기준으로 본다
  return todayKST(today) > until
}

// ── 실적 집계 ───────────────────────────────────────────────────

export interface EstimateStats {
  count: number          // 견적 건수
  amount: number         // 견적 총액
  wonCount: number       // 수주 건수
  wonAmount: number      // 수주 금액
  lostCount: number
  openCount: number      // 아직 결론 안 난 건 (작성중 + 발송함)
  /** 수주율 = 수주 / (수주 + 실주). 결론난 건이 없으면 null */
  winRate: number | null
}

export function calcStats(rows: Pick<Estimate, 'status' | 'total'>[]): EstimateStats {
  const s: EstimateStats = {
    count: rows.length, amount: 0, wonCount: 0, wonAmount: 0,
    lostCount: 0, openCount: 0, winRate: null,
  }
  for (const r of rows) {
    s.amount += r.total || 0
    if (r.status === 'won') { s.wonCount++; s.wonAmount += r.total || 0 }
    else if (r.status === 'lost') s.lostCount++
    else s.openCount++
  }
  const decided = s.wonCount + s.lostCount
  s.winRate = decided > 0 ? s.wonCount / decided : null
  return s
}

// ── 금액 한글 표기 ("일금 오천오백만원정") ──────────────────────
const DIGITS = ['', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구']
const SMALL_UNITS = ['', '십', '백', '천']
const BIG_UNITS = ['', '만', '억', '조', '경']

/** 55000000 → "오천오백만" */
export function numberToKorean(value: number): string {
  const n = Math.floor(Math.abs(Number(value) || 0))
  if (n === 0) return '영'

  const groups: string[] = []
  let rest = n
  let gi = 0

  while (rest > 0 && gi < BIG_UNITS.length) {
    const chunk = rest % 10000
    rest = Math.floor(rest / 10000)

    if (chunk > 0) {
      let s = ''
      for (let i = 3; i >= 0; i--) {
        const d = Math.floor(chunk / Math.pow(10, i)) % 10
        if (d === 0) continue
        // 계약서·수표 관례대로 '일'을 생략하지 않는다 (십만원정 X → 일십만원정 O)
        s += DIGITS[d] + SMALL_UNITS[i]
      }
      groups.unshift(s + BIG_UNITS[gi])
    }
    gi++
  }

  return groups.join('')
}

/**
 * 55000000 → "일금 오천오백만원정"
 *
 * 음수는 반드시 표시한다. numberToKorean 이 절댓값을 다루기 때문에, 할인을
 * 잘못 넣어 합계가 -110,000 이 된 견적서가 숫자로는 -110,000, 한글로는
 * '일금 일십일만원정' 으로 나갔다. 계약 문서에서 금액이 둘로 갈리면 안 된다.
 */
export const koreanAmount = (value: number): string => {
  const n = Math.round(Number(value) || 0)
  return n < 0
    ? `일금 마이너스 ${numberToKorean(n)}원정`
    : `일금 ${numberToKorean(n)}원정`
}

// ── 공사 프리셋 ────────────────────────────────────────────────
// 처음 들어올 때 자동으로 깔리는 기본값. 실제 단가는 사용자가 고쳐 쓴다.

type PresetRow = [category: string, name: string, spec: string, unit: string, qty: number, price: number]

const toItems = (rows: PresetRow[]): EstimateItem[] => {
  const out: EstimateItem[] = []
  let lastCat = ''
  let order = 0
  for (const [category, name, spec, unit, qty, price] of rows) {
    if (category !== lastCat) {
      out.push({
        sort_order: order++, is_header: true, category, name: category,
        spec: null, unit: null, qty: 0, unit_price: 0,
        material_price: 0, labor_price: 0, cost_price: 0, amount: 0, remark: null,
      })
      lastCat = category
    }
    out.push({
      sort_order: order++, is_header: false, category, name, spec: spec || null,
      unit, qty, unit_price: price,
      material_price: 0, labor_price: 0, cost_price: 0, amount: lineAmount(qty, price), remark: null,
    })
  }
  return out
}

export interface PresetDef { name: string; items: EstimateItem[] }

export const DEFAULT_PRESETS: PresetDef[] = [
  {
    name: '원룸 올수리',
    items: toItems([
      ['가설·철거공사', '기존 마감재 철거', '벽·바닥 전체', '식', 1, 800000],
      ['가설·철거공사', '폐기물 처리·운반', '1톤 기준', '대', 2, 250000],
      ['가설·철거공사', '양생·보양', '현관·복도', '식', 1, 150000],
      ['설비공사', '급수·배수 배관 교체', 'PB관', '식', 1, 900000],
      ['설비공사', '양변기 교체', '도기 일체형', 'EA', 1, 350000],
      ['설비공사', '세면대·수전 교체', '', 'EA', 1, 280000],
      ['전기공사', '전선 교체·배선 정리', '', '식', 1, 700000],
      ['전기공사', '분전반 교체', '', 'EA', 1, 250000],
      ['전기공사', '스위치·콘센트 교체', '', 'EA', 12, 18000],
      ['조명공사', 'LED 조명 설치', '거실·주방·욕실', 'EA', 6, 55000],
      ['목공사', '천장 몰딩·걸레받이', '', 'M', 40, 12000],
      ['목공사', '문틀 보수·문짝 교체', 'ABS 도어', 'EA', 3, 320000],
      ['타일공사', '욕실 벽·바닥 타일', '300×600', '㎡', 18, 65000],
      ['타일공사', '주방 벽 타일', '', '㎡', 6, 60000],
      ['도배공사', '실크벽지 시공', '', '㎡', 60, 14000],
      ['바닥공사', '강마루 시공', '', '㎡', 26, 55000],
      ['가구공사', '싱크대 교체', '2.4M', '식', 1, 1600000],
      ['가구공사', '신발장·붙박이장', '', '식', 1, 700000],
      ['도장공사', '현관·발코니 도장', '', '㎡', 20, 15000],
      ['마감·정리', '준공 청소', '', '식', 1, 250000],
      ['마감·정리', '실리콘 마감', '', '식', 1, 150000],
    ]),
  },
  {
    name: '상가 인테리어',
    items: toItems([
      ['가설·철거공사', '가설 울타리·보양', '', '식', 1, 600000],
      ['가설·철거공사', '기존 내부 철거', '', '㎡', 66, 25000],
      ['가설·철거공사', '폐기물 처리·운반', '5톤 기준', '대', 2, 700000],
      ['설비공사', '급배수 배관', '', '식', 1, 1500000],
      ['설비공사', '냉난방기 설치', '스탠드 30평형', 'EA', 2, 2800000],
      ['설비공사', '환기·덕트 공사', '', '식', 1, 1800000],
      ['전기공사', '증설·간선 공사', '', '식', 1, 2200000],
      ['전기공사', '배선·배관', '', '㎡', 66, 35000],
      ['조명공사', '레일·매입 조명', '', 'EA', 30, 65000],
      ['목공사', '천장 목공 (석고 2P)', '', '㎡', 66, 55000],
      ['목공사', '벽체 조성·파티션', '', '㎡', 30, 68000],
      ['금속·유리공사', '전면 강화유리 도어', '', '식', 1, 2500000],
      ['금속·유리공사', '어닝·간판 하지', '', '식', 1, 1200000],
      ['바닥공사', '데코타일 시공', '3.0T', '㎡', 66, 32000],
      ['도장공사', '내부 벽·천장 도장', '수성', '㎡', 130, 16000],
      ['도장공사', '외부 파사드 도장', '', '㎡', 30, 25000],
      ['가구공사', '카운터·집기 제작', '', '식', 1, 2500000],
      ['사인공사', '간판 제작·설치', 'LED 채널', '식', 1, 3000000],
      ['마감·정리', '준공 청소', '', '식', 1, 500000],
    ]),
  },
  {
    name: '사무실 부분수리',
    items: toItems([
      ['가설·철거공사', '부분 철거·정리', '', '식', 1, 400000],
      ['가설·철거공사', '폐기물 처리', '1톤 기준', '대', 1, 250000],
      ['전기공사', '콘센트·통신 배선 증설', '', 'EA', 10, 45000],
      ['조명공사', 'LED 평판 교체', '640×640', 'EA', 12, 75000],
      ['목공사', '파티션 설치', '', '㎡', 12, 65000],
      ['도배공사', '벽지 시공', '', '㎡', 90, 13000],
      ['바닥공사', '데코타일 시공', '', '㎡', 50, 32000],
      ['도장공사', '천장·몰딩 도장', '', '㎡', 50, 15000],
      ['마감·정리', '준공 청소', '', '식', 1, 200000],
    ]),
  },
]

// ── 기본 메일 문구 ─────────────────────────────────────────────
// {거래처명} {담당자} {공사명} {회사명} {발신자} {견적번호} {합계} 치환

export const DEFAULT_SUBJECT = '[{회사명}] {공사명} 견적서 송부 ({견적번호})'

export const DEFAULT_BODY = `{거래처명} {담당자}님 안녕하세요.
{회사명} {발신자}입니다.

문의주신 {공사명} 건 견적서를 첨부하여 보내드립니다.
견적 합계는 {합계}원이며, 유효기간은 발행일로부터 30일입니다.

검토 후 문의사항 있으시면 편하게 연락 주십시오.
감사합니다.`

export function fillTemplate(tpl: string, vars: Record<string, string>): string {
  // 변수명이 한글이라 \w 로는 못 잡는다 (\w = [A-Za-z0-9_])
  return tpl.replace(/\{([^{}\s]+)\}/g, (m, k) => vars[k] ?? m)
}
