// 매물 유형 단일 진실원 (Single Source of Truth)
// 모든 페이지(매물 등록·수정·목록, 고객 요청, 검색 필터, 자동채움)가 이 정의를 공유한다.
//
// 주거 7종 + 비주거 12종 = 총 19종.
// 세움터 건축법상 29종 용도를 빠방 분류로 매핑하기 위한 확장된 분류 체계.
// 비주거 상가 계열 7종은 '(상가)' 접미로 통일.

export interface PropertyCategory {
  label: string
  types: string[]
}

export const PROPERTY_CATEGORIES: PropertyCategory[] = [
  {
    label: '주거',
    types: ['원룸', '투룸', '쓰리룸 이상', '아파트', '오피스텔', '빌라/연립', '단독/다가구'],
  },
  {
    label: '비주거',
    types: [
      '1종(상가)', '2종(상가)', '판매(상가)', '업무(상가)',
      '의료(상가)', '교육(상가)', '운동(상가)',
      '공장/창고', '농업/축사', '숙박', '토지', '기타',
    ],
  },
]

export const ALL_ROOM_TYPES: string[] = PROPERTY_CATEGORIES.flatMap(c => c.types)

export const RESIDENTIAL_TYPES = PROPERTY_CATEGORIES[0].types
export const NON_RESIDENTIAL_TYPES = PROPERTY_CATEGORIES[1].types

// ── 고객 요청 페이지 전용 분류 ──
// 고객은 건축법상 용도(1종/2종/판매/업무/의료/교육/운동 근린생활시설)를 구분하기 어려워
// 비주거 상가 계열 7종을 '상가' 하나로 통합해서 보여준다.
// 중개사 매물 등록·검색 필터·세움터 자동채움은 PROPERTY_CATEGORIES(19종)를 그대로 사용한다.
export const COMMERCIAL_SUBTYPES = [
  '1종(상가)', '2종(상가)', '판매(상가)', '업무(상가)',
  '의료(상가)', '교육(상가)', '운동(상가)',
]

export const CUSTOMER_PROPERTY_CATEGORIES: PropertyCategory[] = [
  { label: '주거', types: RESIDENTIAL_TYPES },
  {
    label: '비주거',
    types: ['상가', ...NON_RESIDENTIAL_TYPES.filter(t => !COMMERCIAL_SUBTYPES.includes(t))],
  },
]

/**
 * 저장된 매물 유형 값들을 고객용 칩 값으로 정규화.
 * 세부 상가 유형(판매(상가) 등)으로 저장된 기존/공동중개 요청을 '상가'로 합쳐,
 * 고객 요청 수정 페이지에서 칩이 정상적으로 선택 표시되도록 한다.
 */
export function toCustomerRoomTypes(types: string[]): string[] {
  const mapped = types.map(t => (COMMERCIAL_SUBTYPES.includes(t) ? '상가' : t))
  return Array.from(new Set(mapped))
}

/**
 * 세움터 건축물대장의 "용도" 텍스트 → 빠방 19종 분류로 매핑.
 * 매칭 우선순위 주의: 위에서부터 순서대로 체크되므로, 더 구체적인 키워드를 먼저 둠.
 *
 * 비주거 상가 계열은 '(상가)' 접미 통일:
 *   1종(상가), 2종(상가), 판매(상가), 업무(상가), 의료(상가), 교육(상가), 운동(상가)
 *
 * 매핑 안 되는 케이스(문화/종교/운수/노유자/수련/위락/자동차/관광휴게/야영장/자원순환/교정/방송통신/발전/묘지/장례 등)는 '기타' 반환.
 * 빈 문자열은 null 반환(자동채움 실패 시 호출자가 기본값 적용).
 */
export function mapPurposeToRoomType(purps: string): string | null {
  const p = purps || ''
  if (!p) return null

  // ── 주거 ──
  if (p.includes('아파트') || p.includes('공동주택')) return '아파트'
  if (p.includes('오피스텔')) return '오피스텔'
  if (p.includes('다세대') || p.includes('연립')) return '빌라/연립'
  if (p.includes('단독주택') || p.includes('다가구') || p.includes('다중주택')) return '단독/다가구'

  // ── 비주거: 상가 계열 (접미 통일) ──
  if (p.includes('1종') && p.includes('근린')) return '1종(상가)'
  if (p.includes('2종') && p.includes('근린')) return '2종(상가)'
  if (p.includes('판매')) return '판매(상가)'
  if (p.includes('업무')) return '업무(상가)'
  if (p.includes('의료')) return '의료(상가)'
  if (p.includes('교육연구') || p.includes('교육시설')) return '교육(상가)'
  if (p.includes('운동')) return '운동(상가)'
  if (p.includes('근린생활')) return '1종(상가)'  // 종 미명시 fallback

  // ── 비주거: 그 외 ──
  if (p.includes('숙박')) return '숙박'
  if (p.includes('공장') || p.includes('창고') || p.includes('위험물')) return '공장/창고'
  if (p.includes('축사') || p.includes('동물') || p.includes('식물 관련')) return '농업/축사'

  // ── 그 외 (문화·종교·운수·노유자·수련·위락·자동차·관광휴게·야영장·자원순환·교정·방송통신·발전·묘지·장례 등) ──
  return '기타'
}
