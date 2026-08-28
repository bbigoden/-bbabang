/**
 * 네이버 블로그 매물 포스팅 변환 — 규칙 기반.
 *
 * 카페(cafe-post.ts)와는 **문장을 공유하지 않는다.** 네이버가 블로그·카페를 한 영역에서
 * 노출하는 통합 랭킹으로 바뀌면서 두 글이 같은 자리를 놓고 경쟁하고, 문장이 겹치면
 * 유사문서로 판정돼 노출이 막힌다. 그래서 파싱만 재사용하고 문구는 전부 따로 쓴다.
 *
 * 매물마다 같은 문장이 나가면 그것 역시 유사문서가 되므로, 문장 풀에서 매물번호 해시로
 * 골라 쓴다. 해시라서 같은 매물은 몇 번을 돌려도 같은 글이 나온다(재생성·교체 관리).
 *
 * 준수 규칙 (naver-blog-listing 스킬):
 *  - 원문에 없는 정보를 지어내지 않는다. 층고·전력·주차는 없으면 [확인 필요]
 *  - `-`/`표시안함`은 미입력이지 "없음"이 아니다
 *  - 부당광고 표현, AI 티 나는 표현 금지
 *  - 소재지는 읍·면·동 + 층수까지만 (표시광고 블록은 예외)
 *  - 첫 문단 200자 안에 종류·면적·가격이 다 들어가야 한다 (AI 브리핑 인용 대상)
 *  - CTA는 글 끝에 한 번만
 */
import { parseListing, m2ToPyeong, type ParsedListing, type Category } from './cafe-post.ts'

const CHECK = '[확인 필요]'

/** 매물번호 해시로 후보 중 하나를 고른다. 같은 매물은 항상 같은 선택. */
function pick<T>(seed: string, arr: T[]): T {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return arr[h % arr.length]
}

const isIndustrial = (c: Category) => c === 'industrial'

// ── 표기 ─────────────────────────────────────────────

const won = (v?: string) => {
  if (!v) return null
  // 뱅크 원문은 `2,000 만원` 처럼 숫자와 단위를 띄어 쓴다. 붙여서 정리한다.
  const t = v.trim().replace(/\s+(만원|억|원)/g, '$1')

  // 만원 단위가 커지면 읽기 어렵다. `130,000만원` 은 `13억원` 으로 바꾼다.
  const man = Number(t.replace(/[^\d]/g, ''))
  if (/만/.test(t) && Number.isFinite(man) && man >= 10000) {
    const eok = Math.floor(man / 10000)
    const rest = man % 10000
    return rest ? `${eok}억 ${rest.toLocaleString()}만원` : `${eok}억원`
  }
  return /억|만|원/.test(t) ? t : `${t}만원`
}

function area(m2?: number): string | null {
  return m2 ? `${m2}㎡ (약 ${m2ToPyeong(m2)}평)` : null
}

function priceLine(p: ParsedListing): string {
  if (p.dealType === '월세' || (p.deposit && p.monthlyRent)) {
    const d = won(p.deposit) ?? CHECK
    const m = won(p.monthlyRent) ?? CHECK
    return `보증금 ${d} / 월세 ${m} (VAT 별도 여부 확인 필요)`
  }
  if (p.salePrice) return `${p.dealType === '전세' ? '전세금' : '매매가'} ${won(p.salePrice)}`
  return CHECK
}

function locationLine(p: ParsedListing): string {
  const base = [p.sido ?? '충청남도', p.city, p.gu, p.dong].filter(Boolean).join(' ')
  const fl = p.floor ? ` (${p.floor}층)` : ''
  return base ? `${base}${fl}` : CHECK
}

/** 라벨 자간을 벌려 세로 정렬을 맞춘다 (스킬의 콜론 형식). */
function labeled(rows: Array<[string, string]>): string {
  const width = Math.max(...rows.map(([k]) => [...k].length))
  return rows.map(([k, v]) => {
    const chars = [...k]
    const padded = chars.length >= width ? k : chars.join(' '.repeat(0)) + ' '.repeat(width - chars.length)
    return `${padded} : ${v}`
  }).join('\n')
}

// ── 1단계: 키워드 ─────────────────────────────────────

export interface BlogKeywords {
  main: string
  subs: string[]
  intents: string[]
}

