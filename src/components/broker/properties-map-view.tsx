'use client'

/**
 * 매물장 지도 뷰 — 카카오 핀(Marker) + 묶음(MarkerClusterer) + 우측 매물 패널.
 *
 * 매물장(page.tsx)에서 떼어 next/dynamic 으로 지도를 열 때만 받는다. 데이터(mapRows)는
 * 목록과 같은 조건(filterParams)으로 page 가 받아 넘기고, [목록에서 열기]도 page 가 쪽을 셈한다.
 * 주소→좌표 캐시와 '이미 저장한 매물' 기록은 지도를 닫았다 열어도 남아야 해서 page 의 ref 를 받는다.
 * 지도 인스턴스·핀은 이 컴포넌트와 같이 사라진다 — 닫았다 열면 새 컨테이너에 새로 만든다.
 */

import { useEffect, useRef, useState, useCallback, type MutableRefObject } from 'react'
import { ImagePlus, X, Loader2, LocateFixed } from 'lucide-react'
import type { createClient } from '@/lib/supabase/client'
import { useKakaoMapSdk } from '@/lib/use-kakao-map'
import { geocodeAddress } from '@/lib/geocode'
import { mapLimit } from '@/lib/map-limit'
import { useToast } from '@/components/toast'

// 지도 뷰 행 — map_office_properties 가 핀·우측 패널·[목록에서 열기]에 쓰는 칸만 준다
export interface MapRow {
  id: string
  seq_no: number | null
  address: string
  deal_type: string
  room_type: string
  status: 'available' | 'contracted' | 'hidden'
  price: number
  monthly_rent: number | null
  size_pyeong: string | null
  floor: number | null
  total_floors: string | null
  brief_memo: string | null
  images: string[]
  lat: number | null
  lng: number | null
}

// 지도용 거래형태 hex 색
const DEAL_TYPE_HEX_MAP: Record<string, string> = {
  매매: '#14274e', 전세: '#7c3aed', 월세: '#ea580c', 분양: '#db2777', 분양권: '#e11d48',
}

// 지도에서 좌표를 못 찾은 주소(정규화) → 기록 시각(ms). '지시푸 507-1504' 같은 엉터리 주소
// ~70건을 지도 열 때마다 다시 묻느라 분당 상한(60회)까지 먹었다 — 7일간 건너뛴다.
// 주소를 고치면 정규화 키가 바뀌어 다시 묻는다. 저장소가 막혀도 매번 다시 물을 뿐.
const GEOCODE_FAIL_KEY = 'busojang_geocode_fail'
const GEOCODE_FAIL_TTL_MS = 7 * 24 * 60 * 60 * 1000
function loadGeocodeFails(): Record<string, number> {
  try {
    const raw = JSON.parse(localStorage.getItem(GEOCODE_FAIL_KEY) || '{}')
    const now = Date.now()
    const fresh: Record<string, number> = {}
    for (const [k, t] of Object.entries(raw)) {
      if (typeof t === 'number' && now - t < GEOCODE_FAIL_TTL_MS) fresh[k] = t
    }
    return fresh
  } catch {
    return {}
  }
}
function saveGeocodeFails(fails: Record<string, number>) {
  try { localStorage.setItem(GEOCODE_FAIL_KEY, JSON.stringify(fails)) } catch { /* 기억 못 해도 다음에 다시 물을 뿐 */ }
}

// 지도 배경 지오코딩 — '못 찾는 주소'(200 + lat null)와 일시 오류(429 분당 상한·502·네트워크)를 가른다.
// geocodeAddress 는 둘 다 null 이라, 그대로 쓰면 멀쩡한 주소가 한 번 막혔다고 7일 빠진다.
async function geocodeForMap(address: string): Promise<{ lat: number; lng: number } | null | 'error'> {
  try {
    const res = await fetch('/api/geocode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address }),
    })
    if (!res.ok) return 'error'
    const data = await res.json()
    if (typeof data?.lat === 'number' && typeof data?.lng === 'number') return { lat: data.lat, lng: data.lng }
    return null
  } catch {
    return 'error'
  }
}


/** 찾은 좌표를 모았다가 이만큼 조용해지면 한꺼번에 저장한다 */
const COORD_FLUSH_MS = 1500
/** 좌표 저장 동시 요청 수 — 수백 건을 한 번에 쏘면 폰에서 줄이 막힌다 */
const COORD_SAVE_CONCURRENCY = 4

