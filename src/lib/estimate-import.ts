/**
 * 예전에 엑셀로 만들어 둔 견적서를 내역으로 읽어 들인다.
 *
 * 양식이 집집마다 다르므로 자동으로 맞히되, 틀리면 화면에서 고칠 수 있게
 * '어느 열이 무엇인지'를 밖으로 내보낸다. 여기서는 읽고 고르는 일만 하고
 * 화면은 import-dialog.tsx 가 그린다.
 *
 * 금액은 엑셀 값을 그대로 믿지 않고 수량×단가로 다시 셈한다. 엑셀에는 손으로
 * 덮어쓴 금액이나 깨진 수식이 남아 있는 일이 잦아서, 다르면 화면에 알린다.
 */

import type { EstimateItem } from './estimate'

/** 내역 한 줄에 채울 수 있는 자리 */
export type Field = 'category' | 'name' | 'spec' | 'unit' | 'qty' | 'unit_price' | 'cost_price' | 'amount' | 'remark'

export const FIELD_LABEL: Record<Field, string> = {
  category: '공종',
  name: '품명',
  spec: '규격',
  unit: '단위',
  qty: '수량',
  unit_price: '단가',
  cost_price: '원가(내부용)',
  amount: '금액',
  remark: '비고',
}

/** 엑셀 머리글에 흔히 쓰이는 말들 — 붙여 쓰거나 띄어 쓴 것 모두 잡는다 */
const HEADER_HINTS: Record<Field, string[]> = {
  category: ['공종', '공정', '구분', '분류', '항목구분'],
  name: ['품명', '품목', '내역', '공사명', '명칭', '작업명'],
  spec: ['규격', '사양', '스펙', '크기'],
  unit: ['단위'],
  qty: ['수량', '물량', '개수'],
  unit_price: ['단가', '단가(원)', '재료비단가', '일위단가'],
  cost_price: ['원가', '매입가', '매입단가', '원가단가'],
  amount: ['금액', '합계금액', '공급가', '계'],
  remark: ['비고', '메모', '참고', '특이사항'],
}

/** 내역이 아니라 표 아래쪽 셈줄인 것들 — 가져오면 금액이 겹쳐 셈이 어긋난다 */
const TOTAL_WORDS = [
  '소계', '합계', '총계', '총합', '누계', '계',
  '부가세', '부가가치세', 'vat', '공급가액', '공급가',
  '경비', '일반관리비', '이윤', '할인', '에누리',
]

export interface Sheet {
  name: string
  rows: string[][]
}

export interface Mapping {
  /** 머리글이 있는 줄 (0부터). -1 이면 머리글 없이 첫 줄부터 값 */
  headerRow: number
  /** 자리 → 열 번호. 없으면 -1 */
  cols: Record<Field, number>
}

/** "13,000", " 13000원 ", "1.5" → 숫자. 못 읽으면 0 */
export function toNum(v: unknown): number {
  if (typeof v === 'number') return isFinite(v) ? v : 0
  const s = String(v ?? '').replace(/[^0-9.-]/g, '')
  if (!s || s === '-' || s === '.') return 0
  const n = Number(s)
  return isFinite(n) ? n : 0
}

const norm = (s: unknown) => String(s ?? '').replace(/\s+/g, '').toLowerCase()

/** 셈줄(소계·합계·부가세…)인지 */
export function isTotalRow(cells: string[]): boolean {
  const joined = cells.map(norm).filter(Boolean)
  if (joined.length === 0) return false
  // 앞쪽 두어 칸에 셈 낱말만 덩그러니 있는 줄을 잡는다
  return joined.slice(0, 3).some(c => TOTAL_WORDS.some(w => c === w || c === w + '금액'))
}

/**
 * 머리글 줄을 찾는다.
 * 아는 낱말이 두 개 넘게 있는 첫 줄을 머리글로 본다 — 위쪽의 제목·회사정보를 건너뛴다.
 */
