/**
 * 네이버부동산(fin.land.naver.com) 매물 조회.
 *
 * 네이버부동산 **화면에는 최신순 정렬이 없다.** 그래서 새로 올라온 매물을 찾으려면
 * 지도를 옮겨 가며 눈으로 훑는 수밖에 없었다. 그런데 화면이 쓰는 내부 API에는
 * `articleSortType: 'DATE_DESC'` 가 있다 — 최신순은 만들어져 있고 화면에만 없다.
 * 이 파일은 그 API를 그대로 부른다.
 *
 * 로그인도, 브라우저도 필요 없다. 그래서 사장님 PC가 꺼져 있어도 Vercel 에서
 * 알아서 돈다(`/api/cron/naver-watch`).
 *
 * **레이트리밋이 있다.** 빠르게 여러 번 부르면 429(TOO_MANY_REQUESTS)가 떨어지고
 * 한동안 아무것도 못 받는다. 그래서 요청 사이를 반드시 띄우고(REQUEST_GAP_MS),
 * 최근 며칠치만 받는다. 전수 수집은 하지 않는다.
 */

const API = 'https://fin.land.naver.com/front-api/v1/article/boundedArticles'

/** 요청 사이 간격. 이보다 촘촘하면 429 가 난다. */
const REQUEST_GAP_MS = 1_200

/** 한 번 수집에서 한 구역당 최대 페이지. 폭주 방지용 안전장치. */
const MAX_PAGES = 8

/** 한 페이지 건수. API 스펙상 최대 30. */
const PAGE_SIZE = 30

/**
 * 매물종류 코드 → 이름. 네이버 번들에서 그대로 옮겼다.
 *
 * 상가·업무·토지만 담았다 — 아파트·빌라 같은 주거는 이 사무소가 다루지 않는다.
 */
export const REAL_ESTATE_TYPES = {
  D01: '사무실',
  D02: '상가',
  D03: '건물',
  D04: '상가건물',
  D05: '상가주택',
  E02: '공장/창고',
  E03: '토지',
  E04: '지식산업센터',
} as const

export type RealEstateType = keyof typeof REAL_ESTATE_TYPES

/** 거래유형 코드 → 이름. B3(단기임대)는 이 업종에서 안 쓴다. */
export const TRADE_TYPES = {
  A1: '매매',
  B1: '전세',
  B2: '월세',
} as const

export type TradeType = keyof typeof TRADE_TYPES

/**
 * 감시 구역.
 *
 * API 는 법정동 코드가 아니라 **지도 사각형**으로 받는다. 사각형은 시 경계와
 * 정확히 맞지 않아 옆 동네가 딸려 온다. 그래서 받은 뒤 `division` 이
 * `divisionPrefix` 로 시작하는 것만 남긴다 — 사각형은 넉넉히, 걸러내기는 정확히.
 *
 * 구 단위로 나눠 둔 이유는 사각형이 클수록 API 가 결과를 줄여서다.
 */
export const REGIONS = [
  {
    id: 'cheonan-dongnam',
    name: '천안시 동남구',
    divisionPrefix: '천안시 동남구',
    boundingBox: { left: 127.10, right: 127.45, top: 36.87, bottom: 36.62 },
  },
  {
    id: 'cheonan-seobuk',
    name: '천안시 서북구',
    divisionPrefix: '천안시 서북구',
    boundingBox: { left: 127.03, right: 127.24, top: 37.03, bottom: 36.75 },
  },
  {
    id: 'asan',
    name: '아산시',
    divisionPrefix: '아산시',
    boundingBox: { left: 126.83, right: 127.15, top: 37.00, bottom: 36.69 },
  },
] as const

export type RegionId = (typeof REGIONS)[number]['id']

/**
 * 매물 한 건. 표의 열과 이름을 맞춰 둔다.
 *
 * **무엇을 눌러 볼지 고르는 데 필요한 것만 담는다.** 응답에는 가격·면적·사진·
 * 중개사도 들어 있지만 저장하지 않는다 — 화면은 링크 목록이고, 값은 눌러
 * 들어가서 직접 보기 때문이다. 안 쓰는 값을 쌓아 두면 네이버가 고칠 때마다
 * 같이 깨질 곳만 늘어난다.
 */
export type NaverArticle = {
  article_no: string
  real_estate_type: string
  trade_type: string
  division: string | null
  sector: string | null
  exposure_start_date: string | null
}

