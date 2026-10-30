import Link from 'next/link'
import { Header } from '@/components/layout/header'
import { SUPPORT_EMAIL } from '@/lib/support'
import { Mail, MessageCircle, Home } from 'lucide-react'
import { SupportForm } from './support-form'

// 정적 페이지 — FAQ + 폼만 있어 24시간 캐시 가능
export const revalidate = 86400

export const metadata = { title: '고객지원' }

export default function SupportPage() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <Header />

      <div className="mx-auto max-w-2xl px-4 py-12">
        <div className="text-center mb-10">
          <div className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-100">
            <MessageCircle className="h-7 w-7 text-blue-600" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">고객지원</h1>
          <p className="mt-2 text-gray-700 dark:text-gray-300 leading-relaxed">
            이용 중 불편한 점이나 문의사항을 알려주세요.
          </p>
        </div>

        {/* 문의 폼 */}
        <SupportForm />

        {/* 이메일 안내 */}
        <div className="mt-6 flex items-center justify-center gap-2 text-sm text-gray-500">
          또는
          <a href={`mailto:${SUPPORT_EMAIL}`} className="inline-flex items-center gap-1 font-semibold text-blue-600 hover:text-blue-700">
            <Mail className="h-3.5 w-3.5" />
            {SUPPORT_EMAIL}
          </a>
          으로 메일
        </div>

        {/* FAQ */}
        <div className="mt-10 rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 shadow-sm">
          <h2 className="mb-4 font-bold text-gray-900 dark:text-white">자주 묻는 질문</h2>
          <div className="space-y-4">
            {[
              // 걷어낸 '고객 요청 매칭' 질문만 있어 업무 도구를 쓰려는 대표에게 맞지 않았다(10-30 재점검) — 실제 동작만 적는다.
              // 사무소 인증은 자동 확인이 아니다(운영에 확인 API 키 없음, 관리자 검토) — lib/broker-office 문구와 같게.
              {
                q: '요금이 있나요?',
                a: '지금은 무료로 쓸 수 있어요.',
              },
              {
                q: '다른 사무소가 우리 매물·고객을 볼 수 있나요?',
                a: '아니요. 매물·고객·업무일지는 사무소 단위로 나뉘어 다른 사무소에서는 볼 수 없어요. 직원은 자기 매물만 고칠 수 있고, 고객은 자기 담당 고객만 봅니다.',
              },
              {
                q: '직원은 어떻게 합류하나요?',
                a: '설정 > 직원에서 합류 코드를 직원에게 알려 주세요. 직원이 가입할 때 그 코드를 넣으면 대표 승인 뒤 함께 쓸 수 있어요. 코드는 한 번 쓰면 새로 바뀝니다.',
              },
              {
                q: '사무소 인증 배지는 언제 붙나요?',
                a: '사무소 등록 정보를 관리자가 확인한 뒤 붙어요. 기다리는 동안에도 매물·고객·업무일지 등은 그대로 쓸 수 있어요.',
              },
              {
                q: '실수로 지운 매물·고객은 되살릴 수 있나요?',
                a: '네. 지운 매물·고객은 휴지통에 30일 동안 보관돼 그 안에는 되살릴 수 있어요. 30일이 지나면 저절로 지워집니다.',
              },
            ].map(({ q, a }) => (
              <div key={q} className="border-b border-gray-100 dark:border-gray-800 pb-4 last:border-0 last:pb-0">
                <p className="font-semibold text-gray-800 dark:text-gray-100 mb-1">{q}</p>
                <p className="text-sm text-gray-500">{a}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-8 text-center">
          <Link href="/" className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-300 transition-colors">
            <Home className="h-4 w-4" />
            홈으로 돌아가기
          </Link>
        </div>
      </div>
    </div>
  )
}
