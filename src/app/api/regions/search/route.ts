import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/rate-limit'

export type RegionHit = {
  sido: string          // 충청남도
  sigungu: string       // 천안시 서북구
  dong: string | null   // 불당동 (NULL=시·군·구 전체)
  label: string         // "충청남도 천안시 서북구 불당동" 또는 "...전체"
}

// Kakao 응답의 약칭 sido → 부소장에서 쓰는 풀네임. request_posts.city와 일관성 유지.
const SIDO_FULL: Record<string, string> = {
  '서울': '서울특별시', '부산': '부산광역시', '대구': '대구광역시', '인천': '인천광역시',
  '광주': '광주광역시', '대전': '대전광역시', '울산': '울산광역시', '세종': '세종특별자치시',
  '경기': '경기도', '강원': '강원특별자치도', '충북': '충청북도', '충남': '충청남도',
  '전북': '전북특별자치도', '전남': '전라남도', '경북': '경상북도', '경남': '경상남도',
  '제주': '제주특별자치도',
}

/**
 * Kakao 주소 검색 API 래퍼.
 * 사용자 입력으로 행정안전부 표준 주소를 자동완성한다.
 *
 * GET /api/regions/search?q=신부동
 *  → { results: [{ sido, sigungu, dong, label }, ...] }
 *
 * 모든 결과는 region_3depth(동·면) 단위까지 노출. 중복 행정동·법정동은 dedupe.
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q')?.trim()
  if (!q || q.length < 2) return NextResponse.json({ results: [] })

  // Rate limit: IP당 분당 30회 (Kakao API quota 보호 + 봇 방지)
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown'
  const allowed = await checkRateLimit(`ip:${ip}:regions-search`, 30, 60)
  if (!allowed) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 })
  }

  const key = process.env.KAKAO_REST_KEY
  if (!key) return NextResponse.json({ error: 'config_missing_kakao_key' }, { status: 500 })

  // Kakao 키워드 검색 API: 부분 매칭 가능. POI 결과에서 행정구역(address_name)만 추출
  const url = `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(q)}&size=15`

  let r: Response
  try {
    r = await fetch(url, { headers: { Authorization: `KakaoAK ${key}` }, next: { revalidate: 0 } })
  } catch {
    return NextResponse.json({ error: 'upstream_fetch_failed' }, { status: 502 })
  }
  if (!r.ok) {
    return NextResponse.json({ error: 'upstream_error', status: r.status }, { status: 502 })
  }

  // 키워드 검색은 POI 결과를 반환. address_name 문자열을 파싱해 행정구역만 추출·dedupe.
  const json = await r.json() as {
    documents?: Array<{ address_name?: string }>
  }

  const seen = new Set<string>()
  const seenSigungu = new Set<string>()
  const sigunguHits: RegionHit[] = []
  const dongHits: RegionHit[] = []

  for (const doc of json.documents ?? []) {
    const addr = (doc.address_name ?? '').trim()
    if (!addr) continue
    // 지번 주소: "충청남도 천안시 서북구 불당동 123-45" 형식
    // 앞 4토큰만 취해 [sido, sigungu(1~2토큰), dong] 분해. sigungu가 "천안시 서북구"처럼 2토큰인 케이스 포함.
    const tokens = addr.split(/\s+/)
    if (tokens.length < 3) continue
    const rawSido = tokens[0]
    const sido = SIDO_FULL[rawSido] ?? rawSido
    // dong: 동/면/읍/리/가/로/길 등으로 끝나는 토큰 중 첫 번째
    const dongIdx = tokens.findIndex((t, i) => i > 0 && /(동|면|읍|리|가)$/.test(t))
    if (dongIdx < 0) continue
    const dong = tokens[dongIdx]
    const sigungu = tokens.slice(1, dongIdx).join(' ')
    if (!sido || !sigungu || !dong) continue
    const key = `${sido}|${sigungu}|${dong}`
    if (!seen.has(key)) {
      seen.add(key)
      dongHits.push({ sido, sigungu, dong, label: `${sido} ${sigungu} ${dong}` })
    }
    // 시·군·구 전체 후보 (dong=null) — 처음 등장하는 시군구마다 한 번씩
    const sigunguKey = `${sido}|${sigungu}`
    if (!seenSigungu.has(sigunguKey)) {
      seenSigungu.add(sigunguKey)
      sigunguHits.push({ sido, sigungu, dong: null, label: `${sido} ${sigungu} 전체` })
    }
  }

  // "시·군·구 전체" 옵션을 상단으로 정렬 (시 전체로 받고 싶은 사용자 발견 쉽게)
  return NextResponse.json({ results: [...sigunguHits, ...dongHits] })
}