export function PropertiesMapView({
  mapRows, mapLoading, officeAddress, supabase, geocodeCacheRef, savedCoordIdsRef, onOpenImages, onJumpToList,
}: {
  mapRows: MapRow[]
  mapLoading: boolean
  officeAddress: string | null
  supabase: ReturnType<typeof createClient>
  geocodeCacheRef: MutableRefObject<Record<string, { lat: number; lng: number } | null>>
  savedCoordIdsRef: MutableRefObject<Set<string>>
  onOpenImages: (images: string[]) => void
  onJumpToList: (id: string) => void
}) {
  const toast = useToast()
  // 카카오 SDK(스크립트 4개)는 지도를 처음 열 때 받는다 — 목록만 보는 사람은 안 받는다
  const { status: mapStatus, ready: mapReady } = useKakaoMapSdk(true)
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const mapInstanceRef = useRef<any>(null)
  const markersRef = useRef<any[]>([])         // 카카오 Marker 인스턴스들
  const clustererRef = useRef<any>(null)        // MarkerClusterer
  const myLocOverlayRef = useRef<any>(null)     // 현 위치 파란 점 오버레이
  // 지도 마커 클릭 시 우측 사이드바(네이버 부동산 식)에 표시할 매물 그룹
  const [mapPanel, setMapPanel] = useState<{ address: string; items: MapRow[] } | null>(null)
  // 지도에 몇 건이 찍혔나 — 전체는 1,995건인데 핀이 ~975건이라 빠진 줄 몰랐다
  const [mapStat, setMapStat] = useState<{ placed: number; total: number; pending: number; failed: number } | null>(null)

  // ── 좌표 저장 — 찾는 대로 한 줄씩 UPDATE 하던 것을 모았다가 한꺼번에(동시 4개) ──
  // upsert 는 쓰지 않는다 — 일부 칸만 넣는 upsert 는 NOT NULL 칸에 걸린다. RLS 를 그대로 받는 update().eq('id').
  const coordQueueRef = useRef<Map<string, { lat: number; lng: number }>>(new Map())
  const coordTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const flushCoords = useCallback(() => {
    if (coordTimerRef.current) { clearTimeout(coordTimerRef.current); coordTimerRef.current = null }
    const batch = [...coordQueueRef.current]
    coordQueueRef.current.clear()
    if (!batch.length) return
    void mapLimit(batch, COORD_SAVE_CONCURRENCY, ([id, c]) =>
      supabase.from('broker_properties').update({ lat: c.lat, lng: c.lng }).eq('id', id).then(() => undefined))
  }, [supabase])
  const queueCoords = useCallback((id: string, coords: { lat: number; lng: number }) => {
    coordQueueRef.current.set(id, coords)
    if (coordTimerRef.current) clearTimeout(coordTimerRef.current)
    coordTimerRef.current = setTimeout(flushCoords, COORD_FLUSH_MS)
  }, [flushCoords])
  // 지도를 닫거나 앱을 내리면 기다리지 않고 바로 저장한다 — 모아 둔 좌표를 잃지 않게
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden') flushCoords() }
    document.addEventListener('visibilitychange', onHide)
    return () => { document.removeEventListener('visibilitychange', onHide); flushCoords() }
  }, [flushCoords])

  // 지도 뷰 렌더링 — Marker(SVG 핀) + MarkerClusterer + 클릭 시 정보 오버레이
  useEffect(() => {
    if (!mapReady) return
    let cancelled = false

    const renderMap = () => {
      if (cancelled || !mapContainerRef.current) return
      // 컨테이너가 아직 layout 안 됐으면 다음 프레임에 재시도 (race condition 방지)
      const rect = mapContainerRef.current.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) {
        requestAnimationFrame(renderMap)
        return
      }

      const kakao = (window as any).kakao

      // 지도 인스턴스 최초 생성
      if (!mapInstanceRef.current) {
        mapInstanceRef.current = new kakao.maps.Map(mapContainerRef.current, {
          center: new kakao.maps.LatLng(36.815, 127.114), // 폴백 좌표 — 아래에서 사무소 주소로 재중심
          level: 6,
        })
        // 사무소 주소 기준 초기 중심 — 매물이 있으면 어차피 setBounds가 덮어쓰지만,
        // 매물 없는 신규 사무소도 자기 동네에서 시작해야 한다 (지오코딩 실패 시 폴백 유지)
        if (officeAddress) {
          // JS SDK addressSearch는 라이브에서 CORS로 실패 — 매물 좌표와 동일하게 /api/geocode 사용
          // 핀이 먼저 꽂혀 화면을 맞췄으면 건드리지 않는다 (이제 핀을 기다림 없이 바로 꽂으므로 이 응답이 더 늦을 수 있다)
          geocodeAddress(officeAddress).then(coords => {
            if (coords && mapInstanceRef.current && markersRef.current.length === 0) {
              mapInstanceRef.current.setCenter(new kakao.maps.LatLng(coords.lat, coords.lng))
            }
          })
        }
        kakao.maps.event.addListener(mapInstanceRef.current, 'click', () => {
          setMapPanel(null)
        })
      } else {
        // 컨테이너 사이즈 변경(검색·뷰 전환) 후 타일·마커가 안 그려지는 문제 방지
        mapInstanceRef.current.relayout()
      }

      const map = mapInstanceRef.current

      // 기존 마커·정보창 정리
      if (clustererRef.current) { clustererRef.current.clear() }
      else {
        clustererRef.current = new kakao.maps.MarkerClusterer({
          map,
          averageCenter: true,
          minLevel: 4, // 줌 4 이상에서 클러스터링 — 동네·읍면 단위 축소 시에도 겹침 해소
          disableClickZoom: false,
          gridSize: 60,
          styles: [{
            width: '40px', height: '40px',
            background: '#14274e', color: '#fff',
            borderRadius: '20px', textAlign: 'center', lineHeight: '40px',
            fontSize: '13px', fontWeight: '700',
            boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
            border: '2px solid #fff',
          }],
        })
      }
      markersRef.current = []

      const targets = mapRows.filter(p => p.address)
      if (targets.length === 0) { setMapStat(null); return }
      // 주소에 천안·아산이 있는데 좌표가 그 바깥이면 주소 변환이 틀린 것이다(지번만 적힌 '아산시 680-125' 등)
      const inRegion = (addr: string, lat: number, lng: number) =>
        !/천안|아산/.test(addr) || (lat > 36.55 && lat < 37.1 && lng > 126.75 && lng < 127.4)

      // 거래형태가 "매매, 월세" 같은 멀티면 첫 번째 값 기준 색
      const pickPrimaryDeal = (d: string) => (d ?? '').split(',').map(s => s.trim()).filter(Boolean)[0] ?? ''

      const fmtAmount = (v: number) => {
        if (v >= 10000) {
          const uk = Math.floor(v / 10000)
          const man = v % 10000
          return uk + '억' + (man > 0 ? ' ' + man.toLocaleString() + '만' : '')
        }
        return v.toLocaleString() + '만'
      }
      const fmtPrice = (p: MapRow) => {
        const isWolse = (p.deal_type ?? '').includes('월세')
        if (isWolse) {
          // 월세: 보증금/월세 형식 (예: "500/60만")
          const dep = p.price != null ? p.price.toLocaleString() : '?'
          const mo = p.monthly_rent != null ? p.monthly_rent.toLocaleString() : '?'
          return `${dep}/${mo}만`
        }
        if (p.price == null) return '미정'
        return fmtAmount(p.price)
      }
      // SVG 핀(알약 모양) data URI 생성 — 모바일 가독성 위해 컴팩트하게
      const makePillIcon = (dealType: string, price: string, color: string) => {
        const label = `${dealType} ${price}`
        const charCount = [...label].length
        const width = Math.max(52, Math.min(120, charCount * 7 + 14))
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="26" viewBox="0 0 ${width} 26"><rect x="1" y="1" width="${width-2}" height="18" rx="9" ry="9" fill="${color}" stroke="white" stroke-width="1.5"/><text x="${width/2}" y="13.5" font-size="10" font-weight="600" text-anchor="middle" fill="white" font-family="-apple-system, BlinkMacSystemFont, sans-serif">${label}</text><path d="M${width/2-4} 18 L${width/2} 24 L${width/2+4} 18 Z" fill="${color}"/></svg>`
        return { url: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg), width, height: 26 }
      }

      // 그룹(같은 좌표 다호수) 핀 — 카운트만 강조
      const makeGroupPillIcon = (count: number) => {
        const label = `매물 ${count}건`
        const charCount = [...label].length
        const width = Math.max(60, charCount * 7 + 16)
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="28" viewBox="0 0 ${width} 28"><rect x="1" y="1" width="${width-2}" height="20" rx="10" ry="10" fill="#111827" stroke="white" stroke-width="1.5"/><text x="${width/2}" y="14.5" font-size="11" font-weight="700" text-anchor="middle" fill="white" font-family="-apple-system, BlinkMacSystemFont, sans-serif">${label}</text><path d="M${width/2-4} 20 L${width/2} 26 L${width/2+4} 20 Z" fill="#111827"/></svg>`
        return { url: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg), width, height: 28 }
      }

      // 주소 정규화 — 같은 건물 다른 호수는 카카오가 어차피 같은 좌표 반환하므로 호수 부분을 제거해
      // 캐시 hit율을 높이고 카카오 OVER_QUERY_LIMIT을 회피한다.
      // 예: "충청남도 천안시 서북구 불당동 1479-2 404호" → "충청남도 천안시 서북구 불당동 1479-2"
      const normalizeAddr = (a: string): string => {
        // 끝에 호수(예: "1412호", "404-1호", "A동1412호")가 있을 때만 처리
        // 행정동("쌍용2동", "다대1동")이 끝나는 주소는 그대로 — 호수 없으면 건드리지 않음
        const hoMatch = a.match(/[0-9A-Za-z\-]*\d[0-9A-Za-z\-]*호\s*$/i)
        if (!hoMatch || hoMatch.index === undefined) return a.trim()
        // 호수 부분 제거
        let r = a.slice(0, hoMatch.index).trim()
        // 호수 앞에 남은 건물 동수(영문/숫자) 추가 제거 — 한글 행정동은 영문·숫자 패턴이라 안전
        r = r.replace(/\s+[0-9A-Za-z\-]+동\s*$/, '')
        return r.replace(/\s+/g, ' ').trim()
      }

      // 같은 좌표(소수 5자리 ≈ 1m 정밀도) 매물을 한 핀으로 묶는다 — 같은 건물의 다른 호수는
      // 카카오 geocoder가 동일 좌표를 반환하므로 마커가 겹쳐 1개만 보이는 문제 발생
      type Geocoded = { prop: MapRow; lat: number; lng: number }
      const groups: Record<string, { list: Geocoded[]; marker: any }> = {}
      const groupKey = (lat: number, lng: number) => `${lat.toFixed(5)}_${lng.toFixed(5)}`

      // 그룹 하나 → 핀 하나
      const makeMarker = (group: Geocoded[]) => {
        const pos = new kakao.maps.LatLng(group[0].lat, group[0].lng)

        // 마커 아이콘: 단일=색깔 pill / 그룹=검정 카운트 pill
        let icon: { url: string; width: number; height: number }
        if (group.length === 1) {
          const g = group[0]
          const primaryDeal = pickPrimaryDeal(g.prop.deal_type)
          // 계약완료 매물은 회색 핀 — 지도만 보고 안내해도 가능/완료가 구분되게
          const color = g.prop.status === 'contracted' ? '#9ca3af' : (DEAL_TYPE_HEX_MAP[primaryDeal] ?? '#374151')
          icon = makePillIcon(primaryDeal, fmtPrice(g.prop), color)
        } else {
          icon = makeGroupPillIcon(group.length)
        }
        const markerImage = new kakao.maps.MarkerImage(
          icon.url,
          new kakao.maps.Size(icon.width, icon.height),
          { offset: new kakao.maps.Point(icon.width / 2, icon.height) }
        )
        const marker = new kakao.maps.Marker({ position: pos, image: markerImage })

        // 클릭 시 React 우측 사이드바 패널에 매물 리스트 표시
        // 헤더 주소는 동·호수 제거한 건물 단위 (group 매물이 같은 건물 다른 호수일 때 정확)
        const addr = group.length > 1
          ? normalizeAddr(group[0].prop.address ?? '')
          : (group[0].prop.address ?? '')
        // 같은 건물 다호수는 동(문자)·호수(숫자) 오름차순으로 — 등록순이면 호수가 뒤죽박죽
        const unitOf = (a: string) => {
          const ho = a.match(/(\d+)[0-9\-]*호\s*$/)
          const dong = a.match(/([0-9A-Za-z\-]+)동\s*\S*호\s*$/)
          return { dong: dong?.[1] ?? '', ho: ho ? parseInt(ho[1], 10) : Number.MAX_SAFE_INTEGER }
        }
        const items = group.map(g => g.prop).sort((x, y) => {
          const ux = unitOf(x.address ?? ''), uy = unitOf(y.address ?? '')
          return ux.dong.localeCompare(uy.dong) || ux.ho - uy.ho
        })
        kakao.maps.event.addListener(marker, 'click', () => {
          setMapPanel({ address: addr, items })
        })
        return marker
      }

      // 핀 전체가 보이게 맞춘다
      const fitToMarkers = () => {
        const markers = [...markersRef.current]
        if (markers.length === 0) return
        const bounds = new kakao.maps.LatLngBounds()
        markers.forEach(m => bounds.extend(m.getPosition()))
        if (markers.length === 1) {
          // 줌 3으로 줌인 — clusterer minLevel(4)과 충돌 방지
          map.setLevel(3)
          map.setCenter(markers[0].getPosition())
        } else {
          map.setBounds(bounds)
        }
        // 컨테이너 사이즈 변경 직후 타일 누락 방지 — relayout + 한 번 더 중심 보정
        requestAnimationFrame(() => {
          if (cancelled) return
          map.relayout()
          if (markers.length === 1) map.setCenter(markers[0].getPosition())
          else map.setBounds(bounds)
        })
      }

      // DB에도 저장 — 다음 지도 로드부터는 카카오 호출 안 함. 찾는 대로 하나씩 쏘지 않고 모았다가 한꺼번에(queueCoords).
      // 받아 둔 지도 데이터는 lat 이 빈 채 다시 쓰이므로, 한 번 저장한 매물은 다시 안 쓴다.
      const saveCoords = (prop: MapRow, coords: { lat: number; lng: number }) => {
        if (savedCoordIdsRef.current.has(prop.id)) return
        savedCoordIdsRef.current.add(prop.id)
        queueCoords(prop.id, coords)
      }

      // 1) 좌표를 아는 매물로 바로 핀을 꽂는다 — DB lat/lng(백필·등록·자동채움 시 채워짐)
      //    또는 이번 화면에서 이미 찾아 둔 주소(geocodeCacheRef).
      // 2) 나머지는 지도를 막지 않고 뒤에서 /api/geocode — 찾는 대로 기존 클러스터에 더한다.
      //    예전엔 전부 끝나야 핀을 그려서, 매번 실패하는 엉터리 주소 ~70건 때문에 몇 초씩 빈 지도였다.
      const cache = geocodeCacheRef.current
      const fails = loadGeocodeFails()
      const needsGeocode: Record<string, MapRow[]> = {}  // 정규화 주소 → 매물들 (같은 건물은 한 번만 묻는다)
      const addToGroup = (g: Geocoded) => {
        const key = groupKey(g.lat, g.lng)
        if (!groups[key]) groups[key] = { list: [], marker: null }
        groups[key].list.push(g)
      }
      let placed = 0
      let failed = 0
      for (const prop of targets) {
        if (prop.lat != null && prop.lng != null) {
          if (inRegion(prop.address, prop.lat, prop.lng)) { addToGroup({ prop, lat: prop.lat, lng: prop.lng }); placed++ }
          else failed++
          continue
        }
        const key = normalizeAddr(prop.address)
        if (key in cache) {
          const coords = cache[key]
          if (coords && inRegion(prop.address, coords.lat, coords.lng)) {
            placed++
            addToGroup({ prop, lat: coords.lat, lng: coords.lng })
            saveCoords(prop, coords)
          } else failed++
        } else if (!(key in fails)) {
          if (!needsGeocode[key]) needsGeocode[key] = []
          needsGeocode[key].push(prop)
        } else failed++
      }
      let pending = Object.values(needsGeocode).reduce((a, l) => a + l.length, 0)
      setMapStat({ placed, total: mapRows.length, pending, failed: failed + (mapRows.length - targets.length) })

      const clusterer = clustererRef.current
      for (const grp of Object.values(groups)) {
        grp.marker = makeMarker(grp.list)
        markersRef.current.push(grp.marker)
      }
      clusterer.addMarkers(markersRef.current)
      fitToMarkers()
      const fittedInitially = markersRef.current.length > 0

      // 뒤늦게 찾은 매물(같은 좌표들)을 클러스터에 더한다 — 그 좌표 핀만 새로 만들어 갈아 끼우고,
      // 다시 묶기(redraw)는 한 프레임에 한 번. 전체 핀(~1,900개)을 다시 만들지 않는다.
      let redrawQueued = false
      const addLate = (found: Geocoded[]) => {
        const key = groupKey(found[0].lat, found[0].lng)
        const old = groups[key]?.marker ?? null
        found.forEach(addToGroup)
        const grp = groups[key]
        grp.marker = makeMarker(grp.list)
        if (old) {
          clusterer.removeMarker(old, true)
          markersRef.current[markersRef.current.indexOf(old)] = grp.marker
        } else {
          markersRef.current.push(grp.marker)
        }
        clusterer.addMarker(grp.marker, true)
        if (!redrawQueued) {
          redrawQueued = true
          requestAnimationFrame(() => {
            redrawQueued = false
            if (!cancelled) clusterer.redraw()
          })
        }
      }

      // 동시 호출 수 제한 — /api/geocode 는 분당 60회 상한
      const queue = Object.keys(needsGeocode)
      const CONCURRENT = 4
      let inFlight = 0
      let cursor = 0

      const processOne = (key: string) => {
        inFlight++
        geocodeForMap(needsGeocode[key][0].address).then(coords => {
          inFlight--
          // 일시 오류(분당 상한 등)는 캐시·기억하지 않는다 — 다음에 다시 묻는다
          if (coords !== 'error') {
            cache[key] = coords
            if (!coords) { fails[key] = Date.now(); saveGeocodeFails(fails) }
          }
          if (cancelled) return  // 지도를 닫았거나 다른 조건으로 다시 그리는 중 — 옛 클러스터를 건드리지 않는다
          const 몇 = needsGeocode[key].length
          pending -= 몇
          if (coords && coords !== 'error' && inRegion(needsGeocode[key][0].address, coords.lat, coords.lng)) {
            const found = needsGeocode[key].map(prop => ({ prop, lat: coords.lat, lng: coords.lng }))
            found.forEach(g => saveCoords(g.prop, coords))
            addLate(found)
            placed += 몇
          } else failed += 몇
          setMapStat({ placed, total: mapRows.length, pending, failed: failed + (mapRows.length - targets.length) })
          if (cursor >= queue.length && inFlight === 0) {
            // 처음에 꽂을 핀이 하나도 없었으면 다 찾은 뒤 한 번만 맞춘다 — 도중에 화면이 튀지 않게
            if (!fittedInitially) fitToMarkers()
            return
          }
          schedule()
        })
      }

      const schedule = () => {
        while (!cancelled && inFlight < CONCURRENT && cursor < queue.length) {
          processOne(queue[cursor++])
        }
      }
      schedule()
    }

    requestAnimationFrame(renderMap)
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- ref·콜백은 바뀌지 않는다. 행·SDK·사무소 주소만 다시 그린다
  }, [mapReady, mapRows, officeAddress])

  // 현 위치로 이동 (임장 중 모바일용) — 파란 점 오버레이 표시
  const goToMyLocation = () => {
    if (!navigator.geolocation) { toast.error('이 기기는 위치 정보를 지원하지 않아요'); return }
    navigator.geolocation.getCurrentPosition(pos => {
      const kakao = (window as any).kakao
      const map = mapInstanceRef.current
      if (!map || !kakao) return
      const ll = new kakao.maps.LatLng(pos.coords.latitude, pos.coords.longitude)
      map.setLevel(4)
      map.setCenter(ll)
      if (myLocOverlayRef.current) myLocOverlayRef.current.setMap(null)
      const el = document.createElement('div')
      el.style.cssText = 'width:14px;height:14px;border-radius:50%;background:#2563eb;border:3px solid #fff;box-shadow:0 0 0 3px rgba(37,99,235,.3)'
      myLocOverlayRef.current = new kakao.maps.CustomOverlay({ position: ll, content: el, zIndex: 5 })
      myLocOverlayRef.current.setMap(map)
    }, () => toast.error('현재 위치를 가져오지 못했어요. 위치 권한을 확인해주세요.'))
  }


  return (
    <div className="relative rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden shadow-sm h-[560px] md:h-[calc(100vh-220px)] md:min-h-[640px]">
      <div ref={mapContainerRef} className="w-full h-full" />
      {/* 로딩/에러 오버레이 */}
      {mapStatus === 'error' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-white dark:bg-gray-900 z-10 px-6 text-center">
          <div className="text-4xl mb-3">🗺️</div>
          <p className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">지도를 불러올 수 없어요</p>
          <p className="text-xs text-gray-500 max-w-md leading-relaxed">
            {/* 직원이 보는 글 — 개발자 안내(카카오 콘솔·환경변수)는 콘솔에만 남긴다(11-06 점검) */}
            잠시 뒤 다시 열어 보세요. 계속 안 되면 대표님께 알려 주세요. 목록 보기는 그대로 쓸 수 있어요.
          </p>
        </div>
      )}
      {/* 좌표 없는 매물의 주소 변환은 뒤에서 하므로 지도를 가리지 않는다 — 가리는 건 SDK·매물을 받는 동안만 */}
      {mapStatus !== 'error' && (!mapReady || mapLoading) && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/80 backdrop-blur-sm z-10">
          <Loader2 className="h-7 w-7 animate-spin text-blue-600 mb-2" />
          <p className="text-sm text-gray-500">{!mapReady ? '지도 불러오는 중...' : '매물 불러오는 중...'}</p>
        </div>
      )}
      {/* 범례 */}
      {mapReady && !mapLoading && (
        <div className="absolute bottom-4 left-4 flex gap-2 z-10">
          {[['매매','#14274e'],['전세','#7c3aed'],['월세','#ea580c'],['계약완료','#9ca3af']].map(([label, color]) => (
            <span key={label} style={{ background: color }} className="flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold text-white shadow">
              {label}
            </span>
          ))}
        </div>
      )}
      {/* 현 위치 버튼 */}
      {mapReady && !mapLoading && (
        <button
          type="button"
          onClick={goToMyLocation}
          aria-label="현 위치로 이동"
          title="현 위치로 이동"
          className="absolute bottom-4 right-4 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-200 shadow-md border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800"
        >
          <LocateFixed className="h-5 w-5" />
        </button>
      )}
      {/* 몇 건이 찍혔나 — 빠진 매물이 있다는 걸 알게 */}
      {mapReady && !mapLoading && mapStat && (
        <div className="absolute left-3 top-3 z-10 rounded-lg bg-white/95 dark:bg-gray-900/95 px-3 py-1.5 text-xs text-gray-700 dark:text-gray-300 shadow border border-gray-200 dark:border-gray-700">
          지도에 {mapStat.placed.toLocaleString()} / {mapStat.total.toLocaleString()}건
          {mapStat.pending > 0 && <span className="text-blue-600"> · 위치 찾는 중 {mapStat.pending.toLocaleString()}</span>}
          {mapStat.failed > 0 && <span className="text-gray-500" title="소재지가 비었거나 지번이 없어 위치를 못 찾은 매물입니다. 목록에서 소재지를 고치면 다음에 찍힙니다."> · 위치 못 찾음 {mapStat.failed.toLocaleString()}</span>}
        </div>
      )}
      {/* 검색 결과 없음 */}
      {mapReady && !mapLoading && mapRows.filter(p => p.address).length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/60 z-10">
          <p className="text-sm text-gray-500">주소가 있는 매물이 없습니다</p>
        </div>
      )}

      {/* 우측 매물 패널 (네이버 부동산 식) — 모바일은 풀시트, 데스크톱은 우측 고정 */}
      {mapPanel && (
        <>
          {/* 모바일 backdrop */}
          <button
            type="button"
            aria-label="패널 닫기"
            onClick={() => setMapPanel(null)}
            className="absolute inset-0 z-20 bg-black/40 md:hidden"
          />
          <div className="absolute inset-y-0 right-0 z-30 flex w-full max-w-[420px] md:w-[380px] flex-col bg-white dark:bg-gray-900 shadow-2xl border-l border-gray-200 dark:border-gray-800">
            {/* 헤더 */}
            <div className="flex items-start gap-2 border-b border-gray-100 dark:border-gray-800 px-4 py-3 flex-shrink-0">
              <div className="flex-1 min-w-0">
                <p className="text-xs text-gray-500 mb-0.5">{mapPanel.items.length > 1 ? '같은 건물' : '매물 위치'}</p>
                <p className="text-sm font-bold text-gray-900 dark:text-white leading-tight break-words">{mapPanel.address || '주소 없음'}</p>
                <p className="mt-1 text-xs text-gray-500">매물 <span className="font-bold text-blue-600">{mapPanel.items.length}</span>건</p>
              </div>
              <button
                type="button"
                onClick={() => setMapPanel(null)}
                aria-label="닫기"
                className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* 매물 리스트 */}
            <div className="flex-1 overflow-y-auto">
              {mapPanel.items.map(p => {
                const primaryDeal = (p.deal_type ?? '').split(',').map(s => s.trim()).filter(Boolean)[0] ?? ''
                const color = DEAL_TYPE_HEX_MAP[primaryDeal] ?? '#374151'
                const isWolse = (p.deal_type ?? '').includes('월세')
                const priceText = isWolse
                  ? `${p.price != null ? p.price.toLocaleString() : '?'}/${p.monthly_rent != null ? p.monthly_rent.toLocaleString() : '?'}만`
                  : (p.price == null ? '미정' : (p.price >= 10000 ? Math.floor(p.price / 10000) + '억' + (p.price % 10000 > 0 ? ' ' + (p.price % 10000).toLocaleString() + '만' : '') : p.price.toLocaleString() + '만'))
                return (
                  // 버튼 중첩(a11y 위반)을 피해 아이템은 div, 사진 열기는 썸네일 버튼에만
                  <div
                    key={p.id}
                    onClick={() => {
                      if (p.images && p.images.length > 0) {
                        onOpenImages(p.images)
                      }
                    }}
                    className="w-full cursor-pointer text-left border-b border-gray-100 dark:border-gray-800 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors flex gap-3"
                  >
                    {/* 사진 썸네일 */}
                    {p.images?.[0] ? (
                      <button
                        type="button"
                        aria-label="사진 보기"
                        onClick={e => { e.stopPropagation(); onOpenImages(p.images) }}
                        className="h-20 w-20 flex-shrink-0 rounded-lg overflow-hidden"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={p.images[0]}
                          alt=""
                          className="h-full w-full object-cover bg-gray-100 dark:bg-gray-800"
                          loading="lazy"
                        />
                      </button>
                    ) : (
                      <div className="h-20 w-20 flex-shrink-0 rounded-lg bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-gray-300">
                        <ImagePlus className="h-6 w-6" />
                      </div>
                    )}

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1.5">
                        <span style={{ background: color }} className="rounded-md px-2 py-0.5 text-[10px] font-bold text-white">
                          {p.deal_type}
                        </span>
                        {p.status === 'contracted' && (
                          <span className="rounded-md bg-gray-400 px-2 py-0.5 text-[10px] font-bold text-white">계약완료</span>
                        )}
                        <span style={{ color }} className="text-base font-black truncate">
                          {priceText}
                        </span>
                        {p.seq_no != null && (
                          <span className="ml-auto flex-shrink-0 rounded bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 text-[10px] font-bold text-gray-600 dark:text-gray-300">
                            #{p.seq_no}
                          </span>
                        )}
                      </div>
                      {/* 동·호수 — 그룹 안에서 어떤 매물인지 식별 */}
                      {(() => {
                        const addr = p.address ?? ''
                        const hoMatch = addr.match(/[0-9A-Za-z\-]*\d[0-9A-Za-z\-]*호\s*$/i)
                        if (!hoMatch || hoMatch.index === undefined) return null
                        const unit = addr.slice(0, hoMatch.index).match(/\s+[0-9A-Za-z\-]+동\s*$/)
                        const unitText = (unit ? unit[0].trim() + ' ' : '') + hoMatch[0].trim()
                        return <div className="text-xs font-semibold text-blue-600 dark:text-blue-400 mb-0.5">{unitText}</div>
                      })()}
                      <div className="text-xs text-gray-500 dark:text-gray-500">
                        {p.room_type}
                        {p.size_pyeong ? ` · ${p.size_pyeong}평` : ''}
                        {p.floor != null ? ` · ${p.floor}층${p.total_floors ? `/${p.total_floors}` : ''}` : ''}
                      </div>
                      {p.brief_memo && (
                        <p className="mt-1.5 text-xs text-gray-500 line-clamp-2">{p.brief_memo}</p>
                      )}
                      <div className="mt-1.5 flex items-center justify-between gap-2">
                        {p.images && p.images.length > 0
                          ? <p className="text-[10px] text-blue-500">사진 {p.images.length}장 · 클릭해서 보기</p>
                          : <span />}
                        <button
                          type="button"
                          onClick={e => { e.stopPropagation(); onJumpToList(p.id) }}
                          className="flex-shrink-0 rounded-md border border-gray-200 dark:border-gray-700 px-2 py-0.5 text-[10px] font-semibold text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
                        >
                          목록에서 열기
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
