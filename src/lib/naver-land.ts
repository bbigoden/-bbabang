/**
 * 네이버부동산(fin.land.naver.com) 매물 조회.
 *
 * 네이버부동산 **화면에는 최신순 정렬이 없다.** 그래서 새로 올라온 매물을 찾으려면
 * 지도를 옮겨 가며 눈으로 훑는 수밖에 없었다. 그런데 화면이 쓰는 내부 API에는
 * `articleSortType: 'DATE_DESC'` 가 있다 — 최신순은 만들어져 있고 화면에만 없다.
 * 이 파일은 그 API를 그대로 부른다.
 *
 * 로그인도 브라우저도 필요 없지만 **서버에서는 못 부른다** — 네이버가 데이터센터
 * IP를 막는다. 실제로 부르는 쪽은 사장님 PC의 광고 프로그램(`부소장광고`)이다.
 *
 * **사각형 하나로는 다 못 받는다.** 지도 API 라 밀집한 곳은 묶여서(클러스터)
 * 개별 목록에 안 나온다. 천안 서북구를 통째로 한 번에 부르면 읍·면 매물만 오고
 * 불당동·두정동 같은 도심이 통째로 빠졌다 — 실제로 불당동 54건 중 17건이
 * 안 들어왔다. 그래서 두 단계로 훑는다.
 *
 *   1. 클러스터로 **매물이 어디 있는지**만 받는다 (구역당 한 번)
 *   2. 매물이 있는 자리만 **작은 사각형**으로 나눠 목록을 받는다 (110개 남짓)
 *
 * 작은 사각형에서는 묶임이 없어 빠지는 것이 없다. 천안·아산 전체가 2~3분이다.
 *
 * **레이트리밋이 있다.** 빠르게 여러 번 부르면 429(TOO_MANY_REQUESTS)가 떨어지고
 * 한동안 아무것도 못 받는다. 그래서 요청 사이를 반드시 띄운다(REQUEST_GAP_MS).
 */

const API_ARTICLES = 'https://fin.land.naver.com/front-api/v1/article/boundedArticles'
const API_CLUSTERS = 'https://fin.land.naver.com/front-api/v1/article/map/articleClusters'

/** 요청 사이 간격. 이보다 촘촘하면 429 가 난다. */
const REQUEST_GAP_MS = 1_200

/**
 * 사각형 하나당 최대 페이지.
 *
 * 넉넉해야 한다. 여기서 잘리면 회차마다 잘리는 지점이 달라져(같은 날짜 안의
 * 순서는 seed 로 섞인다) 같은 매물이 며칠 뒤 다시 "처음 보는 것" 으로 뜬다.
 * 대부분의 사각형은 한두 장이면 날짜 기준에 걸려 알아서 멈춘다.
 */
const MAX_PAGES = 10

/**
 * 훑을 사각형의 크기(도).
 *
 * 지도에서 한 화면에 보이는 만큼이다. 이보다 크게 잡으면 밀집한 곳이 묶여
 * 목록에서 빠진다 — 그것 때문에 도심을 통째로 놓쳤다.
 */
const TILE_LON = 0.04
const TILE_LAT = 0.03

/** 클러스터를 받을 때의 격자 굵기. 13 이 API 가 받는 가장 굵은 값이다. */
const CLUSTER_PRECISION = 13

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
 * `searchBox` 는 **어디에 매물이 있는지 찾을 범위**다. 실제 목록은 그 안에서
 * 매물이 있는 자리만 작은 사각형으로 나눠 받는다.
 *
 * 사각형은 시 경계와 정확히 맞지 않아 옆 동네가 딸려 온다. 받은 뒤 `division` 이
 * `divisionPrefix` 로 시작하는 것만 남긴다 — 범위는 넉넉히, 걸러내기는 정확히.
 */
