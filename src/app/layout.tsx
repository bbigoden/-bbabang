import type { Metadata } from 'next'
import { Geist } from 'next/font/google'
import './globals.css'
import { ServiceWorkerRegister } from '@/components/sw-register'
import { AuthProvider } from '@/lib/auth-context'
import { NotificationsProvider } from '@/lib/notifications-context'
import { ThemeProvider } from '@/lib/theme-context'
import { BottomNav } from '@/components/layout/bottom-nav'
import { Footer } from '@/components/layout/footer'
import { InstallPrompt } from '@/components/install-prompt'
import { ErrorBoundary, GlobalErrorListener } from '@/components/error-tracker'
import { BrokerGlobalLayout } from '@/components/broker/global-layout'
import { ToastProvider } from '@/components/toast'
import { Analytics } from '@vercel/analytics/next'
import { SpeedInsights } from '@vercel/speed-insights/next'
import { ConsentGate } from '@/components/consent-gate'

const geist = Geist({ subsets: ['latin'] })

const BASE_URL = 'https://bbabang.vercel.app'

export const metadata: Metadata = {
  metadataBase: new URL(BASE_URL),
  title: {
    default: '빠방 - 조건만 올리면 중개사가 찾아드립니다',
    template: '%s | 빠방',
  },
  description: '내 조건만 올리면 공인중개사가 먼저 제안합니다. 전세·월세·매매 부동산 역경매 매칭 플랫폼',
  keywords: '부동산, 중개, 전세, 월세, 매매, 역경매, 빠방, 공인중개사, 부동산 매칭',
  authors: [{ name: '빠방' }],
  openGraph: {
    type: 'website',
    locale: 'ko_KR',
    url: BASE_URL,
    siteName: '빠방',
    title: '빠방 - 조건만 올리면 중개사가 찾아드립니다',
    description: '내 조건만 올리면 공인중개사가 먼저 제안합니다. 전세·월세·매매 부동산 역경매 매칭 플랫폼',
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: '빠방 - 부동산 중개 매칭 플랫폼',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: '빠방 - 조건만 올리면 중개사가 찾아드립니다',
    description: '내 조건만 올리면 공인중개사가 먼저 제안합니다.',
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
    title: '빠방',
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
                name: '빠방',
                alternateName: 'Ppabang',
                url: BASE_URL,
                potentialAction: {
                  '@type': 'SearchAction',
                  target: { '@type': 'EntryPoint', urlTemplate: `${BASE_URL}/search?q={search_term_string}` },
                  'query-input': 'required name=search_term_string',
                },
              },
              {
            '@type': 'Organization',
            name: '빠방',
            alternateName: 'Ppabang',
            url: BASE_URL,
            logo: `${BASE_URL}/icon-512.png`,
            description: '내 조건을 올리면 공인중개사가 먼저 제안하는 부동산 역경매 매칭 플랫폼',
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
                  <ConsentGate />
                  <BottomNav />
                  <InstallPrompt />
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