const KIND_WORD: Record<Category, string> = {
  industrial: '창고임대', office: '사무실임대', food: '상가임대', academy: '상가임대',
  beauty: '상가임대', retail: '상가임대', large: '상가임대',
  residential: '주택매매', land: '토지매매',
}

function buildKeywords(p: ParsedListing, no: string): BlogKeywords {
  const city = p.city === '아산시' ? '아산' : '천안'
  const dong = p.dong ?? ''
  const base = KIND_WORD[p.category].replace('임대', p.dealType === '매매' ? '매매' : '임대')
  const main = [city, dong, base].filter(Boolean).join(' ')

  const subs = isIndustrial(p.category)
    ? [
      `${city} ${p.dealType === '매매' ? '공장매매' : '공장임대'}`,
      p.ceilingHeight ? `${city} 층고 높은 창고` : `${city} 단독 창고`,
      `${city} 소형 물류창고`,
      dong ? `${dong} 창고` : `${city} 창고 부지`,
    ]
    : [
      `${city} ${dong} 점포${p.dealType === '매매' ? '매매' : '임대'}`,
      p.floor === '1' ? `${city} 1층 상가` : `${city} ${p.floor ?? ''}층 상가`.trim(),
      p.premium === '없음' ? `${city} 무권리 상가` : `${city} 상가 권리금`,
      `${dong || city} 창업 자리`,
    ]

  const intents = isIndustrial(p.category)
    ? [
      '대형 화물차가 진입하고 회차할 수 있는가',
      p.ceilingHeight ? `층고 ${p.ceilingHeight}가 적재·장비에 충분한가` : '층고가 장비 반입에 충분한가',
      p.power ? `계약전력 ${p.power}로 작업이 가능한가` : '계약전력이 얼마이고 증설이 되는가',
    ]
    : [
      '내 업종이 이 건축물 용도로 인허가가 나는가',
      '월세 외에 관리비와 권리금이 얼마나 더 드는가',
      '전용면적이 실제로 몇 평이고 주차는 되는가',
    ]

  return { main, subs: subs.filter(Boolean), intents }
}

// ── 2단계: 제목 5안 ───────────────────────────────────

/** 스킬이 정한 5가지 스타일. 순서 고정. */
export interface BlogTitle { style: string; text: string }

function buildTitles(p: ParsedListing, kw: BlogKeywords, no: string): BlogTitle[] {
  const pyeong = p.exclusiveArea ? `${m2ToPyeong(p.exclusiveArea)}평` : null
  const rent = p.monthlyRent ? `월세 ${won(p.monthlyRent)}` : p.salePrice ? `${won(p.salePrice)}` : null
  const floorTxt = p.floor && /^\d+$/.test(p.floor) ? `${p.floor}층` : null

  // ③ 제약 공개형 — 이 매물의 한계를 제목에 드러내 헛클릭을 거른다
  const limit = isIndustrial(p.category)
    ? (p.power ? `전력 ${p.power}입니다` : p.ceilingHeight ? `층고 ${p.ceilingHeight} 기준입니다` : '전력·층고는 확인이 필요합니다')
    : (!hasParkingLot(p) ? '건물 주차는 없습니다'
      : p.maintenanceFee ? `관리비 ${p.maintenanceFee} 별도입니다` : '관리비는 실비 부과입니다')

  const target = isIndustrial(p.category)
    ? pick(no, ['보관·소분 작업만 하시는 분께', '소규모 제조 하시는 분께', '물류 거점 찾으시는 분께'])
    : pick(no, ['소자본 창업 준비하시는 분께', '이전 자리 알아보시는 분께', '첫 매장 여시는 분께'])

  return [
    { style: '관련 질문형', text: `${kw.main} ${isIndustrial(p.category) ? '5톤 차량 진입되나요' : '이 업종도 들어갈 수 있나요'}` },
    { style: '조건 나열형', text: [kw.main, floorTxt, pyeong, rent].filter(Boolean).join(' ') },
    { style: '제약 공개형', text: `${kw.main}, ${limit}` },
    { style: '지역 탐색형', text: `${kw.main} ${p.propertyKind ?? ''} ${p.moveIn === '즉시입주' ? '즉시입주' : ''}`.replace(/\s+/g, ' ').trim() },
    { style: '대상 지정형', text: `${kw.main} ${target} 맞습니다` },
  ].map(t => ({ ...t, text: t.text.slice(0, 40) }))
}

