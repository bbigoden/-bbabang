/**
 * 매물목록 한 줄 → 부동산뱅크 등록 화면에 채울 값(임시저장용).
 *
 * 웹(매물목록의 [뱅크 임시저장] 확인창)과 PC 프로그램(부소장광고/src/bank-draft.js)이
 * **같은 파일**을 읽는다. 웹은 누르기 전에 "뱅크에 못 넣는 이유" 를 보여 주고, PC 는 같은
 * 셈으로 화면을 채운다. 여기에만 적고 저쪽에 따로 적지 않는다 — 둘이 어긋나면 웹은 된다고
 * 했는데 PC 가 못 채우는 일이 생긴다.
 *
 * 뱅크 화면 코드(2026-10-21 조사, scratch bank2/form-*.json):
 *   offerings_gbn  ST 상가점포 / OF 사무실 / WH 공장-창고 / FA 공장-공장 (이 넷만 채운다 —
 *                  아파트·오피스텔은 단지 선택, 주택·토지는 화면이 달라 아직 안 만든다)
 *   offerings_sub_gbn  ST: A 단지내상가 B 일반상가 C 복합상가 / OF: A 대형 B 중소형 C 오피스텔 /
 *                      WH: B 창고 C 기타 / FA: A 공장 C 기타
 *   usage_gbn      USG03 1종근생 USG04 2종근생 USG07 판매 USG09 의료 USG10 교육 USG13 운동
 *                  USG14 업무 USG17 공장 USG18 창고
 *   offer_gbn      A 매매 B 전세 C 월세 D 매매(전세포함) E 매매(월세포함) F 매매(전월세포함)
 *   가격 칸        sell_prc 매매가 / lease_prc 전세가 / deposit_prc 보증금 + monthly_prc 월세 (만원)
 *   direction_cd   E W S N NE SE NW SW
 *
 * 부소장광고 PC 프로그램이 이 파일을 경로로 직접 읽는다 — 지우거나 export 를 떼지 말 것.
 */

export type BankDraftProperty = {
  seq_no: number | null
  address: string | null
  room_type: string | null
  deal_type: string | null
  price: number | null
  monthly_rent: number | null
  size_pyeong: string | number | null
  area_type: string | null
  area_unit: string | null
  area_supplied: number | string | null
  floor: number | null
  total_floors: string | number | null
  management_fee: number | null
  premium: number | null
  move_in_date: string | null
  approval_date: string | null
  parking: string | null
  direction: string | null
  rooms_bathrooms: string | null
  description: string | null
  memo: string | null
  images: string[] | null
}

export type BankKind = {
  /** offerings_gbn */
  gbn: 'ST' | 'OF' | 'WH' | 'FA'
  label: string
  /** offerings_sub_gbn */
  sub: string
  /** usage_gbn */
  usage: string
}

/** 부소장 매물종류 → 뱅크 종류. 없는 것은 아직 뱅크에 못 넣는다. */
export const BANK_KIND: Record<string, BankKind> = {
  '1종(상가)': { gbn: 'ST', label: '상가점포', sub: 'B', usage: 'USG03' },
  '2종(상가)': { gbn: 'ST', label: '상가점포', sub: 'B', usage: 'USG04' },
  '판매(상가)': { gbn: 'ST', label: '상가점포', sub: 'B', usage: 'USG07' },
  '의료(상가)': { gbn: 'ST', label: '상가점포', sub: 'B', usage: 'USG09' },
  '교육(상가)': { gbn: 'ST', label: '상가점포', sub: 'B', usage: 'USG10' },
  '운동(상가)': { gbn: 'ST', label: '상가점포', sub: 'B', usage: 'USG13' },
  '업무(상가)': { gbn: 'OF', label: '사무실', sub: 'B', usage: 'USG14' },
  '공장/창고': { gbn: 'WH', label: '창고', sub: 'B', usage: 'USG18' },
}

