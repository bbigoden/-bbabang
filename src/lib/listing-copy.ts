// 입지 카드 → 광고 문안. 뱅크·당근 상세설명에 그대로 붙여 넣을 '입지·건물' 문단과,
// 광고에는 넣지 않고 상담할 때만 보는 참고 메모(실거래·규제·현장 확인할 것)를 따로 만든다.
//
// 원칙(사장님 메모리: 광고 정보는 대장·공공 원본 근거) — 카드에 있는 값만 문장으로 바꾼다. 없는 값은 문장을 통째로 뺀다.
// "층고"는 쓰지 않는다 — 대장의 높이(heit)는 건물 높이라 층고와 다르다. 실거래 시세는 광고 문안에 넣지 않는다
// (같은 동 다른 물건 값이라 이 매물 가격처럼 읽히면 표시광고 문제가 된다).

import type { LocationCard } from './location-card'

const PY = 3.305785
const comma = (n: number) => n.toLocaleString('ko-KR')
const py = (m2: number) => comma(Math.round(m2 / PY))
const walkMin = (m: number) => Math.max(1, Math.ceil(m / 67))
const km = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)}km` : `${Math.round(m)}m`)
const 억만 = (manwon: number) => {
  const eok = Math.floor(manwon / 10000), man = Math.round(manwon % 10000)
  return eok ? `${eok}억${man ? ` ${comma(man)}만` : ''}원` : `${comma(man)}만원`
}

/** 토지특성 도로접면 → 광고 문장. 차량 통행이 안 되거나 맹지면 광고에서 뺀다(null). */
export function roadPhrase(roadSide: string | null | undefined): string | null {
  const r = roadSide ?? ''
  if (!r || /맹지|불\)/.test(r)) return null
  const corner = /각지|소각|세각/.test(r)
  const width = r.startsWith('광대') ? '폭 25m 이상 대로' : r.startsWith('중로') ? '폭 12~25m 도로'
    : r.startsWith('소로') ? '폭 8~12m 도로' : r.startsWith('세로') ? '차량 통행 가능한 도로' : null
  if (!width) return null
  return corner ? `${width}에 접한 코너 자리` : `${width}에 접함`
}

function lines(title: string, items: (string | null | undefined | false)[]): string {
  const xs = items.filter((s): s is string => !!s)
  return xs.length ? `■ ${title}\n${xs.map(s => `· ${s}`).join('\n')}` : ''
}

function trafficLines(c: LocationCard): (string | null)[] {
  // 직선으로 가까운 IC 가 차로는 더 멀 때가 있다 — 실제 주행시간 짧은 순
  const ic = c.traffic.ic.filter(i => i.driveMin != null).sort((a, b) => a.driveMin! - b.driveMin!)
  return [
    ic.length ? ic.map(i => `${i.name} 차량 약 ${i.driveMin}분(${i.driveKm}km)`).join(' · ') : null,
    c.traffic.station && c.traffic.station.distanceM <= 3000 ? `${c.traffic.station.name} 직선 ${km(c.traffic.station.distanceM)}` : null,
  ]
}

function buildingsSummary(c: LocationCard): string[] {
  const b = c.buildings
  if (!b.length) return []
  const years = b.map(x => x.approvalDate?.slice(0, 4)).filter(Boolean) as string[]
  const yr = years.length ? (Math.min(...years.map(Number)) === Math.max(...years.map(Number)) ? `${years[0]}년` : `${Math.min(...years.map(Number))}~${Math.max(...years.map(Number))}년`) : null
  if (b.length === 1) {
    const x = b[0]
    return [[
      yr ? `${yr} 사용승인` : null,
      x.floorsAbove ? `지상 ${x.floorsAbove}층${x.floorsBelow ? `·지하 ${x.floorsBelow}층` : ''}` : null,
      x.structure,
      x.elevators ? `승강기 ${x.elevators}대` : null,
      x.parking ? `주차 ${x.parking}대(건물 전체)` : null,
    ].filter(Boolean).join(' · ')].filter(Boolean)
  }
  const total = b.reduce((s, x) => s + (x.totalAreaM2 ?? 0), 0)
  const head = [`총 ${b.length}개 동`, total ? `연면적 합계 약 ${py(total)}평` : null, yr ? `${yr} 사용승인` : null].filter(Boolean).join(' · ')
  const each = b.slice(0, 8).map(x => [
    x.name, x.purpose,
    x.totalAreaM2 ? `${py(x.totalAreaM2)}평` : null,
    x.heightM ? `건물 높이 ${+x.heightM.toFixed(1)}m` : null,
    x.floorsAbove && x.floorsAbove > 1 ? `${x.floorsAbove}층` : null,
  ].filter(Boolean).join(' '))
  return [head, ...each]
}

function sewerLine(c: LocationCard): string | null {
  if (!c.septic.length) return null
  if (c.septic.some(s => s.capacity.startsWith('공공하수도'))) return '오수: 공공하수도 연결'
  const s = c.septic.find(x => x.capacity !== '용량 기재 없음') ?? c.septic[0]
  return `정화조 ${s.capacity}(${s.mode})`
}

function shopAd(c: LocationCard): string {
  const l = c.land
  const apt = c.apartments
  const near = apt?.complexes.slice(0, 3).map(a => `${a.name} ${comma(a.households)}세대`).join(', ')
  const sch = c.schools.filter(s => s.distanceM <= 1000).map(s => `${s.name} 도보 약 ${walkMin(s.distanceM)}분`)

  const anchors = ['의원', '치과', '한의원', '약국', '학원·교육']
  const inB = c.stores?.inBuilding
  const anchorsIn = inB?.groups.filter(g => anchors.includes(g.label)).map(g => `${g.label === '학원·교육' ? '학원' : g.label} ${g.count}곳`)
  const rad = c.stores?.radius

  return [
    lines('입지', [
      [l?.zoning, roadPhrase(l?.roadSide)].filter(Boolean).join(' · ') || null,
      apt && apt.households > 0 ? `반경 1km 배후 아파트 ${apt.complexes.length}개 단지 약 ${comma(apt.households)}세대${near ? ` (${near} 등)` : ''}` : null,
      sch.length ? sch.join(' · ') : null,
      ...trafficLines(c),
    ]),
    lines('상권', [
      inB && inB.total > 1 ? `건물 내 ${inB.total}개 업소 영업 중${anchorsIn?.length ? ` — ${anchorsIn.join(', ')} 입점` : ''}` : null,
      rad ? `반경 ${rad.radiusM}m 안 ${comma(rad.total)}개 업소 (${rad.groups.slice(0, 4).map(g => `${g.label} ${comma(g.count)}`).join(', ')})` : null,
    ]),
    lines('건물', [...buildingsSummary(c), sewerLine(c)]),
  ].filter(Boolean).join('\n\n')
}

function factoryAd(c: LocationCard): string {
  const l = c.land
  const parkZone = c.zones.find(z => /산업단지|농공단지/.test(z))
  return [
    lines('토지', [
      [l?.zoning, l?.jimok ? `지목 ${l.jimok}` : null, l?.areaM2 ? `대지 약 ${py(l.areaM2)}평(${comma(Math.round(l.areaM2))}㎡)` : null].filter(Boolean).join(' · ') || null,
      parkZone ? `${parkZone} 안 입지` : null,
      roadPhrase(l?.roadSide),
      [l?.slope, l?.shape].filter(Boolean).length ? `${[l?.slope, l?.shape].filter(Boolean).join(' · ')} 부지` : null,
    ]),
    lines('건물', [...buildingsSummary(c), sewerLine(c)]),
    lines('교통', trafficLines(c)),
  ].filter(Boolean).join('\n\n')
}

function landAd(c: LocationCard): string {
  const l = c.land
  const plan = c.zones.filter(z => /지구단위|산업단지|택지|도시개발|역세권/.test(z))
  return [
    lines('토지', [
      [l?.zoning, l?.jimok ? `지목 ${l.jimok}` : null, l?.areaM2 ? `약 ${py(l.areaM2)}평(${comma(Math.round(l.areaM2))}㎡)` : null].filter(Boolean).join(' · ') || null,
      roadPhrase(l?.roadSide),
      [l?.slope, l?.shape].filter(Boolean).length ? `${[l?.slope, l?.shape].filter(Boolean).join(' · ')}` : null,
      plan.length ? `${plan.join(' · ')}` : null,
      l?.officialPricePerM2 ? `${l.priceYear ?? ''}년 공시지가 ㎡당 ${comma(l.officialPricePerM2)}원` : null,
    ]),
    lines('교통', trafficLines(c)),
  ].filter(Boolean).join('\n\n')
}

/** 상담 참고 — 광고에 넣지 않는다 */
function memo(c: LocationCard): string {
  const t = c.trades
  const todo = c.kind === 'factory'
    ? ['전기 용량(kW)', '호이스트 유무·톤수', '처마 높이', '진입로 실제 폭·대형차 회차', '기존 공장등록 업종']
    : c.kind === 'shop' ? ['후드·가스 인입', '전기 용량', '화장실 위치'] : c.kind === 'land' ? ['진입로 실제 폭·소유', '개발행위 가능 여부(토지이음)'] : []
  return [
    t ? lines(`참고 실거래 — ${t.label} (${t.scope}, 최근 1년)`, [
      t.count ? `${t.count}건 · ${t.basis} 평당 중앙값 ${t.medianPerPyeong != null ? `${comma(t.medianPerPyeong)}만원` : '—'}` : '거래 없음',
      ...t.recent.slice(0, 3).map(r => `${r.date} ${r.place} ${r.use}${r.areaPyeong ? ` ${r.areaPyeong}평` : ''} ${억만(r.amount)}${r.perPyeong ? ` (평당 ${comma(r.perPyeong)}만)` : ''}`),
    ]) : '',
    c.zoneAlerts.length ? lines('규제 확인', [c.zoneAlerts.join(' · ')]) : '',
    todo.length ? lines('현장 확인 후 기재', [todo.join(' · ')]) : '',
  ].filter(Boolean).join('\n\n')
}

export function buildListingCopy(c: LocationCard): { ad: string; memo: string } {
  const ad = c.kind === 'factory' ? factoryAd(c) : c.kind === 'land' ? landAd(c) : shopAd(c)
  const src = '※ 출처: 건축물대장·토지이용계획(공공데이터), 거리·시간은 카카오맵 기준'
  return { ad: ad ? `${ad}\n\n${src}` : '', memo: memo(c) }
}
