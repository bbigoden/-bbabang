'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { SUPPORT_EMAIL } from '@/lib/support'

/**
 * 사이트 푸터 — 사업자정보·법적 표기·정책 링크.
 *
 * 두 줄로 줄였다(11-06 사장님): 로고·'중개사무소 업무 도구' 소개를 빼고, 사업자정보 한 줄 + 정책 링크·© 한 줄.
 * 좌우 여백은 화면 본문과 같은 px-4 — 카드 왼쪽 끝과 글자 시작이 맞는다.
 *
 * 사업자번호/중개업등록번호 등은 NEXT_PUBLIC_BUSINESS_* 환경변수에서 읽음. 미설정 시 해당 항목 미표시.
 * 개인정보처리방침은 법상 눈에 띄게 — 굵게 둔다.
 * BottomNav가 모바일에서 고정되므로 모바일에서는 아래 padding으로 가려짐 방지.
 */
const HIDDEN_PATHS = [
  '/admin',
  '/auth',
  '/account-suspended',
  '/broker/messenger', // 화면 꽉 찬 대화창 — 밑에 붙으면 스크롤이 밀려 푸터가 드러난다
  '/b/', // 손님용 예약 페이지 — 부소장 이름이 하나도 보이면 안 된다(11-06 사장님)
]

export function Footer() {
  const pathname = usePathname() ?? ''
  if (HIDDEN_PATHS.some(p => pathname.startsWith(p))) return null

  const companyName = process.env.NEXT_PUBLIC_BUSINESS_NAME ?? '부소장'
  const ceoName = process.env.NEXT_PUBLIC_BUSINESS_CEO
  const bizNumber = process.env.NEXT_PUBLIC_BUSINESS_REG_NUMBER
  const officeRegNumber = process.env.NEXT_PUBLIC_OFFICE_REG_NUMBER
  const address = process.env.NEXT_PUBLIC_BUSINESS_ADDRESS
  const phone = process.env.NEXT_PUBLIC_BUSINESS_PHONE

  const info: [string, React.ReactNode][] = [
    ...(ceoName ? [['대표', ceoName] as [string, string]] : []),
    ...(bizNumber ? [['사업자', bizNumber] as [string, string]] : []),
    ...(officeRegNumber ? [['중개업', officeRegNumber] as [string, string]] : []),
    ...(address ? [['주소', address] as [string, string]] : []),
    ...(phone ? [['전화', <a key="t" href={`tel:${phone.replace(/-/g, '')}`} className="hover:underline">{phone}</a>] as [string, React.ReactNode]] : []),
    ['문의', <a key="m" href={`mailto:${SUPPORT_EMAIL}`} className="hover:underline">{SUPPORT_EMAIL}</a>],
  ]

  return (
    <footer className="mt-8 border-t border-gray-200 bg-gray-50 text-[11px] leading-relaxed text-gray-500 dark:border-gray-800 dark:bg-gray-950">
      <div className="mx-auto max-w-6xl px-4 pt-4 pb-24 md:pb-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
          <span className="font-bold text-gray-700 dark:text-gray-300">{companyName}</span>
          {info.map(([k, v]) => (
            <span key={k}><span className="text-gray-400">{k}</span> {v}</span>
          ))}
        </div>
        {/* 미리받기 끔 — 매 화면 바닥에 그려져 폰 3G 에서 첫 조회와 회선을 나눠 썼다(10-30 폰 속도 조사) */}
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5">
          <Link href="/terms" prefetch={false} className="hover:underline">이용약관</Link>
          <Link href="/privacy" prefetch={false} className="font-semibold text-gray-700 hover:underline dark:text-gray-300">개인정보처리방침</Link>
          <Link href="/support" prefetch={false} className="hover:underline">고객센터·신고</Link>
          <span className="ml-auto text-gray-400">© {new Date().getFullYear()} {companyName}</span>
        </div>
      </div>
    </footer>
  )
}
