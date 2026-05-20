import type { Metadata } from 'next'
export const metadata: Metadata = { title: '최근 본 항목', robots: { index: false, follow: false } }
export default function Layout({ children }: { children: React.ReactNode }) { return children }
