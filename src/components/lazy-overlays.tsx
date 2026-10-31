'use client'

import dynamic from 'next/dynamic'

// 화면 위에 가끔 뜨는 창(약관 재동의·앱 설치 안내·이름 바뀜 안내)은 첫 화면 프로그램에서 빼고 뒤에 받는다.
// 처음 여는 폰 3G 에서 약 250KB 를 받느라 10초 가까이 걸렸다(10-30 폰 속도 조사) — 조금이라도 덜어 낸다.
const ConsentGate = dynamic(() => import('@/components/consent-gate').then(m => m.ConsentGate), { ssr: false })
const InstallPrompt = dynamic(() => import('@/components/install-prompt').then(m => m.InstallPrompt), { ssr: false })
const RebrandNotice = dynamic(() => import('@/components/rebrand-notice').then(m => m.RebrandNotice), { ssr: false })

export function LazyOverlays() {
  return (
    <>
      <ConsentGate />
      <InstallPrompt />
      <RebrandNotice />
    </>
  )
}
