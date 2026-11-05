import { ImageResponse } from 'next/og'
import { loadBookingMeta } from './load'

/** 카톡·인스타 공유 미리보기 그림 — 예약 페이지 제목을 크게. 부소장 이름은 넣지 않는다(손님 화면) */
export const alt = '예약하기'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

/** 한글 글꼴 — 기본 글꼴엔 한글이 없어 네모로 나온다. 쓸 글자만 구글 폰트에서 받아 온다 */
async function koreanFont(text: string): Promise<ArrayBuffer | null> {
  try {
    const css = await fetch(`https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@700&text=${encodeURIComponent(text)}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },   // 이게 없으면 ttf 대신 woff2 를 준다(ImageResponse 가 못 읽음)
    }).then(r => r.text())
    const src = css.match(/src: url\((.+?)\) format\('(opentype|truetype)'\)/)?.[1]
    return src ? await fetch(src).then(r => r.arrayBuffer()) : null
  } catch {
    return null
  }
}

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const meta = await loadBookingMeta(slug)
  const title = (meta?.title ?? '예약하기').slice(0, 20)
  const sub = '날짜·시간 골라 바로 예약 신청'
  const badge = '온라인 예약'
  const font = await koreanFont(title + sub + badge)

  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', padding: '0 90px', background: 'linear-gradient(135deg, #fff7f3 0%, #fdeef3 55%, #f3f0ff 100%)', fontFamily: 'KR' }}>
        {/* 달력 그림 */}
        <div style={{ display: 'flex', flexDirection: 'column', width: 260, height: 260, borderRadius: 36, background: '#ffffff', boxShadow: '0 20px 50px rgba(20,39,78,0.15)', overflow: 'hidden', marginRight: 80, flexShrink: 0 }}>
          <div style={{ height: 70, background: '#e8577e', display: 'flex' }} />
          <div style={{ display: 'flex', flexWrap: 'wrap', padding: '22px 26px', gap: 14 }}>
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} style={{ width: 38, height: 30, borderRadius: 8, background: i === 6 ? '#e8577e' : '#f1e6ea', display: 'flex' }} />
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignSelf: 'flex-start', padding: '8px 22px', borderRadius: 999, background: '#e8577e', color: '#fff', fontSize: 30 }}>{badge}</div>
          <div style={{ display: 'flex', marginTop: 26, fontSize: 96, color: '#1f2937', lineHeight: 1.1 }}>{title}</div>
          <div style={{ display: 'flex', marginTop: 22, fontSize: 40, color: '#6b7280' }}>{sub}</div>
        </div>
      </div>
    ),
    { ...size, fonts: font ? [{ name: 'KR', data: font, weight: 700, style: 'normal' }] : undefined },
  )
}