/** 아직 뱅크에 못 넣는 종류와 그 이유 — 확인창에 그대로 보인다. */
export const BANK_KIND_UNSUPPORTED: Record<string, string> = {
  '아파트': '아파트는 뱅크에서 단지를 골라야 해 아직 자동으로 넣지 못합니다.',
  '오피스텔': '오피스텔은 뱅크에서 단지를 골라야 해 아직 자동으로 넣지 못합니다.',
  '원룸': '원룸·투룸은 뱅크 화면이 달라 아직 자동으로 넣지 못합니다.',
  '투룸': '원룸·투룸은 뱅크 화면이 달라 아직 자동으로 넣지 못합니다.',
  '쓰리룸 이상': '주택은 뱅크 화면이 달라 아직 자동으로 넣지 못합니다.',
  '빌라/연립': '주택은 뱅크 화면이 달라 아직 자동으로 넣지 못합니다.',
  '단독/다가구': '주택은 뱅크 화면이 달라 아직 자동으로 넣지 못합니다.',
  '토지': '토지는 뱅크 화면이 달라 아직 자동으로 넣지 못합니다.',
  '숙박': '숙박은 뱅크 화면이 달라 아직 자동으로 넣지 못합니다.',
  '농업/축사': '농업·축사는 뱅크에 맞는 종류가 없습니다.',
  '기타': "'기타' 는 뱅크 종류를 정할 수 없습니다. 매물종류를 골라 주세요.",
}

/**
 * 천안시 서북구의 읍·면·동. 주소에 구가 빠진 것('천안시 불당동 1530')이 많아 동으로 구를 찾는다.
 * 뱅크 dong_cd 선택지(2026-10-21)와 같다. 여기 없는 천안 동은 동남구로 본다.
 */
const CHEONAN_SEOBUK = new Set(['두정동', '백석동', '부대동', '불당동', '성거읍', '성성동', '성정동', '성환읍', '신당동', '쌍용동', '업성동', '와촌동', '입장면', '직산읍', '차암동'])

export type BankAddress = {
  /** 뱅크 metro_cd 선택지 글자 — '충남' */
  metro: string
  /** gu_cd 선택지 글자 — '천안시 서북구' / '아산시' */
  gu: string
  /** dong_cd 선택지 글자 — '불당동' / '탕정면' */
  dong: string
  /** 읍·면일 때 ri_nm 선택지 글자 — '매곡리' */
  ri: string | null
  /** 본번·부번 */
  jibun1: string
  jibun2: string
  /** 지번 뒤 나머지('101호', '제1동 1층') */
  detail: string
}

const METRO: Record<string, string> = {
  '충남': '충남', '충청남도': '충남', '충북': '충북', '충청북도': '충북', '세종': '세종', '세종특별자치시': '세종',
  '대전': '대전', '대전광역시': '대전', '경기': '경기', '경기도': '경기', '서울': '서울', '서울특별시': '서울',
}

/**
 * 주소 글 → 뱅크 소재지 선택지.
 * '충청남도 천안시 서북구 불당동 1479-2 404호' / '아산시 신창면 오목리 221-1' / '천안시 불당동 1530 정우프라자 115호'
 * 단지 이름만 적힌 것('천안 힐스테이트 퍼스트')은 null — 지번이 없으면 뱅크가 받지 않는다.
 */
