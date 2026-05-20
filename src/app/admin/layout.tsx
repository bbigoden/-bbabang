import type { Metadata } from 'next'
export const metadata: Metadata = {
  title: { default: '관리자', template: '%s | 빠방 관리자' },
  robots: { index: false, follow: false },
}
export default function Layout({ children }: { children: React.ReactNode }) { return children }
