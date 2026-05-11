import Link from 'next/link'
import { Header } from '@/components/layout/header'
import { Mail, MessageCircle, Home } from 'lucide-react'

export const metadata = { title: '고객지원 – 빠방' }

export default function SupportPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <Header />

      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <div className="mb-6 inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-100">
          <MessageCircle className="h-8 w-8 text-blue-600" />
        </div>
        <h1 className="mb-3 text-3xl font-bold text-gray-900">고객지원</h1>
        <p className="mb-10 text-gray-500 leading-relaxed">
          빠방 이용 중 불편하신 점이 있으신가요?<br />
          아래 이메일로 문의 주시면 빠르게 도움드리겠습니다.
        </p>

        <a
          href="mailto:support@bbabang.kr"
          className="inline-flex items-center gap-3 rounded-2xl bg-blue-600 px-8 py-4 text-base font-semibold text-white hover:bg-blue-700 transition-colors shadow-lg"
        >
          <Mail className="h-5 w-5" />
          support@bbabang.kr
        </a>

        <div className="mt-12 rounded-2xl border border-gray-200 bg-white p-6 text-left shadow-sm">
          <h2 className="mb-4 font-bold text-gray-900">자주 묻는 질문</h2>
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
              <div key={q} className="border-b border-gray-100 pb-4 last:border-0 last:pb-0">
                <p className="font-semibold text-gray-800 mb-1">{q}</p>
                <p className="text-sm text-gray-500">{a}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-8">
          <Link href="/" className="inline-flex items-center gap-2 text-sm text-gray-400 hover:text-gray-600 transition-colors">
            <Home className="h-4 w-4" />
            홈으로 돌아가기
          </Link>
        </div>
      </div>
    </div>
  )
}
