import type { Metadata } from 'next'
import { Geist } from 'next/font/google'
import './globals.css'
import { ServiceWorkerRegister } from '@/components/sw-register'

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
    apple: '/icon.svg',
  },
  manifest: '/manifest.webmanifest',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="ko" className="h-full">
      <body className={`${geist.className} min-h-full bg-gray-50 text-gray-900 antialiased`}>
        <ServiceWorkerRegister />
        {children}
      </body>
    </html>
  )
}