export const REGIONS = [
  {
    id: 'cheonan-dongnam',
    name: '천안시 동남구',
    divisionPrefix: '천안시 동남구',
    searchBox: { left: 127.10, right: 127.45, top: 36.87, bottom: 36.62 },
  },
  {
    id: 'cheonan-seobuk',
    name: '천안시 서북구',
    divisionPrefix: '천안시 서북구',
    searchBox: { left: 127.03, right: 127.24, top: 37.03, bottom: 36.75 },
  },
  {
    id: 'asan',
    name: '아산시',
    divisionPrefix: '아산시',
    searchBox: { left: 126.83, right: 127.15, top: 37.00, bottom: 36.69 },
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
  /** 우리 사무소가 올린 매물을 빼는 데만 쓴다. 화면에는 안 적는다. */
  brokerage_name: string | null
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
  lastInfo: unknown[],
): Promise<{ list: Record<string, any>[]; lastInfo: unknown[]; hasNextPage: boolean }> {
  const body = {
    filter: articleFilter(),
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
    const res = await fetch(API_ARTICLES, { method: 'POST', headers: HEADERS, body: JSON.stringify(body) })
    if (res.status === 429) {
      await sleep(3_000)
      continue
    }
    if (!res.ok) throw new Error(`네이버 응답 ${res.status}`)
    const json = await res.json()
    if (!json?.isSuccess) throw new Error(`네이버 거절: ${json?.detailCode ?? '알 수 없음'}`)
    return {
      list: json.result?.list ?? [],
      lastInfo: json.result?.lastInfo ?? [],
      hasNextPage: !!json.result?.hasNextPage,
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
    brokerage_name: a.brokerInfo?.brokerageName ?? null,
  }
}

/** 매물 필터. 한 벌로 만들어 두 API 에 같이 쓴다. */
function articleFilter() {
  return {
    tradeTypes: Object.keys(TRADE_TYPES),
    realEstateTypes: Object.keys(REAL_ESTATE_TYPES),
    roomCount: [], bathRoomCount: [], optionTypes: [], oneRoomShapeTypes: [], moveInTypes: [],
    filtersExclusiveSpace: false, floorTypes: [], directionTypes: [],
    hasArticlePhoto: false, isAuthorizedByOwner: false, parkingTypes: [], entranceTypes: [],
    hasArticle: false,
  }
}

/**
 * 매물이 **어디에** 있는지만 받아, 훑을 사각형 목록으로 바꾼다.
 *
 * 클러스터 API 는 굵은 격자로 "여기 몇 건" 만 알려준다. 한 구역에 한 번이면 되고,
 * 그 좌표들을 사각형 칸에 담으면 매물이 없는 산·논은 통째로 건너뛴다.
 * 천안·아산 전체가 110개 남짓으로 줄어든다.
 */
async function discoverTiles(region: (typeof REGIONS)[number]): Promise<BoundingBox[]> {
  const res = await fetch(API_CLUSTERS, {
    method: 'POST', headers: HEADERS,
    body: JSON.stringify({
      filter: articleFilter(),
      boundingBox: region.searchBox,
      precision: CLUSTER_PRECISION,
      userChannelType: 'PC',
    }),
  })
  if (!res.ok) throw new Error(`네이버 응답 ${res.status}`)
  const json = await res.json()
  if (!json?.isSuccess) throw new Error(`네이버 거절: ${json?.detailCode ?? '알 수 없음'}`)

  const cells = new Set<string>()
  for (const c of json.result?.clusters ?? []) {
    const x = Math.floor(c.coordinates.xCoordinate / TILE_LON)
    const y = Math.floor(c.coordinates.yCoordinate / TILE_LAT)
    cells.add(`${x}/${y}`)
  }
  return [...cells].map(k => {
    const [x, y] = k.split('/').map(Number)
    return {
      left: x * TILE_LON, right: (x + 1) * TILE_LON,
      bottom: y * TILE_LAT, top: (y + 1) * TILE_LAT,
    }
  })
}

/**
 * 한 구역의 최근 매물을 받는다.
 *
 * 매물이 있는 자리만 작은 사각형으로 나눠 훑는다. 사각형마다 최신순으로 받다가
 * `since` 보다 오래된 광고가 나오면 그 사각형은 끝낸다.
 *
 * @param region  REGIONS 의 한 항목
 * @param since   'YYYY-MM-DD'. 이 날짜보다 앞선 광고는 받지 않는다
 * @param opts.onProgress  몇 번째 사각형인지 알려준다 (2~3분 걸려서 표시가 필요하다)
 */
export async function fetchRecentArticles(
  region: (typeof REGIONS)[number],
  since: string,
  { onProgress }: { onProgress?: (done: number, total: number) => void } = {},
): Promise<NaverArticle[]> {
  const tiles = await discoverTiles(region)
  const found = new Map<string, NaverArticle>()

  for (let t = 0; t < tiles.length; t++) {
    let lastInfo: unknown[] = []
    for (let page = 0; page < MAX_PAGES; page++) {
      await sleep(REQUEST_GAP_MS)
      const res = await fetchPage(tiles[t], lastInfo)
      const batch = res.list.map(normalize).filter((r): r is NaverArticle => r !== null)
      // 사각형이 시 경계를 넘어 옆 동네가 섞여 온다. 여기서 잘라낸다.
      for (const r of batch) {
        if (r.division?.startsWith(region.divisionPrefix)) found.set(r.article_no, r)
      }
      const oldest = batch.at(-1)?.exposure_start_date
      if (!res.hasNextPage || (oldest && oldest < since)) break
      lastInfo = res.lastInfo
    }
    onProgress?.(t + 1, tiles.length)
  }

  return [...found.values()]
}
