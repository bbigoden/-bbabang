import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: '빠방 - 부동산 중개 매칭',
    short_name: '빠방',
    description: '조건만 올리면 공인중개사가 먼저 제안합니다',
    start_url: '/',
    display: 'standalone',
    background_color: '#F9FAFB',
    theme_color: '#14274e',
    orientation: 'portrait',
    icons: [
      {
        src: '/icon-192.png?v=2',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icon-192.png?v=2',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/icon-512.png?v=2',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icon-512.png?v=2',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/favicon.ico?v=2',
        sizes: '48x48',
        type: 'image/x-icon',
      },
    ],
    categories: ['lifestyle', 'utilities'],
    lang: 'ko',
  }
}
