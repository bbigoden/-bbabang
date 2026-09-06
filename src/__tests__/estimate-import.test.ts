/**
 * 엑셀 가져오기 — 읽고 고르는 부분.
 *
 * 금액이 조용히 틀리면 그대로 거래처에 나가므로, 양식이 제각각인 상황을
 * 여기서 붙잡아 둔다.
 */
import { describe, it, expect } from 'vitest'
import {
  toNum, isTotalRow, findHeaderRow, guessMapping, parseRows, type Mapping,
} from '@/lib/estimate-import'

describe('toNum — 엑셀에 적히는 온갖 꼴', () => {
  it('쉼표와 단위를 걷어낸다', () => {
    expect(toNum('13,000')).toBe(13000)
    expect(toNum(' 13000원 ')).toBe(13000)
    expect(toNum('₩1,842,500')).toBe(1842500)
  })
  it('소수와 음수', () => {
    expect(toNum('33.5')).toBe(33.5)
    expect(toNum('-5000')).toBe(-5000)
  })
  it('숫자가 아니면 0', () => {
    expect(toNum('')).toBe(0)
    expect(toNum(null)).toBe(0)
    expect(toNum('일금')).toBe(0)
    expect(toNum('-')).toBe(0)
    expect(toNum(NaN)).toBe(0)
  })
})

describe('머리글 줄 찾기', () => {
  it('위쪽 제목·회사정보를 건너뛴다', () => {
    const rows = [
      ['견 적 서', '', '', '', ''],
      ['가나다건설', '', '', '', ''],
      ['2026-09-05', '', '', '', ''],
      ['공종', '품명', '규격', '단위', '수량', '단가', '금액'],
      ['철거', '기존 마감 철거', '바닥+벽', '㎡', '33.5', '12000', '402000'],
    ]
    expect(findHeaderRow(rows)).toBe(3)
  })
  it('머리글이 없으면 -1', () => {
    expect(findHeaderRow([['가', '나'], ['다', '라']])).toBe(-1)
  })
})

describe('열 맞히기', () => {
  it('띄어쓰기가 섞여 있어도 맞힌다', () => {
    const rows = [['공 종', '품 명', '규격', '단위', '수 량', '단가', '금액', '비고']]
    const c = guessMapping(rows, 0)
    expect(c.category).toBe(0)
    expect(c.name).toBe(1)
    expect(c.spec).toBe(2)
    expect(c.unit).toBe(3)
    expect(c.qty).toBe(4)
    expect(c.unit_price).toBe(5)
    expect(c.amount).toBe(6)
    expect(c.remark).toBe(7)
  })
  it('다른 말로 적어도 맞힌다', () => {
    const rows = [['구분', '내역', '사양', '단위', '물량', '단가', '합계금액']]
    const c = guessMapping(rows, 0)
    expect(c.category).toBe(0)
    expect(c.name).toBe(1)
    expect(c.spec).toBe(2)
    expect(c.qty).toBe(4)
  })
  it('한 열을 두 자리가 나눠 갖지 않는다', () => {
    const rows = [['품명', '단가']]
    const c = guessMapping(rows, 0)
    const used = [c.name, c.unit_price].filter(v => v >= 0)
    expect(new Set(used).size).toBe(used.length)
  })
  it('없는 자리는 -1', () => {
    const c = guessMapping([['품명', '수량']], 0)
    expect(c.spec).toBe(-1)
    expect(c.remark).toBe(-1)
  })
})

describe('셈줄 가려내기', () => {
  it('소계·합계·부가세는 셈줄', () => {
    expect(isTotalRow(['소계', '', '', '', '', '', '5000000'])).toBe(true)
    expect(isTotalRow(['', '합 계', '', '', '', '', '6050000'])).toBe(true)
    expect(isTotalRow(['부가세', '', '', '', '', '', '550000'])).toBe(true)
  })
  it('보통 내역은 셈줄이 아니다', () => {
    expect(isTotalRow(['철거', '기존 마감 철거', '바닥+벽', '㎡', '33.5', '12000', '402000'])).toBe(false)
  })
  it("'계단 설치' 같은 품명을 셈줄로 오해하지 않는다", () => {
    expect(isTotalRow(['목공', '계단 설치', '', '식', '1', '500000', '500000'])).toBe(false)
  })
})

