/**
 * 네이버 카페 매물 포스팅 변환 — 규칙 기반 (API 연결 없음).
 *
 * 부동산뱅크·네이버부동산에서 복사한 매물 원문을 파싱해서
 * 플러스불당공인중개사사무소의 네이버 카페 게시용 글로 변환한다.
 * 인터넷 표시광고 필수 명시사항(13행 표, 법정 순서)을 준수한다.
 *
 * 준수 규칙:
 *  - 원문의 `-`/`표시안함`은 미입력이지 "없음"이 아님 → 융자·임차권등기 언급 금지
 *  - 매출·영업성과 주장, 근거 없는 최상급/거리 표현 금지
 *  - 소재지는 읍·면·동 + 층수까지만 (지번·호수 제외)
 *  - 면적 ㎡ + 평 병기 (㎡ × 0.3025)
 *  - 채광 표현 금지, 중개사 개인 문구는 중개사 정보 섹션에만
 */

// ── 파싱 ─────────────────────────────────────────────

export interface ParsedListing {
  addressRaw?: string      // 소재지 필드 원문
  sido?: string            // 충청남도
  city?: string            // 천안시/아산시
  gu?: string              // 서북구/동남구
  dong?: string            // 불당동/백석동...
  floor?: string           // 해당층
  totalFloors?: string     // 총층
  exclusiveArea?: number   // 전용면적 ㎡
  supplyArea?: number      // 공급면적 ㎡
  dealType?: '매매' | '전세' | '월세'
  salePrice?: string       // 매매/전세가 (원문 표기)
  deposit?: string         // 보증금 (원문 표기)
  monthlyRent?: string     // 월세 (원문 표기)
  propertyKind?: string    // 중개대상물 종류
  moveIn?: string          // 입주가능일
  bathrooms?: string       // 화장실 수
  approvalDate?: string    // 사용승인일
  parking?: string         // 주차
  maintenanceFee?: string  // 관리비
  maintenanceFeeAmount?: number // 관리비 숫자(원) — 10만원 초과 점검용
  direction?: string       // 방향
  premium?: string         // 권리금
  coBrokerage?: boolean    // 공동중개 환영 여부
  elevator?: boolean
  // 공장·창고 검색자가 가장 먼저 보는 항목. 뱅크 폼에는 없고 상세설명에 적히는 경우가 많다
  ceilingHeight?: string   // 층고
  power?: string           // 계약전력
  landArea?: number        // 대지면적 ㎡
  totalFloorArea?: number  // 연면적 ㎡
  category: Category
}

export type Category = 'office' | 'food' | 'academy' | 'beauty' | 'large' | 'retail' | 'industrial'
  | 'residential' | 'land'

const NEEDS_CHECK = '확인 필요'

/**
 * 라벨 뒤의 값을 뽑는다. `소재지 : 값`, `소재지: 값`, `소재지 값`, 탭 구분 모두 허용.
 *
 * 부동산뱅크 원문은 **미입력**을 `-`, `-만원`, `- 만원 (표시안함)`, `표시안함` 으로 적는다.
 * 이걸 값으로 읽으면 "권리금은 -만원 조건입니다" 같은 문장이 나가고,
 * 융자·임차권등기는 "없음"으로 단정돼 허위표시가 된다. 전부 미입력으로 처리한다.
 */
function field(src: string, labels: string[]): string | undefined {
  for (const label of labels) {
    const re = new RegExp(`${label}\\s*[:：|]?\\s*([^\\n\\r|]+)`)
    const m = src.match(re)
    if (m) {
      const v = m[1].trim()
      if (v && !/^-/.test(v) && !/^표시안함$/.test(v)) return v
    }
  }
  return undefined
}

/** "173.5㎡", "173.5m²", "173.5 m2" 등에서 ㎡ 숫자 추출 */
function areaNumber(v: string | undefined): number | undefined {
  if (!v) return undefined
  const m = v.match(/([\d,]+(?:\.\d+)?)\s*(?:㎡|m²|m2|제곱미터)/i) ?? v.match(/([\d,]+(?:\.\d+)?)/)
  if (!m) return undefined
  const n = parseFloat(m[1].replace(/,/g, ''))
  if (!Number.isFinite(n) || n <= 0) return undefined
  // 뱅크 원문에 `121.5473 ㎡` 처럼 소수점 네 자리까지 들어 있다. 광고에 그대로
  // 나가면 지저분하고, 그만큼 정밀한 값도 아니다. 둘째 자리에서 끊는다.
  return Math.round(n * 100) / 100
}

/**
 * 소재지 꼬리에서 해당층을 읽는다. 스킬이 말하는 "호수와 대조해 판단"이 이것이다.
 *   `지하1층` `B135호` → B1 / `210호` → 2 / `1001호` → 10 / `12동` → 알 수 없음
 * 동 번호(`501동`)를 호수로 오인하지 않도록 `호`·`층`으로 끝나는 것만 본다.
 */
function floorFromAddress(addr?: string): string | undefined {
  if (!addr) return undefined
  const base = addr.match(/지하\s*(\d+)\s*층/) ?? addr.match(/B\s*(\d)\d{2}\s*호/)
  if (base) return `B${base[1]}`
  const explicit = addr.match(/(\d+)\s*층/)
  if (explicit) return explicit[1]
  // 호수 → 층. 3자리는 앞 1자리, 4자리는 앞 2자리. 여러 호가 붙어도 마지막 것을 본다.
  const rooms = addr.match(/\d{3,4}\s*호/g)
  if (rooms) {
    const n = rooms[rooms.length - 1].replace(/\D/g, '')
    return n.length === 4 ? String(Number(n.slice(0, 2))) : String(Number(n[0]))
  }
  return undefined
}

/**
 * 뱅크 층수 필드의 원값을 내부 표기로 바꾼다.
 *
 * 앞값이 양수면 해당층이 맞다 — 244건에서 소재지(`1층`·`202호`·`1001호`)와 그대로
 * 맞물린다. 그런데 **음수는 믿을 수 없다.** `-1 / 1` 12건을 소재지와 대조해 보면
 * 지하가 맞는 건 `지하1층`·`B135호`로 적힌 5건뿐이고, 나머지는 `210호`(2층),
 * `136호`(1층), `1층 단독 창고`처럼 지상이다. 지상 매물을 지하로 광고하면
 * 0층을 찍는 것보다 나쁘다. 그래서 음수는 버리고 소재지에서 다시 읽는다.
 *
 * `0`은 소재지가 `전체`인 통건물이라 해당층 개념이 없다.
 */
function normalizeFloor(raw: string | undefined, src?: string): string | undefined {
  const v = raw?.trim()
  if (v && /^\d+$/.test(v) && v !== '0') return v
  if (v && /^B\d+$/.test(v)) return v
  if (!src) return undefined
  return floorFromAddress(field(src, ['소재지']))
    ?? floorFromAddress((src.match(/-\s*위치\s*[:：].*/) ?? [''])[0])
}

/**
 * 사람이 읽는 주차 표기. 뱅크는 `26` 처럼 숫자만 준다.
 *
 * 서식을 표에만 두었더니 본문에는 "주차는 26 조건입니다" 처럼 단위가 빠진 채로
 * 나갔다. 세 군데에서 같은 값을 쓰므로 한 곳에서 만든다.
 */
/** 공장·창고 계열인가. 이쪽은 검색자가 보는 항목 자체가 다르다 (층고·전력·진입). */
function isIndustrialCat(c: Category): boolean {
  return c === 'industrial'
}

export function parkingLabel(parking?: string): string | null {
  if (!parking) return null
  return /^\d+$/.test(parking) ? `총 ${parking}대` : parking
}

/** 사람이 읽는 층 표기. 지하는 `B1`로 담고 있으므로 풀어서 쓴다. */
export function floorLabel(floor?: string): string | null {
  if (!floor) return null
  const b = floor.match(/^B(\d+)$/)
  return b ? `지하 ${b[1]}층` : `${floor}층`
}

export function m2ToPyeong(m2: number): string {
  return (m2 * 0.3025).toFixed(1)
}

/** 관리비 문자열에서 원 단위 금액 추정 (10만원 초과 점검용) */
function feeToWon(v: string | undefined): number | undefined {
  if (!v) return undefined
  const man = v.match(/([\d,]+(?:\.\d+)?)\s*만/)
  if (man) return parseFloat(man[1].replace(/,/g, '')) * 10000
  const won = v.match(/([\d,]{4,})\s*원/)
  if (won) return parseFloat(won[1].replace(/,/g, ''))
  return undefined
}

/** 소재지에서 시/구/동 추출. 지번·건물명·호수는 버린다 */
function parseAddress(raw: string | undefined) {
  if (!raw) return {}
  const sido = raw.match(/(충청남도|충남|충청북도|충북|세종특별자치시|대전광역시)/)?.[1]
  const city = raw.match(/([가-힣]+시)(?!장)/)?.[1]
  // 주의: 한글에는 \b(단어 경계)가 동작하지 않으므로 lookahead로 구분
  const gu = raw.match(/([가-힣]+구)(?=\s|$|,|\d)/)?.[1]
  const dong = raw.match(/([가-힣]+[동읍면])(?=\s|\d|$|,)/)?.[1]
  const normSido = sido === '충남' ? '충청남도' : sido === '충북' ? '충청북도' : sido
  return { sido: normSido, city, gu, dong }
}

/** 업종 카테고리 추정 (템플릿 선택용) */
function detectCategory(source: string, exclusiveArea?: number): Category {
  // 중개사무소 소개 문구("플러스불당공인중개사사무소")가 업종 판단에 섞이면
  // 1층 상가가 '사무실'로 잡힌다. 판단 전에 걷어낸다.
  const src = source
    .replace(/[가-힣]*공인중개사\s*사무소/g, '')
    .replace(/중개\s*사무소/g, '')

  // 원문의 `건물종류`·`건축물용도`가 가장 믿을 만한 근거다. 이걸 두고 면적이나
  // 본문 키워드로 추측하면 업무시설(555㎡)이 '대형 상가'가 되고 단독주택이 '상가'가 된다.
  const declared = [field(src, ['건물종류']), field(src, ['건축물용도'])].filter(Boolean).join(' ')
  const byDeclared = categoryFromKind(declared)
  if (byDeclared) return byDeclared

  // 선언된 용도가 없을 때만 본문 전체로 추정한다
  const byText = categoryFromKind(src)
  if (byText) return byText

  if (exclusiveArea && exclusiveArea >= 330) return 'large' // 약 100평 이상
  return 'retail'
}

