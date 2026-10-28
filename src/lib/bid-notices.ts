/** 입찰공고 목록 다듬기 */

type OrdRow = {
  bid_ntce_no: string
  bid_ntce_ord: string
  name: string
  bid_close_at: string | null
  bssamt: number | null
  a_amount: number | null
  rng_end: number | null
}

/**
 * 정정공고는 같은 공고번호에 차수만 올라간다(000 → 001 → 002). 살아 있는 건 마지막 차수뿐이라
 * 앞 차수를 그대로 두면 같은 공고가 두세 번 보인다. 취소공고도 새 차수로 오므로, 마지막 차수가
 * 취소면 공고째 뺀다. 기초금액은 앞 차수에만 붙어 있기도 해서 비었으면 넘겨 받는다.
 */
export function latestOrd<T extends OrdRow>(rows: T[]): T[] {
  const byNo = new Map<string, T[]>()
  for (const r of rows) byNo.set(r.bid_ntce_no, [...(byNo.get(r.bid_ntce_no) ?? []), r])
  const out: T[] = []
  for (const group of byNo.values()) {
    const sorted = [...group].sort((a, b) => b.bid_ntce_ord.localeCompare(a.bid_ntce_ord))
    const last = sorted[0]
    if (/취소공고/.test(last.name)) continue
    const withBase = sorted.find(r => r.bssamt != null)
    out.push(last.bssamt == null && withBase
      ? { ...last, bssamt: withBase.bssamt, a_amount: last.a_amount ?? withBase.a_amount, rng_end: last.rng_end ?? withBase.rng_end }
      : last)
  }
  return out.sort((a, b) => (a.bid_close_at ?? '').localeCompare(b.bid_close_at ?? ''))
}

/** 이보다 크면 잘못 친 것으로 본다(1조) — 5,000자 숫자를 넣자 '∞원'이 찍혔다 */
const MAX_WON = 1e12

/**
 * 사람이 치는 금액 → 원. '2억3600만' '6,400만' '2.36억' '63500000' 모두 받는다.
 * 숫자를 못 읽으면 null — 소수점·마이너스·1e10 처럼 애매한 건 숫자만 골라 읽지 않고 거절한다
 * (예전엔 '25240000.5' 를 252,400,005 원으로 읽어 추천 금액이 10배가 됐다).
 */
export function parseWon(text: string): number | null {
  const t = text.replace(/[,\s원]/g, '')
  if (!t) return null
  if (/^\d+$/.test(t)) return t.length <= 13 && Number(t) > 0 && Number(t) <= MAX_WON ? Number(t) : null
  const m = t.match(/^(?:(\d+(?:\.\d+)?)억)?(?:(\d+(?:\.\d+)?)만)?(\d+)?$/)
  if (!m || (!m[1] && !m[2])) return null
  const v = Number(m[1] ?? 0) * 1e8 + Number(m[2] ?? 0) * 1e4 + Number(m[3] ?? 0)
  return v > 0 && v <= MAX_WON ? Math.round(v) : null
}
