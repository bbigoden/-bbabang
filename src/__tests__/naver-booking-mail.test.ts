import { describe, it, expect } from 'vitest'
import { parseNaverMail, mailText, looksLikeNaverBooking } from '@/lib/naver-booking-mail'

describe('네이버예약 메일 읽기', () => {
  const body = `네이버 예약
새로운 예약이 접수되었습니다.
예약번호 : 1234567890
예약자명 : 홍길동 님
연락처 : 010-1234-5678
이용일시 : 2026.11.08.(일) 오후 2:30
상품명 : 꽃다발 (중)
결제금액 : 35,000원
요청사항 : 리본에 생일 축하 문구`

  it('칸을 읽는다', () => {
    const m = parseNaverMail('[네이버 예약] 새로운 예약이 접수되었습니다', body)
    expect(m).toMatchObject({ kind: 'new', ref: '1234567890', name: '홍길동', phone: '010-1234-5678',
      date: '2026-11-08', time: '14:30', product: '꽃다발 (중)', amount: 35000, request: '리본에 생일 축하 문구' })
  })
  it('취소·변경·확정', () => {
    expect(parseNaverMail('[네이버 예약] 예약이 취소되었습니다', body).kind).toBe('canceled')
    expect(parseNaverMail('예약 변경 안내', body).kind).toBe('changed')
    expect(parseNaverMail('예약이 확정되었습니다', body).kind).toBe('confirmed')
  })
  it('표 모양(칸 이름 다음 줄에 값)과 오전 12시', () => {
    const m = parseNaverMail('새 예약', '예약자\n김꽃\n예약일시\n2026-12-01 오전 12:00')
    expect(m.name).toBe('김꽃'); expect(m.date).toBe('2026-12-01'); expect(m.time).toBe('00:00')
  })
  it('html 메일과 다른 메일 거르기', () => {
    expect(mailText('', '<p>예약자명 : 이<b>름</b></p><br>x&nbsp;y')).toBe('예약자명 : 이름\nx y')
    expect(looksLikeNaverBooking('ad@shop.com', '할인 쿠폰', '이번 주 할인')).toBe(false)
    expect(looksLikeNaverBooking('naverbooking@navercorp.com', '[네이버 예약] 새 예약', body)).toBe(true)
  })
})
