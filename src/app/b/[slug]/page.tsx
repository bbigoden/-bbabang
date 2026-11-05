import type { Metadata } from 'next'
import { BookingForm } from './booking-form'
import { loadBookingMeta } from './load'

/**
 * 손님용 예약 페이지 — 로그인 없이 연다. 링크는 직원이 인스타 프로필·카톡 채널에 붙인다(?from=insta|kakao).
 *
 * 공유 미리보기는 이 페이지 것으로 덮는다. 안 그러면 사이트 기본값(부소장 소개·옛 '빠방' 그림)이
 * 카톡 미리보기에 떠서 손님에게 중개사무소 도구가 보였다(11-05). 그림은 opengraph-image.tsx.
 */
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const meta = await loadBookingMeta(slug)
  const title = meta?.title ?? '예약하기'
  const description = meta?.intro ?? '원하는 날짜와 시간을 골라 예약을 신청하세요.'
  return {
    title: { absolute: title },
    description,
    robots: { index: false, follow: false },
    openGraph: { type: 'website', locale: 'ko_KR', url: `/b/${slug}`, title, description, siteName: title },
    twitter: { card: 'summary_large_image', title, description },
  }
}

export default async function BookingPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  return <BookingForm slug={slug} />
}