const MAP = (headerRow: number): Mapping => ({
  headerRow,
  cols: { category: 0, name: 1, spec: 2, unit: 3, qty: 4, unit_price: 5, amount: 6, remark: 7, cost_price: -1 },
})

describe('줄 만들기', () => {
  const rows = [
    ['공종', '품명', '규격', '단위', '수량', '단가', '금액', '비고'],
    ['', '1. 철거공사', '', '', '', '', '', ''],
    ['철거', '기존 마감 철거', '바닥+벽', '㎡', '33.5', '12,000', '402,000', '폐기물 별도'],
    ['철거', '폐기물 처리', '1톤', '대', '2', '149,000', '298,000', ''],
    ['', '', '', '', '', '', '', ''],
    ['소계', '', '', '', '', '', '700,000', ''],
  ]

  it('머리줄·내역·셈줄을 갈라 낸다', () => {
    const r = parseRows(rows, MAP(0))
    expect(r.items).toHaveLength(3)
    expect(r.items[0].is_header).toBe(true)
    expect(r.items[0].name).toBe('1. 철거공사')
    expect(r.items[1].is_header).toBe(false)
    expect(r.skippedTotals).toBe(1)
  })

  it('금액은 수량×단가로 다시 셈한다', () => {
    const r = parseRows(rows, MAP(0))
    expect(r.items[1].qty).toBe(33.5)
    expect(r.items[1].unit_price).toBe(12000)
    expect(r.items[1].amount).toBe(402000)
    expect(r.mismatched).toBe(0)
  })

  it('엑셀 금액이 수량×단가와 다르면 센다', () => {
    // 손으로 덮어쓴 금액이 남아 있는 경우
    const bad = [rows[0], ['철거', '철거', '', '식', '1', '100,000', '999,999', '']]
    const r = parseRows(bad, MAP(0))
    expect(r.items[0].amount).toBe(100000)      // 우리는 다시 셈한 값을 쓴다
    expect(r.items[0].excelAmount).toBe(999999)
    expect(r.mismatched).toBe(1)
  })

  it('빈 줄과 품명 없는 줄은 버린다', () => {
    const r = parseRows(rows, MAP(0))
    expect(r.items.every(i => i.name)).toBe(true)
  })

  it('머리줄에는 수량·단가를 남기지 않는다', () => {
    const r = parseRows(rows, MAP(0))
    const h = r.items[0]
    expect(h.qty).toBe(0)
    expect(h.unit_price).toBe(0)
    expect(h.amount).toBe(0)
    expect(h.spec).toBeNull()
  })

  it('머리글이 없는 표도 첫 줄부터 읽는다', () => {
    const noHeader = [['철거', '기존 마감 철거', '바닥+벽', '㎡', '33.5', '12000', '402000', '']]
    const r = parseRows(noHeader, { ...MAP(-1) })
    expect(r.items).toHaveLength(1)
    expect(r.items[0].name).toBe('기존 마감 철거')
  })

  it('고르지 않은 열은 비워 둔다', () => {
    const m: Mapping = { headerRow: 0, cols: { ...MAP(0).cols, spec: -1, remark: -1 } }
    const r = parseRows(rows, m)
    expect(r.items[1].spec).toBeNull()
    expect(r.items[1].remark).toBeNull()
  })
})