/** 용도 문구 → 카테고리. 더 구체적인 것부터 본다. */
function categoryFromKind(t: string): Category | null {
  if (!t) return null
  if (/토지|임야|대지|전답|과수원/.test(t)) return 'land'
  if (/아파트|오피스텔|빌라|연립|다세대|단독주택|다가구|주택|원룸|투룸/.test(t)) return 'residential'
  if (/공장|창고|물류|제조|지식산업센터|자동차|축사|주차장/.test(t)) return 'industrial'
  if (/사무실|업무시설|오피스/.test(t)) return 'office'
  if (/음식점|식당|카페|주방|요식|덕트/.test(t)) return 'food'
  if (/학원|교습|스터디|교육연구/.test(t)) return 'academy'
  if (/미용|네일|피부|헤어|뷰티/.test(t)) return 'beauty'
  // 상가 계열은 마지막에 본다. 앞의 업종 키워드가 더 구체적이기 때문.
  // 이게 없으면 `단지내상가 / 제2종 근린생활시설` 이 판정을 못 받고 본문 추정으로 넘어가,
  // 상세설명의 "아파트 입구 …" 때문에 주택으로 분류된다.
  if (/근린생활시설|상가|점포|판매시설/.test(t)) return 'retail'
  return null
}

export function parseListing(source: string): ParsedListing {
  const src = source.replace(/ /g, ' ')

  const addressRaw = field(src, ['소재지', '소재\\s*지역', '주소', '위치'])
  const addr = parseAddress(addressRaw ?? src)

  // 면적 — 전용/공급 라벨 우선, 없으면 "계약/전용" 순서쌍 추정
  const exclusiveArea = areaNumber(field(src, ['전용면적', '전용']))
  const supplyArea = areaNumber(field(src, ['공급면적', '계약면적', '분양면적', '공급']))
  // 공장·창고는 전용·공급이 비고 연면적만 적힌 경우가 많다. 규모 판단(대형 여부)에
  // 쓸 수 있게 여기서 미리 잡아 둔다.
  const totalFloorArea = areaNumber(field(src, ['연면적']))

  // 층수 — "지하층/지상층 1 / 6" 형식은 라벨과 달리 실제로 해당층/총층이다.
  // 244건을 소재지와 대조해 확인했다: 앞값 1은 소재지 `1층`, 2는 `202호`,
  // 10은 `1001호`, 12는 `제12층`과 정확히 맞물린다. 해당층이 지하면 `-1`처럼
  // 음수로, 건물 전체를 쓰는 매물은 `0`으로 들어온다.
  let floor: string | undefined
  let totalFloors: string | undefined
  const floorPair =
    src.match(/(?:지하층\s*\/\s*지상층|해당층\s*\/\s*총층|층수)\s*[:：]?\s*(-?\d+|B\d+)\s*(?:층)?\s*\/\s*(?:총\s*)?(\d+)\s*(?:층)?/) ??
    src.match(/(B?\d+)\s*층\s*\/\s*(?:총\s*)?(\d+)\s*층/)
  if (floorPair) {
    floor = normalizeFloor(floorPair[1], src)
    totalFloors = floorPair[2]
    // 해당층이 총층보다 높으면 둘 중 하나가 오입력이다. 소재지에서 읽은 해당층이
    // 근거가 더 확실하므로(`210호`인데 총 1층) 총층을 버린다.
    if (floor && /^\d+$/.test(floor) && totalFloors && Number(floor) > Number(totalFloors)) {
      totalFloors = undefined
    }
  } else {
    // 단층 건물(창고·공장)은 지하층이 비어 `지하층/지상층  - / 1` 로 온다.
    // 한쪽이 미입력이라고 층수를 통째로 버리면 표가 "확인 필요"가 된다.
    const halfPair = src.match(/지하층\s*\/\s*지상층\s*[:：]?\s*(-|-?\d+|B\d+)\s*\/\s*(-|\d+)/)
    if (halfPair) {
      const [, base, upper] = halfPair
      if (upper !== '-') { floor = upper; totalFloors = upper }
      else if (base !== '-') floor = normalizeFloor(base, src)
    }
    floor ??= normalizeFloor(field(src, ['해당층'])?.match(/-?\d+|B\d+/)?.[0], src)
    totalFloors ??= field(src, ['총층수', '총층'])?.match(/\d+/)?.[0]
  }

  // 거래형태·가격
  let dealType: ParsedListing['dealType']
  // '거래종류'는 부동산뱅크 인쇄 화면(매물 원문)이 쓰는 라벨
  const dealField = field(src, ['거래형태', '거래유형', '거래구분', '거래종류'])
  if (dealField) {
    if (dealField.includes('매매')) dealType = '매매'
    else if (dealField.includes('전세')) dealType = '전세'
    else if (dealField.includes('월세') || dealField.includes('임대')) dealType = '월세'
  }
  // 뱅크 원문은 한 줄에 몰아서 쓴다: `월세가  월세보증금 2,000 만원 / 월세금액 120 만원`
  let deposit = field(src, ['월세보증금', '보증금'])?.match(/[\d,.억만원\s]+/)?.[0]?.trim()
  let monthlyRent = field(src, ['월세금액', '월세', '월\\s*임대료', '차임'])?.match(/[\d,.억만원\s]+/)?.[0]?.trim()
  const salePrice = field(src, ['매매가격', '매매가', '매매금액', '전세보증금', '전세가', '전세금'])?.match(/[\d,.억만원\s]+/)?.[0]?.trim()
  // "1,000/70" 단축 표기
  if (!deposit && !monthlyRent) {
    const short = src.match(/([\d,]+)\s*\/\s*([\d,]+)\s*(?:만원)?/)
    if (short && !dealType) { deposit = short[1]; monthlyRent = short[2] }
    else if (short && dealType === '월세') { deposit = short[1]; monthlyRent = short[2] }
  }
  if (!dealType) {
    if (monthlyRent) dealType = '월세'
    else if (salePrice && /전세/.test(src)) dealType = '전세'
    else if (salePrice || /매매/.test(src)) dealType = '매매'
  }

  // 관리비 — 금액이 있으면 금액만, 금액 없이 부과 방식만 있으면 **그 방식을 그대로**.
  //
  // 예전에는 `관리규약에 따라 부과` 를 '확인 필요' 로 바꿔 버렸다. 원문에 적혀
  // 있는 것을 안 적은 셈이라, 275건 중 151건이 관리비 칸을 비운 채 나갔다.
  // 금액을 모르는 것과 부과 방식이 정해져 있는 것은 다르다.
  const maintenanceFeeRaw = field(src, ['관리비'])
  const maintenanceFeeAmount = feeToWon(maintenanceFeeRaw)
  // 금액이 분명할 때만 금액을 적고, 나머지는 **관리규약에 따라 부과** 로 통일한다.
  // 상가·공장 임대는 관리규약 부과가 기본이라 그렇게 적는 편이 '확인 필요' 보다
  // 정확하다. 사장님이 정한 표기다.
  const maintenanceFee = maintenanceFeeAmount
    ? `월 ${(maintenanceFeeRaw!.match(/[\d,.]+\s*만\s*원?|[\d,]{4,}\s*원/) ?? [''])[0]
        .replace(/\s/g, '').replace(/만$/, '만원')}`
    : '관리규약에 따라 부과'

  // 권리금 — 표의 `권리금  -만원` 은 **미입력**이지 없음이 아니다(절대규칙 2).
  // 다만 사장님이 손으로 `권리금 없음` 이라 적었으면 그건 사실이다. 그걸 안 읽어
  // 무권리 매물 10건이 그 장점을 빼고 나갔다 — 상가에서 가장 큰 조건인데도.
  const premiumRaw = field(src, ['권리금'])
  // 표의 `권리금  -만원` 은 **미입력**이지 없음이 아니다(절대규칙 2). 모를 때는
  // '유선 문의' 로 통일한다 — 비워 두면 없는 것처럼 읽히고, 없다고 적으면 거짓이다.
  // 다만 사장님이 손으로 `권리금 없음` 이라 적었으면 그건 사실이고, 상가에서
  // 가장 큰 조건이므로 장점으로 살린다.
  let premium: string
  if (/무권리|권리금\s*[:：]?\s*없|권리금\s*없음/.test(handwrittenBody(src))) {
    premium = '없음'
  } else if (premiumRaw && !/문의|협의/.test(premiumRaw) && /[\d]/.test(premiumRaw)) {
    premium = premiumRaw
  } else {
    premium = '유선 문의'
  }

  const moveInRaw = field(src, ['입주가능일', '입주일', '입주시기'])
  const moveIn = moveInRaw
    ? (/즉시/.test(moveInRaw) ? '즉시입주' : /협의/.test(moveInRaw) ? '협의' : moveInRaw)
    : (/즉시\s*입주/.test(src) ? '즉시입주' : undefined)

  return {
    addressRaw,
    ...addr,
    floor,
    totalFloors,
    exclusiveArea,
    supplyArea,
    dealType,
    salePrice,
    deposit,
    monthlyRent,
    // **뱅크의 `건물종류`(공장·창고…) 는 쓰지 않는다.** 광고에 적는 종류는
    // 건축물대장·등기에서 확인한 것이어야 하고, 그게 `건축물 용도` 다.
    // 뱅크의 건물종류는 뱅크가 목록을 나누려고 붙인 분류라 근거가 다르다.
    // 못 읽으면 "확인 필요" 로 두고 발행을 막는다 — 근거 없는 값을 넣지 않는다.
    propertyKind: field(src, ['중개대상물\\s*종류', '건축물\\s*용도', '용도', '매물종류', '건물용도']),
    moveIn,
    bathrooms: field(src, ['화장실', '욕실'])?.match(/\d+/)?.[0],
    // 뱅크 원문은 `준공년월  2021.05.27   총 주차대수  5` 처럼 한 줄에 두 항목을 붙여 쓴다.
    // 느슨하게 잡으면 뒤 항목까지 딸려오고, 너무 좁게 잡으면 연도만 남는다.
    approvalDate: (() => {
      const v = field(src, ['사용승인일', '준공년월', '준공연도', '준공일', '사용승인'])
      if (!v) return undefined
      const ymd = v.match(/(\d{4})[.\-/년]\s*(\d{1,2})[.\-/월]\s*(\d{1,2})/)
      if (ymd) return `${ymd[1]}.${ymd[2].padStart(2, '0')}.${ymd[3].padStart(2, '0')}`
      const ym = v.match(/(\d{4})[.\-/년]\s*(\d{1,2})/)
      if (ym) return `${ym[1]}.${ym[2].padStart(2, '0')}`
      return v.match(/\d{4}/)?.[0]
    })(),
    parking: field(src, ['주차대수', '주차'])?.trim(),
    maintenanceFee,
    maintenanceFeeAmount,
    direction: field(src, ['방향', '향'])?.match(/[가-힣]*[동서남북]향?/)?.[0],
    premium,
    ceilingHeight: field(src, ['층고'])?.match(/[\d.]+\s*[mM미터]?/)?.[0]?.replace(/\s/g, '').replace(/[mM]$/, 'm'),
    power: field(src, ['전력', '계약전력'])?.match(/[\d.]+\s*[kK]?[wW]/)?.[0]?.replace(/\s/g, ''),
    landArea: areaNumber(field(src, ['대지면적', '토지면적'])),
    totalFloorArea,
    coBrokerage: /공동\s*중개\s*환영|공동\s*환영/.test(src),
    elevator: /엘리베이터|승강기|E\/?V/.test(src),
    category: detectCategory(src, exclusiveArea ?? supplyArea ?? totalFloorArea),
  }
}

