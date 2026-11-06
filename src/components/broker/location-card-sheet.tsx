'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, Check, ChevronDown, Copy, ExternalLink, X } from 'lucide-react'
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
 * 매물 소재지 한 줄로 입지를 한 장에 — 맨 위는 뱅크·당근 상세설명에 붙여 넣을 광고 문안,
 * 그 아래 상담 참고(실거래·규제·현장 확인), 맨 아래 근거 자료(토지·건물·교통·상권).
 * 못 읽은 칸은 비워 둔다.
 */
export function LocationCardSheet({ address, roomType, onClose }: { address: string; roomType: string | null; onClose: () => void }) {
  const [card, setCard] = useState<LocationCard | null>(null)
  const [copy, setCopy] = useState<{ ad: string; memo: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [detail, setDetail] = useState(false)

  useEffect(() => {
    let alive = true
    fetch('/api/properties/location', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address, roomType }),
    })
      .then(async r => {
        const d = await r.json().catch(() => ({}))
        if (!alive) return
        if (r.ok && d?.card) { setCard(d.card as LocationCard); setCopy(d.copy ?? null) }
        else setError(ERRORS[d?.error] ?? '입지 정보를 불러오지 못했어요. 잠시 뒤 다시 열어 주세요.')
      })
      .catch(() => { if (alive) setError('인터넷 연결을 확인해 주세요.') })
    return () => { alive = false }
  }, [address, roomType])

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
        className="max-h-[90vh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:max-w-xl sm:rounded-2xl dark:bg-gray-900">
        <div className="mb-3 flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-xs text-gray-500">입지 · 광고 문안{roomType ? ` · ${roomType}` : ''}</p>
            <h3 className="break-words text-base font-bold text-gray-900 dark:text-white">{card?.address ?? address}</h3>
            {card?.roadAddress && <p className="break-words text-xs text-gray-500">{card.roadAddress}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="닫기" className="-m-2 rounded-lg p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800">
            <X className="h-5 w-5" />
          </button>
        </div>

        {!card && !error && (
          <div className="flex items-center gap-2 py-10 text-sm text-gray-500"><Spinner size="xs" label={null} />토지·건축물대장·상권·실거래를 모으는 중… (처음엔 5초쯤 걸려요)</div>
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

            {copy?.ad && (
              <CopyBlock title="상세설명에 붙여 넣기 (뱅크·당근)" hint="매물설명 끝에 붙이면 카페·블로그 글에도 같이 들어가요." text={copy.ad} primary />
            )}
            {copy?.memo && (
              <CopyBlock title="상담 참고 — 광고에는 넣지 마세요" hint="같은 동네 다른 물건의 실거래라 이 매물 가격처럼 읽히면 안 돼요." text={copy.memo} />
            )}

            {card.missing.length > 0 && (
              <p className="text-xs text-red-600 dark:text-red-400">못 읽음: {card.missing.join(', ')} — 그 부분은 문안에서 빠졌어요. 잠시 뒤 다시 열면 채워질 수 있어요.</p>
            )}

            <button type="button" onClick={() => setDetail(v => !v)}
              className="flex w-full items-center justify-between rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800">
              근거 자료 {detail ? '접기' : '펼치기'} (토지·건물·교통·상권·배후 세대·실거래)
              <ChevronDown className={`h-4 w-4 transition-transform ${detail ? 'rotate-180' : ''}`} />
            </button>

            {detail && (
              <div className="space-y-4">
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
                  ) : <p className="text-gray-500">자료가 없어요.</p>}
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
                              b.elevators ? `승강기 ${b.elevators}대` : null,
                              b.parking ? `주차 ${b.parking}대` : null,
                              b.approvalDate ? `사용승인 ${b.approvalDate}` : null,
                            ].filter(Boolean).join(' · ')}
                          </p>
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="mt-1 text-xs text-gray-500">정화조: {card.septic.length ? card.septic.map(s => `${s.mode} · ${s.capacity}`).join(' / ') : '대장에 기재 없음'}</p>
                </Section>

                <Section title="교통·학교">
                  <ul className="space-y-1 text-gray-900 dark:text-gray-100">
                    {card.traffic.ic.map(c => (
                      <li key={c.name}>{c.name} — 차량 {c.driveMin != null ? `${c.driveMin}분(${c.driveKm}km)` : '시간 못 받음'} · 직선 {km(c.distanceM)}</li>
                    ))}
                    {card.traffic.station && <li>{card.traffic.station.name} — 직선 {km(card.traffic.station.distanceM)}</li>}
                    {card.schools.map(s => <li key={s.name}>{s.name} — 직선 {km(s.distanceM)}</li>)}
                  </ul>
                </Section>

                {card.apartments && card.apartments.complexes.length > 0 && (
                  <Section title={`배후 아파트 (반경 1km · ${card.apartments.complexes.length}개 단지 ${comma(card.apartments.households)}세대)`}>
                    <ul className="space-y-0.5 text-gray-900 dark:text-gray-100">
                      {card.apartments.complexes.map(a => (
                        <li key={a.name + a.distanceM} className="flex justify-between gap-2">
                          <span className="truncate">{a.name}{a.year ? ` (${a.year})` : ''}</span>
                          <span className="shrink-0 tabular-nums text-gray-500">{comma(a.households)}세대 · {km(a.distanceM)}</span>
                        </li>
                      ))}
                    </ul>
                  </Section>
                )}

                {card.stores?.inBuilding && (
                  <Section title={`건물 내 업소 (${card.stores.inBuilding.total}곳)`}>
                    <p className="text-gray-900 dark:text-gray-100">
                      {card.stores.inBuilding.groups.slice(0, 10).map(g => `${g.label} ${g.count}`).join(' · ')}
                    </p>
                  </Section>
                )}
                {card.stores?.radius && (
                  <Section title={`반경 ${card.stores.radius.radiusM}m 업소 (${comma(card.stores.radius.total)}곳)`}>
                    <p className="text-gray-900 dark:text-gray-100">{card.stores.radius.groups.map(g => `${g.label} ${comma(g.count)}`).join(' · ')}</p>
                  </Section>
                )}

                {card.trades && (
                  <Section title={`실거래 — ${card.trades.label} (${card.trades.scope}, 최근 1년 ${card.trades.count}건)`}>
                    {card.trades.recent.length === 0 ? <p className="text-gray-500">거래가 없어요.</p> : (
                      <ul className="space-y-0.5 text-xs text-gray-700 dark:text-gray-300">
                        {card.trades.recent.map((r, i) => (
                          <li key={i}>{r.date} · {r.place} · {r.use}{r.areaPyeong ? ` · ${r.areaPyeong}평` : ''} · {comma(r.amount)}만원{r.perPyeong ? ` (평당 ${comma(r.perPyeong)}만)` : ''}</li>
                        ))}
                      </ul>
                    )}
                    <p className="mt-1 text-xs text-gray-500">평당 값은 {card.trades.basis} 기준이에요.</p>
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
                <p className="text-xs leading-relaxed text-gray-400">
                  출처: 토지이용계획·토지특성(브이월드), 건축물대장(세움터), 상가정보(소상공인시장진흥공단), 실거래(국토교통부), 카카오맵·카카오내비.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function CopyBlock({ title, hint, text, primary = false }: { title: string; hint: string; text: string; primary?: boolean }) {
  const [done, setDone] = useState(false)
  const copyIt = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setDone(true)
      setTimeout(() => setDone(false), 1500)
    } catch { /* 클립보드 권한이 없으면 아래 글을 직접 길게 눌러 복사한다 */ }
  }
  return (
    <section className={`rounded-lg border p-3 ${primary ? 'border-blue-200 bg-blue-50/40 dark:border-blue-900 dark:bg-blue-950/20' : 'border-gray-200 dark:border-gray-700'}`}>
      <div className="mb-1.5 flex items-center gap-2">
        <h4 className="flex-1 text-xs font-semibold text-gray-700 dark:text-gray-200">{title}</h4>
        <button type="button" onClick={copyIt}
          className={`inline-flex shrink-0 items-center gap-1 rounded-md px-2.5 py-1 text-xs font-semibold ${primary ? 'bg-blue-600 text-white hover:bg-blue-700' : 'border border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800'}`}>
          {done ? <><Check className="h-3.5 w-3.5" />복사됨</> : <><Copy className="h-3.5 w-3.5" />복사</>}
        </button>
      </div>
      <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-gray-900 select-text dark:text-gray-100">{text}</p>
      <p className="mt-1.5 text-[11px] text-gray-500">{hint}</p>
    </section>
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