function hasParkingLot(p: ParsedListing): boolean {
  if (!p.parking) return false
  const n = p.parking.match(/\d+/)
  return n ? Number(n[0]) > 0 : !/없|불가/.test(p.parking)
}

// ── 3단계: 본문 ───────────────────────────────────────

/** 핵심 조건 블록 — 종류별 항목·순서가 고정돼 있다. */
function conditionBlock(p: ParsedListing): string {
  if (isIndustrial(p.category)) {
    return labeled([
      ['위치', locationLine(p)],
      ['거래형태', p.dealType ?? CHECK],
      [p.dealType === '매매' ? '매매가' : '임대료', priceLine(p)],
      ['토지면적', area(p.landArea) ?? CHECK],
      ['건물면적', `${area(p.totalFloorArea ?? p.exclusiveArea) ?? CHECK}${p.propertyKind ? ` (${p.propertyKind})` : ''}`],
      ['층고', p.ceilingHeight ? `${p.ceilingHeight} (기준 확인 필요)` : CHECK],
      ['전력', p.power ?? CHECK],
      ['설비', CHECK],
    ])
  }
  return labeled([
    ['소재지', locationLine(p)],
    ['면적', p.exclusiveArea
      ? `전용면적 ${area(p.exclusiveArea)}${p.supplyArea ? ` / 공급면적 ${area(p.supplyArea)}` : ''}`
      : CHECK],
    ['조건', priceLine(p)],
    ['관리비', p.maintenanceFee ?? '확인 필요 (사용량에 따라 실비 부과)'],
    ['층수', p.floor ? `${p.floor}층${p.totalFloors ? ` / 총 ${p.totalFloors}층` : ''}` : CHECK],
    ['권리금', p.premium === '없음' ? '없음 (무권리)' : p.premium ?? CHECK],
    ['방향', p.direction ? `${p.direction.endsWith('향') ? p.direction : `${p.direction}향`} (주된 출입구 기준)` : CHECK],
    ['용도', p.propertyKind ?? CHECK],
    ['사용승인일', p.approvalDate ?? CHECK],
    ['주차대수', p.parking ? `${p.parking} (건축물대장상 주차대수)` : CHECK],
  ])
}

/** 첫 문단 — 200자 안에 종류·면적·가격이 다 들어가야 AI 브리핑에 인용된다. */
function opening(p: ParsedListing, kw: BlogKeywords): string {
  const a = p.exclusiveArea ? `전용 ${area(p.exclusiveArea)}` : ''
  const price = priceLine(p).replace(' (VAT 별도 여부 확인 필요)', '')
  const who = isIndustrial(p.category)
    ? (p.ceilingHeight ? `층고 ${p.ceilingHeight} 기준으로 적재나 장비 반입이 필요한 분` : '단독으로 쓸 창고 공간이 필요한 분')
    : (p.floor === '1' ? '전면 노출이 필요한 업종을 준비하시는 분' : '임대료 부담을 낮춰 시작하시려는 분')
  return `${kw.main} 매물입니다. ${[a, price].filter(Boolean).join(', ')} 조건입니다. ${who}께 맞는 자리입니다.`
}

function sectionLocation(p: ParsedListing, no: string): string {
  const region = [p.city, p.gu, p.dong].filter(Boolean).join(' ') || '해당 지역'
  if (isIndustrial(p.category)) {
    return [
      `${region}에 있는 물건입니다. 인근 산업단지와 국도 접근성은 실제 이동 경로에 따라 체감이 달라지므로, 현장에서 진입 동선을 함께 확인해 드립니다.`,
      '진입로 폭과 회차 공간은 차량 톤수에 따라 갈립니다. 어떤 차량이 드나드는지 알려주시면 실제로 들어갈 수 있는지 확인해 드리겠습니다.',
      '야간이나 주말에 출입이 필요하신 경우에는 건물 관리 방식에 따라 제약이 있을 수 있어 미리 확인해 드립니다.',
      p.moveIn === '즉시입주' ? '현재 비어 있어 계약 후 바로 사용하실 수 있습니다.' : '입주 시점은 협의가 필요합니다.',
    ].filter(Boolean).join(' ')
  }
  return [
    `${region} 생활권에 자리한 물건입니다. 배후 세대와 주 이용층은 시간대별로 달라 현장에서 유동 동선을 함께 보시는 편이 정확합니다.`,
    p.floor === '1' ? '1층이라 전면이 도로에 노출됩니다.' : `${p.floor ?? ''}층이라 임대료 부담이 1층보다 낮습니다.`.trim(),
    hasParkingLot(p) ? `주차는 ${p.parking} 기준입니다. 다만 건축물대장 기준이라 실제 배정 대수는 관리사무소 확인이 필요합니다.` : '건물 주차는 별도 확인이 필요합니다. 인근 공영주차장 위치를 함께 안내드립니다.',
    '주변 상가 구성과 시간대별 이용층은 직접 보셔야 판단이 서는 부분이라, 방문 시 함께 걸어보시길 권해 드립니다.',
  ].filter(Boolean).join(' ')
}