// ── 부당광고 표현 점검 ─────────────────────────────────

/**
 * 원문에 있으면 점검 보고에 알리는 표현.
 *
 * **결과물에서 빼는 것이 아니다.** 이 생성기는 원문 문장을 옮기지 않고 정해진
 * 어휘로 새로 쓰므로, 애초에 옮겨질 일이 없다. 사장님이 뱅크 원문을 손볼 때
 * 참고하시라고 알리는 것뿐이다.
 *
 * 최상급 표현과 거리·시간 표현은 사장님 판단으로 알리지 않는다. 나머지는
 * 남긴다 — 영업 실적을 단정하는 말이라 성격이 다르다.
 */
const BANNED_PATTERNS: Array<[RegExp, string]> = [
  [/성업\s*중/, '성업 중'],
  [/잘\s*되는\s*자리/, '잘 되는 자리'],
  [/검증된?\s*매출/, '검증된 매출'],
  [/매출\s*보장/, '매출 보장'],
]

function findBanned(src: string): string[] {
  const found: string[] = []
  for (const [re, label] of BANNED_PATTERNS) {
    if (re.test(src)) found.push(label)
  }
  return found
}

// ── 생성 ─────────────────────────────────────────────

/** 같은 원문이면 같은 결과가 나오도록 문자열 해시로 템플릿 변형 선택 */
function hashPick(src: string, n: number): number {
  let h = 0
  for (let i = 0; i < src.length; i++) h = (h * 31 + src.charCodeAt(i)) >>> 0
  return h % n
}

const KIND_LABEL: Record<Category, string> = {
  office: '사무실', food: '상가', academy: '상가', beauty: '상가', large: '대형상가', retail: '상가',
  industrial: '공장·창고',
  residential: '주택', land: '토지',
}

const CONCERNS: Record<Category, string[]> = {
  office: [
    '사무실을 알아보실 때 가장 번거로운 부분이 칸막이 공사와 집기 배치입니다. 평면이 애매하면 인테리어 비용이 늘어나고, 입주 일정도 그만큼 밀리게 됩니다.',
    '사무 공간은 면적 숫자보다 실제 평면이 중요합니다. 기둥 위치나 형태가 애매하면 같은 평수라도 책상 배치가 어려워 공사비가 늘어나곤 합니다.',
  ],
  food: [
    '음식점 창업에서 가장 큰 부담은 초기 시설 투자와 공사 기간입니다. 덕트·급배수 공사가 새로 필요한 자리는 오픈까지 시간과 비용이 예상보다 커지곤 합니다.',
    '요식업 자리를 구하실 때는 시설 상태에 따라 초기 비용 차이가 큽니다. 기존 설비를 활용할 수 있는지가 창업 일정과 예산을 좌우합니다.',
  ],
  academy: [
    '학원 자리는 용도와 층, 주차 조건을 함께 봐야 해서 조건에 맞는 매물을 찾기가 쉽지 않습니다. 강의실 구획 공사 비용도 평면에 따라 크게 달라집니다.',
    '교습 시설은 학부모 차량 동선과 건물 용도 요건까지 확인해야 할 항목이 많습니다. 조건이 맞는 매물이 나오면 회전이 빠른 편입니다.',
  ],
  beauty: [
    '미용업 창업은 인테리어 비용 비중이 커서, 평면이 반듯하고 설비 이전이 수월한 자리를 만나는 것이 초기 부담을 줄이는 핵심입니다.',
    '뷰티샵 자리는 고객 접근성과 인테리어 비용을 함께 따져야 합니다. 기존 시설 활용 여부에 따라 오픈 예산이 크게 달라집니다.',
  ],
  large: [
    '대형 평수는 한 층을 통으로 쓸 수 있는 물건 자체가 귀합니다. 면적을 나눠 쓰자니 동선이 불편하고, 통임대 매물은 나오는 대로 소진되는 편입니다.',
    '규모 있는 공간을 찾으실 때는 층 분산 없이 한 번에 쓸 수 있는지가 관건입니다. 조건에 맞는 대형 매물은 공급이 많지 않습니다.',
  ],
  residential: [
    '주택은 겉으로 보이는 상태보다 배관·누수·단열 같은 부분에서 비용이 갈립니다. 입주 전에 확인해 둘 항목이 적지 않습니다.',
    '다가구·단독주택은 임대 운용까지 고려하면 방 구성과 주차 여건이 수익률을 좌우합니다. 현재 임대 현황을 함께 살펴보셔야 합니다.',
  ],
  land: [
    '토지는 용도지역과 건폐율·용적률에 따라 지을 수 있는 것이 크게 달라집니다. 계획 중인 용도가 실제로 가능한지 먼저 확인해야 합니다.',
    '땅은 진입로 확보 여부가 가치를 좌우합니다. 도로에 접해 있는지, 맹지는 아닌지가 먼저 확인할 부분입니다.',
  ],
  industrial: [
    '공장·창고를 구하실 때는 진입로 폭과 차량 회전 반경이 실제 운영을 좌우합니다. 면적이 맞아도 대형 차량이 못 들어오면 쓸 수 없는 자리가 됩니다.',
    '제조·물류 공간은 층고와 바닥 하중, 전력 용량이 관건입니다. 설비를 옮긴 뒤에야 조건이 안 맞는 걸 알게 되면 비용이 크게 늘어납니다.',
    '공장 자리는 건축물 용도와 업종의 인허가 가능 여부를 먼저 확인해야 합니다. 계약 후 용도 문제로 영업을 못 하는 경우가 있습니다.',
  ],
  retail: [
    '상가 자리를 알아보실 때는 임대 조건 못지않게 초기 투자 부담이 큰 고민입니다. 권리금과 시설 상태에 따라 창업 예산이 크게 달라집니다.',
    '점포 자리는 조건이 좋아 보여도 관리비나 부대 비용까지 합치면 계산이 달라지는 경우가 많습니다. 계약 전 확인할 항목이 적지 않습니다.',
  ],
}

const RECOMMENDED_USES: Record<Category, string> = {
  office: '사무실, 스튜디오, 학원 상담실, 소규모 교육장, 온라인 판매 사무공간',
  food: '음식점, 카페, 분식, 베이커리, 포장 전문점',
  academy: '학원, 교습소, 스터디카페, 공부방, 상담센터',
  beauty: '미용실, 네일샵, 피부관리실, 왁싱샵, 속눈썹샵',
  large: '학원, 헬스장, 필라테스, 전시장, 대형 사무실, 물류·판매 복합공간',
  industrial: '제조업, 물류·보관, 유통, 조립·가공, 소규모 공장, 창고',
  residential: '실거주, 임대 운용, 사옥 겸용',
  land: '건축, 창고·공장 부지, 투자 목적 보유',
  retail: '소매점, 사무실, 학원, 서비스업 매장, 쇼룸',
}

/**
 * 글에 쓰는 대표 면적. **전용 > 공급 > 연면적** 순으로 고른다.
 *
 * 공장·창고는 뱅크 원문에 전용·공급면적이 비어 있고 `연면적` 만 적힌 경우가
 * 많다. 단독 건물이라 연면적이 곧 쓸 수 있는 면적이기 때문이다. 전용면적만
 * 보면 이런 매물이 통째로 "면적 확인 필요" 가 되어 광고를 못 낸다.
 *
 * 라벨을 함께 돌려주는 이유는 **연면적을 전용면적이라고 적으면 안 되기**
 * 때문이다. 전용은 임차인이 독점하는 면적이고 연면적은 건물 전체 바닥면적이라
 * 뜻이 다르다. 잘못 적으면 계약 분쟁이 된다.
 */
function mainArea(p: ParsedListing): { m2: number; label: string } | null {
  if (p.exclusiveArea) return { m2: p.exclusiveArea, label: '전용' }
  if (p.supplyArea) return { m2: p.supplyArea, label: '공급' }
  // '연' 이 아니라 '연면적' 이다 — "연 약 58평" 은 말이 안 된다.
  if (p.totalFloorArea) return { m2: p.totalFloorArea, label: '연면적' }
  return null
}

/** 대표 면적의 ㎡ 값. 크기로 갈리는 판단(대형 여부 등)에 쓴다. */
function mainAreaM2(p: ParsedListing): number | undefined {
  return mainArea(p)?.m2
}

function fmtArea(p: ParsedListing): string {
  const ex = p.exclusiveArea ? `전용 ${p.exclusiveArea}㎡ (약 ${m2ToPyeong(p.exclusiveArea)}평)` : null
  const su = p.supplyArea ? `공급 ${p.supplyArea}㎡ (약 ${m2ToPyeong(p.supplyArea)}평)` : null
  if (ex && su) return `${ex} / ${su}`
  if (ex ?? su) return (ex ?? su) as string
  // 둘 다 없으면 연면적으로 적되, **연면적이라고 밝힌다.**
  return p.totalFloorArea
    ? `연면적 ${p.totalFloorArea}㎡ (약 ${m2ToPyeong(p.totalFloorArea)}평)`
    : NEEDS_CHECK
}

