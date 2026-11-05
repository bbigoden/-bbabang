import type { Metadata } from 'next'
import { BookingForm } from './booking-form'

/** 손님용 예약 페이지 — 로그인 없이 연다. 링크는 직원이 인스타 프로필·카톡 채널에 붙인다(?from=insta|kakao). */
export const metadata: Metadata = {
  title: '예약하기',
  robots: { index: false, follow: false },
}

export default async function BookingPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  return <BookingForm slug={slug} />
}