function sectionArea(p: ParsedListing): string {
  const bits: string[] = []
  if (p.exclusiveArea && p.supplyArea) {
    const rate = ((p.exclusiveArea / p.supplyArea) * 100).toFixed(0)
    bits.push(`공급 ${area(p.supplyArea)}에 전용 ${area(p.exclusiveArea)}로, 전용률은 약 ${rate}%입니다.`)
  } else if (p.exclusiveArea) {
    bits.push(`전용 ${area(p.exclusiveArea)} 규모입니다.`)
  }
  if (isIndustrial(p.category)) {
    bits.push(p.ceilingHeight
      ? `층고는 ${p.ceilingHeight}로 기재돼 있습니다. 처마 기준인지 최고높이 기준인지는 현장에서 확인해 드리겠습니다.`
      : '층고는 원문에 기재가 없어 현장 확인 후 알려드리겠습니다.')
    bits.push(p.power
      ? `계약전력은 ${p.power}입니다. 증설이 필요하시면 가능 여부를 함께 알아봐 드립니다.`
      : '계약전력은 확인이 필요합니다. 사용하실 장비를 알려주시면 함께 확인하겠습니다.')
    bits.push('셔터 규격과 호이스트 유무는 원문에 없어 현장에서 실측해 알려드리겠습니다.')
  } else {
    bits.push(p.propertyKind
      ? `건축물 용도는 ${p.propertyKind}입니다. 준비하시는 업종이 이 용도로 인허가가 나는지 먼저 확인해 드립니다.`
      : '건축물 용도는 확인 후 안내드리겠습니다. 업종 인허가와 직결되는 부분입니다.')
    bits.push(p.bathrooms ? `화장실은 ${p.bathrooms}개입니다.` : '화장실 위치와 개수는 현장에서 확인해 드립니다.')
    bits.push('정화조 용량과 후드·가스 인입 여부는 음식점 가능 여부를 가르는 항목이라, 원문에 없는 경우 임의로 판단하지 않고 확인 후 알려드립니다.')
  }
  return bits.join(' ')
}

function sectionCost(p: ParsedListing): string {
  const bits = [`${priceLine(p)} 조건입니다.`]
  if (p.maintenanceFee) {
    bits.push(p.maintenanceFeeAmount && p.maintenanceFeeAmount > 100000
      ? `관리비는 ${p.maintenanceFee}이며, 청소·수도·공용전기 등 세부 비목은 확인 후 안내드리겠습니다.`
      : `관리비는 ${p.maintenanceFee}입니다.`)
  } else {
    bits.push('관리비는 원문에 금액이 기재돼 있지 않습니다. 최근 실제 부과된 범위를 확인해 함께 안내드리겠습니다.')
  }
  bits.push(p.premium === '없음'
    ? '권리금은 없는 것으로 기재돼 있어 초기 비용을 보증금과 시설 공사 위주로 잡으시면 됩니다.'
    : p.premium ? `권리금은 ${p.premium} 조건입니다.` : '권리금은 원문에 기재가 없어 확인 후 안내드리겠습니다.')
  bits.push('부가세 별도 여부는 계약 조건에 따라 달라지므로 계약 전에 명확히 정리해 드립니다.')
  return bits.join(' ')
}