function fmtMoney(v: string | undefined): string | undefined {
  if (!v) return undefined
  const t = v.trim()
  return /억|만|원/.test(t) ? t : `${t}만원`
}

function fmtPrice(p: ParsedListing): string {
  if (p.dealType === '월세' || (p.deposit && p.monthlyRent)) {
    const d = fmtMoney(p.deposit) ?? NEEDS_CHECK
    const m = fmtMoney(p.monthlyRent) ?? NEEDS_CHECK
    return `보증금 ${d} / 월세 ${m}`
  }
  if (p.salePrice) return `${p.dealType === '전세' ? '전세금' : '매매가'} ${fmtMoney(p.salePrice)}`
  return NEEDS_CHECK
}

function fmtLocation(p: ParsedListing): string {
  const parts = [p.sido ?? '충청남도', p.city, p.gu, p.dong].filter(Boolean)
  const base = parts.length >= 2 ? parts.join(' ') : NEEDS_CHECK
  const fl = p.floor ? ` (${floorLabel(p.floor)})` : ''
  return base === NEEDS_CHECK ? base : `${base}${fl}`
}

/**
 * 실제로 주차가 되는 매물인지.
 *
 * 부동산뱅크는 주차 없는 매물도 주차대수를 0으로 저장하므로, 값의 존재만 보면
 * "총 0대"인 매물에 '주차 가능' 특장점·태그·Q&A가 붙어 본문과 모순된다.
 * 주차 관련 문구는 전부 이 함수를 거친다.
 */
function hasParking(p: ParsedListing): boolean {
  if (!p.parking) return false
  const n = p.parking.match(/\d+/)
  return n ? Number(n[0]) > 0 : !/없|불가/.test(p.parking)
}

/** 특장점 후보 수집 (제목·한줄요약·태그에서 공용) */
function features(p: ParsedListing): string[] {
  const out: string[] = []
  if (p.premium === '없음') out.push('무권리')
  if (p.moveIn === '즉시입주') out.push('즉시입주 가능')
  if (hasParking(p)) out.push('주차 가능')
  if (p.elevator) out.push('엘리베이터')
  if (p.floor === '1') out.push('1층 매물')
  if ((mainAreaM2(p) ?? 0) >= 330) out.push('대형 평수')
  if (p.coBrokerage) out.push('공동중개 환영')
  if (out.length < 3 && mainArea(p)) out.push(`${mainArea(p)!.label} 약 ${m2ToPyeong(mainArea(p)!.m2)}평`)
  if (out.length < 3 && p.dong) out.push(`${p.dong} 상권`)
  if (out.length < 3) out.push('현장 확인 실매물')
  return out
}

/**
 * 규모를 범주형으로. 태그(`#천안대형상가`)에 쓴다.
 *
 * 절대규칙 8이 막는 것은 `32평상가` 같은 **검색 키워드**다 — 아무도 그렇게 검색하지 않는다.
 * 제목 뒷부분의 `약 92평` 은 읽는 사람에게 규모를 알려주는 설명이므로 해당하지 않는다.
 */
function sizeLabel(p: ParsedListing): string | null {
  const a = mainAreaM2(p)
  if (!a) return null
  if (a >= 330) return '대형'      // 약 100평 이상
  if (a >= 132) return '중대형'    // 약 40평 이상
  if (a <= 66) return '소형'       // 약 20평 이하
  return null
}

/**
 * 검색되는 평수 표기. `43.8평` 으로 검색하는 사람은 없고 `40평대` 로 찾는다.
 * 정확한 면적은 표와 본문이 말하므로 제목에서는 범주로 적는다(절대규칙 8).
 */
function sizeBand(p: ParsedListing): string | null {
  const a = mainAreaM2(p)
  if (!a) return null
  const py = a * 0.3025
  if (py < 10) return '10평 미만'
  if (py < 100) return `${Math.floor(py / 10) * 10}평대`
  return `${Math.floor(py / 100) * 100}평대`
}

/** 종류를 부르는 다른 말. 같은 매물을 여러 검색어로 걸기 위해 제목마다 바꾼다. */
const KIND_ALT: Record<Category, string> = {
  office: '사무실', food: '점포', academy: '점포', beauty: '점포', large: '점포', retail: '점포',
  industrial: '창고', residential: '주택', land: '토지',
}

function buildTitles(p: ParsedListing, src = ''): string[] {
  // 사용자가 실제 쓰는 형식은 `천안 불당동`(시 + 동)이다. 동만 쓰면 어느 시인지 모호하다.
  const cityShort = p.city?.replace(/시$/, '') ?? p.city
  const region = [cityShort, p.dong].filter(Boolean).join(' ') || cityShort || '천안'
  const kind = KIND_LABEL[p.category]
  const deal = p.dealType ?? '임대'
  const uses = RECOMMENDED_USES[p.category].split(',').map(s => s.trim())

  // 제목은 **사람들이 검색할 말**로 채운다. 틀을 지키는 것보다 그게 먼저다.
  // `전용 약 43.8평`, `제2종 근린생활시설`, `업종 협의 가능` 은 아무도 검색하지
  // 않는다. 지역·종류·거래·층·평수대·업종이 실제로 검색되는 말이다.
  const 층 = p.floor ? (p.floor.startsWith('-') ? `지하${p.floor.slice(1)}층` : `${p.floor}층`) : ''
  const 평수대 = sizeBand(p) ?? ''

  const mark = markPair(src)
  const 업종 = p.category === 'industrial' ? null : mark.업종
  const 자리 = mark.자리
  const 설비 = p.category === 'industrial'
    ? [p.ceilingHeight ? `층고 ${p.ceilingHeight}` : null, p.power ? `계약전력 ${p.power}` : null]
      .filter(Boolean)[0] ?? null
    : null

  // 조건도 검색되는 것만 남긴다. `주차 가능` 으로 검색하는 사람은 없다.
  const 검색조건 = [
    p.premium === '없음' ? '무권리' : null,
    p.moveIn === '즉시입주' ? '즉시입주' : null,
  ].filter(Boolean)

  // 거래유형과 종류를 제목마다 달리 적어, 같은 매물이 여러 검색어에 걸리게 한다.
  // (`불당동 상가 월세` 와 `불당동 점포 임대` 는 서로 다른 검색이다.)
  const join = (...xs: Array<string | null>) => xs.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()

  // 가격은 검색어는 아니지만 목록에서 조건을 가늠하게 해 준다. 중개 실무에서
  // 쓰는 `3,000/250` 표기를 그대로 쓴다 — 길게 풀어 쓰면 제목이 넘친다.
  const 만원뺌 = (v?: string) => v?.replace(/\s*만\s*원?/g, '').trim()
  const 가격 = fmtPrice(p) === NEEDS_CHECK ? null
    : p.deposit && p.monthlyRent ? `${만원뺌(p.deposit)}/${만원뺌(p.monthlyRent)}`
      : p.salePrice ? `매매 ${p.salePrice}` : null

  return [
    // ① 업종·상권 — 무엇을 하기 좋은 자리인가
    join(`[${region} ${kind} ${deal}]`, 설비 ?? 자리, 층, 평수대,
      `${업종 ?? `${uses[0]}·${uses[1]}`} 자리`),
    // ② 조건 — 층·평수대에 조건과 가격을 붙인다
    join(`[${region} ${kind} ${deal === '월세' ? '임대' : deal}]`, 층, 평수대,
      검색조건.join(' ') || null, 가격),
    // ③ 다른 이름으로 — 점포/창고 같은 다른 검색어를 잡는다
    join(`[${region} ${KIND_ALT[p.category]} ${deal}]`, 자리 ?? 설비, 층, 평수대,
      `${업종 ?? uses[0]} 추천`, 가격),
  ].map(t => t.replace(/\s+/g, ' ').trim())
}

/**
 * 원문 상세설명에서 이 매물만의 사실을 뽑는다.
 *
 * 스킬은 소개를 매물마다 새로 쓰라고 한다. 그런데 미리 써둔 문장을 매물번호로
 * 골라 쓰면 같은 업종끼리 글이 닮는다. 사장님이 상세설명에 적어 둔 내용이
 * 그 매물만의 근거인데 그걸 안 읽고 있었다.
 *
 * **원문 문장을 그대로 가져오지 않는다.** 정해진 표현으로만 바꿔 담는다.
 * 원문에는 `극대화`, `우수` 같은 부당광고 표현이 섞여 있어 그대로 옮기면
 * 절대규칙 2를 어기고, 없는 사실을 만들어낼 위험도 사라진다.
 */
/**
 * 사장님이 `매물특징` 에 적어 둔 업종. 제목의 ①업종/상권 각도에 쓴다.
 *
 * **원문을 그대로 옮기지 않는다.** 사장님이 쓴 문장에는 `딱 좋은`, `가성비`
 * 같은 표현이 섞여 있어 그대로 제목에 올리면 부당광고가 된다. 정해진 말로만
 * 바꿔 담는다 — 없는 업종을 지어낼 위험도 사라진다.
 *
 * 앞쪽일수록 우선한다. 구체적인 업종을 앞에 둔다.
 */
const PURPOSE_MARKS: Array<[RegExp, string]> = [
  [/휴대폰|핸드폰|통신\s*(사|매장)/, '휴대폰·통신 매장'],
  [/미용실|헤어|펌|살롱/, '미용실'],
  [/네일|속눈썹|왁싱|피부|뷰티|에스테틱|마사지/, '뷰티샵'],
  [/베이커리|제과|디저트|빵집/, '베이커리'],
  [/카페|커피/, '카페'],
  [/고기|곱창|삼겹|횟집|초밥|국밥|한식|중식|일식|분식|치킨|피자|호프|주점|술집/, '음식점'],
  [/식당|음식점|요식/, '음식점'],
  [/학원|교습|스터디|공부방|과외/, '학원'],
  [/헬스|필라테스|요가|피티|PT/, '헬스·필라테스'],
  [/병원|의원|약국|치과|한의원|클리닉/, '병의원'],
  [/편의점|마트|슈퍼/, '판매점'],
  [/애견|반려|펫/, '애견샵'],
  [/스크린|골프/, '스크린골프'],
  [/세탁|빨래방|코인워시/, '세탁소'],
  [/사무실|오피스|사무\s*공간/, '사무실'],
  [/공장|제조|가공|조립/, '제조'],
  [/창고|물류|보관|적재/, '물류·보관'],
]

