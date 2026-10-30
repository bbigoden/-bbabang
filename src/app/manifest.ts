import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: '부소장 - 중개사무소 업무 도구',
    short_name: '부소장',
    description: '매물장·고객장·업무일지·광고관리·정산까지, 중개사무소 업무를 한 곳에서',
    start_url: '/',
    display: 'standalone',
    background_color: '#F9FAFB',
    theme_color: '#14274e',
    orientation: 'portrait',
    icons: [
      {
        src: '/icon-192.png?v=3',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icon-192.png?v=3',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/icon-512.png?v=3',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icon-512.png?v=3',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        // 실제 파일은 32x32 PNG 한 장을 ICO로 감싼 것이다(48로 적으면 틀린 선언)
        src: '/favicon.ico?v=3',
        sizes: '32x32',
        type: 'image/x-icon',
      },
    ],
    categories: ['lifestyle', 'utilities'],
    lang: 'ko',
  }
}
