import type { Metadata } from 'next'
export const metadata: Metadata = { title: '추천 매물', robots: { index: false, follow: false } }
export default function Layout({ children }: { children: React.ReactNode }) { return children }