/** 어디에 있는 자리인가 — 입지 문단에 쓴다. */
const LOCATION_MARKS: Array<[RegExp, string]> = [
  [/대단지|단지\s*앞|아파트\s*앞/, '대단지 앞'],
  [/대형\s*병원|병원\s*배후|의료\s*(단지|시설)/, '병원 배후'],
  [/역세권|지하철|전철|터미널/, '역세권'],
  [/산업\s*단지|산단|공단/, '산업단지 인근'],
  [/학원가|학군|학교\s*앞/, '학원가'],
  [/코너|모퉁이/, '코너'],
  [/전면|도로변|대로변/, '전면 도로변'],
]

/** 매물의 상태·조건 — 입지가 아니므로 입지 문단에는 넣지 않는다. */
const CONDITION_MARKS: Array<[RegExp, string]> = [
  [/무권리|권리금\s*없/, '무권리'],
  [/신축/, '신축'],
  [/인테리어\s*(완비|되어|그대로|포함)/, '인테리어 완비'],
  [/독립|단독\s*(건물|동)|단독동/, '단독 건물'],
]

/** 제목의 '자리' 자리에는 둘 다 쓴다. 위치가 있으면 그것을 먼저 본다. */
const SPOT_MARKS: Array<[RegExp, string]> = [...LOCATION_MARKS, ...CONDITION_MARKS]

/**
 * 사장님이 손으로 적은 구간(`매물특징`·`상세설명`)만 잘라낸다.
 *
 * **문서 끝까지 훑으면 표 라벨에 걸린다.** `핸드폰 번호`(중개업소 연락처 항목)
 * 때문에 공장·창고까지 '휴대폰 매장' 으로 잡힌 적이 있다. 상세설명 뒤에 오는
 * 표 구간에서 끊는다.
 */
function handwrittenBody(src: string): string {
  const m = src.match(/(?:매물특징|상세설명)[\s\S]*/)
  if (!m) return ''
  // 상세설명 다음에 오는 표 항목들. 여기서부터는 사람이 쓴 글이 아니다.
  const end = m[0].search(/\n\s*(매물사진|중개업소|핸드폰\s*번호|입주일|전송\s*정보|중개사\s*메모)/)
  return (end > 0 ? m[0].slice(0, end) : m[0])
    .replace(/[가-힣]*공인중개사.*/g, '')
    .replace(/010-\d{4}-\d{4}/g, '')
    .replace(/.*(문의|상담|촬영|허위|낚시|미끼).*/g, '')
}

/**
 * 사장님이 `매물특징` 에 적은 **한 줄**. 그 매물 하나를 두고 쓴 말이다.
 *
 * 상세설명까지 보면 안 된다. 거기에는 사무소 소개(`천안·아산 상가/사무실 임대
 * 전문`)와 추천 업종 나열이 들어 있어, 208평 1층 상가가 '사무실 자리' 로
 * 잡히는 일이 실제로 있었다.
 */
function ownWords(src: string): string {
  // 사무소 홍보·안내 줄을 걷어낸다. 이 줄들은 매물마다 똑같이 붙어 있어,
  // 그대로 두면 `천안·아산 상가/사무실 임대 전문` 때문에 208평 1층 상가가
  // '사무실 자리' 로, `대표전화 / 핸드폰 번호` 때문에 공장이 '휴대폰 매장' 으로
  // 잡힌다. 걷어내고 남는 것이 그 매물을 두고 쓴 말이다.
  const 홍보 = /공인중개사|플러스불당|중개를\s*더하는|실매물|실사진|허위|낚시|미끼|비공개\s*매물|로컬\s*원주민|임대\s*전문|상가전문|모든\s*조건\s*적극|010-|매물번호\s*알려/
  return handwrittenBody(src)
    .split(String.fromCharCode(10))
    .filter(l => l.trim() && !홍보.test(l))
    .join(String.fromCharCode(10))
}

function featureLine(src: string): string {
  const m = src.match(new RegExp("\n\\s*매물특징[\t ]+([^\n]*)"))
  return m?.[1]?.trim() ?? ''
}

/** 걸리는 것을 전부 뽑는다 (앞선 것부터, 중복 없이). */
function marksIn(marks: Array<[RegExp, string]>, line: string): string[] {
  const out: string[] = []
  for (const [re, phrase] of marks) {
    if (re.test(line) && !out.includes(phrase)) out.push(phrase)
  }
  return out
}

/** 정해진 어휘로만 바꿔 담는다. 없으면 빈 값. */
function markIn(marks: Array<[RegExp, string]>, line: string) {
  for (const [re, phrase] of marks) {
    const m = line.match(re)
    if (m) return { phrase, at: m.index ?? 0, len: m[0].length }
  }
  return null
}

/**
 * 매물특징 한 줄에서 **자리 성격**과 **업종**을 뽑는다.
 *
 * 자리를 먼저 잡고 그 부분을 지운 뒤 업종을 찾는다. 같은 낱말이 둘 다에
 * 걸리기 때문이다 — `대형병원 배후 수요` 는 상권 설명인데, 순서를 안 두면
 * 업종이 '병의원' 으로 잡혀 상가가 병원 자리로 광고된다.
 */
function markPair(src: string): { 자리: string | null; 업종: string | null } {
  const line = ownWords(src)
  if (!line) return { 자리: null, 업종: null }
  const spot = markIn(SPOT_MARKS, line)
  const rest = spot ? line.slice(0, spot.at) + ' ' + line.slice(spot.at + spot.len) : line
  return { 자리: spot?.phrase ?? null, 업종: markIn(PURPOSE_MARKS, rest)?.phrase ?? null }
}

const FEATURE_MARKS: Array<[RegExp, string]> = [
  [/시스템\s*냉난방|시스템\s*에어컨|냉난방기?\s*(완비|설치|구비)/, '시스템 냉난방'],
  [/엘리베이터|승강기/, '엘리베이터'],
  [/(독립|내부|전용)\s*화장실|화장실\s*(별도|내부)/, '내부 화장실'],
  [/공간\s*분할|분할\s*(가능|용이)|구획\s*(가능|용이)|칸막이\s*(가능|용이)/, '내부 구획'],
  [/리모델링|올수리|전체\s*수리/, '수리된 내부'],
  [/테라스|야외\s*(공간|좌석)/, '테라스 공간'],
  [/정화조/, '정화조 용량'],
  [/주방|홀|후드|덕트|급배수/, '주방 설비'],
  [/호이스트|크레인/, '호이스트'],
  [/데크|상하차|도크/, '상하차 공간'],
  [/사무\s*공간|사무실\s*(별도|포함)|내부\s*사무실/, '별도 사무 공간'],
  [/샤워|탈의/, '샤워 시설'],
  [/전기\s*증설|증설\s*가능/, '전기 증설 여지'],
  [/마당|야적|적치/, '마당 공간'],
]

/**
 * @returns 소개 답 문장에 넣을 조각들. 원문에 근거가 있는 것만.
 */
function extractFeatures(source: string): string[] {
  const body = handwrittenBody(source)
  const out: string[] = []
  for (const [re, phrase] of FEATURE_MARKS) {
    if (re.test(body) && !out.includes(phrase)) out.push(phrase)
  }
  return out
}

/**
 * 이 매물을 보는 사람이 실제로 하는 고민.
 *
 * 업종만 보고 고르면 130평 매물에 "권리금 부담" 이야기가 나간다.
 * 스킬이 고민 예시에 `대형평수 = 한 층 통임대 물건 부족` 을 따로 둔 이유다.
 * 상업용 매물은 **크기를 먼저 본다.**
 */
function pickConcern(p: ParsedListing, src: string): string {
  const COMMERCIAL: Category[] = ['retail', 'office', 'food', 'academy', 'beauty', 'large']
  const isBig = (mainAreaM2(p) ?? 0) >= 330            // 약 100평
  const key: Category = isBig && COMMERCIAL.includes(p.category) ? 'large' : p.category
  const pool = CONCERNS[key]
  return pool[hashPick(src, pool.length)]
}

