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
  category: Category
}

export type Category = 'office' | 'food' | 'academy' | 'beauty' | 'large' | 'retail'

const NEEDS_CHECK = '확인 필요'

/** 라벨 뒤의 값을 뽑는다. `소재지 : 값`, `소재지: 값`, `소재지 값`, 탭 구분 모두 허용 */
function field(src: string, labels: string[]): string | undefined {
  for (const label of labels) {
    const re = new RegExp(`${label}\\s*[:：|]?\\s*([^\\n\\r|]+)`)
    const m = src.match(re)
    if (m) {
      const v = m[1].trim()
      if (v && v !== '-' && !/^-\s/.test(v)) return v
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
  return Number.isFinite(n) && n > 0 ? n : undefined
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
function detectCategory(src: string, exclusiveArea?: number): Category {
  if (exclusiveArea && exclusiveArea >= 330) return 'large' // 약 100평 이상
  if (/사무실|사무소|오피스/.test(src)) return 'office'
  if (/음식점|식당|카페|주방|요식|덕트|홀\b/.test(src)) return 'food'
  if (/학원|교습|스터디/.test(src)) return 'academy'
  if (/미용|네일|피부|헤어|뷰티/.test(src)) return 'beauty'
  return 'retail'
}

export function parseListing(source: string): ParsedListing {
  const src = source.replace(/ /g, ' ')

  const addressRaw = field(src, ['소재지', '소재\\s*지역', '주소', '위치'])
  const addr = parseAddress(addressRaw ?? src)

  // 면적 — 전용/공급 라벨 우선, 없으면 "계약/전용" 순서쌍 추정
  const exclusiveArea = areaNumber(field(src, ['전용면적', '전용']))
  const supplyArea = areaNumber(field(src, ['공급면적', '계약면적', '분양면적', '공급']))

  // 층수 — "지하층/지상층 1 / 6" 형식은 실제로 해당층/총층
  let floor: string | undefined
  let totalFloors: string | undefined
  const floorPair =
    src.match(/(?:지하층\s*\/\s*지상층|해당층\s*\/\s*총층|층수)\s*[:：]?\s*(B?\d+)\s*(?:층)?\s*\/\s*(?:총\s*)?(\d+)\s*(?:층)?/) ??
    src.match(/(B?\d+)\s*층\s*\/\s*(?:총\s*)?(\d+)\s*층/)
  if (floorPair) {
    floor = floorPair[1]
    totalFloors = floorPair[2]
  } else {
    floor = field(src, ['해당층'])?.match(/B?\d+/)?.[0]
    totalFloors = field(src, ['총층수', '총층'])?.match(/\d+/)?.[0]
  }

  // 거래형태·가격
  let dealType: ParsedListing['dealType']
  const dealField = field(src, ['거래형태', '거래유형', '거래구분'])
  if (dealField) {
    if (dealField.includes('매매')) dealType = '매매'
    else if (dealField.includes('전세')) dealType = '전세'
    else if (dealField.includes('월세') || dealField.includes('임대')) dealType = '월세'
  }
  let deposit = field(src, ['보증금'])?.match(/[\d,.억만원\s]+/)?.[0]?.trim()
  let monthlyRent = field(src, ['월세', '월\\s*임대료', '차임'])?.match(/[\d,.억만원\s]+/)?.[0]?.trim()
  let salePrice = field(src, ['매매가', '매매금액', '전세가', '전세금'])?.match(/[\d,.억만원\s]+/)?.[0]?.trim()
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

  // 관리비 — 금액이 있으면 금액만 뽑아서 유지, 금액 없이 "관리규약에 따라 부과" 등이면 확인 필요
  const maintenanceFeeRaw = field(src, ['관리비'])
  const maintenanceFeeAmount = feeToWon(maintenanceFeeRaw)
  let maintenanceFee: string | undefined
  if (maintenanceFeeRaw) {
    if (maintenanceFeeAmount) {
      const m = maintenanceFeeRaw.match(/[\d,.]+\s*만\s*원?|[\d,]{4,}\s*원/)
      maintenanceFee = m ? `월 ${m[0].replace(/\s/g, '').replace(/만$/, '만원')}` : maintenanceFeeRaw
    } else if (!/관리규약|별도\s*문의|부과/.test(maintenanceFeeRaw)) {
      maintenanceFee = maintenanceFeeRaw
    }
  }

  const premiumRaw = field(src, ['권리금'])
  let premium: string | undefined
  if (premiumRaw) {
    if (/무권리|없/.test(premiumRaw)) premium = '없음'
    else if (/문의|협의/.test(premiumRaw)) premium = '유선 문의'
    else premium = premiumRaw
  } else if (/무권리/.test(src)) {
    premium = '없음'
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
    propertyKind: field(src, ['중개대상물\\s*종류', '건축물\\s*용도', '용도', '매물종류', '건물용도']),
    moveIn,
    bathrooms: field(src, ['화장실', '욕실'])?.match(/\d+/)?.[0],
    approvalDate: field(src, ['사용승인일', '준공년월', '준공연도', '준공일', '사용승인'])?.match(/[\d.\-년월\s]+/)?.[0]?.trim(),
    parking: field(src, ['주차대수', '주차'])?.trim(),
    maintenanceFee,
    maintenanceFeeAmount,
    direction: field(src, ['방향', '향'])?.match(/[가-힣]*[동서남북]향?/)?.[0],
    premium,
    coBrokerage: /공동\s*중개\s*환영|공동\s*환영/.test(src),
    elevator: /엘리베이터|승강기|E\/?V/.test(src),
    category: detectCategory(src, exclusiveArea),
  }
}

// ── 부당광고 표현 점검 ─────────────────────────────────

const BANNED_PATTERNS: Array<[RegExp, string]> = [
  [/성업\s*중/, '성업 중'],
  [/잘\s*되는\s*자리/, '잘 되는 자리'],
  [/검증된?\s*매출/, '검증된 매출'],
  [/매출\s*보장/, '매출 보장'],
  [/최고|최적지|파격|극대화/, '근거 없는 최상급 표현'],
  [/도보\s*\d+\s*분|역세권\s*\d+\s*분/, '측정 근거 없는 거리·시간 표현'],
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
  retail: '소매점, 사무실, 학원, 서비스업 매장, 쇼룸',
}

function fmtArea(p: ParsedListing): string {
  const ex = p.exclusiveArea ? `전용 ${p.exclusiveArea}㎡ (약 ${m2ToPyeong(p.exclusiveArea)}평)` : null
  const su = p.supplyArea ? `공급 ${p.supplyArea}㎡ (약 ${m2ToPyeong(p.supplyArea)}평)` : null
  if (ex && su) return `${ex} / ${su}`
  return ex ?? su ?? NEEDS_CHECK
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
  const fl = p.floor ? ` (${p.floor}층)` : ''
  return base === NEEDS_CHECK ? base : `${base}${fl}`
}

/** 특장점 후보 수집 (제목·한줄요약·태그에서 공용) */
function features(p: ParsedListing): string[] {
  const out: string[] = []
  if (p.premium === '없음') out.push('무권리')
  if (p.moveIn === '즉시입주') out.push('즉시입주 가능')
  if (p.parking) out.push('주차 가능')
  if (p.elevator) out.push('엘리베이터')
  if (p.floor === '1') out.push('1층 매물')
  if (p.exclusiveArea && p.exclusiveArea >= 330) out.push('대형 평수')
  if (p.coBrokerage) out.push('공동중개 환영')
  if (out.length < 3 && p.exclusiveArea) out.push(`전용 약 ${m2ToPyeong(p.exclusiveArea)}평`)
  if (out.length < 3 && p.dong) out.push(`${p.dong} 상권`)
  if (out.length < 3) out.push('현장 확인 실매물')
  return out
}

function buildTitles(p: ParsedListing): string[] {
  const region = p.dong ?? p.city ?? '천안'
  const kind = KIND_LABEL[p.category]
  const deal = p.dealType ?? '임대'
  const f = features(p)
  const uses = RECOMMENDED_USES[p.category].split(',').map(s => s.trim())
  const areaTxt = p.exclusiveArea ? `전용 약 ${m2ToPyeong(p.exclusiveArea)}평` : '면적 확인'
  return [
    `[${region} ${kind} ${deal}] ${f[0]}${f[1] ? ` · ${f[1]}` : ''}`,
    `[${region} ${kind} ${deal}] ${areaTxt}, ${uses[0]} 등 추천`,
    `[${p.city ?? '천안시'} ${kind} ${deal}] ${uses[1]}·${uses[2]} 추천 자리`,
  ]
}

function buildIntro(p: ParsedListing, src: string): string {
  const regionLabel = p.city === '아산시' ? '아산' : '천안'
  const kindWord: Record<Category, string> = {
    office: '사무실', food: '음식점·카페 상가', academy: '학원·교습 상가',
    beauty: '미용업 상가', large: '대형 상가', retail: '상가·점포',
  }
  const concern = CONCERNS[p.category][hashPick(src, CONCERNS[p.category].length)]

  const locArea = [
    p.dong && p.floor ? `${p.dong} ${p.floor}층` : p.dong,
    p.exclusiveArea ? `전용 약 ${m2ToPyeong(p.exclusiveArea)}평` : null,
  ].filter(Boolean).join(', ')

  const extras: string[] = []
  if (p.premium === '없음') extras.push('권리금 부담이 없고')
  if (p.moveIn === '즉시입주') extras.push('즉시입주가 가능해')
  const extraTxt = extras.length ? extras.join(' ') : '조건을 직접 확인해 보실 수 있어'

  const answer = locArea
    ? `이번 매물은 ${locArea} 매물로, ${extraTxt} 이런 고민을 덜어드릴 수 있습니다.`
    : `이번 매물은 ${extraTxt} 이런 고민을 함께 풀어볼 수 있는 매물입니다.`

  return `안녕하세요. ${regionLabel} ${kindWord[p.category]} 임대·매매를 다뤄온 플러스불당공인중개사사무소입니다.\n\n${concern}\n\n${answer}`
}

function buildSummary(p: ParsedListing): string {
  const s1 = `${fmtLocation(p)}에 위치한 ${KIND_LABEL[p.category]} 매물입니다.`
  const areaPart = p.exclusiveArea
    ? `전용 ${p.exclusiveArea}㎡(약 ${m2ToPyeong(p.exclusiveArea)}평) 규모이며, `
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
    ['층수', p.floor && p.totalFloors ? `${p.floor}층 / 총 ${p.totalFloors}층` : p.floor ? `${p.floor}층` : NEEDS_CHECK],
    ['입주가능일', p.moveIn ?? NEEDS_CHECK],
    ['방수/욕실수', p.bathrooms ? `화장실 ${p.bathrooms}개` : NEEDS_CHECK],
    ['사용승인일', p.approvalDate ?? NEEDS_CHECK],
    ['주차대수', p.parking ?? NEEDS_CHECK],
    ['관리비', p.maintenanceFee ? `${p.maintenanceFee} (세부 비목 확인 필요)` : NEEDS_CHECK],
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
  const areaTxt = p.exclusiveArea ? `전용 약 ${m2ToPyeong(p.exclusiveArea)}평` : ''
  return [
    `${region} ${dong}${kind} ${deal} | ${f[0]}${areaTxt ? ` ${areaTxt}` : ''}`,
    `${region} ${dong}${kind} ${deal} 매물 정보 - ${uses[0]}, ${uses[1]} 추천`,
    `${region} ${kind} ${deal} 찾으신다면 | ${dong}${f[0]} 매물`,
  ]
}

function buildDetails(p: ParsedListing): string {
  const region = [p.city, p.gu, p.dong].filter(Boolean).join(' ') || '해당 지역'

  const loc = `**입지**\n${region} 생활권에 위치한 매물입니다. 주변 상권 구성과 배후수요는 업종에 따라 체감이 다르므로, 현장 안내 시 실제 유동 동선과 함께 상세히 설명드리겠습니다.`

  const buildBits: string[] = []
  if (p.floor && p.totalFloors) buildBits.push(`총 ${p.totalFloors}층 건물의 ${p.floor}층에 자리하고 있습니다`)
  else if (p.floor) buildBits.push(`${p.floor}층에 자리하고 있습니다`)
  if (p.exclusiveArea) buildBits.push(`전용 ${p.exclusiveArea}㎡(약 ${m2ToPyeong(p.exclusiveArea)}평)로 용도에 맞게 구획해 사용하실 수 있습니다`)
  if (p.elevator) buildBits.push('엘리베이터가 있어 층간 이동이 편리합니다')
  if (p.parking) buildBits.push(`주차는 ${p.parking} 조건입니다`)
  const building = `**건물 및 공간 구성**\n${buildBits.length ? buildBits.join('. ') + '.' : '건물 구성과 내부 상태는 현장에서 직접 확인하실 수 있도록 안내드리겠습니다.'}`

  const uses = `**추천 업종**\n${RECOMMENDED_USES[p.category]} 등을 검토해 보실 수 있습니다. 건축물 용도에 따른 인허가 가능 여부는 업종별로 함께 확인해 드립니다.`

  const condBits: string[] = []
  condBits.push(p.premium === '없음'
    ? '권리금이 없어 초기 부담을 줄일 수 있습니다'
    : p.premium ? `권리금은 ${p.premium} 조건입니다` : '권리금 조건은 확인 후 안내드리겠습니다')
  if (p.moveIn) condBits.push(`입주는 ${p.moveIn === '협의' ? '일정 협의가 가능' : p.moveIn} 조건입니다`)
  condBits.push('세부 임대 조건은 협의 범위가 있으니 편하게 문의해 주세요')
  const cond = `**${p.dealType === '매매' ? '인수 조건' : '임대 조건'}**\n${condBits.join('. ')}.`

  return [loc, building, uses, cond].join('\n\n')
}

function buildQnA(p: ParsedListing): string {
  const pool: Array<[string, string]> = []
  if (!p.maintenanceFee) pool.push(['관리비는 얼마나 나오나요?', '관리비는 건물 관리규약에 따라 부과되어 정확한 금액과 포함 항목을 확인 후 안내드리겠습니다. 문의 주시면 바로 확인해 드립니다.'])
  if (p.premium === '유선 문의') pool.push(['권리금은 어떻게 되나요?', '권리금은 유선으로 문의 주시면 조건을 안내드리겠습니다. 협의 범위도 함께 설명드립니다.'])
  if (p.premium === '없음') pool.push(['정말 권리금이 없나요?', '네, 무권리 매물입니다. 초기 비용은 보증금과 시설 공사 범위 위주로 계획하시면 됩니다.'])
  if (p.parking) pool.push(['주차는 충분한가요?', `주차는 ${p.parking} 조건입니다. 이용 방식(지정/공용)은 현장에서 함께 확인해 드립니다.`])
  if (p.exclusiveArea && p.exclusiveArea >= 330) pool.push(['일부만 임대도 가능한가요?', '분할 임대 가능 여부는 임대인과 협의가 필요한 부분입니다. 원하시는 면적을 말씀해 주시면 협의해 보겠습니다.'])
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

  // 지역
  tags.add(`#${region}상가임대`)
  tags.add(`#${region}상가${deal}`)
  if (p.dong) { tags.add(`#${p.dong}상가${deal}`); tags.add(`#${p.dong}상가임대`) }
  if (p.gu) tags.add(`#${region}${p.gu}상가`)
  tags.add(`#${region}상가`)

  // 업종
  const jobTags: Record<Category, string[]> = {
    office: [`#${region}사무실임대`, `#${region}사무실${deal}`, `#${region}소형사무실`],
    food: [`#${region}음식점자리`, `#${region}카페자리`, `#${region}식당임대`],
    academy: [`#${region}학원임대`, `#${region}학원자리`, `#${region}교습소자리`],
    beauty: [`#${region}미용실자리`, `#${region}네일샵자리`, `#${region}상가임대`],
    large: [`#${region}대형상가`, `#${region}통임대`, `#${region}대형사무실`],
    retail: [`#${region}점포임대`, `#${region}소매점자리`, `#${region}사무실임대`],
  }
  jobTags[p.category].forEach(t => tags.add(t))

  // 특성
  if (p.premium === '없음') tags.add(`#${region}무권리상가`)
  if (p.moveIn === '즉시입주') tags.add(`#${region}즉시입주상가`)
  if (p.parking) tags.add(`#${region}주차가능상가`)
  if (p.floor === '1') tags.add(`#${region}1층상가`)
  if (p.elevator) tags.add(`#${region}엘리베이터상가`)

  // 브랜드 고정
  ;['#플러스불당공인중개사', '#불당동상가전문', '#천안상가전문부동산', '#천안시상가매물', '#천안시상가추천']
    .forEach(t => tags.add(t))

  // 채우기용 일반 태그
  ;[`#${region}부동산`, `#${region}상권`, `#${region}창업`, `#${region}상가추천`, `#${region}임대`,
    `#${region}상가매물`, `#${region}점포`, `#충남상가`, `#${region}창업자리`, `#${region}상가정보`]
    .forEach(t => { if (tags.size < 25) tags.add(t) })

  return Array.from(tags).join(' ')
}

function buildReport(p: ParsedListing, src: string, listingNo: string): string | null {
  const issues: string[] = []

  const missing: string[] = []
  if (fmtLocation(p) === NEEDS_CHECK) missing.push('소재지')
  if (!p.exclusiveArea && !p.supplyArea) missing.push('면적')
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
  if (banned.length) issues.push(`원문의 부당광고 위험 표현(${banned.join(', ')})은 변환 결과에서 제외했습니다.`)

  if (!issues.length) return null
  return `---\n\n📋 **점검 보고**\n${issues.map(i => `- ${i}`).join('\n')}`
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

  const titles = format === 'blog' ? buildBlogTitles(p) : buildTitles(p)
  const infoSection = format === 'blog' ? buildInfoList(p, listingNo) : buildTable(p, listingNo)

  const sections = [
    `🏷️ **추천 제목**\n${titles.map((t, i) => `${i + 1}. ${t}`).join('\n')}`,
    `👋 **소개**\n\n${buildIntro(p, source)}`,
    `📍 **매물 요약**\n\n${buildSummary(p)}`,
    `🏢 **매물 기본 정보**\n\n${infoSection}`,
    `✨ **매물 세부 특징 설명**\n\n${buildDetails(p)}`,
    `💬 **자주 묻는 질문**\n\n${buildQnA(p)}`,
    `📞 **중개사 정보**\n\n${buildBrokerInfo(p)}`,
    `📌 **특장점 한 줄 요약**\n\n→ ${features(p).slice(0, 3).join(' + ')}`,
    `🏷️ **태그**\n\n${buildTags(p)}`,
    `📋 매물번호: ${listingNo}`,
  ]

  const report = buildReport(p, source, listingNo)
  return sections.join('\n\n\n') + (report ? `\n\n\n${report}` : '')
}
