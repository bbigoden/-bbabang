import type { Metadata } from 'next'
import { Geist } from 'next/font/google'
import './globals.css'
import { ServiceWorkerRegister } from '@/components/sw-register'
import { AuthProvider } from '@/lib/auth-context'
import { NotificationsProvider } from '@/lib/notifications-context'
import { ThemeProvider } from '@/lib/theme-context'
import { BottomNav } from '@/components/layout/bottom-nav'
import { Footer } from '@/components/layout/footer'
import { ErrorBoundary, GlobalErrorListener } from '@/components/error-tracker'
import { BrokerGlobalLayout } from '@/components/broker/global-layout'
import { ToastProvider } from '@/components/toast'
import { Analytics } from '@vercel/analytics/next'
import { SpeedInsights } from '@vercel/speed-insights/next'
import { LazyOverlays } from '@/components/lazy-overlays'

// 미리받기(preload) 끔 — 한글 화면이라 거의 안 쓰는 라틴 글꼴(29KB)이 첫 화면 프로그램과 회선을 나눠 썼다(10-30).
// 글꼴은 그대로 쓰고, 받기 전엔 시스템 글꼴로 보였다가 바뀐다.
const geist = Geist({ subsets: ['latin'], preload: false })

const BASE_URL = 'https://bbabang.vercel.app'

export const metadata: Metadata = {
  metadataBase: new URL(BASE_URL),
  title: {
    default: '중개사무소 업무 도구',
    template: '%s | 부소장',
  },
  description: '매물장·고객장·업무일지·광고관리·정산까지, 중개사무소 업무를 한 곳에서',
  keywords: '부동산, 중개사무소, 매물장, 고객장, 업무일지, 부소장, 빠방, 공인중개사',
  authors: [{ name: '부소장' }],
  openGraph: {
    type: 'website',
    locale: 'ko_KR',
    url: BASE_URL,
    siteName: '부소장',
    title: '부소장 - 중개사무소 업무 도구',
    description: '매물장·고객장·업무일지·광고관리·정산까지, 중개사무소 업무를 한 곳에서',
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: '부소장 - 중개사무소 업무 도구',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: '부소장 - 중개사무소 업무 도구',
    description: '매물장·고객장·업무일지·광고관리·정산까지, 중개사무소 업무를 한 곳에서',
    images: ['/og-image.png'],
  },
  robots: {
    index: true,
    follow: true,
  },
  icons: {
    icon: '/favicon.ico',
    apple: [
      { url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
      { url: '/apple-touch-icon-167.png', sizes: '167x167', type: 'image/png' },
      { url: '/apple-touch-icon-152.png', sizes: '152x152', type: 'image/png' },
    ],
  },
  // iOS PWA standalone 모드 + 상단 상태바 네이비 통일
  appleWebApp: {
    capable: true,
    title: '부소장',
    statusBarStyle: 'black-translucent',
  },
  manifest: '/manifest.webmanifest',
}

export const viewport: import('next').Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  themeColor: '#14274e',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="ko" className="h-full" suppressHydrationWarning>
      <head>
        {/* FOUC 방지: hydration 전에 테마·글꼴 클래스 적용 */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{
              var t=localStorage.getItem('bbabang_theme')||'system';
              var f=localStorage.getItem('bbabang_font_size')||'md';
              var dark=t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);
              var r=document.documentElement;
              if(dark)r.classList.add('dark');
              r.classList.add('font-'+f);
            }catch(e){}})();`,
          }}
        />
      </head>
      <body className={`${geist.className} min-h-full antialiased`}>
        <a href="#main" className="skip-link">본문으로 건너뛰기</a>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@graph': [
              {
                '@type': 'WebSite',
                name: '부소장',
                alternateName: ['Busojang', '빠방'],
                url: BASE_URL,
              },
              {
            '@type': 'Organization',
            name: '부소장',
            alternateName: ['Busojang', '빠방'],
            url: BASE_URL,
            logo: `${BASE_URL}/icon-512.png`,
            description: '매물장·고객장·업무일지·광고관리·정산까지, 중개사무소 업무를 한 곳에서',
            sameAs: [],
            contactPoint: {
              '@type': 'ContactPoint',
              email: 'bigodennn@gmail.com',
              contactType: 'customer service',
              areaServed: 'KR',
              availableLanguage: ['Korean'],
            },
              },
            ],
          }) }}
        />
        <ServiceWorkerRegister />
        <GlobalErrorListener />
        <ErrorBoundary>
          <ThemeProvider>
            <AuthProvider>
              <NotificationsProvider>
                <ToastProvider>
                  <BrokerGlobalLayout>
                    <main id="main" className="flex-1">{children}</main>
                    <Footer />
                  </BrokerGlobalLayout>
                  <BottomNav />
                  <LazyOverlays />
                </ToastProvider>
              </NotificationsProvider>
            </AuthProvider>
          </ThemeProvider>
        </ErrorBoundary>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  )
}
