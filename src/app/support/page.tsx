import Link from 'next/link'
import { Header } from '@/components/layout/header'
import { Mail, MessageCircle, Home } from 'lucide-react'
import { SupportForm } from './support-form'

export const dynamic = 'force-dynamic'

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
          <p className="mt-2 text-gray-500 leading-relaxed">
            이용 중 불편한 점이나 문의사항을 알려주세요.
          </p>
        </div>

        {/* 문의 폼 */}
        <SupportForm />

        {/* 이메일 안내 */}
        <div className="mt-6 flex items-center justify-center gap-2 text-sm text-gray-500">
          또는
          <a href="mailto:bigodennn@gmail.com" className="inline-flex items-center gap-1 font-semibold text-blue-600 hover:text-blue-700">
            <Mail className="h-3.5 w-3.5" />
            bigodennn@gmail.com
          </a>
          으로 메일
        </div>

        {/* FAQ */}
        <div className="mt-10 rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 shadow-sm">
          <h2 className="mb-4 font-bold text-gray-900 dark:text-white">자주 묻는 질문</h2>
          <div className="space-y-4">
            {[
              {
                q: '중개사 인증은 어떻게 하나요?',
                a: '회원가입 후 중개사 등록 메뉴에서 자격증 정보를 입력하시면 관리자 검토 후 승인됩니다.',
              },
              {
                q: '매물 요청은 무료인가요?',
                a: '네, 매물 요청 등록은 완전 무료입니다. 가입비나 광고비도 없습니다.',
              },
              {
                q: '제안을 받은 후 마음에 들지 않으면 어떻게 하나요?',
                a: '제안을 거절하거나 무시하셔도 됩니다. 원하는 중개사에게만 연락하시면 됩니다.',
              },
              {
                q: '개인정보는 안전하게 보호되나요?',
                a: '네, 고객의 상세 주소 및 연락처는 매칭된 중개사에게만 공개됩니다.',
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
