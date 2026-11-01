/**
 * 입찰 수집이 멈췄을 때 화면에 '왜 멈췄고 어떻게 되는지'를 적는다.
 * 오류 문구만 보이면 사장님이 무슨 일인지·할 일이 있는지 알 수 없었다(11/01 '응답을 읽지 못했습니다 (200)' — 나라장터 점검이었다).
 */
export type StopInfo = { why: string; plan: string; needsYou?: boolean }

export function explainStop(source: '나라장터' | '국방', r: { stoppedBy?: string; error?: string | null } | null | undefined): StopInfo | null {
  if (!r || (r.stoppedBy !== 'error' && r.stoppedBy !== 'limit')) return null
  const e = r.error ?? ''
  if (r.stoppedBy === 'limit') {
    return { why: `${source} 오늘 조회 한도를 다 썼습니다`, plan: '자정이 지나면 다음 회차부터 멈춘 곳에서 이어 받습니다' }
  }
  if (/점검|\(200\)/.test(e)) {
    return { why: `${source} 시스템 점검 중이라 데이터 대신 점검 안내 화면이 옵니다`, plan: '점검이 끝나면 1시간마다 자동으로 다시 받고, 멈춘 곳부터 이어 받습니다. 하실 일은 없습니다' }
  }
  if (/등록되지 않은|SERVICE_KEY|서비스키|인증키|권한/.test(e)) {
    return { why: `${source} API 키가 이 기능에 등록돼 있지 않습니다`, plan: '공공데이터포털 활용신청(승인·만료)을 확인해야 합니다 — Claude에게 알려 주세요', needsYou: true }
  }
  if (/시간|timeout|Timeout|fetch failed|\(5\d\d\)/.test(e)) {
    return { why: `${source} 응답이 늦거나 끊겼습니다`, plan: '1시간 뒤 다음 회차에 자동으로 다시 받습니다' }
  }
  return { why: e || '알 수 없는 오류', plan: '다음 회차에 다시 받습니다. 몇 시간째 같으면 Claude에게 알려 주세요', needsYou: false }
}