export function parseBankAddress(address: string | null | undefined): BankAddress | null {
  if (!address) return null
  // '충남천안시' 처럼 붙은 것을 띄우고, '번지' 는 뗀다
  const text = address
    .replace(/,/g, ' ')
    .replace(/(충청남도|충남|충청북도|충북|세종특별자치시|세종|대전광역시|대전|경기도|경기)(?=\S)/, '$1 ')
    .replace(/(\d)번지/g, '$1')
    .trim()
  const tokens = text.split(/\s+/)
  let metro = ''
  const guParts: string[] = []
  let dong = ''
  let ri: string | null = null
  let i = 0
  if (tokens[i] && METRO[tokens[i]]) { metro = METRO[tokens[i]]; i++ }
  // 시·군·구 — 읍·면·동이 나오기 전까지
  while (i < tokens.length && /^[가-힣]+(시|군|구)$/.test(tokens[i]) && !/(읍|면|동)$/.test(tokens[i])) {
    guParts.push(tokens[i]); i++
  }
  if (i < tokens.length && /^[가-힣]+[0-9]?(읍|면|동)$/.test(tokens[i])) { dong = tokens[i]; i++ }
  if (!dong) return null
  if (/(읍|면)$/.test(dong) && i < tokens.length && /^[가-힣]+리$/.test(tokens[i])) { ri = tokens[i]; i++ }
  const m = i < tokens.length ? /^(\d+)(?:-(\d+))?$/.exec(tokens[i]) : null
  if (!m) return null
  i++
  const detail = tokens.slice(i).join(' ')

  // 구가 빠진 천안 주소는 동으로 찾는다. '천안' 만 적힌 것도 '천안시' 로 본다.
  let gu = guParts.join(' ')
  if (/^천안시?$/.test(gu) || (guParts.length === 1 && guParts[0] === '천안시')) {
    gu = `천안시 ${CHEONAN_SEOBUK.has(dong.replace(/[0-9]/g, '')) ? '서북구' : '동남구'}`
  }
  // 시까지 빠진 것('불당동 100 101호')은 서북구 동이면 천안으로 본다. 다른 동은 어느 시인지 모른다.
  if (!gu && CHEONAN_SEOBUK.has(dong.replace(/[0-9]/g, ''))) gu = '천안시 서북구'
  if (!gu) return null
  if (!metro) metro = /^(천안|아산|공주|보령|서산|논산|계룡|당진|금산|부여|서천|청양|홍성|예산|태안)/.test(gu) ? '충남' : ''
  if (!metro) return null
  // 행정동 숫자('성정1동')는 뱅크 법정동 이름에 없다
  dong = dong.replace(/[0-9]+(?=동$)/, '')
  return { metro, gu, dong, ri, jibun1: m[1], jibun2: m[2] ?? '', detail }
}

/** 거래종류 글('매매, 월세') → 뱅크 offer_gbn. 모르면 null. */
export function bankOfferCode(dealType: string | null | undefined): 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | null {
  const set = new Set((dealType ?? '').split(/[,/·\s]+/).map(s => s.trim()).filter(Boolean))
  const 매매 = set.has('매매'), 전세 = set.has('전세'), 월세 = set.has('월세')
  if (매매 && 전세 && 월세) return 'F'
  if (매매 && 월세) return 'E'
  if (매매 && 전세) return 'D'
  if (매매) return 'A'
  if (전세) return 'B'
  if (월세) return 'C'
  return null
}

const DIRECTION: Record<string, string> = {
  '동향': 'E', '서향': 'W', '남향': 'S', '북향': 'N', '북동향': 'NE', '남동향': 'SE', '북서향': 'NW', '남서향': 'SW',
}

export type BankDraftForm = {
  kind: BankKind
  address: BankAddress
  offer: 'A' | 'B' | 'C' | 'D' | 'E' | 'F'
  /** 만원 */
  sell: number | null
  lease: number | null
  deposit: number | null
  monthly: number | null
  /** 평 — 뱅크 화면이 ㎡ 로 바꾼다 */
  excPyeong: number | null
  supPyeong: number | null
  floor: number | null
  totalFloors: number | null
  bathrooms: number | null
  parkCount: number | null
  parking: 'Y' | 'N' | null
  direction: string | null
  manageFee: number | null
  premium: number | null
  /** 'YYYY-MM-DD' */
  approvalDate: string | null
  moveInNow: boolean
  memo: string
  hiddenMemo: string
  images: string[]
}

export type BankDraftPlan =
  | { ok: true; form: BankDraftForm; warnings: string[] }
  | { ok: false; problems: string[]; warnings: string[] }

const num = (v: unknown): number | null => {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.]/g, ''))
  return Number.isFinite(n) ? n : null
}

/**
 * 뱅크에 넣을 수 있는지와 채울 값. problems 가 있으면 넣지 않는다(웹이 막는다).
 * warnings 는 넣되 사람이 뱅크에서 마저 채워야 하는 칸이다.
 */