function sectionFit(p: ParsedListing, no: string): { good: string[]; bad: string[] } {
  const good: string[] = []
  const bad: string[] = []

  if (isIndustrial(p.category)) {
    if (p.ceilingHeight) good.push(`층고 ${p.ceilingHeight} 기준으로 적재하실 계획인 경우`)
    if (p.landArea) good.push(`마당을 포함해 ${area(p.landArea)} 부지가 필요한 경우`)
    good.push('단독으로 쓰는 동을 찾으시는 경우')
    if (!p.power) bad.push('전력 사용량이 큰 설비를 돌리셔야 하는 경우 — 계약전력이 확인되지 않았습니다')
    bad.push('25톤 트레일러 상시 진출입이 필요한 경우 — 진입로와 회차 공간을 먼저 보셔야 합니다')
  } else {
    if (p.floor === '1') good.push('간판과 전면 노출이 매출에 중요한 업종')
    if (p.premium === '없음') good.push('권리금 부담 없이 시작하려는 경우')
    if (p.moveIn === '즉시입주') good.push('계약 후 바로 공사를 시작하셔야 하는 경우')
    good.push(p.exclusiveArea && p.exclusiveArea < 66 ? '1~2인 운영으로 시작하는 소형 매장' : '어느 정도 좌석·진열 공간이 필요한 매장')
    if (!hasParkingLot(p)) bad.push('손님 주차가 필수인 업종 — 건물 자체 주차가 없습니다')
    if (!p.maintenanceFee) bad.push('고정비를 미리 확정해야 하는 경우 — 관리비가 실비 부과라 월별로 달라집니다')
    bad.push('배기·정화조가 크게 필요한 업종 — 용량 확인 전에는 권해 드리기 어렵습니다')
  }
  return { good: good.slice(0, 4), bad: bad.slice(0, 3) }
}

function sectionQnA(p: ParsedListing, no: string): Array<[string, string]> {
  const pool: Array<[string, string]> = []
  if (isIndustrial(p.category)) {
    pool.push(['5톤 차량이 들어갈 수 있나요',
      '진입로 폭과 마당 회차 공간을 현장에서 함께 확인해 드립니다. 실제 운행하시는 차량 톤수를 알려주시면 들어갈 수 있는지 판단해 드리겠습니다.'])
    pool.push(['층고는 정확히 얼마인가요',
      p.ceilingHeight
        ? `원문에는 ${p.ceilingHeight}로 기재돼 있습니다. 처마 기준과 최고높이 기준이 2m 가까이 차이 나므로 현장에서 실측해 알려드리겠습니다.`
        : '원문에 기재가 없어 현장에서 실측 후 알려드리겠습니다. 사용하실 장비 높이를 알려주시면 함께 맞춰보겠습니다.'])
    pool.push(['전기 증설이 되나요',
      p.power
        ? `현재 계약전력은 ${p.power}입니다. 증설 가능 여부와 비용은 한전 조회가 필요해 확인 후 안내드리겠습니다.`
        : '계약전력이 원문에 없어 먼저 확인이 필요합니다. 필요한 용량을 알려주시면 함께 알아보겠습니다.'])
    pool.push(['이 용도로 인허가가 나나요',
      `건축물대장상 용도는 ${p.propertyKind ?? '확인이 필요'}합니다. 하시려는 업종을 알려주시면 해당 용도로 등록이 가능한지 확인해 드립니다.`])
  } else {
    pool.push(['관리비는 얼마나 나오나요',
      p.maintenanceFee
        ? `${p.maintenanceFee} 기준이며 세부 비목은 확인 후 안내드립니다.`
        : '금액이 정해져 있지 않고 사용량에 따라 부과됩니다. 최근 실제 부과된 범위를 확인해 알려드리겠습니다.'])
    pool.push(['제 업종이 들어갈 수 있나요',
      `건축물 용도가 ${p.propertyKind ?? '확인 필요'}입니다. 준비하시는 업종을 말씀해 주시면 인허가 가능 여부를 먼저 확인해 드립니다.`])
    pool.push(['전용면적은 실제로 몇 평인가요',
      p.exclusiveArea
        ? `전용 ${area(p.exclusiveArea)}입니다.${p.supplyArea ? ` 공급면적 ${area(p.supplyArea)} 기준으로 보시면 차이가 있습니다.` : ''}`
        : '원문에 전용면적 기재가 없어 확인 후 알려드리겠습니다.'])
    pool.push(['권리금은 어떻게 되나요',
      p.premium === '없음' ? '무권리 물건으로 기재돼 있습니다. 초기 비용은 보증금과 시설 공사 위주로 계획하시면 됩니다.'
        : p.premium ? `${p.premium} 조건입니다.` : '원문에 기재가 없어 확인 후 안내드리겠습니다.'])
    pool.push(['주차는 몇 대나 되나요',
      hasParkingLot(p) ? `건축물대장상 ${p.parking}입니다. 실제 배정 대수는 관리사무소 확인이 필요합니다.`
        : '건물 자체 주차는 확인이 필요합니다. 인근 공영주차장 위치를 함께 안내드리겠습니다.'])
  }
  // 매물마다 다른 조합이 나가도록 시작 지점을 해시로 옮긴다
  const start = pick(no, [0, 1, 2])
  return [...pool.slice(start), ...pool.slice(0, start)].slice(0, 3)
}

