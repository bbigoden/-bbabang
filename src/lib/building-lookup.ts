// 건축물대장 자동채움 핵심 — 웹(/api/properties/auto-fill)과 일괄 채우기 스크립트(scripts/backfill-area.mjs)가 같이 쓴다.
// Node 가 이 파일을 바로 읽을 수 있게 import 를 두지 않는다 — 키와 용도 매핑은 받아 쓴다.

export interface LookupDeps {
  seumKey: string
  kakaoKey: string
  mapRoomType: (purps: string) => string | null
}

const SEUM_BASE = 'https://apis.data.go.kr/1613000/BldRgstHubService'

export interface AutoFillBody {
  address?: string
  bcode?: string
  sigunguCd?: string
  bjdongCd?: string
  bun?: string
  ji?: string
  ho?: string
  platGbCd?: string
  /** 주소에 적힌 층(지하는 음수) — 일반건축물에서 그 층 면적을 고른다 */
  floor?: number | null
}

async function geocodeAddress(address: string, kakaoKey: string): Promise<{ sigunguCd: string; bjdongCd: string; bun: string; ji: string } | null> {
  try {
    const key = kakaoKey.trim()
    if (!key) return null
    const url = `https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(address)}&analyze_type=similar`
    // next.revalidate 는 웹(Next)에서만 하루 캐시로 쓰이고 Node 스크립트에선 무시된다
    const res = await fetch(url, { headers: { Authorization: `KakaoAK ${key}` }, next: { revalidate: 86400 } })
    if (!res.ok) {
      console.error('[geocode] kakao api error', res.status, res.statusText)
      return null
    }
    const json = await res.json().catch((e: unknown) => { console.error('[geocode] json parse error', e); return null })
    const doc = json?.documents?.[0]
    if (!doc) return null
    const bCode: string = doc.address?.b_code ?? ''
    if (bCode.length !== 10) return null
    return {
      sigunguCd: bCode.slice(0, 5),
      bjdongCd: bCode.slice(5),
      bun: doc.address?.main_address_no ?? '',
      ji: doc.address?.sub_address_no || '0',
    }
  } catch (e) {
    console.error('[geocode] unexpected error', e)
    return null
  }
}

interface SeumItem {
  [k: string]: string | number | undefined
}

async function fetchWithTimeout(url: string, timeoutMs = 20000): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { cache: 'no-store', signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

async function callSeumPage(url: string, retries = 2): Promise<{ items?: { item?: unknown }; totalCount?: unknown } | null> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetchWithTimeout(url)
      if (!res.ok) {
        if (attempt < retries) await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)))
        continue
      }
      const json = await res.json().catch(() => null)
      const body = json?.response?.body
      if (!body) {
        if (attempt < retries) await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)))
        continue
      }
      return body
    } catch {
      if (attempt < retries) await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)))
    }
  }
  return null
}

async function callSeum(seumKey: string, endpoint: string, params: Record<string, string>, strict = false): Promise<SeumItem[]> {
  const PAGE_SIZE = 100
  const all: SeumItem[] = []

  for (let page = 1; page <= 100; page++) {
    const url = new URL(`${SEUM_BASE}/${endpoint}`)
    url.searchParams.set('serviceKey', seumKey)
    url.searchParams.set('numOfRows', String(PAGE_SIZE))
    url.searchParams.set('pageNo', String(page))
    url.searchParams.set('startDate', '')
    url.searchParams.set('endDate', '')
    url.searchParams.set('_type', 'json')
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)

    const body = await callSeumPage(url.toString())
    // 세움터가 시간 초과(SERVICETIMEOUT)로 답을 못 하면 '건물 없음'이 아니라 오류다 — 예전엔 빈 결과로 보고
    // "건축물대장에 없는 주소예요"라고 안내했다(11-02 일괄 점검에서 멀쩡한 주소 여럿이 그렇게 나옴)
    if (!body) {
      if (page === 1 && strict) throw new Error('seum_unavailable')
      break
    }
    const item = body?.items?.item
    if (!item) break
    const rows = Array.isArray(item) ? item : [item]
    all.push(...rows)
    if (all.length >= Number(body?.totalCount ?? 0) || rows.length < PAGE_SIZE) break
  }

  return all
}