export function findHeaderRow(rows: string[][]): number {
  const limit = Math.min(rows.length, 30)
  for (let r = 0; r < limit; r++) {
    let hit = 0
    for (const cell of rows[r]) {
      const c = norm(cell)
      if (!c) continue
      if (Object.values(HEADER_HINTS).some(list => list.some(h => c === norm(h)))) hit++
    }
    if (hit >= 2) return r
  }
  return -1
}

/** 머리글 낱말을 보고 자리를 맞혀 본다 */
export function guessMapping(rows: string[][], headerRow: number): Record<Field, number> {
  const cols = Object.fromEntries(
    (Object.keys(FIELD_LABEL) as Field[]).map(f => [f, -1])
  ) as Record<Field, number>

  if (headerRow < 0 || !rows[headerRow]) return cols

  const header = rows[headerRow].map(norm)
  const taken = new Set<number>()

  // 정확히 같은 낱말을 먼저 가져가고, 그다음 '들어 있는' 것을 본다
  for (const pass of ['exact', 'loose'] as const) {
    for (const f of Object.keys(HEADER_HINTS) as Field[]) {
      if (cols[f] >= 0) continue
      for (let c = 0; c < header.length; c++) {
        if (taken.has(c) || !header[c]) continue
        const hit = HEADER_HINTS[f].some(h => {
          const n = norm(h)
          return pass === 'exact' ? header[c] === n : header[c].includes(n)
        })
        if (hit) { cols[f] = c; taken.add(c); break }
      }
    }
  }
  return cols
}

export interface ParsedRow extends Omit<EstimateItem, 'sort_order'> {
  /** 엑셀에 적힌 금액. 수량×단가와 다르면 화면에서 알린다 */
  excelAmount: number | null
}

export interface ParseResult {
  items: ParsedRow[]
  /** 셈줄이라 건너뛴 줄 수 */
  skippedTotals: number
  /** 엑셀 금액과 수량×단가가 다른 줄 */
  mismatched: number
}

/**
 * 고른 자리대로 줄을 만든다.
 *
 * - 수량·단가가 모두 비어 있고 품명만 있으면 공정 머리줄로 본다
 * - 소계·합계·부가세 줄은 건너뛴다 (가져오면 금액이 두 번 더해진다)
 * - 아무것도 없는 줄은 버린다
 */
export function parseRows(rows: string[][], m: Mapping): ParseResult {
  const start = m.headerRow < 0 ? 0 : m.headerRow + 1
  const get = (row: string[], f: Field) => m.cols[f] >= 0 ? (row[m.cols[f]] ?? '') : ''
  const text = (v: string) => { const s = String(v ?? '').trim(); return s || null }

  const items: ParsedRow[] = []
  let skippedTotals = 0
  let mismatched = 0

  for (let r = start; r < rows.length; r++) {
    const row = rows[r]
    if (!row || row.every(c => !String(c ?? '').trim())) continue

    if (isTotalRow(row)) { skippedTotals++; continue }

    const name = text(get(row, 'name'))
    const category = text(get(row, 'category'))
    const qty = toNum(get(row, 'qty'))
    const unitPrice = toNum(get(row, 'unit_price'))
    const excelAmount = m.cols.amount >= 0 ? toNum(get(row, 'amount')) : null

    // 품명도 공종도 없으면 내역 줄이 아니다
    if (!name && !category) continue

    const isHeader = qty === 0 && unitPrice === 0 && (excelAmount ?? 0) === 0
    const amount = Math.round(qty * unitPrice)
    if (!isHeader && excelAmount !== null && excelAmount !== 0 && excelAmount !== amount) mismatched++

    items.push({
      is_header: isHeader,
      category: isHeader ? null : category,
      name: name ?? category,
      spec: isHeader ? null : text(get(row, 'spec')),
      unit: isHeader ? null : text(get(row, 'unit')),
      qty: isHeader ? 0 : qty,
      unit_price: isHeader ? 0 : unitPrice,
      cost_price: isHeader ? 0 : toNum(get(row, 'cost_price')),
      amount: isHeader ? 0 : amount,
      remark: isHeader ? null : text(get(row, 'remark')),
      excelAmount,
    })
  }

  return { items, skippedTotals, mismatched }
}
