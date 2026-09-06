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

/**
 * 머리글에 흔히 쓰이는 말들. **앞에 적힌 것이 우선**이다.
 *
 * 건설 견적서는 재료비·노무비·경비·합계마다 단가와 금액이 따로 있는 일이 잦다.
 * 그럴 때 재료비 단가를 집으면 노무비가 통째로 빠지므로 '합계' 쪽을 먼저 본다.
 * (두 줄 머리글은 '재료비 단가' 처럼 위아래를 붙여 하나로 만들어 둔다)
 */
const HEADER_HINTS: Record<Field, string[]> = {
  category: ['공종', '공정', '구분', '분류', '항목구분'],
  name: ['품명', '품목', '항목', '내역', '공사명', '명칭', '작업명'],
  spec: ['규격', '사양', '스펙', '크기'],
  unit: ['단위'],
  qty: ['수량', '물량', '개수'],
  unit_price: ['합계단가', '계단가', '단가', '단가(원)', '일위단가'],
  cost_price: ['원가', '매입가', '매입단가', '원가단가', '재료비단가'],
  amount: ['합계금액', '계금액', '금액', '공급가'],
  remark: ['비고', '메모', '참고', '특이사항'],
}

/**
 * 내역이 아니라 셈줄인 것들 — 가져오면 금액이 겹쳐 셈이 어긋난다.
 *
 * '소계' 뿐 아니라 '방수소계'·'철거공사 소계' 처럼 앞에 공사 이름을 붙여 쓰는 일이
 * 훨씬 많다. 그래서 '~로 끝나는' 것도 잡되, '계단 설치' 같은 품명을 오해하지 않게
 * 끝말만 본다('계단'은 '계' 로 끝나지 않는다).
 */
const TOTAL_PARTS = [
  '소계', '합계', '총계', '총합', '누계',
  '부가세', '부가가치세', '공급가액', '공급가',
  '일반관리비', '이윤',
]
/**
 * 이건 그 칸 전체가 이 말일 때만 셈줄로 본다.
 *
 * '경비' 는 넣지 않는다 — 견적서에서 경비는 셈줄이 아니라 '일반경비'·'공구손료'
 * 같은 실제 내역인 일이 많다. 셈줄로 오해하면 그 금액이 통째로 빠진다.
 */
const TOTAL_EXACT = ['계', 'vat', '할인', '에누리']

/** 이 말로 시작하면 그 아래는 표가 끝난 것으로 본다 (특기사항·안내문이 이어진다) */
const END_PARTS = ['합계', '총계', '총합']

export interface Sheet {
  name: string
  rows: string[][]
  /** 너무 길어 잘라 낸 줄 수 (0 이면 다 읽었다) */
  truncated: number
}

/**
 * CSV 를 글자로 푼다.
 *
 * SheetJS 는 BOM 없는 CSV 를 서양 코드페이지로 읽어서 한글이 통째로 깨진다
 * ('공종' → 'ê³µì¢'). 게다가 한국 엑셀이 "CSV 로 저장"하면 CP949 로 나가는데
 * 그건 아예 읽지 못한다. 그래서 CSV 만은 우리가 직접 풀어서 넘긴다.
 *
 *  1) BOM 이 있으면 UTF-8
 *  2) 없으면 UTF-8 로 엄격히 풀어 보고, 어긋나면 CP949(euc-kr) 로 본다
 */
export function decodeCsv(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  if (bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
    return new TextDecoder('utf-8').decode(bytes.subarray(3))
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    // UTF-8 로 성립하지 않는 바이트가 있다 — 한국 엑셀이 저장한 CP949 로 본다
    return new TextDecoder('euc-kr').decode(bytes)
  }
}

