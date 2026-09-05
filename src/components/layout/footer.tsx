'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { SUPPORT_EMAIL } from '@/lib/support'

/**
 * 사이트 푸터 — 사업자정보·법적 표기·정책 링크.
 *
 * 사업자번호/중개업등록번호 등은 NEXT_PUBLIC_BUSINESS_* 환경변수에서 읽음.
 * 미설정 시 해당 항목 미표시 (운영 환경에서 설정).
 *
 * BottomNav가 모바일에서 고정되므로 모바일에서는 padding으로 가려짐 방지.
 */
const HIDDEN_PATHS = [
  // 견적서 공개 열람 — 거래처(외부인)가 보는 화면이라 부소장 껍데기를 붙이지 않는다
  '/e/',
  '/chat/',
  '/admin',
  '/auth',
  '/account-suspended',
  '/broker/properties/[id]/edit',
]

export function Footer() {
  const pathname = usePathname() ?? ''
  if (HIDDEN_PATHS.some(p => pathname.startsWith(p))) return null

  // 환경변수 — 사용자가 운영 환경에서 설정. 누락 시 표시 안 함.
  const companyName = process.env.NEXT_PUBLIC_BUSINESS_NAME ?? '부소장'
  const ceoName = process.env.NEXT_PUBLIC_BUSINESS_CEO
  const bizNumber = process.env.NEXT_PUBLIC_BUSINESS_REG_NUMBER
  const officeRegNumber = process.env.NEXT_PUBLIC_OFFICE_REG_NUMBER
  const address = process.env.NEXT_PUBLIC_BUSINESS_ADDRESS
  const contactEmail = SUPPORT_EMAIL
  const phone = process.env.NEXT_PUBLIC_BUSINESS_PHONE

  return (
    <footer className="mt-12 border-t border-gray-200 bg-gray-50 text-gray-600 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-500">
      <div className="mx-auto max-w-6xl px-4 py-10 md:pb-10 pb-24">
        <div className="grid gap-8 md:grid-cols-3">
          {/* 회사·사업자 정보 */}
          <div className="md:col-span-2">
            <div className="mb-3 flex items-center gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/icon.svg" alt="부소장 로고" width={28} height={28} className="h-7 w-7 rounded-lg" />
              <span className="text-base font-bold text-gray-900 dark:text-white">
                부소<span className="text-blue-600">장</span>
              </span>
              <span className="text-xs text-gray-500">부동산 역경매 매칭 플랫폼</span>
            </div>
            <dl className="space-y-1 text-xs leading-relaxed">
              <div className="flex flex-wrap gap-x-2">
                <dt className="font-medium text-gray-700 dark:text-gray-300">상호</dt>
                <dd>{companyName}</dd>
                {ceoName && (
                  <>
                    <dt className="font-medium text-gray-700 dark:text-gray-300">· 대표</dt>
                    <dd>{ceoName}</dd>
                  </>
                )}
              </div>
              {bizNumber && (
                <div className="flex flex-wrap gap-x-2">
                  <dt className="font-medium text-gray-700 dark:text-gray-300">사업자등록번호</dt>
                  <dd>{bizNumber}</dd>
                </div>
              )}
              {officeRegNumber && (
                <div className="flex flex-wrap gap-x-2">
                  <dt className="font-medium text-gray-700 dark:text-gray-300">중개업등록번호</dt>
                  <dd>{officeRegNumber}</dd>
                </div>
              )}
              {address && (
                <div className="flex flex-wrap gap-x-2">
                  <dt className="font-medium text-gray-700 dark:text-gray-300">주소</dt>
                  <dd>{address}</dd>
                </div>
              )}
              <div className="flex flex-wrap gap-x-2">
                <dt className="font-medium text-gray-700 dark:text-gray-300">문의</dt>
                <dd>
                  <a href={`mailto:${contactEmail}`} className="hover:text-blue-600 hover:underline">
                    {contactEmail}
                  </a>
                </dd>
                {phone && (
                  <>
                    <dt className="font-medium text-gray-700 dark:text-gray-300">· 전화</dt>
                    <dd>
                      <a href={`tel:${phone.replace(/-/g, '')}`} className="hover:text-blue-600 hover:underline">
                        {phone}
                      </a>
                    </dd>
                  </>
                )}
              </div>
            </dl>
            <p className="mt-4 text-[11px] text-gray-500 leading-relaxed">
              부소장은 통신판매중개자이며, 거래 당사자가 아닙니다.
              매물 정보는 등록한 공인중개사가 책임지며, 부소장은 정보의 정확성·신뢰성에 대해 보증하지 않습니다.
            </p>
          </div>

          {/* 정책·법적 링크 */}
          <div>
            <div className="mb-3 text-sm font-semibold text-gray-900 dark:text-white">정책·약관</div>
            <ul className="space-y-1.5 text-xs">
              <li>
                <Link href="/terms" className="hover:text-blue-600 hover:underline">
                  이용약관
                </Link>
              </li>
              <li>
                <Link href="/privacy" className="hover:text-blue-600 hover:underline font-semibold">
                  개인정보처리방침
                </Link>
              </li>
              <li>
                <Link href="/support" className="hover:text-blue-600 hover:underline">
                  고객센터·신고
                </Link>
              </li>
              <li>
                <Link href="/office-intro" className="hover:text-blue-600 hover:underline">
                  중개사무소용 부소장 소개
                </Link>
              </li>
              <li>
                <Link href="/jobs" className="hover:text-blue-600 hover:underline">
                  구인 게시판
                </Link>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-8 border-t border-gray-200 pt-4 text-[11px] text-gray-500 dark:border-gray-800">
          © {new Date().getFullYear()} {companyName}. All rights reserved.
        </div>
      </div>
    </footer>
  )
}
