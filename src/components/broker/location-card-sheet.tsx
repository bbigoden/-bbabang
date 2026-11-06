'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, ExternalLink, X } from 'lucide-react'
import { Spinner } from '@/components/ui/spinner'
import type { LocationCard } from '@/lib/location-card'

const PY = 3.305785
const comma = (n: number) => n.toLocaleString('ko-KR')
const m2py = (m2: number) => `${comma(Math.round(m2))}㎡ (${comma(+(m2 / PY).toFixed(1))}평)`
const km = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)}km` : `${Math.round(m)}m`)

const ERRORS: Record<string, string> = {
  geocode_failed: '주소를 지도에서 찾지 못했어요. 소재지를 지번(예: 운전리 319-2)이나 도로명으로 적어 주세요.',
  address_required: '소재지가 비어 있어요.',
  rate_limited: '잠시 너무 많이 열었어요. 조금 뒤에 다시 열어 주세요.',
  unauthorized: '로그인이 풀렸어요. 다시 로그인해 주세요.',
}

/**
 * 매물 소재지 한 줄로 입지를 한 장에 — 공장·창고·상가 상담용.
 * 용도지역·지역지구(토지이용계획), 지목·면적·공시지가·도로접면(토지특성), 동별 건물·정화조(건축물대장),
 * 가까운 IC·전철역(카카오, 직선거리), 반경 500m 점포 수. 못 읽은 칸은 비워 둔다.
 */
export function LocationCardSheet({ address, onClose }: { address: string; onClose: () => void }) {
  const [card, setCard] = useState<LocationCard | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    fetch('/api/properties/location', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address }),
    })
      .then(async r => {
        const d = await r.json().catch(() => ({}))
        if (!alive) return
        if (r.ok) setCard(d as LocationCard)
        else setError(ERRORS[d?.error] ?? '입지 정보를 불러오지 못했어요. 잠시 뒤 다시 열어 주세요.')
      })
      .catch(() => { if (alive) setError('인터넷 연결을 확인해 주세요.') })
    return () => { alive = false }
  }, [address])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const land = card?.land
  const landRows: [string, string | null][] = land ? [
    ['용도지역', [land.zoning, land.zoning2].filter(Boolean).join(' · ') || null],
    ['지목', land.jimok],
    ['토지면적', land.areaM2 ? m2py(land.areaM2) : null],
    ['공시지가', land.officialPricePerM2
      ? `㎡당 ${comma(land.officialPricePerM2)}원 · 평당 약 ${comma(Math.round(land.officialPricePerM2 * PY / 10000))}만원${land.priceYear ? ` (${land.priceYear}년)` : ''}`
      : null],
    ['도로접면', land.roadSide],
    ['형상·경사', [land.shape, land.slope].filter(Boolean).join(' · ') || null],
    ['이용상황', land.useStatus],
  ] : []

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 sm:items-center" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="입지 보기" onClick={e => e.stopPropagation()}
        className="max-h-[88vh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:max-w-lg sm:rounded-2xl dark:bg-gray-900">
        <div className="mb-3 flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-xs text-gray-500">입지</p>
            <h3 className="break-words text-base font-bold text-gray-900 dark:text-white">{card?.address ?? address}</h3>
            {card?.roadAddress && <p className="break-words text-xs text-gray-500">{card.roadAddress}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="닫기" className="-m-2 rounded-lg p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800">
            <X className="h-5 w-5" />
          </button>
        </div>

        {!card && !error && (
          <div className="flex items-center gap-2 py-10 text-sm text-gray-500"><Spinner size="xs" label={null} />토지·건축물대장·지도를 조회하는 중…</div>
        )}
        {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>}

        {card && (
          <div className="space-y-4 text-sm">
            {card.zoneAlerts.length > 0 && (
              <div className="rounded-lg bg-amber-50 p-3 dark:bg-amber-950/30">
                <p className="mb-1 flex items-center gap-1 text-xs font-semibold text-amber-800 dark:text-amber-300">
                  <AlertTriangle className="h-3.5 w-3.5" />먼저 확인할 규제
                </p>
                <p className="text-amber-900 dark:text-amber-200">{card.zoneAlerts.join(' · ')}</p>
              </div>
            )}

            <Section title="토지">
              {land ? (
                <dl className="grid grid-cols-[5.5rem_1fr] gap-x-3 gap-y-1.5">
                  {landRows.filter(([, v]) => v).map(([k, v]) => (
                    <div key={k} className="contents">
                      <dt className="text-gray-500">{k}</dt>
                      <dd className="break-words text-gray-900 dark:text-gray-100">{v}</dd>
                    </div>
                  ))}
                </dl>
              ) : <Empty />}
              {card.zones.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {card.zones.map(z => (
                    <span key={z} className={`rounded px-1.5 py-0.5 text-xs ${card.zoneAlerts.includes(z)
                      ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200'
                      : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'}`}>{z}</span>
                  ))}
                </div>
              )}
            </Section>

            <Section title={`건물${card.buildings.length > 1 ? ` (${card.buildings.length}개 동)` : ''}`}>
              {card.buildings.length === 0 ? <p className="text-gray-500">건축물대장에 건물이 없어요(나대지이거나 미등재).</p> : (
                <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                  {card.buildings.slice(0, 12).map((b, i) => (
                    <li key={i} className="py-1.5">
                      <p className="text-gray-900 dark:text-gray-100">
                        <span className="font-semibold">{b.name ?? '건물'}</span>
                        {b.purpose && <span className="ml-1.5">{b.purpose}</span>}
                      </p>
                      <p className="text-xs text-gray-500">
                        {[b.structure,
                          b.totalAreaM2 ? `연면적 ${m2py(b.totalAreaM2)}` : null,
                          b.heightM ? `높이 ${b.heightM}m` : null,
                          b.floorsAbove ? `지상 ${b.floorsAbove}층${b.floorsBelow ? `·지하 ${b.floorsBelow}층` : ''}` : null,
                          b.approvalDate ? `사용승인 ${b.approvalDate}` : null,
                        ].filter(Boolean).join(' · ')}
                      </p>
                    </li>
                  ))}
                  {card.buildings.length > 12 && <li className="py-1.5 text-xs text-gray-500">외 {card.buildings.length - 12}개 동</li>}
                </ul>
              )}
            </Section>

            <Section title="정화조">
              {card.septic.length === 0
                ? <p className="text-gray-500">건축물대장에 정화조 기재가 없어요.</p>
                : card.septic.map((s, i) => <p key={i} className="text-gray-900 dark:text-gray-100">{s.mode} · {s.capacity}</p>)}
            </Section>

            <Section title="교통 (직선거리)">
              <dl className="grid grid-cols-[5.5rem_1fr] gap-x-3 gap-y-1.5">
                <dt className="text-gray-500">고속도로 IC</dt>
                <dd className="text-gray-900 dark:text-gray-100">
                  {card.traffic.ic.length ? card.traffic.ic.map(c => `${c.name} ${km(c.distanceM)}`).join(' · ') : '20km 안에 없음'}
                </dd>
                <dt className="text-gray-500">전철역</dt>
                <dd className="text-gray-900 dark:text-gray-100">
                  {card.traffic.station ? `${card.traffic.station.name} ${km(card.traffic.station.distanceM)}` : '20km 안에 없음'}
                </dd>
              </dl>
            </Section>

            {card.nearby.length > 0 && (
              <Section title="반경 500m 점포 수">
                <div className="grid grid-cols-5 gap-1 text-center">
                  {card.nearby.map(n => (
                    <div key={n.label} className="rounded-lg bg-gray-50 py-1.5 dark:bg-gray-800">
                      <p className="text-base font-semibold tabular-nums text-gray-900 dark:text-gray-100">{comma(n.count)}</p>
                      <p className="text-[11px] text-gray-500">{n.label}</p>
                    </div>
                  ))}
                </div>
              </Section>
            )}

            <div className="flex flex-wrap gap-2">
              <a href={`https://www.eum.go.kr/web/ar/lu/luLandDet.jsp?pnu=${card.pnu}&mode=search&isNoScr=script`} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800">
                토지이음 원본 <ExternalLink className="h-3 w-3" />
              </a>
              <a href={`https://map.kakao.com/link/map/${encodeURIComponent(card.address)},${card.coord.y},${card.coord.x}`} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800">
                카카오맵 <ExternalLink className="h-3 w-3" />
              </a>
            </div>

            {card.missing.length > 0 && (
              <p className="text-xs text-red-600 dark:text-red-400">못 읽음: {card.missing.join(', ')} — 잠시 뒤 다시 열면 채워질 수 있어요.</p>
            )}
            <p className="text-xs leading-relaxed text-gray-400">
              출처: 토지이용계획·토지특성(브이월드), 건축물대장(세움터), 카카오맵. 전기 용량·호이스트·실제 층고·진입로 실제 폭은 공공 자료에 없어 현장에서 확인해 주세요.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h4 className="mb-1.5 text-xs font-semibold text-gray-500">{title}</h4>
      {children}
    </section>
  )
}

function Empty() {
  return <p className="text-gray-500">자료가 없어요.</p>
}