export interface Mapping {
  /** 머리글이 있는 줄 (0부터). -1 이면 머리글 없이 첫 줄부터 값 */
  headerRow: number
  /** 머리글이 몇 줄인지. 2 면 아랫줄까지 머리글이고 내역은 그다음부터 */
  headerSpan: 1 | 2
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

/**
 * 셈줄(소계·합계·부가세…)인지.
 *
 * '방수소계'·'철거공사 소계' 처럼 앞에 공사 이름을 붙이거나, '합계(VAT별도)'
 * 처럼 뒤에 토를 다는 일이 흔하다. 그래서 앞뒤 어느 쪽에 붙어도 잡는다.
 * 대신 '계단 설치' 같은 품명을 오해하지 않게 '계' 는 그 칸 전체일 때만 본다.
 */
export function isTotalRow(cells: string[]): boolean {
  const head = cells.slice(0, 3).map(norm).filter(Boolean)
  if (head.length === 0) return false
  return head.some(c =>
    TOTAL_EXACT.some(w => c === w || c === w + '금액') ||
    TOTAL_PARTS.some(w => c.startsWith(w) || c.endsWith(w))
  )
}

/**
 * 표가 여기서 끝나는지 (합계 줄).
 *
 * 견적서는 합계 아래에 특기사항·안내문이 이어지는 일이 많다. 그것까지 내역으로
 * 읽으면 '[특기사항]'·'1. 유효기간 …' 이 품명으로 딸려 들어온다.
 * 공종마다 나오는 '소계' 는 여기 넣지 않는다 — 아래에 내역이 더 있다.
 */
export function isEndRow(cells: string[]): boolean {
  const head = cells.slice(0, 3).map(norm).filter(Boolean)
  return head.some(c => END_PARTS.some(w => c.startsWith(w)))
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

/**
 * 머리글이 두 줄인지 본다.
 *
 * 건설 견적서는 위에 '재료비·노무비·경비·합계'를 병합해 놓고 그 아래에
 * '단가·금액'을 두는 일이 흔하다. 아랫줄에 단가·금액 같은 말이 둘 넘게 있으면
 * 두 줄짜리 머리글로 본다.
 */
export function detectHeaderSpan(rows: string[][], headerRow: number): 1 | 2 {
  const next = rows[headerRow + 1]
  if (headerRow < 0 || !next) return 1

  // 아랫줄이 '머리글스러운가' 로 가른다 — 아는 낱말이 있고 숫자는 하나도 없을 때.
  //   위: 재료비 | 노무비 | 합계     아래: 단가 | 금액 | 단가 | 금액
  //   위: 내  역(두 칸 병합)         아래: 구 분 | 항 목
  // 내역 줄이라면 수량·단가 자리에 숫자가 들어 있으므로 이걸로 갈린다.
  let words = 0
  for (const cell of next) {
    const c = norm(cell)
    if (!c) continue
    if (/[0-9]/.test(c)) return 1        // 숫자가 있으면 내역 줄이다
    if (Object.values(HEADER_HINTS).some(list => list.some(h => c === norm(h)))) words++
  }
  return words >= 2 ? 2 : 1
}

/**
 * 머리글 줄(들)을 한 줄짜리 이름으로 만든다.
 *
 * 병합된 칸은 첫 칸에만 값이 오고 뒤는 비어 있으므로 왼쪽 값을 이어 쓴다.
 * '재료비 + 단가' → '재료비단가', '합계 + 금액' → '합계금액'.
 * 그래야 어느 단가가 재료비고 어느 것이 합계인지 가릴 수 있다.
 */
export function buildHeaderLabels(rows: string[][], headerRow: number, span: 1 | 2): string[] {
  if (headerRow < 0 || !rows[headerRow]) return []
  const top = rows[headerRow]
  const sub = span === 2 ? (rows[headerRow + 1] ?? []) : []
  const width = Math.max(top.length, sub.length)

  const labels: string[] = []
  let carried = ''
  for (let c = 0; c < width; c++) {
    const t = norm(top[c])
    const b = norm(sub[c])
    // 위 칸이 비었으면 병합의 이어짐으로 보고 왼쪽 값을 물려받는다
    if (t) carried = t
    labels.push(span === 2 && b ? `${carried}${b}` : (t || b || ''))
  }
  return labels
}

/** 머리글 낱말을 보고 자리를 맞혀 본다 */
export function guessMapping(rows: string[][], headerRow: number, span: 1 | 2 = 1): Record<Field, number> {
  const cols = Object.fromEntries(
    (Object.keys(FIELD_LABEL) as Field[]).map(f => [f, -1])
  ) as Record<Field, number>

  if (headerRow < 0 || !rows[headerRow]) return cols

  const header = buildHeaderLabels(rows, headerRow, span)
  const taken = new Set<number>()

  // 힌트에 적힌 순서가 우선순위다 ('합계단가' 를 '재료비단가' 보다 먼저 집는다).
  // 정확히 같은 것을 한 바퀴 다 돌고 나서 '들어 있는' 것을 본다.
  for (const pass of ['exact', 'loose'] as const) {
    for (const f of Object.keys(HEADER_HINTS) as Field[]) {
      if (cols[f] >= 0) continue
      outer:
      for (const h of HEADER_HINTS[f]) {
        const n = norm(h)
        for (let c = 0; c < header.length; c++) {
          if (taken.has(c) || !header[c]) continue
          const hit = pass === 'exact' ? header[c] === n : header[c].includes(n)
          if (hit) { cols[f] = c; taken.add(c); break outer }
        }
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
 * - 수량·단가가 모두 비어 있고 품명만 있으면 공종 머리줄로 본다
 * - 소계·합계·부가세 줄은 건너뛴다 (가져오면 금액이 두 번 더해진다)
 * - 아무것도 없는 줄은 버린다
 */
export function parseRows(rows: string[][], m: Mapping): ParseResult {
  const start = m.headerRow < 0 ? 0 : m.headerRow + (m.headerSpan ?? 1)
  const get = (row: string[], f: Field) => m.cols[f] >= 0 ? (row[m.cols[f]] ?? '') : ''
  const text = (v: string) => { const s = String(v ?? '').trim(); return s || null }

  const items: ParsedRow[] = []
  let skippedTotals = 0
  let mismatched = 0

  for (let r = start; r < rows.length; r++) {
    const row = rows[r]
    if (!row || row.every(c => !String(c ?? '').trim())) continue

    // 합계를 만나면 표가 끝난 것으로 보고 그만 읽는다 (아래는 특기사항·안내문)
    if (isEndRow(row)) { skippedTotals++; break }
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