export function planBankDraft(p: BankDraftProperty): BankDraftPlan {
  const problems: string[] = []
  const warnings: string[] = []

  const roomType = (p.room_type ?? '').trim()
  let kind = BANK_KIND[roomType] ?? null
  if (!kind) {
    problems.push(roomType
      ? (BANK_KIND_UNSUPPORTED[roomType] ?? `매물종류 '${roomType}' 는 뱅크 종류를 정할 수 없습니다.`)
      : '매물종류가 비어 있습니다.')
  } else if (kind.gbn === 'WH' && /공장/.test(`${p.description ?? ''} ${p.memo ?? ''} ${p.address ?? ''}`) && !/창고/.test(`${p.description ?? ''} ${p.memo ?? ''}`)) {
    // '공장/창고' 한 칸이라 글에 공장이라고 적혀 있으면 공장으로 넣는다
    kind = { gbn: 'FA', label: '공장', sub: 'A', usage: 'USG17' }
  }

  const address = parseBankAddress(p.address)
  if (!address) problems.push('소재지에서 읍·면·동과 지번을 찾지 못했습니다. "천안시 서북구 불당동 1479-2 404호" 처럼 적어 주세요.')

  const offer = bankOfferCode(p.deal_type)
  if (!offer) problems.push(p.deal_type ? `거래형태 '${p.deal_type}' 는 뱅크에 넣을 수 없습니다(매매·전세·월세만).` : '거래형태가 비어 있습니다.')

  const price = num(p.price)
  const rent = num(p.monthly_rent)
  if (price == null || price <= 0) problems.push('가격이 비어 있습니다.')
  if (offer && /[CEF]/.test(offer) && (rent == null || rent <= 0)) problems.push('월세가 비어 있습니다.')

  const sizeP = num(p.size_pyeong)
  const unit = (p.area_unit ?? '평').trim()
  const toPyeong = (v: number | null) => v == null ? null : unit === '㎡' ? Math.round(v / 3.305785 * 100) / 100 : v
  const isSup = (p.area_type ?? '전용').trim() === '공급'
  const excPyeong = isSup ? null : toPyeong(sizeP)
  const supPyeong = isSup ? toPyeong(sizeP) : toPyeong(num(p.area_supplied))
  if (excPyeong == null && supPyeong == null) warnings.push('면적이 비어 있어 뱅크에서 직접 적어야 합니다.')

  const floor = num(p.floor)
  const tf = String(p.total_floors ?? '')
  const totalFloors = num(tf.includes('/') ? tf.split('/').pop() : tf)
  if (floor == null) warnings.push('층이 비어 있습니다.')
  if (totalFloors == null) warnings.push('총층이 비어 있습니다.')

  const rb = /(\d+)\s*\/\s*(\d+)/.exec(p.rooms_bathrooms ?? '')
  const bathrooms = rb ? parseInt(rb[2], 10) : null
  if (bathrooms == null) warnings.push('욕실 수가 비어 있어 뱅크에서 적어야 합니다(필수).')

  const parkingText = (p.parking ?? '').trim()
  const parkCount = num(parkingText)
  const parking: 'Y' | 'N' | null = /불가|없음/.test(parkingText) ? 'N' : (parkCount != null && parkCount > 0) || /가능/.test(parkingText) ? 'Y' : null
  if (parking == null) warnings.push('주차가 비어 있습니다(필수).')

  const direction = DIRECTION[(p.direction ?? '').trim()] ?? null
  if (!direction) warnings.push('방향이 비어 있습니다(필수).')

  const approvalDate = /^\d{4}-\d{2}-\d{2}$/.test(p.approval_date ?? '') ? p.approval_date! : null
  if (!approvalDate) warnings.push('사용승인일이 비어 있습니다(필수).')

  const images = (p.images ?? []).filter(u => /^https?:\/\//.test(u)).slice(0, 20)
  if (!images.length) warnings.push('사진이 없습니다.')

  if (problems.length || !kind || !address || !offer) return { ok: false, problems, warnings }

  const seq = p.seq_no != null ? `부소장 #${p.seq_no}` : '부소장'
  return {
    ok: true,
    warnings,
    form: {
      kind, address, offer,
      sell: /[ADEF]/.test(offer) ? price : null,
      lease: /[BDF]/.test(offer) ? price : null,
      deposit: /[CEF]/.test(offer) ? price : null,
      monthly: /[CEF]/.test(offer) ? rent : null,
      excPyeong, supPyeong,
      floor, totalFloors, bathrooms, parkCount, parking, direction,
      manageFee: num(p.management_fee), premium: num(p.premium),
      approvalDate,
      moveInNow: /즉시/.test(p.move_in_date ?? ''),
      memo: (p.description ?? '').trim(),
      // 비공개 메모 맨 앞에 부소장 번호 — 재등록해도 어느 매물인지 남는다
      hiddenMemo: [seq, (p.memo ?? '').trim()].filter(Boolean).join('\n'),
      images,
    },
  }
}
