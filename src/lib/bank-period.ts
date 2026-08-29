/**
 * 부동산뱅크 광고 기간 해석.
 *
 * 뱅크는 목록에 `26.08.27 ~26.09.26` 형태로 광고 기간을 준다. 30일이 지나면
 * 자동 종료돼 광고가 내려가는데, 화면에 남은 날짜가 없으면 언제 끝나는지
 * 알 수가 없다. 만료를 놓치면 뱅크·네이버부동산에서 조용히 빠진다.
 *
 * 웹(광고관리 화면)과 로컬 프로그램이 같이 쓴다.
 */

export interface BankPeriod {
  start: Date
  end: Date
  /** 오늘 기준 남은 날. 오늘 끝나면 0, 지났으면 음수 */
  daysLeft: number
  /** 사람이 읽는 표기 — `3일 남음`, `오늘 만료`, `2일 지남` */
  label: string
  level: 'expired' | 'urgent' | 'soon' | 'ok'
}

/** `26.08.27` → Date. 뱅크는 두 자리 연도를 쓴다. */
function parseShortDate(s: string): Date | null {
  const m = s.match(/(\d{2})\.(\d{2})\.(\d{2})/)
  if (!m) return null
  const [, y, mo, d] = m
  const date = new Date(2000 + Number(y), Number(mo) - 1, Number(d))
  return Number.isNaN(date.getTime()) ? null : date
}

/** 시각을 버리고 날짜만 비교한다 — 오후에 봐도 "1일 남음"이 유지돼야 한다. */
function atMidnight(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

/**
 * @param period 뱅크 목록의 기간 문자열 (`26.08.27 ~26.09.26`)
 * @param now 기준 시각 (검사용. 생략하면 현재)
 */
export function parseBankPeriod(period: string | null | undefined, now = new Date()): BankPeriod | null {
  if (!period) return null
  const parts = period.split('~')
  if (parts.length < 2) return null
  const start = parseShortDate(parts[0])
  const end = parseShortDate(parts[1])
  if (!start || !end) return null

  const daysLeft = Math.round(
    (atMidnight(end).getTime() - atMidnight(now).getTime()) / 86_400_000,
  )

  const label =
    daysLeft < 0 ? `${-daysLeft}일 지남`
    : daysLeft === 0 ? '오늘 만료'
    : `${daysLeft}일 남음`

  // 뱅크 재등록은 사람이 직접 해야 하므로, 주말이 껴도 대응할 수 있게
  // 3일 전부터 급함으로 본다.
  const level =
    daysLeft < 0 ? 'expired'
    : daysLeft <= 3 ? 'urgent'
    : daysLeft <= 7 ? 'soon'
    : 'ok'

  return { start, end, daysLeft, label, level }
}