/** 표시광고 필수 명시사항 블록 — 본문 최하단 고정 */
function adBlock(p: ParsedListing): string {
  return [
    '■ 중개사무소 명칭 : 플러스불당 공인중개사사무소',
    '■ 등록번호 : 제44133-2024-00142호',
    '■ 사무소 소재지 : 충청남도 천안시 서북구 불당23로 73-27 502호',
    '■ 대표자 성명 : 김용유',
    '■ 연락처 : 010-5585-8943',
    `■ 매물 소재지 : ${locationLine(p)}`,
    `■ 면적 : ${p.supplyArea ? `계약 ${area(p.supplyArea)} / ` : ''}${p.exclusiveArea ? `전용 ${area(p.exclusiveArea)}` : CHECK}`,
    `■ 가격 : ${priceLine(p).replace(' (VAT 별도 여부 확인 필요)', '')}`,
    `■ 거래형태 : ${p.dealType ?? CHECK}`,
    `■ 층수 : ${p.floor ? `${p.floor}층${p.totalFloors ? ` / 총 ${p.totalFloors}층` : ''}` : CHECK}`,
    `■ 방향 : ${p.direction ? `${p.direction.endsWith('향') ? p.direction : `${p.direction}향`} (주출입구 기준)` : CHECK}`,
    `■ 입주가능일 : ${p.moveIn ?? CHECK}`,
    `■ 주차대수 : ${p.parking ?? CHECK}`,
    `■ 관리비 : ${p.maintenanceFee ?? CHECK}`,
    `■ 건축물 용도 : ${p.propertyKind ?? CHECK}`,
    `■ 사용승인일 : ${p.approvalDate ?? CHECK}`,
  ].join('\n')
}

// ── 4단계: 태그 (정확히 10개) ─────────────────────────

function buildTags(p: ParsedListing, kw: BlogKeywords): string[] {
  const city = p.city === '아산시' ? '아산' : '천안'
  const dong = p.dong
  const ind = isIndustrial(p.category)
  const deal = p.dealType === '매매' ? '매매' : '임대'

  const tags = [
    `#${kw.main.replace(/\s/g, '')}`,
    `#${city}${ind ? '공장' : '상가'}${deal}`,
    dong ? `#${dong}${ind ? '창고' : '상가'}` : `#${city}부동산`,
    `#${city}${p.gu ?? ''}${ind ? '창고' : '사무실'}`.replace('undefined', ''),
    ind ? `#${city}물류창고` : (p.floor === '1' ? `#1층상가${deal}` : `#소형사무실${deal}`),
    ind ? `#단독창고` : (p.premium === '없음' ? '#무권리상가' : '#상가권리금'),
    ind ? `#${city}제조업소` : '#음식점자리',
    ind ? `#${city}창고부지` : '#학원자리',
    `#${city}${ind ? '공장창고' : '상가'}전문`,
    '#플러스불당공인중개사',
  ]
  return [...new Set(tags)].slice(0, 10)
}

// ── 산출물 ───────────────────────────────────────────

export interface BlogPost {
  no: string
  category: Category
  keywords: BlogKeywords
  titles: BlogTitle[]
  body: string
  tags: string[]
  report: string[]
  nextTopics: string[]
}