function buildIntro(p: ParsedListing, src: string): string {
  const regionLabel = p.city === '아산시' ? '아산' : '천안'
  const kindWord: Record<Category, string> = {
    office: '사무실', food: '음식점·카페 상가', academy: '학원·교습 상가',
    beauty: '미용업 상가', large: '대형 상가', retail: '상가·점포',
    industrial: '공장·창고',
    residential: '주택', land: '토지',
  }
  const concern = pickConcern(p, src)

  // 첫 줄의 업종 표기도 크기를 반영한다 — 130평인데 '상가·점포 전문'은 어색하다
  const isBig = (mainAreaM2(p) ?? 0) >= 330
  const kindLabel = isBig && ['retail', 'office', 'food', 'academy', 'beauty'].includes(p.category)
    ? '대형 상가·사무실'
    : kindWord[p.category]

  const locArea = [
    p.dong && p.floor ? `${p.dong} ${floorLabel(p.floor)}` : p.dong,
    mainArea(p) ? `${mainArea(p)!.label} 약 ${m2ToPyeong(mainArea(p)!.m2)}평` : null,
  ].filter(Boolean).join(', ')

  // 이 매물만의 근거를 원문에서 먼저 가져온다. 즉시입주·무권리 두 가지만 쓰면
  // 매물이 달라도 같은 문장이 나온다. 셋을 넘기면 한 문장이 길어져 읽히지 않는다.
  // **고민에 답하는 값을 먼저 놓는다.** 창고 고민은 층고·전력·야드인데 답이
  // "조건을 직접 확인해 보실 수 있어" 로 끝나면 짝이 맞지 않는다.
  // 원문에 층고 8m 이 적혀 있는데도 그렇게 나간 적이 있다.
  const answers: string[] = []
  if (isIndustrialCat(p.category)) {
    if (p.ceilingHeight) answers.push(`층고 ${p.ceilingHeight}`)
    if (p.power) answers.push(`계약전력 ${p.power}`)
    if (p.landArea) answers.push(`야드 ${m2ToPyeong(p.landArea)}평`)
  }
  // 야드 평수를 이미 말했으면 '마당 공간' 은 같은 이야기다
  const extra = extractFeatures(src)
    .filter(f => !(f === '마당 공간' && answers.some(a => a.startsWith('야드'))))
  const facts = [...answers, ...extra].slice(0, 3)
  // 조건은 명사구로 모아 쉼표로 잇고, 서술어는 맨 끝에 한 번만 붙인다.
  // 조각마다 '~있고 ~있어' 를 달아 두면 어미가 겹쳐 문장이 무너진다.
  const states: string[] = []
  if (p.premium === '없음') states.push('권리금 부담이 없고')
  if (p.moveIn === '즉시입주') states.push('즉시입주가 가능해')

  // 조건은 '~고' 로 이어 두고 서술어는 맨 끝에 한 번만 온다.
  //   시스템 냉난방, 엘리베이터가 갖춰져 있고 즉시입주가 가능해 …
  // 받침 유무에 따라 '이/가' 가 갈린다. 마지막 조각의 끝 글자로 고른다.
  // 갖추는 물건이 아니라 상태인 것들은 앞에 따로 세운다
  // 조각을 다 붙이면 "열려 있고 갖춰져 있고 없고 가능해" 처럼 늘어진다.
  // 상태형은 하나만 쓰고, 나머지는 아래 명사구 쪽에 맡긴다.
  const parts: string[] = []
  // 신축은 앞에 붙어도 자연스럽지만, '전면이 열려 있고' 는 뒤의 '갖춰져 있고' 와
  // 어미가 겹친다. 명사구가 없을 때만 쓴다.
  if (/신축|준신축/.test(src)) parts.push('신축 건물이라')
  else if (!facts.length && /코너\s*(자리|상가)|양면\s*개방|전면\s*(노출|개방)/.test(src)) {
    parts.push('전면이 도로에 열려 있어')
  }
  if (facts.length) {
    const last = facts[facts.length - 1]
    const code = last.charCodeAt(last.length - 1) - 0xac00
    const hasBatchim = code >= 0 && code <= 11171 && code % 28 !== 0
    parts.push(`${facts.join(', ')}${hasBatchim ? '이' : '가'} 갖춰져 있고`)
  }
  parts.push(...states)

  const extraTxt = parts.length
    // 마지막 조각만 '~어' 로 닫아 뒤 문장과 이어지게 한다
    ? parts.join(' ').replace(/있고$/, '있어')
    : '조건을 직접 확인해 보실 수 있어'

  const answer = locArea
    ? `이번 매물은 ${locArea} 매물로, ${extraTxt} 이런 고민을 덜어드릴 수 있습니다.`
    : `이번 매물은 ${extraTxt} 이런 고민을 함께 풀어볼 수 있는 매물입니다.`

  // '~를 다뤄온' 은 중개사무소 소개로 어색하다. 목적격 조사를 빼고 '업종 + 전문' 으로 잇는다.
  return `안녕하세요. ${regionLabel} ${kindLabel} 전문 플러스불당공인중개사사무소입니다.\n\n${concern}\n\n${answer}`
}

function buildSummary(p: ParsedListing): string {
  const s1 = `${fmtLocation(p)}에 위치한 ${KIND_LABEL[p.category]} 매물입니다.`
  const areaPart = mainArea(p)
    ? `${mainArea(p)!.label} ${mainArea(p)!.m2}㎡(약 ${m2ToPyeong(mainArea(p)!.m2)}평) 규모이며, `
    : ''
  const s2 = `${areaPart}${fmtPrice(p)} 조건입니다.`
  const s3 = `${RECOMMENDED_USES[p.category].split(',').slice(0, 3).join(',')} 등의 업종에 적합합니다.`
  return `${s1} ${s2} ${s3}`
}

/** 13행 법정 순서 기본 정보 (카페=표, 블로그=리스트 공용) */
function infoRows(p: ParsedListing, listingNo: string): Array<[string, string]> {
  return [
    ['매물번호', listingNo],
    ['소재지', fmtLocation(p)],
    ['면적', fmtArea(p)],
    ['가격', fmtPrice(p)],
    ['중개대상물 종류', p.propertyKind ?? NEEDS_CHECK],
    ['거래형태', p.dealType ?? NEEDS_CHECK],
    ['층수', p.floor && p.totalFloors ? `${floorLabel(p.floor)} / 총 ${p.totalFloors}층`
      : p.floor ? floorLabel(p.floor)! : p.totalFloors ? `총 ${p.totalFloors}층` : NEEDS_CHECK],
    ['입주가능일', p.moveIn ?? NEEDS_CHECK],
    ['방수/욕실수', p.bathrooms ? `화장실 ${p.bathrooms}개` : NEEDS_CHECK],
    ['사용승인일', p.approvalDate ?? NEEDS_CHECK],
    // 뱅크 원문은 "총 주차대수 0" 형태라 숫자만 잡힌다 — 표기 형식을 맞춘다
    ['주차대수', parkingLabel(p.parking) ?? NEEDS_CHECK],
    // 금액이면 비목을 덧붙이고, 부과 방식이면 그대로 적는다.
    ['관리비', !p.maintenanceFee ? NEEDS_CHECK
      : /^월\s/.test(p.maintenanceFee) ? `${p.maintenanceFee} (세부 비목 확인 필요)`
        : p.maintenanceFee],
    ['방향', p.direction ? `${p.direction.endsWith('향') ? p.direction : `${p.direction}향`} (주출입구 기준)` : NEEDS_CHECK],
  ]
}

function buildTable(p: ParsedListing, listingNo: string): string {
  return ['| 항목 | 내용 |', '|------|------|', ...infoRows(p, listingNo).map(([k, v]) => `| ${k} | ${v} |`)].join('\n')
}

/** 블로그용 — 네이버 블로그 에디터는 마크다운 표가 안 붙으므로 리스트형 */
function buildInfoList(p: ParsedListing, listingNo: string): string {
  return infoRows(p, listingNo).map(([k, v]) => `■ ${k} : ${v}`).join('\n')
}

/** 블로그용 SEO 제목 — 검색 키워드(지역+업종+거래형태)를 앞에 배치 */
function buildBlogTitles(p: ParsedListing): string[] {
  const region = p.city === '아산시' ? '아산' : '천안'
  const dong = p.dong ? `${p.dong} ` : ''
  const kind = KIND_LABEL[p.category]
  const deal = p.dealType ?? '임대'
  const f = features(p)
  const uses = RECOMMENDED_USES[p.category].split(',').map(s => s.trim())
  const areaTxt = mainArea(p) ? `${mainArea(p)!.label} 약 ${m2ToPyeong(mainArea(p)!.m2)}평` : ''
  return [
    `${region} ${dong}${kind} ${deal} | ${f[0]}${areaTxt ? ` ${areaTxt}` : ''}`,
    `${region} ${dong}${kind} ${deal} 매물 정보 - ${uses[0]}, ${uses[1]} 추천`,
    `${region} ${kind} ${deal} 찾으신다면 | ${dong}${f[0]} 매물`,
  ]
}

/**
 * 세부 특징 4개를 [아이콘, 소제목, 본문] 으로 반환.
 * 카페 HTML 생성기(make_cafe_html.py)가 이 구조를 그대로 받는다.
 * 아이콘은 고정 — 매물 종류가 바뀌어도 같은 자리에 같은 아이콘이 오도록 한다.
 */
function detailSections(p: ParsedListing, src = ''): Array<[string, string, string]> {
  const md = buildDetails(p, src)
  const icons = ['🗺️', '🏗️', '💡', '💰']
  return md.split('\n\n').map((block, i) => {
    const [head, ...rest] = block.split('\n')
    return [icons[i] ?? '📌', head.replace(/\*\*/g, ''), rest.join(' ')] as [string, string, string]
  })
}

function buildDetails(p: ParsedListing, src = ''): string {
  const region = [p.city, p.gu, p.dong].filter(Boolean).join(' ') || '해당 지역'

  // 사장님이 `매물특징` 에 적어 둔 상권 근거를 쓴다. 예전에는 "주변 상권 구성과
  // 배후수요는 업종에 따라 체감이 다르므로…" 라고만 적어 사실상 아무 말도 하지
  // 않았다. 현장을 보고 쓴 근거가 원문에 있는데 그걸 버리고 있었다.
  //
  // 원문 문장을 그대로 옮기지는 않는다. 정해진 말로 바꿔 담는다.
  const spots = marksIn(LOCATION_MARKS, ownWords(src))
  const locBits = [`${region} 생활권에 자리한 매물입니다`]
  if (spots.length) locBits.push(`${spots.join(', ')} 조건을 갖춘 자리입니다`)
  locBits.push('실제 유동 동선과 주변 구성은 현장 안내 시 함께 확인해 드리겠습니다')
  const loc = `**입지**\n${locBits.join('. ')}.`

  const buildBits: string[] = []
  if (p.floor && p.totalFloors) buildBits.push(`총 ${p.totalFloors}층 건물의 ${floorLabel(p.floor)}에 자리하고 있습니다`)
  else if (p.floor) buildBits.push(`${floorLabel(p.floor)}에 자리하고 있습니다`)
  if (mainArea(p)) buildBits.push(`${mainArea(p)!.label} ${mainArea(p)!.m2}㎡(약 ${m2ToPyeong(mainArea(p)!.m2)}평)로 용도에 맞게 구획해 사용하실 수 있습니다`)
  if (p.elevator) buildBits.push('엘리베이터가 있어 층간 이동이 편리합니다')
  // 주차 0대를 본문에서 굳이 안내하지 않는다. 표시광고 필수 항목이라 표에는 사실대로 적히고,
  // 세부 설명은 매물의 장점을 설명하는 자리다. 없는 것을 문장으로 강조할 이유가 없다.
  if (hasParking(p)) buildBits.push(`주차는 ${parkingLabel(p.parking)} 가능합니다`)
  const building = `**건물 및 공간 구성**\n${buildBits.length ? buildBits.join('. ') + '.' : '건물 구성과 내부 상태는 현장에서 직접 확인하실 수 있도록 안내드리겠습니다.'}`

  // 사장님이 `음식점 추천` 처럼 적어 두었으면 그것을 앞세운다. 종류에서 뽑은
  // 기본 목록만 쓰면 상가는 전부 '소매점, 사무실, 학원…' 으로 똑같아진다.
  const 적힌업종 = p.category === 'industrial' ? null : markPair(src).업종
  const usesHead = 적힌업종
    ? `${적힌업종} 자리를 보고 계신 분께 특히 맞고, ${RECOMMENDED_USES[p.category]}`
    : RECOMMENDED_USES[p.category]
  const uses = `**추천 업종**\n${usesHead} 등을 검토해 보실 수 있습니다. 건축물 용도에 따른 인허가 가능 여부는 업종별로 함께 확인해 드립니다.`

  const condBits: string[] = []
  condBits.push(p.premium === '없음'
    ? '권리금이 없어 초기 부담을 줄일 수 있습니다'
    : p.premium ? `권리금은 ${p.premium} 조건입니다` : '권리금 조건은 확인 후 안내드리겠습니다')
  if (p.moveIn) condBits.push(`입주는 ${p.moveIn === '협의' ? '일정 협의가 가능' : p.moveIn} 조건입니다`)
  condBits.push('세부 임대 조건은 협의 범위가 있으니 편하게 문의해 주세요')
  const cond = `**${p.dealType === '매매' ? '인수 조건' : '임대 조건'}**\n${condBits.join('. ')}.`

  return [loc, building, uses, cond].join('\n\n')
}

