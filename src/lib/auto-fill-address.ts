// 자동채움에 넘길 주소·호수 정리 — 매물목록 화면과 일괄 채우기 스크립트(scripts/backfill-area.mjs)가 같이 쓴다.
// Node 가 이 파일을 바로 읽을 수 있게 import 를 두지 않는다.

/** 층 표기('3층', 'B1층')를 빼고 호수를 뽑는다 — 단일·다중·범위 지원 */
export function splitAddressForAutoFill(addr: string): { addr: string; hos: string[] } {
  return extractHos(addr.replace(/\s*[Bb]?\d+층\s*/g, ' ').replace(/\s+/g, ' ').trim())
}

// '114호' → ['114']
// '114, 115호' / '103,104호' → ['114','115']
// '201, 202, 203호' → ['201','202','203']
// '201~205호' / '114-115호' → 범위 자동 확장 (자릿수 같을 때만, 최대 50개)
// '104동 404호' → ho=['404'], 주소에 '104동' 유지
// '104-404' → ho=['404'], 주소에 '104동' 추가
export function extractHos(addr: string): { addr: string; hos: string[] } {
  // 1) '동번호-호번호' 형식 (예: '104-404') — 호 접미사 없음
  const dongHo = addr.match(/\s(\d{1,3})-(\d{3,4})\s*$/)
  if (dongHo) {
    const cleaned = (addr.slice(0, dongHo.index) + ` ${dongHo[1]}동`).replace(/\s+/g, ' ').trim()
    return { addr: cleaned, hos: [dongHo[2]] }
  }
  // 2) 'N호' / 'N,M호' / 'N~M호' 등 다중 호수
  // '호' 뒤에 \b 를 쓰면 안 된다 — 한글은 단어 글자가 아니라 '203호' 끝에서 경계가 안 생겨 호수를 영영 못 찾았다
  // (5/28~11/01 자동채움이 호수 매물 면적을 하나도 못 채움). 뒤에 글자·숫자가 이어지지 않는지로 본다.
  const m = addr.match(/(\d{1,4}(?:\s*[,\-·~]\s*\d{1,4})*)\s*호(?![가-힣A-Za-z0-9])/)
  if (!m) return { addr: addr.trim(), hos: [] }
  const start = m.index ?? 0
  const cleaned = (addr.slice(0, start) + ' ' + addr.slice(start + m[0].length)).replace(/\s+/g, ' ').trim()
  // 호수 확장
  const parts = m[1].trim().split(/\s*[,·]\s*/)
  const out: string[] = []
  for (const p of parts) {
    const t = p.trim()
    if (!t) continue
    const rm = t.match(/^(\d+)\s*[~\-]\s*(\d+)$/)
    if (rm && rm[1].length === rm[2].length) {
      const a = Number(rm[1]), b = Number(rm[2])
      if (a <= b && b - a <= 50) {
        for (let n = a; n <= b; n++) out.push(String(n))
        continue
      }
    }
    const n = t.replace(/[^0-9]/g, '')
    if (n) out.push(n)
  }
  // 중복 제거(순서 유지)
  const seen = new Set<string>()
  const hos = out.filter(h => !seen.has(h) && (seen.add(h), true))
  return { addr: cleaned, hos }
}
