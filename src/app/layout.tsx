import type { Metadata } from 'next'
import { Geist } from 'next/font/google'
import './globals.css'

const geist = Geist({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: '빠방 - 내 조건에 맞는 방을 중개사가 찾아드립니다',
  description: '조건만 올리면 중개사가 먼저 제안합니다. 부동산 역경매 플랫폼',
  keywords: '부동산, 중개, 전세, 월세, 매매, 역경매, 빠방',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="ko" className="h-full">
      <body className={`${geist.className} min-h-full bg-gray-50 text-gray-900 antialiased`}>
        {children}
      </body>
    </html>
  )
}
