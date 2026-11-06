/**
 * 네이버예약 알림 메일 → 일정 한 건.
 * 네이버예약은 가게에 예약 정보를 넘겨주는 공개 연결(API)이 없다. 그래서 사장님께 오는 알림 메일을
 * 지메일(구글 스크립트)이나 메일 받는 서비스가 /api/inbound/naver/<slug> 로 넘겨주고, 여기서 읽는다.
 *
 * 실제 메일 샘플을 받기 전에 만든 첫 판 — 칸 이름을 여러 가지로 찾는다. 못 읽은 칸은 비워 두고
 * 원문을 그대로 붙여 '확인 필요'에 올린다(사람이 보고 고친다). 샘플이 오면 칸 이름을 맞춘다.
 */

import { createHmac } from 'crypto'

/** 받는 주소의 열쇠 — slug 와 CRON_SECRET 으로 만든다. CRON_SECRET 을 바꾸면 스크립트 주소도 바꿔야 한다 */
export function inboundKey(slug: string): string {
  return createHmac('sha256', process.env.CRON_SECRET ?? '').update(`naver-inbound:${slug}`).digest('hex').slice(0, 32)
}

export type NaverMailKind = 'new' | 'confirmed' | 'changed' | 'canceled'

export interface NaverMail {
  kind: NaverMailKind
  ref: string | null          // 예약번호
  name: string | null
  phone: string | null        // 가려진 번호(010-****-1234)는 그대로 둔다
  date: string | null         // YYYY-MM-DD
  time: string | null         // HH:MM
  product: string | null
  amount: number | null
  request: string | null
}

/** html 메일이면 글자만 남긴다 */
export function mailText(text: string | null | undefined, html: string | null | undefined): string {
  if (text && text.trim()) return text.replace(/\r\n?/g, '\n')
  if (!html) return ''
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, '\n')
    .replace(/<\/t[dh]>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim()
}

/** 네이버예약 메일이 맞나 — 지메일에 다른 메일이 섞여 와도 일정에 안 들어가게 */
export function looksLikeNaverBooking(from: string, subject: string, body: string): boolean {
  const all = `${from}\n${subject}\n${body.slice(0, 3000)}`
  return /네이버\s*예약|naver\s*booking|booking\.naver|smartplace|스마트플레이스/i.test(all) && /예약/.test(all)
}

function label(body: string, names: string[], max = 60): string | null {
  for (const n of names) {
    // '예약자명 : 홍길동' / '예약자명 홍길동' / 표에서 '예약자명\n홍길동'
    const re = new RegExp(`(?:^|\\n|\\s)${n}\\s*[:：]?[ \\t]*\\n?[ \\t]*([^\\n]{1,${max}})`)
    const m = re.exec(body)
    if (m) {
      const v = m[1].trim().replace(/^[:：]\s*/, '')
      if (v) return v
    }
  }
  return null
}

function parseWhen(s: string): { date: string; time: string | null } | null {
  const m = /(20\d{2})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})\s*[.일]?\s*(?:\([^)]*\)|[월화수목금토일]요일)?\s*(오전|오후|AM|PM)?\s*(?:(\d{1,2})\s*(?::|시)\s*(\d{2})?)?/i.exec(s)
  if (!m) return null
  const date = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  if (!m[5]) return { date, time: null }
  let h = Number(m[5])
  const ap = m[4]?.toUpperCase()
  if ((ap === '오후' || ap === 'PM') && h < 12) h += 12
  if ((ap === '오전' || ap === 'AM') && h === 12) h = 0
  if (h > 23) return { date, time: null }
  return { date, time: `${String(h).padStart(2, '0')}:${(m[6] ?? '00').padStart(2, '0')}` }
}

export function parseNaverMail(subject: string, body: string): NaverMail {
  const head = `${subject}\n${body.slice(0, 400)}`
  const kind: NaverMailKind =
    /취소/.test(subject) || (!subject && /예약이?\s*취소/.test(head)) ? 'canceled'
      : /변경/.test(subject) ? 'changed'
        : /확정/.test(subject) ? 'confirmed'
          : 'new'

  const ref = (/예약\s*번호\s*[:：]?\s*\n?\s*([0-9A-Za-z-]{5,30})/.exec(body) ?? [])[1] ?? null

  const name = label(body, ['예약자명', '예약자', '예약자 이름', '고객명', '이름'], 30)
    ?.replace(/\s*(님|고객님)$/, '').replace(/\s*\(.*$/, '').trim() || null

  const phoneM = /01[016789][-.\s]?(?:\d{3,4}|\*{3,4})[-.\s]?\d{4}/.exec(body)
  const phone = phoneM ? phoneM[0].replace(/[.\s]/g, '-').replace(/^(01\d)(\d{3,4})(\d{4})$/, '$1-$2-$3') : null

  const whenLine = label(body, ['이용\\s*일시', '예약\\s*일시', '방문\\s*일시', '이용일', '예약일', '일시', '날짜'], 60)
  const when = (whenLine && parseWhen(whenLine)) || parseWhen(body)

  const product = label(body, ['상품명', '예약\\s*상품', '이용\\s*상품', '상품', '메뉴', '서비스'], 60)

  const amountLine = label(body, ['결제\\s*금액', '총\\s*결제\\s*금액', '총\\s*금액', '결제\\s*예정\\s*금액', '금액'], 40)
  const amountM = amountLine && /([\d,]{3,})\s*원?/.exec(amountLine)
  const amount = amountM ? Number(amountM[1].replace(/,/g, '')) || null : null

  const request = label(body, ['요청\\s*사항', '요청', '메모', '고객\\s*요청'], 300)

  return { kind, ref, name, phone, date: when?.date ?? null, time: when?.time ?? null, product, amount, request }
}
