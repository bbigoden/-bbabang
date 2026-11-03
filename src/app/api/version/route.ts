import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/**
 * 지금 배포된 판의 커밋. 폰에 떠 있는 앱(ServiceWorkerRegister)이 자기 빌드 값과 견줘
 * 다르면 '새 버전' 안내를 띄운다. 로그인과 무관하고 값도 공개 커밋 해시뿐이다.
 */
export function GET() {
  return NextResponse.json(
    { id: process.env.VERCEL_GIT_COMMIT_SHA ?? '' },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