/** Q&A 3개를 [질문, 답변] 쌍으로 반환 (HTML 생성기용). */
function qnaPairs(p: ParsedListing): Array<[string, string]> {
  return buildQnA(p).split('\n\n').map(block => {
    const [q, a] = block.split('\n')
    return [q.replace(/^\*\*Q\.\s*/, '').replace(/\*\*$/, ''), a.replace(/^A\.\s*/, '')] as [string, string]
  })
}

function buildQnA(p: ParsedListing): string {
  const pool: Array<[string, string]> = []
  if (!p.maintenanceFee) pool.push(['관리비는 얼마나 나오나요?', '관리비는 건물 관리규약에 따라 부과되어 정확한 금액과 포함 항목을 확인 후 안내드리겠습니다. 문의 주시면 바로 확인해 드립니다.'])
  if (p.premium === '유선 문의') pool.push(['권리금은 어떻게 되나요?', '권리금은 유선으로 문의 주시면 조건을 안내드리겠습니다. 협의 범위도 함께 설명드립니다.'])
  if (p.premium === '없음') pool.push(['정말 권리금이 없나요?', '네, 무권리 매물입니다. 초기 비용은 보증금과 시설 공사 범위 위주로 계획하시면 됩니다.'])
  if (hasParking(p)) pool.push(['주차는 충분한가요?', `${parkingLabel(p.parking)} 주차가 가능합니다. 이용 방식(지정/공용)은 현장에서 함께 확인해 드립니다.`])
  if ((mainAreaM2(p) ?? 0) >= 330) pool.push(['일부만 임대도 가능한가요?', '분할 임대 가능 여부는 임대인과 협의가 필요한 부분입니다. 원하시는 면적을 말씀해 주시면 협의해 보겠습니다.'])
  if (p.moveIn === '즉시입주') pool.push(['입주는 언제부터 가능한가요?', '즉시입주 가능한 매물입니다. 계약 일정에 맞춰 바로 사용하실 수 있습니다.'])
  pool.push(['현장은 언제 볼 수 있나요?', '연락 주시면 일정을 맞춰 현장 안내드리겠습니다. 방문 전 원하시는 조건을 말씀해 주시면 비교 매물도 함께 준비해 드립니다.'])
  pool.push(['계약 시 확인해야 할 사항이 있나요?', '등기사항과 건축물대장 등 공부 서류는 계약 전에 함께 확인해 드립니다. 궁금하신 부분은 편하게 문의해 주세요.'])

  return pool.slice(0, 3).map(([q, a]) => `**Q. ${q}**\nA. ${a}`).join('\n\n')
}

function buildBrokerInfo(p: ParsedListing): string {
  const first = `현장을 직접 확인한 실매물만 소개해 드리며, 광고되지 않은 매물도 함께 비교해 보실 수 있도록 준비해 드립니다.${p.coBrokerage ? ' 공동중개도 환영합니다.' : ''}`
  return [
    first,
    '',
    '**■ 명칭** : 플러스불당공인중개사사무소',
    '**■ 소재지** : 충청남도 천안시 서북구 불당23로 73-27 502호 (불당동 1491)',
    '**■ 연락처** : 010-5585-8943',
    '**■ 등록번호** : 제44133-2024-00142호',
    '**■ 성명** : 김용유',
    '**■ 네이버지도** : https://map.naver.com/p/entry/place/1153579977',
  ].join('\n')
}

function buildTags(p: ParsedListing): string {
  const region = p.city === '아산시' ? '아산' : '천안'
  const deal = p.dealType === '매매' ? '매매' : p.dealType === '전세' ? '전세' : '월세'
  const tags = new Set<string>()

  // 검색어의 뼈대가 되는 물건 유형. 공장·창고 매물에 '상가' 태그를 달면 검색이 어긋난다.
  const noun = p.category === 'industrial' ? '공장' : p.category === 'office' ? '사무실' : '상가'

  // 지역
  tags.add(`#${region}${noun}임대`)
  tags.add(`#${region}${noun}${deal}`)
  if (p.dong) { tags.add(`#${p.dong}${noun}${deal}`); tags.add(`#${p.dong}${noun}임대`) }
  if (p.gu) tags.add(`#${region}${p.gu}${noun}`)
  tags.add(`#${region}${noun}`)

  // 업종
  const jobTags: Record<Category, string[]> = {
    office: [`#${region}사무실임대`, `#${region}사무실${deal}`, `#${region}소형사무실`],
    food: [`#${region}음식점자리`, `#${region}카페자리`, `#${region}식당임대`],
    academy: [`#${region}학원임대`, `#${region}학원자리`, `#${region}교습소자리`],
    beauty: [`#${region}미용실자리`, `#${region}네일샵자리`, `#${region}상가임대`],
    large: [`#${region}대형상가`, `#${region}통임대`, `#${region}대형사무실`],
    industrial: [`#${region}공장`, `#${region}창고`, `#${region}공장임대`, `#${region}창고임대`, `#${region}물류창고`],
    residential: [`#${region}주택`, `#${region}단독주택`, `#${region}다가구`, `#${region}주택매매`],
    land: [`#${region}토지`, `#${region}땅`, `#${region}토지매매`, `#${region}임야`],
    retail: [`#${region}점포임대`, `#${region}소매점자리`, `#${region}사무실임대`],
  }
  jobTags[p.category].forEach(t => tags.add(t))

  // 특성
  if (p.premium === '없음') tags.add(`#${region}무권리${noun}`)
  if (p.moveIn === '즉시입주') tags.add(`#${region}즉시입주${noun}`)
  if (hasParking(p)) tags.add(`#${region}주차가능${noun}`)
  if (p.floor === '1') tags.add(`#${region}1층${noun}`)
  if (p.elevator) tags.add(`#${region}엘리베이터${noun}`)

  // 브랜드 고정
  ;['#플러스불당공인중개사', '#불당동상가전문', '#천안상가전문부동산', '#천안시상가매물', '#천안시상가추천']
    .forEach(t => tags.add(t))

  // 채우기용 일반 태그
  const filler = p.category === 'industrial'
    ? [`#${region}부동산`, `#${region}공장매물`, `#${region}창고매물`, `#${region}공장추천`,
       `#${region}물류`, `#${region}제조업`, `#충남공장`, `#충남창고`, `#${region}산업단지`, `#${region}공장정보`]
    : [`#${region}부동산`, `#${region}상권`, `#${region}창업`, `#${region}${noun}추천`, `#${region}임대`,
       `#${region}${noun}매물`, `#${region}점포`, `#충남상가`, `#${region}창업자리`, `#${region}${noun}정보`]
  filler.forEach(t => { if (tags.size < 25) tags.add(t) })

  return Array.from(tags).join(' ')
}

function buildReport(p: ParsedListing, src: string, listingNo: string): string | null {
  const issues: string[] = []

  const missing: string[] = []
  if (fmtLocation(p) === NEEDS_CHECK) missing.push('소재지')
  if (!mainArea(p)) missing.push('면적')
  if (fmtPrice(p) === NEEDS_CHECK) missing.push('가격')
  if (!p.propertyKind) missing.push('중개대상물 종류')
  if (!p.approvalDate) missing.push('사용승인일')
  if (!p.parking) missing.push('주차대수')
  if (!p.direction) missing.push('방향')
  if (missing.length) issues.push(`원문에서 **${missing.join(', ')}** 항목을 찾지 못해 "확인 필요"로 표기했습니다. 게시 전 채워 주세요.`)

  if (!listingNo || listingNo === 'XXXXXXXXXX') issues.push('매물번호가 입력되지 않아 `XXXXXXXXXX`로 표기했습니다. 게시 전 10자리 번호로 교체해 주세요.')

  if (p.exclusiveArea && p.supplyArea && p.exclusiveArea === p.supplyArea) {
    issues.push('공급면적과 전용면적이 동일합니다. 다층 건물에서는 이례적이므로 원문 수치를 확인해 주세요.')
  }
  if (p.maintenanceFeeAmount && p.maintenanceFeeAmount > 100000 && p.maintenanceFee && !/포함|비목|수도|전기|청소|승강기/.test(p.maintenanceFee)) {
    issues.push('관리비가 10만원을 초과하는데 세부 비목이 없습니다. 포함 항목(청소비·승강기 유지비 등)을 확인해 주세요.')
  }

  const banned = findBanned(src)
  if (banned.length) {
    issues.push(`원문에 ${banned.join(', ')} 표현이 있습니다. 영업 실적을 단정하는 말이라 `
      + '뱅크 원문에서 손보시는 편이 안전합니다. (이 글에는 옮기지 않았습니다)')
  }

  if (!issues.length) return null
  return `---\n\n📋 **점검 보고**\n${issues.map(i => `- ${i}`).join('\n')}`
}

/**
 * 광고에 "확인 필요" 로 나가면 안 되는 항목 중 빠진 것.
 *
 * 점검 보고에는 사용승인일·주차대수·방향까지 함께 적지만, 그건 비어 있어도
 * 광고가 성립한다. 여기 넷은 다르다 — 무엇을 얼마에 어디서 파는지가 없는
 * 광고가 되어 버린다.
 */
