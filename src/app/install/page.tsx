import type { Metadata } from 'next'
import { InstallGuide } from './install-guide'

export const metadata: Metadata = {
  title: '앱 설치',
  description: '부소장을 폰 홈 화면에 앱으로 설치하는 방법',
}

/**
 * 폰에 앱 까는 화면 — 직원에게 이 주소(/install) 하나만 보내면 된다.
 * 카톡으로 받은 링크는 카톡 안 브라우저로 열려 설치가 안 되므로, 그 경우 바깥 브라우저로 내보낸다.
 */
export default function InstallPage() {
  return (
    <main className="mx-auto flex min-h-[80dvh] max-w-md flex-col justify-center px-4 py-10">
      <InstallGuide />
    </main>
  )
}