export function buildBlogPost(source: string, listingNoInput: string): BlogPost {
  const p = parseListing(source)
  const no = listingNoInput.replace(/[^0-9]/g, '') || 'XXXXXXXXXX'
  const kw = buildKeywords(p, no)
  const ind = isIndustrial(p.category)
  const fit = sectionFit(p, no)
  const qna = sectionQnA(p, no)

  const body = [
    opening(p, kw),
    '',
    conditionBlock(p),
    '',
    `[사진: 건물 전면 외관]`,
    '',
    `${kw.main}, ${ind ? '진입과 주변 여건은 어떤가요' : '어떤 자리인가요'}`,
    sectionLocation(p, no),
    '',
    `[사진: ${ind ? '진입로와 마당' : '앞 도로와 인도'}]`,
    '',
    `${ind ? '면적과 설비는 어디까지 확인됐나요' : '실제로 쓰는 면적은 얼마인가요'}`,
    sectionArea(p),
    '',
    `[사진: 내부 전경]`,
    '',
    '들어가는 비용은 어떻게 되나요',
    sectionCost(p),
    '',
    '이런 분께 맞습니다',
    fit.good.map(g => `· ${g}`).join('\n'),
    '',
    '이런 경우에는 맞지 않습니다',
    fit.bad.map(b => `· ${b}`).join('\n'),
    '',
    `[사진: ${ind ? '천장과 전기 인입부' : '내부 다른 각도'}]`,
    '',
    '자주 묻는 질문',
    qna.map(([q, a]) => `${q}\n${a}`).join('\n\n'),
    '',
    '[사진: 지도 캡처]',
    '',
    '현장 방문 안내',
    '연락 주시면 일정에 맞춰 현장을 안내해 드립니다. 원하시는 조건을 함께 말씀해 주시면 광고에 올리지 않은 물건까지 정리해 비교해 보실 수 있도록 준비하겠습니다.',
    '',
    adBlock(p),
  ].join('\n')

  // 점검 보고
  const report: string[] = []
  const missing: string[] = []
  if (!p.exclusiveArea && !p.supplyArea) missing.push('면적')
  if (!p.propertyKind) missing.push('건축물 용도')
  if (!p.approvalDate) missing.push('사용승인일')
  if (!p.parking) missing.push('주차대수')
  if (!p.maintenanceFee) missing.push('관리비')
  if (ind && !p.ceilingHeight) missing.push('층고')
  if (ind && !p.power) missing.push('계약전력')
  if (missing.length) report.push(`원문에 없어 ${CHECK}로 남긴 항목: ${missing.join(', ')}`)
  if (p.exclusiveArea && p.supplyArea && p.exclusiveArea === p.supplyArea) {
    report.push('공급면적과 전용면적이 같습니다. 이례적이므로 원문을 확인해 주세요.')
  }
  report.push('네이버에서 메인 키워드를 검색해 AI 브리핑 아래 관련 질문 버튼 문구를 그대로 주시면 제목 ①을 교체하겠습니다.')

  const nextTopics = ind
    ? [`${kw.main} 계약 전 확인해야 할 전기 용량`,
       '창고 임대차 관리비는 보통 어떻게 책정되나요',
       `${p.city === '아산시' ? '아산' : '천안'} 창고 밀집 지역 비교`]
    : [`${kw.main} 계약 전 확인할 건축물 용도`,
       '상가 관리비는 보통 어떤 항목으로 부과되나요',
       `${p.dong ?? '천안'} 상권 이용층과 시간대별 흐름`]

  return { no, category: p.category, keywords: kw, titles: buildTitles(p, kw, no), body, tags: buildTags(p, kw), report, nextTopics }
}