function missingRequired(p: ParsedListing): string[] {
  const out: string[] = []
  if (fmtLocation(p) === NEEDS_CHECK) out.push('소재지')
  if (!mainArea(p)) out.push('면적')
  if (fmtPrice(p) === NEEDS_CHECK) out.push('가격')
  if (!p.propertyKind) out.push('중개대상물 종류')
  return out
}

// ── 진입점 ────────────────────────────────────────────

export type PostFormat = 'cafe' | 'blog'

export function generateCafePost(
  source: string,
  listingNoInput: string,
  format: PostFormat = 'cafe',
): string {
  const p = parseListing(source)
  const listingNo = listingNoInput.replace(/[^0-9]/g, '') || 'XXXXXXXXXX'

  const titles = format === 'blog' ? buildBlogTitles(p) : buildTitles(p, source)
  const infoSection = format === 'blog' ? buildInfoList(p, listingNo) : buildTable(p, listingNo)

  const sections = [
    `🏷️ **추천 제목**\n${titles.map((t, i) => `${i + 1}. ${t}`).join('\n')}`,
    `👋 **소개**\n\n${buildIntro(p, source)}`,
    `📍 **매물 요약**\n\n${buildSummary(p)}`,
    `🏢 **매물 기본 정보**\n\n${infoSection}`,
    `✨ **매물 세부 특징 설명**\n\n${buildDetails(p, source)}`,
    `💬 **자주 묻는 질문**\n\n${buildQnA(p)}`,
    `📞 **중개사 정보**\n\n${buildBrokerInfo(p)}`,
    `📌 **특장점 한 줄 요약**\n\n→ ${features(p).slice(0, 3).join(' + ')}`,
    `🏷️ **태그**\n\n${buildTags(p)}`,
    `📋 매물번호: ${listingNo}`,
  ]

  const report = buildReport(p, source, listingNo)
  return sections.join('\n\n\n') + (report ? `\n\n\n${report}` : '')
}

// ── 카페 HTML 생성기 연동 ─────────────────────────────

/**
 * make_cafe_html.py 가 받는 config 구조.
 * 스킬(naver-cafe-listing)의 post_config.json 스키마와 1:1 대응한다.
 */
export interface CafeHtmlConfig {
  no: string
  out_dir: string
  /** 매물 분류. 카페 게시판의 말머리(상가/사무실/공장 창고…) 선택에 쓴다. */
  category: Category
  titles: string[]
  intro: string[]
  summary: string
  rows: Array<[string, string]>
  features: Array<[string, string, string]>
  qa: Array<[string, string]>
  report: string[]
  /**
   * 이대로 올리면 광고에 "확인 필요" 로 나가는 **표시광고법 핵심 항목**.
   * 하나라도 있으면 올리지 않는다 — 소재지·면적·가격·중개대상물 종류는
   * 인터넷 표시광고 필수 명시사항이라, 비워 둔 채 게시하면 위반이다.
   */
  missing_required: string[]
  office_lead: string
  highlight: string
  tags: string
}

/**
 * 매물 원문 → 카페 HTML 생성기용 config.
 *
 * 마크다운 문자열(generateCafePost)과 같은 문구 규칙을 쓰되, 섹션을 구조화해서 돌려준다.
 * 카페 에디터가 마크다운 표를 렌더링하지 않아 HTML `<table>` 로 내야 하므로,
 * 실제 발행에는 이 config → make_cafe_html.py 경로를 쓴다.
 */
/**
 * @param listingNoInput 뱅크 매물번호. 파일명·색 배정에 쓴다
 * @param displayNo      글에 적을 번호. **고객이 아는 것은 네이버부동산 번호다.**
 *                       뱅크 번호는 사장님이 뱅크에서 쓰는 내부 번호라 고객은 모른다.
 *                       주지 않으면 뱅크 번호를 그대로 쓴다.
 */
export function buildCafeHtmlConfig(
  source: string,
  listingNoInput: string,
  outDir = '.',
  displayNo?: string,
): CafeHtmlConfig {
  const p = parseListing(source)
  const no = listingNoInput.replace(/[^0-9]/g, '') || 'XXXXXXXXXX'
  // 글에 적는 번호는 고객이 아는 네이버부동산 번호. 파일명·색은 no(뱅크)로 고정한다.
  const shownNo = (displayNo ?? '').replace(/[^0-9]/g, '') || no

  const report = buildReport(p, source, shownNo)
  const reportItems = report
    ? report.split('\n').filter(l => l.startsWith('- ')).map(l => l.slice(2).replace(/\*\*/g, ''))
    : []

  return {
    no,
    out_dir: outDir,
    category: p.category,
    titles: buildTitles(p, source),
    intro: buildIntro(p, source).split('\n\n').filter(Boolean),
    summary: buildSummary(p),
    rows: infoRows(p, shownNo),   // 표에 적히는 번호는 고객이 아는 것
    features: detailSections(p, source),
    qa: qnaPairs(p),
    report: reportItems,
    missing_required: missingRequired(p),
    office_lead: `현장을 직접 확인한 실매물만 소개해 드리며, 광고되지 않은 매물도 함께 비교해 보실 수 있도록 준비해 드립니다.${p.coBrokerage ? ' 공동중개도 환영합니다.' : ''}`,
    highlight: features(p).slice(0, 3).join(' + '),
    tags: buildTags(p),
  }
}

/**
 * 썸네일 생성기(make_cafe_thumb.py)용 config.
 * 값은 전부 매물 기본 정보에서 그대로 가져온다 — 표에 없는 내용을 지어내지 않는다.
 */
export interface CafeThumbConfig {
  no: string                // 뱅크 매물번호 — 파일명과 색 배정에 쓴다
  display_no: string        // 썸네일에 적을 번호 — 고객이 아는 네이버부동산 번호
  out_dir: string
  region_badge: string
  headline: string[]
  price_lines: string[]
  office: string
  phone: string
}

export function buildCafeThumbConfig(
  source: string,
  listingNoInput: string,
  outDir = '.',
  displayNo?: string,
): CafeThumbConfig {
  const p = parseListing(source)
  // 파일명과 색 배정은 뱅크 번호로 고정한다. 표시만 고객이 아는 번호로 바꾼다.
  const no = listingNoInput.replace(/[^0-9]/g, '') || 'XXXXXXXXXX'
  const shownNo = (displayNo ?? '').replace(/[^0-9]/g, '') || no

  // 지역 배지: 충청남도 제거, 천안시→천안, 아산시→아산, 최대 3어절
  const region = [p.city, p.gu, p.dong].filter(Boolean).join(' ')
    .replace(/충청남도\s*/, '').replace(/천안시/, '천안').replace(/아산시/, '아산')
    .split(/\s+/).slice(0, 3).join(' ') || '천안'

  // 헤드라인: 층 + 종류 + 거래형태 / 면적
  const kind = KIND_LABEL[p.category]
  const floorPart = p.floor && /^\d+$/.test(p.floor) ? `${p.floor}층 ` : ''
  const head1 = `${floorPart}${kind} ${p.dealType ?? '임대'}`.trim()
  const head2 = mainArea(p)
    ? `${mainArea(p)!.label} ${mainArea(p)!.m2}㎡ · ${m2ToPyeong(mainArea(p)!.m2)}평`
    : p.supplyArea ? `공급 ${p.supplyArea}㎡ · ${m2ToPyeong(p.supplyArea)}평` : ''

  // 가격: 괄호 부연·단서(부가세 별도 등)는 썸네일에서 제외
  const strip = (s: string) => s.replace(/\([^)]*\)/g, '').trim()
  const priceLines = fmtPrice(p) === NEEDS_CHECK
    ? ['가격 협의']
    : fmtPrice(p).split(' / ').map(strip).filter(Boolean).slice(0, 3)

  return {
    no,
    display_no: shownNo,
    out_dir: outDir,
    region_badge: region,
    headline: [head1, head2].filter(Boolean),
    price_lines: priceLines,
    office: '플러스불당 공인중개사사무소',
    phone: '010-5585-8943',
  }
}

/**
 * 자기 글에 남길 댓글 후보 3개.
 *
 * 카페 매물 글은 댓글이 붙어 있어야 노출·신뢰에 유리하다. 매물 조건을 반영해
 * 서로 다른 각도로 만들고, 발행 시 그중 하나를 골라 쓴다.
 *
 * 본문과 같은 규칙을 지킨다 — 매출·최상급 표현 금지, 없는 조건 단정 금지.
 * 연락처는 중개사 정보에 이미 있으므로 댓글에서는 반복하지 않는다.
 */
export function buildComments(source: string): string[] {
  const p = parseListing(source)
  const kind = KIND_LABEL[p.category]
  const region = p.dong ?? p.city ?? '해당 지역'
  const uses = RECOMMENDED_USES[p.category].split(',').map(s => s.trim())

  const out: string[] = []

  // ① 조건 안내 — 매물의 실제 조건에서 하나를 집는다
  if (p.moveIn === '즉시입주') {
    out.push('즉시입주 가능한 매물이라 일정 조율이 수월합니다. 현장 확인 원하시면 편하게 문의 주세요.')
  } else if (hasParking(p)) {
    out.push(`${parkingLabel(p.parking)} 주차가 가능합니다. 현장에서 진입 동선까지 함께 확인해 드리겠습니다.`)
  } else {
    out.push('현장 확인 원하시면 일정 맞춰 안내해 드리겠습니다. 편하게 문의 주세요.')
  }

  // ② 비교 매물 제안
  out.push(`${region} 일대 비슷한 조건의 ${kind} 매물도 함께 비교해 보실 수 있습니다. 원하시는 조건 말씀해 주시면 정리해 드리겠습니다.`)

  // ③ 업종 인허가 — 상가·공장은 용도 확인이 실제로 자주 걸리는 부분이다
  out.push(p.category === 'industrial'
    ? `${uses[0]}·${uses[1]} 용도로 검토 중이시면 인허가 가능 여부부터 함께 확인해 드리겠습니다.`
    : `${uses[0]}·${uses[1]} 등 생각하고 계신 업종이 있으시면 인허가 가능 여부를 먼저 확인해 드리겠습니다.`)

  return out
}
