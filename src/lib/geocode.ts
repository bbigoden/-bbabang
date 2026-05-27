// 클라이언트에서 매물 주소 → 좌표 변환.
// 서버 라우트(/api/geocode)가 카카오 REST API + 캐시 헤더로 처리.
// 호출자는 결과 lat/lng를 broker_properties에 함께 저장해야 함.

export async function geocodeAddress(address: string): Promise<{ lat: number; lng: number } | null> {
  if (!address?.trim()) return null
  try {
    const res = await fetch('/api/geocode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address }),
    })
    if (!res.ok) return null
    const data = await res.json()
    if (typeof data?.lat === 'number' && typeof data?.lng === 'number') {
      return { lat: data.lat, lng: data.lng }
    }
    return null
  } catch {
    return null
  }
}
