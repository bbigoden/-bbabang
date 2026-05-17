import type { Metadata } from 'next'
import Link from 'next/link'
import { Home } from 'lucide-react'

export const metadata: Metadata = {
  title: '이용약관',
  description: '빠방 서비스 이용약관',
}

const sections = [
  {
    title: '제1조 (목적)',
    content: `이 약관은 빠방(이하 "회사")이 제공하는 부동산 중개 매칭 플랫폼 서비스(이하 "서비스")의 이용과 관련하여 회사와 이용자 간의 권리, 의무 및 책임사항을 규정함을 목적으로 합니다.`,
  },
  {
    title: '제2조 (정의)',
    content: `① "서비스"란 회사가 제공하는 부동산 매물 요청 및 중개사 매칭 관련 모든 서비스를 말합니다.\n② "이용자"란 이 약관에 따라 회사가 제공하는 서비스를 받는 회원 및 비회원을 말합니다.\n③ "회원"이란 회사와 이용계약을 체결하고 아이디를 부여받은 자로서, 회사의 서비스를 이용하는 자를 말합니다.\n④ "중개사"란 공인중개사 자격을 보유하고 회사에 등록한 회원을 말합니다.`,
  },
  {
    title: '제3조 (약관의 효력 및 변경)',
    content: `① 이 약관은 서비스 화면에 게시하거나 기타의 방법으로 이용자에게 공지함으로써 효력이 발생합니다.\n② 회사는 합리적인 사유가 발생한 경우 관련 법령에 위배되지 않는 범위에서 이 약관을 변경할 수 있으며, 변경된 약관은 서비스 내 공지사항을 통해 공지합니다.`,
  },
  {
    title: '제4조 (서비스의 제공)',
    content: `① 회사는 다음과 같은 서비스를 제공합니다.\n1. 부동산 매물 요청 등록 및 열람 서비스\n2. 중개사와 이용자 간 매칭 및 제안 서비스\n3. 실시간 채팅 서비스\n4. 중개사 프로필 및 리뷰 서비스\n② 회사는 서비스의 운영상, 기술상 필요에 따라 제공하는 서비스를 변경할 수 있습니다.`,
  },
  {
    title: '제5조 (회원가입)',
    content: `① 이용자는 회사가 정한 양식에 따라 회원정보를 기입한 후 이 약관에 동의한다는 의사표시를 함으로써 회원가입을 신청합니다.\n② 회사는 다음 각 호에 해당하는 신청에 대해서는 승인을 하지 않거나 사후에 이용계약을 해지할 수 있습니다.\n1. 실명이 아니거나 타인의 명의를 이용한 경우\n2. 허위 정보를 기재하거나 회사가 제시하는 내용을 기재하지 않은 경우\n3. 기타 회원으로 등록하는 것이 서비스 운영에 현저히 지장이 있다고 판단되는 경우`,
  },
  {
    title: '제6조 (중개사 서비스 이용)',
    content: `① 중개사로 등록하려는 회원은 공인중개사 자격증 번호 등 관련 정보를 제출하여야 합니다.\n② 회사는 중개사의 자격 여부를 확인하기 위한 검증 절차를 운영할 수 있으며, 검증이 완료되지 않은 중개사는 일부 서비스 이용이 제한될 수 있습니다.\n③ 중개사는 이 서비스를 통해 이용자에게 제안을 보낼 수 있으며, 허위 정보 제공 시 이용이 제한됩니다.`,
  },
  {
    title: '제7조 (이용자의 의무)',
    content: `① 이용자는 다음 행위를 하여서는 안 됩니다.\n1. 신청 또는 변경 시 허위내용 등록\n2. 타인의 정보 도용\n3. 회사가 게시한 정보의 무단 변경\n4. 회사가 정한 정보 이외의 정보(컴퓨터 프로그램 등) 송신 또는 게시\n5. 회사와 기타 제3자의 저작권 등 지적재산권 침해\n6. 회사 및 기타 제3자의 명예를 손상시키거나 업무를 방해하는 행위\n7. 외설 또는 폭력적인 메시지, 화상, 음성 등을 서비스에 공개 또는 게시하는 행위`,
  },
  {
    title: '제8조 (서비스 이용 제한)',
    content: `① 회사는 이용자가 이 약관의 의무를 위반하거나 서비스의 정상적인 운영을 방해한 경우, 서비스 이용을 경고, 일시 정지, 계약 해지 등으로 단계적으로 제한할 수 있습니다.\n② 회사는 전항에도 불구하고 주민등록법을 위반한 명의도용 및 결제도용, 전기통신기본법 등을 위반한 불법통신, 저작권법을 위반한 불법 프로그램의 제공 및 운영 등 관련 법령에 위반되는 경우에는 즉시 계약을 해지할 수 있습니다.`,
  },
  {
    title: '제9조 (면책조항)',
    content: `① 회사는 천재지변 또는 이에 준하는 불가항력으로 인하여 서비스를 제공할 수 없는 경우에는 서비스 제공에 관한 책임이 면제됩니다.\n② 회사는 이용자의 귀책사유로 인한 서비스 이용의 장애에 대하여는 책임을 지지 않습니다.\n③ 회사는 이용자가 서비스를 이용하여 기대하는 수익을 상실한 것에 대하여 책임을 지지 않으며, 그 밖에 서비스를 통하여 얻은 자료로 인한 손해에 관하여 책임을 지지 않습니다.\n④ 회사는 중개사와 이용자 간의 실제 부동산 거래에 대해 중개 책임을 지지 않으며, 단순 매칭 플랫폼으로서의 역할만을 수행합니다.`,
  },
  {
    title: '제10조 (분쟁 해결)',
    content: `① 회사는 이용자가 제기하는 정당한 의견이나 불만을 반영하고 그 피해를 보상 처리하기 위하여 피해보상처리기구를 설치, 운영합니다.\n② 회사와 이용자 간에 발생한 분쟁은 대한민국 법을 준거법으로 합니다.\n③ 회사와 이용자 간 발생한 분쟁에 관한 소송은 민사소송법상의 관할법원에 제기합니다.`,
  },
  {
    title: '부칙',
    content: `이 약관은 2025년 1월 1일부터 적용됩니다.`,
  },
]

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-3xl px-4 py-12">
        {/* 헤더 */}
        <div className="mb-8">
          <Link href="/" className="mb-6 inline-flex items-center gap-2 text-sm text-gray-500 hover:text-blue-600">
            <Home className="h-4 w-4" />
            홈으로
          </Link>
          <h1 className="mt-4 text-3xl font-black text-gray-900">이용약관</h1>
          <p className="mt-2 text-sm text-gray-500">최종 수정일: 2025년 1월 1일</p>
        </div>

        {/* 본문 */}
        <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
          <div className="space-y-8">
            {sections.map((section) => (
              <div key={section.title}>
                <h2 className="mb-3 text-base font-bold text-gray-900">{section.title}</h2>
                <p className="whitespace-pre-line text-sm leading-relaxed text-gray-600">
                  {section.content}
                </p>
              </div>
            ))}
          </div>

          <div className="mt-10 border-t border-gray-100 pt-6">
            <p className="text-xs text-gray-500">
              문의사항이 있으시면{' '}
              <a href="mailto:bbigoden@gmail.com" className="text-blue-600 underline">
                bbigoden@gmail.com
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
