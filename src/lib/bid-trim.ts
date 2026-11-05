/**
 * 업체별 투찰은 1순위 앞뒤 몇 곳만 보관한다 (2026-11-05).
 *
 * 2년치 낙찰을 받으면서 공고마다 참여 업체 전부(평균 130곳, 많으면 500곳 넘게)를 넣었더니
 * 이 표 하나가 711MB — DB 무료 한도(500MB)를 혼자 넘겼다. 화면(result-detail)은 1순위 앞뒤 8곳만
 * 먼저 보이고, 사정률·1순위 금액 같은 분석 값은 받을 때 전체로 계산해 bid_results 에 따로 적어 두므로
 * 나머지 줄은 다시 쓰이지 않는다.
 *
 * 1순위를 고르는 법은 화면과 같다 — 금액 순으로 놓고 나라장터 1순위, 없으면 하한선 위 첫 업체.
 * 둘 다 못 잡으면(금액이 아직 안 왔다 등) 자르지 않는다 — 다시 받을 때 잘린다.
 */

export const BID_KEEP_AROUND = 10

/** 낙찰하한선 — (예정가격 − A값) × 하한율 + A값, 올림. result-detail 과 같은 식 */
export function bidFloor(plnprc: number | null | undefined, lwltRate: number | string | null | undefined, aAmount: number | null | undefined): number | null {
  const L = lwltRate == null ? NaN : Number(lwltRate)
  if (!plnprc || !Number.isFinite(L) || L <= 0) return null
  const A = aAmount ?? 0
  return Math.ceil((plnprc - A) * (L / 100) + A)
}

type BidLike = { rank: number; amount: number | null }

const byAmount = (a: BidLike, b: BidLike) => (a.amount ?? Infinity) - (b.amount ?? Infinity)

export function trimBids<T extends BidLike>(bids: T[], floor: number | null, keep = BID_KEEP_AROUND): T[] {
  if (bids.length <= keep * 2 + 1) return bids
  const sorted = [...bids].sort(byAmount)
  let w = sorted.findIndex(b => b.rank === 1)
  if (w < 0 && floor != null) w = sorted.findIndex(b => (b.amount ?? 0) >= floor)
  if (w < 0) return bids
  return sorted.slice(Math.max(0, w - keep), w + keep + 1)
}