type BoundingBox = { left: number; right: number; top: number; bottom: number }

const HEADERS = {
  'content-type': 'application/json',
  accept: 'application/json',
  'accept-language': 'ko-KR,ko;q=0.9',
  origin: 'https://fin.land.naver.com',
  referer: 'https://fin.land.naver.com/map',
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/**
 * 한 페이지를 받는다.
 *
 * 429 는 "잠깐 쉬라"는 뜻이지 오류가 아니다. 한 번은 더 기다렸다 다시 부른다.
 * 그래도 안 되면 그 구역은 이번 수집에서 포기한다 — 다음 회차에 다시 받으면 된다.
 */
async function fetchPage(
  boundingBox: BoundingBox,
  types: readonly string[],
  tradeTypes: readonly string[],
  lastInfo: unknown[],
): Promise<{ list: Record<string, any>[]; lastInfo: unknown[]; hasNextPage: boolean; totalCount: number }> {
  const body = {
    filter: {
      tradeTypes,
      realEstateTypes: types,
      roomCount: [], bathRoomCount: [], optionTypes: [], oneRoomShapeTypes: [], moveInTypes: [],
      filtersExclusiveSpace: false, floorTypes: [], directionTypes: [],
      hasArticlePhoto: false, isAuthorizedByOwner: false, parkingTypes: [], entranceTypes: [],
      hasArticle: false,
    },
    boundingBox,
    precision: 15,
    userChannelType: 'PC',
    articlePagingRequest: {
      size: PAGE_SIZE,
      userChannelType: 'PC',
      articleSortType: 'DATE_DESC',
      lastInfo,
    },
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(API, { method: 'POST', headers: HEADERS, body: JSON.stringify(body) })
    if (res.status === 429) {
      await sleep(5_000)
      continue
    }
    if (!res.ok) throw new Error(`네이버 응답 ${res.status}`)
    const json = await res.json()
    if (!json?.isSuccess) throw new Error(`네이버 거절: ${json?.detailCode ?? '알 수 없음'}`)
    return {
      list: json.result?.list ?? [],
      lastInfo: json.result?.lastInfo ?? [],
      hasNextPage: !!json.result?.hasNextPage,
      totalCount: json.result?.totalCount ?? 0,
    }
  }
  throw new Error('네이버가 계속 요청을 거절합니다 (429)')
}

/** API 응답 한 건을 표의 한 행으로. */
function normalize(raw: Record<string, any>): NaverArticle | null {
  const a = raw?.representativeArticleInfo
  if (!a?.articleNumber) return null
  return {
    article_no: String(a.articleNumber),
    real_estate_type: a.realEstateType,
    trade_type: a.tradeType,
    division: a.address?.division ?? null,
    sector: a.address?.sector ?? null,
    exposure_start_date: a.verificationInfo?.exposureStartDate ?? null,
  }
}

/**
 * 한 구역의 최근 매물을 최신순으로 받는다.
 *
 * `since` 보다 오래된 광고가 나오면 멈춘다. 최신순이라 그 뒤는 볼 것이 없다.
 *
 * @param region  REGIONS 의 한 항목
 * @param since   'YYYY-MM-DD'. 이 날짜보다 앞선 광고는 받지 않는다
 */
export async function fetchRecentArticles(
  region: (typeof REGIONS)[number],
  since: string,
): Promise<NaverArticle[]> {
  const types = Object.keys(REAL_ESTATE_TYPES)
  const trades = Object.keys(TRADE_TYPES)
  const rows: NaverArticle[] = []
  let lastInfo: unknown[] = []

  for (let page = 0; page < MAX_PAGES; page++) {
    if (page > 0) await sleep(REQUEST_GAP_MS)
    const res = await fetchPage(region.boundingBox, types, trades, lastInfo)
    const batch = res.list.map(normalize).filter((r): r is NaverArticle => r !== null)
    // 사각형이 시 경계보다 넓어 옆 동네가 섞여 온다. 여기서 잘라낸다.
    rows.push(...batch.filter(r => r.division?.startsWith(region.divisionPrefix)))

    const oldest = batch.at(-1)?.exposure_start_date
    if (!res.hasNextPage || (oldest && oldest < since)) break
    lastInfo = res.lastInfo
  }

  return rows
}

/** 구역 사이 간격 — 다음 구역으로 넘어갈 때도 쉬어야 429 를 피한다. */
export const REGION_GAP_MS = REQUEST_GAP_MS