describe('진짜 엑셀 파일로 한 바퀴', () => {
  it('제목·회사정보가 위에 있고 아래에 소계가 붙은 흔한 양식', async () => {
    const XLSX = await import('xlsx')
    const aoa = [
      ['견 적 서', '', '', '', '', '', ''],
      ['가나다건설  041-000-0000', '', '', '', '', '', ''],
      ['', '', '', '', '', '', ''],
      ['공 종', '품 명', '규격', '단위', '수 량', '단가', '금액', '비고'],
      ['', '1. 철거공사', '', '', '', '', '', ''],
      ['철거', '기존 마감 철거', '바닥+벽', '㎡', 33.5, 12000, 402000, '폐기물 별도'],
      ['철거', '폐기물 처리', '1톤', '대', 2, 149000, 298000, ''],
      ['', '2. 내장공사', '', '', '', '', '', ''],
      ['내장', '실크벽지 시공', '광폭 합지', '평', 33.5, 13000, 435500, ''],
      ['내장', '강마루 시공', '8mm', '평', 33.5, 55000, 1842500, ''],
      ['전기', 'LED 등기구 교체', '50W 평판', '개', 12, 85000, 1020000, ''],
      ['', '', '', '', '', '', '', ''],
      ['소 계', '', '', '', '', '', 3998000, ''],
      ['부가세', '', '', '', '', '', 399800, ''],
      ['합 계', '', '', '', '', '', 4397800, ''],
    ]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), '견적내역')
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })

    // 화면이 하는 것과 같은 방식으로 되읽는다
    const back = XLSX.read(buf, { type: 'array' })
    const ws = back.Sheets[back.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json<string[]>(ws, {
      header: 1, raw: false, defval: '', blankrows: false,
    }) as string[][]

    const headerRow = findHeaderRow(rows)
    expect(headerRow).toBe(3)                       // 제목·회사정보를 건너뛴다

    const cols = guessMapping(rows, headerRow)
    expect(cols.category).toBe(0)                   // '공 종' 처럼 띄어 써도 맞힌다
    expect(cols.qty).toBe(4)                        // '수 량'
    expect(cols.remark).toBe(7)

    const r = parseRows(rows, { headerRow, cols })
    expect(r.items.filter(i => !i.is_header)).toHaveLength(5)
    expect(r.items.filter(i => i.is_header)).toHaveLength(2)   // 공정 구분 두 줄
    expect(r.skippedTotals).toBe(3)                            // 소계·부가세·합계
    expect(r.mismatched).toBe(0)
    expect(r.items.reduce((s, i) => s + i.amount, 0)).toBe(3998000)
    expect(r.items[1].remark).toBe('폐기물 별도')
  })
})

describe('CSV 글자 풀기 — 한글이 깨지지 않는가', () => {
  const CSV = '공종,품명,규격,단위,수량,단가,금액\n철거,기존 마감 철거,바닥+벽,㎡,33.5,12000,402000\n'

  /** 문자열을 CP949 바이트로 (한국 엑셀이 "CSV 로 저장"할 때 나오는 꼴) */
  const toCp949 = (s: string) => {
    // 테스트에서만 쓰는 되돌리기 — euc-kr 로 풀었을 때 원문이 나오는 바이트를 찾는다
    const buf: number[] = []
    for (const ch of s) {
      if (ch.charCodeAt(0) < 128) { buf.push(ch.charCodeAt(0)); continue }
      // 완성형 한글은 2바이트. 실제 표를 다 넣을 수 없으므로 아는 글자만 쓴다
      const known: Record<string, number[]> = {
        '공': [0xB0, 0xF8], '종': [0xC1, 0xBE], '품': [0xC7, 0xB0], '명': [0xB8, 0xED],
      }
      if (known[ch]) buf.push(...known[ch])
      else throw new Error(`표에 없는 글자: ${ch}`)
    }
    return new Uint8Array(buf).buffer
  }

  it('BOM 있는 UTF-8 은 그대로', async () => {
    const { decodeCsv } = await import('@/lib/estimate-import')
    const bytes = new Uint8Array([0xEF, 0xBB, 0xBF, ...new TextEncoder().encode(CSV)])
    expect(decodeCsv(bytes.buffer)).toBe(CSV)
  })

  it('BOM 없는 UTF-8 도 그대로 (예전에는 여기서 깨졌다)', async () => {
    const { decodeCsv } = await import('@/lib/estimate-import')
    expect(decodeCsv(new TextEncoder().encode(CSV).buffer as ArrayBuffer)).toBe(CSV)
  })

  it('한국 엑셀이 저장하는 CP949 도 읽는다', async () => {
    const { decodeCsv } = await import('@/lib/estimate-import')
    expect(decodeCsv(toCp949('공종,품명\n'))).toBe('공종,품명\n')
  })

  it('CP949 CSV 를 통째로 읽어 내역까지 만든다', async () => {
    const XLSX = await import('xlsx')
    const { decodeCsv } = await import('@/lib/estimate-import')
    const text = decodeCsv(toCp949('공종,품명\n공종,품명\n'))
    const wb = XLSX.read(text, { type: 'string' })
    const rows = XLSX.utils.sheet_to_json<string[]>(wb.Sheets[wb.SheetNames[0]], {
      header: 1, raw: false, defval: '',
    }) as string[][]
    expect(rows[0]).toEqual(['공종', '품명'])   // 깨지지 않았다
  })
})
