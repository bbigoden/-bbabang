// 사무소 주소 → 표준 행정구역 (시·도 + 시·군·구) 추출 헬퍼.
// 가입 시 alert_regions(관심지역) 자동 시드용.
//
// 작동 방식:
//  1. 주소에서 동·면·읍·리·가로 끝나는 첫 토큰을 추출 (예: "불당동")
//  2. /api/regions/search?q=<동> 호출 → Kakao 기반 canonical {sido, sigungu, dong}
//  3. 주소 토큰과 sigungu가 가장 잘 매치되는 결과를 선택
//  4. 동(dong) 단위가 아닌 **시·군·구 전체(dong=null)**로 시드 — 첫 알림 커버리지 ↑
//
// 동 토큰을 못 찾거나 Kakao가 결과 0이면 null → alert_regions는 빈 배열로 둠.

import type { RegionValue } from '@/components/region-picker'

export async function seedRegionFromAddress(address: string | null | undefined): Promise<RegionValue | null> {
  if (!address) return null
  const tokens = address.trim().split(/\s+/)
  // 1) dong 후보 토큰 — 동·면·읍·리·가로 끝나는 첫 토큰
  const dongTok = tokens.find(t => /(동|면|읍|리|가)$/.test(t))
  if (!dongTok) return null

  try {
    const r = await fetch(`/api/regions/search?q=${encodeURIComponent(dongTok)}`)
    if (!r.ok) return null
    const j = await r.json() as { results?: Array<{ sido: string; sigungu: string; dong: string | null }> }
    const results = j.results ?? []
    if (!results.length) return null

    // 2) 같은 동 이름이라도 여러 시·군·구에 존재할 수 있음 →
    //    주소 토큰 중 하나가 sigungu에 포함된 결과를 우선.
    const exactDong = results.filter(h => h.dong === dongTok)
    const sigunguMatch = exactDong.find(h =>
      tokens.some(t => t.length >= 2 && h.sigungu.includes(t))
    )
    const pick = sigunguMatch ?? exactDong[0] ?? results[0]
    if (!pick) return null

    // 3) 시·군·구 전체로 시드
    return { sido: pick.sido, sigungu: pick.sigungu, dong: null }
  } catch {
    return null
  }
}
