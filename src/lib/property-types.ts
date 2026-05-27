// 매물 유형 단일 진실원 (Single Source of Truth)
// 모든 페이지(매물 등록·수정·목록, 고객 요청, 검색 필터, 자동채움)가 이 정의를 공유한다.
//
// 주거 7종 + 비주거 12종 = 총 19종.
// 세움터 건축법상 29종 용도를 빠방 분류로 매핑하기 위한 확장된 분류 체계.

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
      '상가', '사무실', '창고/공장', '숙박',
      '의료시설', '교육시설', '위락시설', '운동시설',
      '자동차시설', '농업/축사', '토지', '기타',
    ],
  },
]

export const ALL_ROOM_TYPES: string[] = PROPERTY_CATEGORIES.flatMap(c => c.types)

export const RESIDENTIAL_TYPES = PROPERTY_CATEGORIES[0].types
export const NON_RESIDENTIAL_TYPES = PROPERTY_CATEGORIES[1].types

/**
 * 세움터 건축물대장의 "용도" 텍스트 → 빠방 19종 분류로 매핑.
 * 매칭 우선순위 주의: 위에서부터 순서대로 체크되므로, 더 구체적인 키워드를 먼저 둠.
 *
 * 매핑 안 되는 케이스(종교/문화/운수/자원순환/교정/국방/방송통신/발전/묘지/관광휴게/장례 등)는 '기타' 반환.
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

  // ── 비주거 ──
  if (p.includes('업무')) return '사무실'
  if (p.includes('숙박')) return '숙박'
  if (p.includes('의료') || p.includes('노유자')) return '의료시설'
  if (p.includes('교육연구') || p.includes('교육시설')) return '교육시설'
  if (p.includes('위락')) return '위락시설'
  if (p.includes('운동')) return '운동시설'
  if (p.includes('자동차')) return '자동차시설'
  if (p.includes('축사') || p.includes('동물') || p.includes('식물 관련')) return '농업/축사'
  if (p.includes('공장') || p.includes('창고') || p.includes('위험물')) return '창고/공장'
  if (
    p.includes('근린생활') || p.includes('판매') || p.includes('소매')
  ) return '상가'

  // ── 그 외 (종교/문화/운수/자원순환/교정/국방/방송통신/발전/묘지/관광휴게/장례 등) ──
  // 빠방 어디에도 잘 안 맞으므로 '기타'로 통합
  return '기타'
}