const pad4 = (s: string) => String(s || '0').padStart(4, '0')


function formatDate(s: unknown): string | null {
  const str = String(s ?? '')
  if (str.length !== 8) return null
  return `${str.slice(0, 4)}-${str.slice(4, 6)}-${str.slice(6, 8)}`
}

const m2ToPyeong = (m2: number) => +(m2 / 3.305785).toFixed(2)

function parseFloor(item: SeumItem): number | null {
  const nm = String(item.flrNoNm ?? '')
  if (nm.includes('~')) return null  // 지하1층~지상8층 등 범위 표기는 단일 층 특정 불가
  if (String(item.flrGbCd ?? '') === '10' || nm.includes('지하')) {
    const n = nm.replace(/[^0-9]/g, '')
    return n ? -Number(n) : (Number(item.flrNo) > 0 ? -Number(item.flrNo) : -1)
  }
  return Number(nm.replace(/[^0-9-]/g, '')) || null
}

export async function lookupBuilding(body: AutoFillBody, deps: LookupDeps): Promise<{ status: number; data: Record<string, unknown> }> {
    const { ho, platGbCd } = body
    const wantFloor = typeof body.floor === 'number' && body.floor !== 0 ? body.floor : null
    let { sigunguCd, bjdongCd, bun, ji } = body

    if (body.bcode && body.bcode.length === 10 && !sigunguCd) {
      sigunguCd = body.bcode.slice(0, 5)
      bjdongCd = body.bcode.slice(5)
      if (!bun && body.address) {
        // "불당동 1421 101동" 처럼 동(棟)번호로 끝나는 경우 제거 후 본번 추출
        const addrForBun = body.address.trim().replace(/\s+\d+동\s*$/, '').trim()
        const m = addrForBun.match(/(\d+)(?:-(\d+))?\s*$/)
        if (m) { bun = m[1]; ji = m[2] || '0' }
      }
    } else if (body.address && (!sigunguCd || !bjdongCd || !bun)) {
      const geo = await geocodeAddress(body.address, deps.kakaoKey)
      if (!geo) return { status: 400, data: { error: 'address_not_found' } }
      sigunguCd = geo.sigunguCd
      bjdongCd = geo.bjdongCd
      bun = geo.bun
      ji = geo.ji
      // 카카오 '비슷한 주소' 검색은 부번을 떼기도 한다 — '불당동 1542-1 엘림프라자' → 1542 로 돌아와
      // 옆 건물 대장을 뒤졌다(11-01). 적힌 본번이 같고 부번이 비어 돌아오면 적힌 부번을 쓴다.
      const lot = body.address.match(/(?:동|리|가)\s+(?:산\s*)?(\d+)-(\d+)(?![\d-])/)
      if (lot && lot[1] === bun && (!ji || ji === '0')) ji = lot[2]
    }

    if (!sigunguCd || !bjdongCd || !bun) {
      return { status: 400, data: { error: 'missing_fields' } }
    }

    // 주소에서 동(棟)번호 추출 (101동, 102동 등) — 다동 건물 필터링용
    const dongFilterMatch = body.address?.match(/\b(\d+)동(?:\s|$)/)
    const dongFilter = dongFilterMatch ? `${dongFilterMatch[1]}동` : ''

    const addr = {
      sigunguCd,
      bjdongCd,
      platGbCd: platGbCd ?? '0',
      bun: pad4(bun),
      ji: pad4(ji ?? '0'),
    }
    // 동(棟)이 지정되면 세움터 API의 dongNm 파라미터로 직접 필터 → 페이지 fetching 대폭 감소
    const dongParam: Record<string, string> = dongFilter ? { dongNm: dongFilter } : {}

    // 전유공용면적은 표제부 결과와 상관없이 같은 주소로 묻는다 — 먼저 띄워 두고 표제부와 같이 기다린다.
    // 차례로 물으면 등록 버튼이 3.7초 걸렸다(11-06 점검). 실패는 아래 await 에서 그대로 던진다.
    const exposFirst = callSeum(deps.seumKey, 'getBrExposPubuseAreaInfo', { ...addr, ...dongParam, regstrKindCd: '4' })
    exposFirst.catch(() => {})
    try {
      let title = await callSeum(deps.seumKey, 'getBrTitleInfo', { ...addr, ...dongParam, regstrKindCd: '4' }, true)
      if (title.length === 0) title = await callSeum(deps.seumKey, 'getBrTitleInfo', { ...addr, ...dongParam }, true)
      if (title.length === 0) {
        return { status: 404, data: { error: 'building_not_found' } }
      }

      // 동번호가 지정된 경우 해당 동의 표제부 선택
      const t = (dongFilter ? title.find(x => String(x.dongNm ?? '') === dongFilter) : null) ?? title[0]
      const totalFloors = Number(t.grndFlrCnt) || null
      const approvalDate = formatDate(t.useAprDay)
      const calcParking = (row: SeumItem) =>
        (Number(row.indrAutoUtcnt) || 0)
        + (Number(row.oudrAutoUtcnt) || 0)
        + (Number(row.indrMechUtcnt) || 0)
        + (Number(row.oudrMechUtcnt) || 0)
      let parkingTotal = calcParking(t)
      // 일부 단지는 동별 표제부에 주차 정보 없음 → 단지 전체 표제부 max → 총괄표제부 순으로 fallback
      if (parkingTotal === 0 && dongFilter) {
        const allTitles = await callSeum(deps.seumKey, 'getBrTitleInfo', { ...addr, regstrKindCd: '4' })
        const allMax = allTitles.reduce((m, row) => Math.max(m, calcParking(row)), 0)
        if (allMax > 0) parkingTotal = allMax
      }
      if (parkingTotal === 0) {
        // 아파트 단지는 총괄표제부에 단지 전체 주차(실내+옥외) 들어있음
        const recap = await callSeum(deps.seumKey, 'getBrRecapTitleInfo', addr)
        const recapMax = recap.reduce((m, row) => Math.max(m, calcParking(row)), 0)
        if (recapMax > 0) parkingTotal = recapMax
      }
      const mainPurps = String(t.mainPurpsCdNm ?? '')
      const buildingName = String(t.bldNm ?? '').trim() || null

      let floor: number | null = null
      let areaM2 = 0
      let areaSuppliedM2 = 0  // 공급 = 전용 + 주거공용
      let yongdoNm = ''

      let expos = await exposFirst
      if (expos.length === 0) expos = await callSeum(deps.seumKey, 'getBrExposPubuseAreaInfo', { ...addr, ...dongParam })

      if (expos.length > 0) {
        const num = (s: unknown): number => {
          const d = String(s ?? '').replace(/[^0-9]/g, '')
          return d ? Number(d) : 0
        }
        const hoInt = num(ho)
        const dongInt = num(dongFilter)
        // 전유부 dongNm 분포 — 비어있으면(예: 1466 호반금호어울림) 동 필터 우회
        const exposDongsMeaningful = new Set(
          expos.map(f => String(f.dongNm ?? '').trim()).filter(d => d)
        )
        const dongDataMissing = exposDongsMeaningful.size === 0

        const matchHo = (f: SeumItem) => num(f.hoNm) === hoInt
        const matchDong = (f: SeumItem) => {
          if (dongInt === 0) return true
          if (dongDataMissing) return true
          return num(f.dongNm) === dongInt
        }
        const RESIDENTIAL = ['벽체', '계단', '승강기', '복도', '현관', '엘리베이터']
        const isResidentialPublic = (f: SeumItem) => {
          if (String(f.exposPubuseGbCd ?? '') !== '2') return false
          const txt = `${f.etcPurps ?? ''} ${f.mainPurpsCdNm ?? ''}`
          return RESIDENTIAL.some(k => txt.includes(k))
        }

        let matched: SeumItem[] = []
        if (hoInt) {
          matched = expos.filter(f => matchHo(f) && matchDong(f))
          // 동 미지정 시에만 호만으로 매칭 (동 지정됐는데 매칭 실패면 폴백 X — 잘못된 데이터 차단)
          if (matched.length === 0 && dongInt === 0) {
            matched = expos.filter(matchHo)
          }
        }
        // ho 없이 전유부 있는 다세대 단지: 1층 전체 합산하면 1000평+ 사고 → 면적 매칭 자체 skip
        const target = hoInt
          ? matched
          : []

        if (target.length > 0) {
          // 변경이력으로 mgmBldrgstPk만 다른 완전 동일 row → 합산 시 면적 2배 사고 →
          // (dongNm, hoNm, flrNoNm, exposPubuseGbCd, area) 동일 row 한 행만 유지.
          const seen = new Set<string>()
          const deduped: SeumItem[] = []
          for (const f of target) {
            const k = [
              String(f.dongNm ?? ''),
              String(f.hoNm ?? ''),
              String(f.flrNoNm ?? ''),
              String(f.exposPubuseGbCd ?? ''),
              String(f.area ?? ''),
            ].join('|')
            if (seen.has(k)) continue
            seen.add(k)
            deduped.push(f)
          }
          const dedup = deduped

          const exclusive = dedup.filter(f => f.exposPubuseGbCd === '1')
          areaM2 = exclusive.reduce((sum, f) => sum + (Number(f.area) || 0), 0)
          const areaResidential = dedup.filter(isResidentialPublic).reduce((sum, f) => sum + (Number(f.area) || 0), 0)
          areaSuppliedM2 = areaM2 + areaResidential
          // 층 정보는 전용면적 행 우선(공용 행은 flrNoNm이 "각층"으로 층수 미표기)
          const flrSource = exclusive.length > 0 ? exclusive[0] : dedup[0]
          floor = parseFloor(flrSource)
          // flrNoNm이 호수와 같으면(예: 1626 "101", 707 "502") 층 신뢰 불가 → null
          if (floor !== null && ho) {
            const srcFlrnm = String(flrSource.flrNoNm ?? '').replace(/[^0-9]/g, '')
            if (srcFlrnm && srcFlrnm === String(ho).replace(/[^0-9]/g, '')) {
              floor = null
            }
          }
          yongdoNm = String(flrSource.mainPurpsCdNm ?? '')
        }
      } else {
        const flrs = await callSeum(deps.seumKey, 'getBrFlrOulnInfo', addr)
        // 주소에 적힌 층('4층전체'·'지하1층')이 있으면 그 층 — 예전엔 층을 버리고 1층 면적을 넣었다(11-01 일괄 채우기 점검)
        const target = ho
          ? flrs.filter(f => String(f.flrNoNm ?? '').includes(ho))
          : wantFloor != null
            ? flrs.filter(f => parseFloor(f) === wantFloor)
            // flrNo 만 보면 지하1층도 1 이라 지상1층과 합쳐졌다 — 지상 1층만
            : flrs.filter(f => parseFloor(f) === 1)
        if (target.length > 0) {
          // 같은 지번에 여러 동이 있는 일반건축물: 면적 합산 (예: 1동 912㎡ + 2동 96㎡ = 1008㎡)
          areaM2 = target.reduce((sum, f) => sum + (Number(f.area) || 0), 0)
          floor = parseFloor(target[0])
          yongdoNm = String(target[0].mainPurpsCdNm ?? '')
        } else if (flrs.length > 0 && !ho && wantFloor == null) {
          // 호수·층을 콕 집었는데 못 찾았으면 아무 층이나 넣지 않는다(102호 → 첫 층 665평이 들어갈 뻔)
          areaM2 = Number(flrs[0].area) || 0
          yongdoNm = String(flrs[0].mainPurpsCdNm ?? '')
        }
      }

      let sizePyeong = areaM2 > 0 ? m2ToPyeong(areaM2) : null
      let sizePyeongSupplied = areaSuppliedM2 > 0 ? m2ToPyeong(areaSuppliedM2) : null
      // ho 지정 시 해당 유닛 용도 우선, ho 없으면 건물 전체 용도(mainPurps) 우선
      // 호실 용도는 '의원'·'소매점'처럼 세부로 적혀 '기타'가 되기 쉽다 — 그러면 건물 용도(제1종근린생활시설 등)를 쓴다.
      // (11-01 엘림프라자 205호 '의원' → '기타'로 상가 유형을 덮어씀)
      const unitType = deps.mapRoomType(yongdoNm)
      const bldType = deps.mapRoomType(mainPurps)
      const roomType = ho
        ? (unitType && unitType !== '기타' ? unitType : bldType || unitType)
        : bldType || unitType

      // ─────────────────────────────────────────────────────────────
      // 결과 Sanity Check — 잘못된 데이터를 절대 DB에 흘리지 않음.
      // ─────────────────────────────────────────────────────────────
      let safeTotalFloors: number | null = totalFloors
      let safeApprovalDate: string | null = approvalDate
      let safeParking = parkingTotal
      let safeAreaM2 = areaM2
      let safeAreaSuppliedM2 = areaSuppliedM2

      // S1: floor > total_floors 모순 → floor null
      if (floor !== null && safeTotalFloors !== null && floor > safeTotalFloors) floor = null
      // S2: floor < -10 (지하 10층 이하는 사실상 없음)
      if (floor !== null && floor < -10) floor = null
      // S3: total_floors > 100
      if (safeTotalFloors !== null && safeTotalFloors > 100) safeTotalFloors = null
      // S4: total_floors == 0
      if (safeTotalFloors === 0) safeTotalFloors = null
      // S5: 공급 < 전용 → 공급=전용 강제
      if (safeAreaM2 > 0 && safeAreaSuppliedM2 > 0 && safeAreaSuppliedM2 < safeAreaM2) {
        safeAreaSuppliedM2 = safeAreaM2
        sizePyeongSupplied = m2ToPyeong(safeAreaSuppliedM2)
      }
      // S6: 호 지정 + 1평 미만 → 데이터 의심
      if (ho && safeAreaM2 > 0 && safeAreaM2 < 3.3) {
        safeAreaM2 = 0; safeAreaSuppliedM2 = 0; sizePyeong = null; sizePyeongSupplied = null
      }
      // S7: 호 지정 + 다세대 200평 초과 → 매칭 오류 의심
      const SUSPECT_BIG = new Set(['아파트', '오피스텔', '빌라/연립', '단독/다가구',
        '1종(상가)', '2종(상가)', '업무(상가)', '의료(상가)', '판매(상가)', '교육(상가)', '운동(상가)', '숙박'])
      if (ho && sizePyeong !== null && sizePyeong > 200 && roomType && SUSPECT_BIG.has(roomType)) {
        safeAreaM2 = 0; safeAreaSuppliedM2 = 0; sizePyeong = null; sizePyeongSupplied = null
      }
      // S8: 사용승인일 미래/1900년 이전
      if (safeApprovalDate) {
        const m = safeApprovalDate.match(/^(\d{4})-(\d{2})-(\d{2})$/)
        if (!m) {
          safeApprovalDate = null
        } else {
          const d = new Date(safeApprovalDate)
          const today = new Date()
          const year = Number(m[1])
          if (isNaN(d.getTime()) || d > today || year < 1900) safeApprovalDate = null
        }
      }
      // S9: 주차 > 10000 또는 음수
      if (safeParking > 10000 || safeParking < 0) safeParking = 0

      return { status: 200, data: {
        size_m2: safeAreaM2 > 0 ? +safeAreaM2.toFixed(2) : null,
        size_pyeong: sizePyeong,
        size_m2_supplied: safeAreaSuppliedM2 > 0 ? +safeAreaSuppliedM2.toFixed(2) : null,
        size_pyeong_supplied: sizePyeongSupplied,
        floor,
        total_floors: safeTotalFloors,
        approval_date: safeApprovalDate,
        parking: safeParking > 0 ? String(safeParking) : null,
        room_type: roomType,
        building_name: buildingName,
        main_purpose: mainPurps || null,
      } }
    } catch (err) {
      console.error('[auto-fill] error', err)
      return { status: 502, data: { error: 'upstream_fetch_failed' } }
    }
}
