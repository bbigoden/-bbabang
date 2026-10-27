/**
 * 매물목록 칸에 넣은 값이 말이 되는지 — 저장하기 전에 본다.
 *
 * 점검에서 가격 -500, 1e9(10조), 총층 0.5, 면적 -10, 사용승인일 "내일", 500자 소재지가 오류 한 줄
 * 없이 그대로 저장됐다. 뱅크·카페 광고가 이 값을 그대로 가져가므로 들어올 때 막는다.
 * 돌려주는 글은 그대로 토스트에 띄운다. null 이면 괜찮다.
 */

/** 만원 단위 돈 — 1조(1억만원)까지 */
const MONEY_MAX = 100_000_000
const TEXT_LIMITS: Record<string, [number, string]> = {
  address: [200, '소재지'],
  memo: [2000, '중개사 메모'],
  brief_memo: [1000, '매물설명'],
  description: [2000, '설명'],
  parking: [30, '주차'],
  rooms_bathrooms: [20, '방수/욕실수'],
  direction: [20, '방향'],
  room_type: [50, '중개대상물종류'],
  deal_type: [50, '거래형태'],
  assignee: [100, '담당자'],
}
const MONEY_LABEL: Record<string, string> = { price: '가격', monthly_rent: '월세', management_fee: '관리비', premium: '권리금' }

/** 받침에 맞춘 조사 — '가격은', '월세는', '가격이', '관리비가' ('가격이(가)' 처럼 둘 다 쓰지 않는다) */
const josa = (w: string, 받침있음: string, 받침없음: string) => {
  const c = w.charCodeAt(w.length - 1)
  const has = c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 !== 0
  return w + (has ? 받침있음 : 받침없음)
}
const 은 = (w: string) => josa(w, '은', '는')
const 이 = (w: string) => josa(w, '이', '가')

const isYmd = (v: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false
  const d = new Date(`${v}T00:00:00Z`)
  // 99999-01-01 같은 연도는 형식은 맞아도 말이 안 된다 — 1900~2100 만 받는다
  const y = d.getUTCFullYear()
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v && y >= 1900 && y <= 2100
}

/** 날짜 칸 검사 — 맞으면 null, 아니면 화면에 띄울 한국어 문구. (고객목록 접수일자 등에서 공용) */
export function checkYmdField(label: string, value: string): string | null {
  return isYmd(value.trim()) ? null : `${은(label)} 2024-03-15 처럼 날짜로 적어 주세요.`
}

export function checkPropertyField(field: string, value: unknown): string | null {
  if (value == null || value === '') return null

  if (field in MONEY_LABEL) {
    const n = typeof value === 'number' ? value : Number(value)
    if (!Number.isFinite(n)) return `${은(MONEY_LABEL[field])} 숫자로 적어 주세요.`
    if (n < 0) return `${은(MONEY_LABEL[field])} 0보다 작을 수 없어요.`
    if (!Number.isInteger(n)) return `${은(MONEY_LABEL[field])} 만원 단위 정수로 적어 주세요 (예: 3000).`
    if (n > MONEY_MAX) return `${이(MONEY_LABEL[field])} 너무 커요 — 만원 단위입니다 (3,000 = 3천만 원).`
    return null
  }

  if (field === 'floor') {
    const n = typeof value === 'number' ? value : Number(value)
    if (!Number.isInteger(n)) return '층은 정수로 적어 주세요 (지하는 -1, -2).'
    if (n < -20 || n > 200) return '층이 -20 ~ 200 범위를 벗어났어요.'
    return null
  }
  if (field === 'total_floors') {
    const s = String(value).trim()
    const m = /^(?:(-?\d{1,3})\s*\/\s*)?(\d{1,3})$/.exec(s)
    if (!m) return "총층은 '5' 또는 '2/5' 처럼 적어 주세요."
    const t = Number(m[2])
    if (t < 1 || t > 200) return '총층이 1 ~ 200 범위를 벗어났어요.'
    if (m[1] != null && (Number(m[1]) < -20 || Number(m[1]) > t)) return '해당 층이 총층보다 클 수 없어요.'
    return null
  }

  if (field === 'size_pyeong' || field === 'area_supplied') {
    const n = typeof value === 'number' ? value : Number(String(value).replace(/,/g, ''))
    const label = field === 'size_pyeong' ? '면적' : '공급면적'
    if (!Number.isFinite(n)) return `${은(label)} 숫자로 적어 주세요.`
    if (n <= 0) return `${은(label)} 0보다 커야 해요.`
    if (n > 1_000_000) return `${이(label)} 너무 커요.`
    return null
  }

  if (field === 'approval_date' || field === 'received_date') {
    const label = field === 'approval_date' ? '사용승인일' : '접수일자'
    if (!isYmd(String(value))) return `${은(label)} 2024-03-15 처럼 날짜로 적어 주세요.`
    return null
  }
  if (field === 'move_in_date') {
    const s = String(value).trim()
    if (isYmd(s) || /^(즉시|협의|즉시\s*입주|입주\s*협의)/.test(s)) return null
    if (s.length > 20) return "입주가능일은 날짜(2024-03-15)나 '즉시', '협의' 로 적어 주세요."
    return null
  }

  const lim = TEXT_LIMITS[field]
  if (lim && typeof value === 'string') {
    if (value.length > lim[0]) return `${이(lim[1])} 너무 길어요 (${lim[0]}자까지, 지금 ${value.length}자).`
    if (field === 'address' && !value.trim()) return '소재지가 비어 있어요.'
  }
  return null
}