/** 썸네일 3종 생성기(make_thumbnails.py)용 config */
export function buildBlogThumbConfig(source: string, listingNoInput: string, outDir = '.') {
  const p = parseListing(source)
  const no = listingNoInput.replace(/[^0-9]/g, '') || 'XXXXXXXXXX'
  const ind = isIndustrial(p.category)
  const region = [p.city, p.gu, p.dong].filter(Boolean).join(' ')
    .replace(/천안시/, '천안').replace(/아산시/, '아산')

  const head1 = `${p.floor && /^\d+$/.test(p.floor) ? `${p.floor}층 ` : ''}${ind ? '창고' : '상가'} ${p.dealType ?? '임대'}`
  const head2 = p.exclusiveArea
    ? `${p.exclusiveArea}㎡ · ${m2ToPyeong(p.exclusiveArea)}평`
    : (p.landArea ? `대지 ${m2ToPyeong(p.landArea)}평` : '')

  const strip = (s: string) => s.replace(/\([^)]*\)/g, '').trim()
  const priceLines = priceLine(p) === CHECK
    ? ['가격 협의']
    : priceLine(p).replace(' (VAT 별도 여부 확인 필요)', '').split(' / ').map(strip).filter(Boolean).slice(0, 3)

  const infoRows: Array<[string, string]> = ind
    ? [['소재지', locationLine(p)], ['거래형태', p.dealType ?? CHECK],
       ['토지면적', area(p.landArea) ?? CHECK], ['건물면적', area(p.totalFloorArea ?? p.exclusiveArea) ?? CHECK],
       ['층고', p.ceilingHeight ?? CHECK], ['전력', p.power ?? CHECK],
       ['건축물 용도', p.propertyKind ?? CHECK], ['사용승인일', p.approvalDate ?? CHECK],
       ['주차', p.parking ?? CHECK], ['입주가능일', p.moveIn ?? CHECK]]
    : [['소재지', locationLine(p)], ['층수', p.floor ? `${p.floor}층` : CHECK],
       ['공급면적', area(p.supplyArea) ?? CHECK], ['전용면적', area(p.exclusiveArea) ?? CHECK],
       ['건축물 용도', p.propertyKind ?? CHECK], ['조건', priceLines.join(' / ')],
       ['관리비', p.maintenanceFee ?? CHECK], ['권리금', p.premium ?? CHECK],
       ['주차', p.parking ?? CHECK], ['입주가능일', p.moveIn ?? CHECK]]

  const features: Array<[string, string]> = ind
    ? [
      ['단독 사용', '동을 나눠 쓰지 않고 단독으로 사용하실 수 있습니다'],
      [p.ceilingHeight ? `층고 ${p.ceilingHeight}` : '층고 확인', p.ceilingHeight ? '적재 계획에 맞는지 현장에서 실측해 드립니다' : '현장 실측 후 정확한 높이를 알려드립니다'],
      [p.landArea ? `대지 ${m2ToPyeong(p.landArea)}평` : '부지 확인', '마당 회차 공간을 함께 확인해 보실 수 있습니다'],
      [p.power ? `전력 ${p.power}` : '전력 확인', p.power ? '증설 필요 시 가능 여부를 알아봐 드립니다' : '필요 용량을 알려주시면 함께 확인합니다'],
      [p.moveIn === '즉시입주' ? '즉시입주' : '입주 협의', p.moveIn === '즉시입주' ? '계약 후 바로 사용하실 수 있습니다' : '입주 시점은 협의가 가능합니다'],
      ['용도 확인', `건축물대장상 ${p.propertyKind ?? '용도를 확인해'} 인허가를 함께 봐 드립니다`],
    ]
    : [
      [p.floor === '1' ? '1층 전면' : `${p.floor ?? ''}층 위치`.trim(), p.floor === '1' ? '도로에서 바로 보이는 자리입니다' : '임대료 부담을 낮춰 시작하실 수 있습니다'],
      [p.exclusiveArea ? `전용 ${m2ToPyeong(p.exclusiveArea)}평` : '면적 확인', '실제 사용 면적 기준으로 안내드립니다'],
      [p.premium === '없음' ? '무권리' : '권리금 확인', p.premium === '없음' ? '초기 비용을 시설 공사 위주로 잡으실 수 있습니다' : '조건은 확인 후 안내드립니다'],
      [hasParkingLot(p) ? `주차 ${p.parking}` : '주차 확인', hasParkingLot(p) ? '건축물대장 기준 대수입니다' : '인근 공영주차장을 함께 안내드립니다'],
      [p.moveIn === '즉시입주' ? '즉시입주' : '입주 협의', p.moveIn === '즉시입주' ? '계약 후 바로 공사를 시작하실 수 있습니다' : '입주 시점은 협의가 가능합니다'],
      ['업종 확인', `${p.propertyKind ?? '건축물 용도'} 기준으로 인허가를 함께 확인해 드립니다`],
    ]

  return {
    out_dir: outDir,
    slug: `listing_${no}`,
    palette: 'wine',            // 블로그는 와인+골드 계열 고정 (카페와 분리)
    region_badge: region || '천안',
    headline: [head1, head2].filter(Boolean),
    price_lines: priceLines,
    office: '플러스불당 공인중개사사무소',
    phone: '010-5585-8943',
    info_title: '매물 기본 정보',
    info_rows: infoRows,
    feature_title: ind ? '이 창고의 강점' : '이 상가의 강점',
    features,
  }
}
