/**
 * 날짜는 언제나 한국(Asia/Seoul) 기준으로 센다.
 *
 * 서버(Vercel)도 Supabase 도 UTC 로 돈다. 그래서 `new Date().toISOString().slice(0,10)`
 * 이나 SQL 의 `CURRENT_DATE` 를 그대로 쓰면 **한국시간 0~9시 사이에는 어제 날짜**가
 * 나온다. 사장님은 아침 일찍 일하므로 이건 이론이 아니라 매일 아침 나는 일이다.
 *
 * 실제로 견적서에서 났다 — 견적번호는 Asia/Seoul 로 매기는데 발행일만 UTC 라,
 * 아침 8시에 만든 견적서가 번호는 2026-0905-01 인데 발행일은 2026-09-04 로 찍혔다.
 * 업무일지도 아침에 쓰면 어제 칸에 적혔다.
 *
 * 시각(timestamptz)은 순간을 그대로 담으므로 toISOString() 이 맞다.
 * 문제가 되는 건 거기서 **날짜만 뽑을 때**다.
 */

/** 오늘 날짜(한국 기준) YYYY-MM-DD */
export function todayKST(now = new Date()): string {
  return ymdKST(now)
}

/** 어떤 시각을 한국 날짜로 읽는다. YYYY-MM-DD */
export function ymdKST(value: Date | string | number): string {
  const d = value instanceof Date ? value : new Date(value)
  if (isNaN(d.getTime())) return ''
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d)
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

/** 어떤 시각을 한국 시:분으로 읽는다. HH:MM (24시간) */
export function hmKST(value: Date | string | number): string {
  const d = value instanceof Date ? value : new Date(value)
  if (isNaN(d.getTime())) return ''
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d)
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? ''
  // 자정을 '24'로 주는 환경이 있어 '00'으로 맞춘다
  const h = get('hour') === '24' ? '00' : get('hour')
  return `${h}:${get('minute')}`
}

/**
 * 날짜 문자열에 며칠을 더한다. YYYY-MM-DD → YYYY-MM-DD
 *
 * getDate()/setDate() 는 로컬 시간으로 읽고 쓰기 때문에 보는 곳에 따라 하루가
 * 밀린다. 날짜에 일수를 더하는 셈은 어디서 보든 같아야 하므로 UTC 로만 센다.
 */
export function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`)
  if (isNaN(d.getTime())) return ''
  d.setUTCDate(d.getUTCDate() + (Number(days) || 0))
  return d.toISOString().slice(0, 10)
}
