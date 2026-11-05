import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: '부소장 - 중개사무소 업무 도구',
    short_name: '부소장',
    description: '매물장·고객장·업무일지·광고관리·정산까지, 중개사무소 업무를 한 곳에서',
    // id 가 없으면 start_url 이 바뀔 때 폰이 다른 앱으로 보고 두 번 깔린다
    id: '/',
    // 바로 첫 화면으로. '/' 로 열면 서버가 역할을 한 번 더 묻고 돌려보내 켤 때마다 한 번 더 기다렸다(2026-11-05).
    // 중개사가 아닌 계정은 이 화면이 homePath 로 다시 보낸다
    start_url: '/dashboard/broker',
    scope: '/',
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
    // 홈 화면 아이콘을 길게 누르면 바로 가는 곳
    shortcuts: [
      { name: '메세지', url: '/broker/messenger', icons: [{ src: '/icon-192.png?v=3', sizes: '192x192', type: 'image/png' }] },
      { name: '매물목록', url: '/broker/properties', icons: [{ src: '/icon-192.png?v=3', sizes: '192x192', type: 'image/png' }] },
      { name: '업무일지', url: '/broker/diary', icons: [{ src: '/icon-192.png?v=3', sizes: '192x192', type: 'image/png' }] },
    ],
    categories: ['lifestyle', 'utilities'],
    lang: 'ko',
  }
}
