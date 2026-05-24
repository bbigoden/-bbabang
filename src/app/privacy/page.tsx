import type { Metadata } from 'next'
import Link from 'next/link'
import { Home } from 'lucide-react'

// 개인정보처리방침은 정적 (1일마다 재생성). CDN 캐시 가능
export const dynamic = 'force-static'
export const revalidate = 86400

export const metadata: Metadata = {
  title: '개인정보처리방침',
  description: '빠방 개인정보처리방침',
}

const sections = [
  {
    title: '1. 수집하는 개인정보의 항목',
    content: `빠방은 서비스 제공을 위해 다음과 같은 개인정보를 수집합니다.\n\n[필수 항목]\n- 이름, 이메일 주소, 비밀번호, 휴대폰 번호, 서비스 역할(일반 사용자/중개사)\n\n[중개사 추가 수집 항목]\n- 공인중개사 자격증 번호, 사무소명, 사무소 주소, 사무소 등록번호, 사업자등록번호, 관심 지역(시·도/시·군·구/동·읍·면 단위)\n\n[서비스 이용 과정에서 자동 수집되는 항목]\n- 서비스 이용 기록, 접속 로그, IP 주소, 채팅 내용, 업로드한 이미지\n- 푸시 알림 구독 정보(브라우저가 발급한 endpoint·암호화 키, User-Agent) — 사용자가 알림 허용 시에만 수집`,
  },
  {
    title: '2. 개인정보의 수집 및 이용목적',
    content: `빠방은 수집한 개인정보를 다음의 목적을 위해 활용합니다.\n\n① 서비스 제공: 부동산 매물 요청 및 중개사 매칭 서비스, 채팅 서비스 제공\n② 회원 관리: 회원제 서비스 이용에 따른 본인 확인, 개인 식별, 불량 회원 부정 이용 방지\n③ 서비스 개선: 신규 서비스 개발 및 맞춤 서비스 제공, 서비스 이용 통계 분석\n④ 중개사 인증: 공인중개사 자격 확인 및 인증 처리`,
  },
  {
    title: '3. 개인정보의 보유 및 이용기간',
    content: `빠방은 원칙적으로 개인정보 수집 및 이용목적이 달성된 후에는 해당 정보를 지체 없이 파기합니다. 단, 다음의 정보에 대해서는 아래의 이유로 명시한 기간 동안 보존합니다.\n\n[관련 법령에 의한 정보 보유]\n- 계약 또는 청약철회 등에 관한 기록: 5년 (전자상거래 등에서의 소비자보호에 관한 법률)\n- 소비자의 불만 또는 분쟁처리에 관한 기록: 3년 (동법)\n- 접속에 관한 기록: 3개월 (통신비밀보호법)`,
  },
  {
    title: '4. 개인정보의 제3자 제공',
    content: `빠방은 원칙적으로 이용자의 개인정보를 외부에 제공하지 않습니다. 다만, 아래의 경우에는 예외로 합니다.\n\n① 이용자가 사전에 동의한 경우\n② 법령의 규정에 의거하거나, 수사 목적으로 법령에 정해진 절차와 방법에 따라 수사기관의 요구가 있는 경우\n\n[서비스 내 정보 공개]\n- 중개사 프로필 정보(이름, 사무소명, 담당 지역, 평점)는 서비스 이용자에게 공개됩니다.\n- 채팅 상대방 간의 정보(이름, 휴대폰 번호)는 채팅방 내에서 상호 공개됩니다.`,
  },
  {
    title: '5. 개인정보 처리의 위탁',
    content: `빠방은 원활한 서비스 제공을 위해 다음과 같이 개인정보 처리를 위탁하고 있습니다.\n\n- 수탁업체: Supabase Inc.\n- 위탁 업무: 데이터베이스 운영 및 관리, 사용자 인증 서비스\n- 보유 기간: 서비스 이용기간 동안\n\n- 수탁업체: Vercel Inc.\n- 위탁 업무: 웹 서비스 호스팅 및 운영\n- 보유 기간: 서비스 이용기간 동안\n\n- 수탁업체: Kakao Corp.\n- 위탁 업무: 주소·행정구역 검색 API (입력한 검색어가 카카오 서버로 전송됨)\n- 보유 기간: 일시적 처리 (저장하지 않음)\n\n- 수탁업체: 브라우저 푸시 서비스 제공자(예: FCM, Apple Push Notification Service)\n- 위탁 업무: 푸시 알림 발송\n- 보유 기간: 사용자가 알림을 해제할 때까지`,
  },
  {
    title: '6. 이용자의 권리와 행사방법',
    content: `이용자는 언제든지 다음과 같은 개인정보 보호 관련 권리를 행사할 수 있습니다.\n\n① 개인정보 열람 요구\n② 오류 등이 있을 경우 정정 요구\n③ 삭제 요구\n④ 처리 정지 요구\n\n위 권리 행사는 회사에 대해 서면, 전화, 전자우편으로 하실 수 있으며 회사는 이에 대해 지체 없이 조치하겠습니다.`,
  },
  {
    title: '7. 개인정보의 파기',
    content: `빠방은 원칙적으로 개인정보 처리목적이 달성된 경우에는 지체없이 해당 개인정보를 파기합니다.\n\n- 전자적 파일 형태: 복원이 불가능한 방법으로 영구 삭제\n- 종이 문서: 분쇄기로 분쇄하거나 소각`,
  },
  {
    title: '8. 개인정보 보호책임자',
    content: `빠방은 개인정보 처리에 관한 업무를 총괄해서 책임지고, 개인정보 처리와 관련한 이용자의 불만처리 및 피해구제 등을 위하여 아래와 같이 개인정보 보호책임자를 지정하고 있습니다.\n\n개인정보 보호책임자\n- 이메일: bigodennn@gmail.com\n\n기타 개인정보침해에 대한 신고나 상담이 필요하신 경우에는 아래 기관에 문의하시기 바랍니다.\n- 개인정보침해신고센터: privacy.kisa.or.kr / 국번없이 118\n- 대검찰청 사이버범죄수사단: www.spo.go.kr / 02-3480-3573`,
  },
  {
    title: '9. 쿠키의 운영 및 거부',
    content: `빠방은 이용자에게 개별적인 맞춤서비스를 제공하기 위해 이용 정보를 저장하고 수시로 불러오는 '쿠키(cookie)'를 사용합니다. 이용자는 쿠키 설치에 대한 선택권을 가지고 있으며, 웹 브라우저의 설정을 통해 쿠키 저장을 거부할 수 있습니다. 단, 쿠키 저장을 거부할 경우 일부 서비스 이용에 어려움이 있을 수 있습니다.`,
  },
  {
    title: '부칙',
    content: `이 개인정보처리방침은 2026년 5월 18일부터 적용됩니다.\n주요 변경: 푸시 알림·관심 지역 정보 수집 항목 추가, Kakao 주소 검색·푸시 서비스 위탁 명시.`,
  },
]

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <div className="mx-auto max-w-3xl px-4 py-12">
        {/* 헤더 */}
        <div className="mb-8">
          <Link href="/" className="mb-6 inline-flex items-center gap-2 text-sm text-gray-500 hover:text-blue-600">
            <Home className="h-4 w-4" />
            홈으로
          </Link>
          <h1 className="mt-4 text-3xl font-black text-gray-900 dark:text-white">개인정보처리방침</h1>
          <p className="mt-2 text-sm text-gray-500">최종 수정일: 2026년 5월 18일</p>
        </div>

        {/* 요약 박스 */}
        <div className="mb-6 rounded-2xl border border-blue-100 bg-blue-50 px-6 py-4">
          <p className="text-sm font-semibold text-blue-800">📋 요약</p>
          <p className="mt-1 text-sm text-blue-700">
            빠방은 서비스 제공에 필요한 최소한의 개인정보만 수집하며,
            제3자에게 제공하지 않습니다. 이용자는 언제든지 개인정보 열람·수정·삭제를 요청할 수 있습니다.
          </p>
        </div>

        {/* 본문 */}
        <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-8 shadow-sm">
          <div className="space-y-8">
            {sections.map((section) => (
              <div key={section.title}>
                <h2 className="mb-3 text-base font-bold text-gray-900 dark:text-white">{section.title}</h2>
                <p className="whitespace-pre-line text-sm leading-relaxed text-gray-600 dark:text-gray-400">
                  {section.content}
                </p>
              </div>
            ))}
          </div>

          <div className="mt-10 border-t border-gray-100 dark:border-gray-800 pt-6">
            <p className="text-xs text-gray-500">
              개인정보와 관련한 문의사항은{' '}
              <a href="mailto:bigodennn@gmail.com" className="text-blue-600 underline">
                bigodennn@gmail.com
              </a>
              으로 연락주세요.
            </p>
          </div>
        </div>

        <div className="mt-6 text-center">
          <Link href="/auth/login" className="text-sm text-blue-600 hover:underline">
            ← 로그인으로 돌아가기
          </Link>
        </div>
      </div>
    </div>
  )
}
