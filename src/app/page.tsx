import Link from 'next/link'
import { Header } from '@/components/layout/header'
import { AutoRedirectHome } from '@/components/auto-redirect-home'
import { SUPPORT_EMAIL } from '@/lib/support'
import {
  Building2, Users, BookOpen, Calculator, Megaphone, Radar, MessageCircle,
  MapPin, ShieldCheck, Smartphone, CheckCircle2, ArrowRight, Mail,
} from 'lucide-react'

// 첫 화면 = 중개사무소 대상 소개. 고객 요청 매칭 화면은 2026-10-30 걷어냈다.
// 정적 렌더링 — 로그인한 사람은 proxy.ts(서버)·AutoRedirectHome(클라이언트)이 대시보드로 보낸다.
export const revalidate = 86400

export const metadata = {
  title: '중개사무소를 위한 부소장 — 매물장부터 정산까지 하나로',
  description:
    '엑셀·수기·단톡방에 흩어진 사무소 업무를 하나로. 매물장, 고객장, 업무일지, 광고관리, 매물수집, 정산까지 — 실제 중개사무소가 만들고 매일 쓰는 업무 도구.',
}

const FEATURES = [
  {
    icon: Building2,
    title: '매물장',
    desc: '엑셀처럼 셀을 바로 고치고, 담당자·가격·평수·층수로 걸러 봅니다. 지도 뷰에서 사무소 매물을 핀으로 한눈에.',
  },
  {
    icon: Users,
    title: '고객장',
    desc: '유입 경로·담당자·구분별로 자동 집계됩니다. 같은 연락처가 다시 접수되면 등록 순간 바로 알려줘요.',
  },
  {
    icon: BookOpen,
    title: '업무일지',
    desc: '직원별 일일 업무일지에 고객·제안 매물을 연결합니다. 퇴사자의 기록도 대표 열람용으로 안전하게 보관됩니다.',
  },
  {
    icon: Calculator,
    title: '정산',
    desc: '계약별 수수료와 담당자 분배율을 입력하면 월 손익·직원별 실수령까지 자동 계산됩니다.',
  },
  {
    icon: Megaphone,
    title: '광고관리',
    desc: '부동산뱅크에 올린 매물을 한 화면에서 보고, 카페·당근 광고를 같이 올리고 내립니다. 계약완료인데 광고가 남은 매물은 빨갛게 알려 줘요.',
  },
  {
    icon: Radar,
    title: '매물수집',
    desc: '관심 지역에 새로 올라온 매물을 매일 모아, 원본 링크로 바로 확인합니다.',
  },
]

const TRUST = [
  {
    icon: ShieldCheck,
    title: '사무소 단위 데이터 격리',
    desc: '매물·고객·정산·일지 모든 데이터는 사무소 단위로 격리되어 다른 사무소에서는 볼 수 없습니다. 직원은 자기 매물만 고칠 수 있고, 고객은 자기 담당 고객만 봅니다.',
  },
  {
    // 개설은 검증 통과를 기다리지 않는다(broker/register 는 바로 열고 auto-verify 는 배지만 붙인다).
    // 예전 '확인된 중개사무소만 참여합니다'는 코드와 달라, 실제로 하는 일만 적는다.
    // '국세청·국토부 자동 확인'도 아직 사실이 아니다 — 운영에 PUBLICDATA_API_KEY·VWORLD_API_KEY 가 없어
    // auto-verify 가 config_missing 으로 운영자 검토에 넘긴다(verify-business/route.ts:21). 두 키가 Vercel 에
    // 들어가면 그때 기관명을 되살린다. 그 전엔 '자동 조회 또는 운영자 검토'로 둔다(표시광고).
    icon: MapPin,
    title: '등록번호 확인 · 인증 배지',
    desc: '사무소를 열 때 입력한 사업자등록번호·중개사무소 등록번호를 확인(자동 조회 또는 운영자 검토)해, 확인된 사무소에 인증 배지를 붙입니다.',
  },
  {
    icon: Smartphone,
    title: '폰에 설치해서 쓰는 앱',
    desc: '안드로이드·아이폰 홈 화면에 설치하면 앱처럼 씁니다. 새 문의·담당 배정은 푸시 알림으로 바로 도착합니다.',
  },
]

const STEPS = [
  { title: '가입', desc: '이메일로 가입하세요.' },
  { title: '사무소 개설', desc: '상호·등록번호를 입력하면 바로 개설됩니다. 등록번호 확인이 끝나면 인증 배지가 붙어요.' },
  { title: '직원 초대', desc: '사무소 코드를 직원에게 공유하면 합류 신청이 오고, 대표가 승인하면 끝.' },
]

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <Header />
      {/* 로그인한 사람이 bfcache 등으로 / 로 돌아오면 대시보드로 */}
      <AutoRedirectHome />

      {/* 히어로 */}
      <section className="bg-blue-600 text-white">
        <div className="mx-auto max-w-5xl px-4 py-16 md:py-20 text-center">
          <p className="mb-3 text-sm font-semibold text-blue-200">중개사무소를 위한 부소장</p>
          <h1 className="text-3xl md:text-4xl font-black leading-tight">
            매물장부터 정산까지,<br className="md:hidden" /> 사무소 업무가 한 곳에
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-blue-100 leading-relaxed">
            엑셀 매물장, 수기 고객 노트, 단톡방 보고, 흩어진 광고 현황 —
            흩어진 사무소 업무를 하나로 모았습니다.
            실제 영업 중인 중개사무소가 직접 만들고 매일 쓰는 도구입니다.
          </p>
          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link href="/auth/signup"
              className="inline-flex items-center gap-2 rounded-xl bg-white px-6 py-3 text-sm font-bold text-blue-700 hover:bg-blue-50 transition-colors">
              무료로 시작하기
              <ArrowRight className="h-4 w-4" />
            </Link>
            <a href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('[부소장] 사무소 도입 문의')}`}
              className="inline-flex items-center gap-2 rounded-xl border border-blue-300/60 px-6 py-3 text-sm font-semibold text-white hover:bg-blue-500/40 transition-colors">
              <Mail className="h-4 w-4" />
              도입 문의
            </a>
          </div>
          <p className="mt-4 text-xs text-blue-200">현재 무료로 이용할 수 있어요 · 설치 없이 웹에서 바로 시작</p>
        </div>
      </section>

      {/* 기능 6종 */}
      <section className="mx-auto max-w-5xl px-4 py-14">
        <h2 className="text-center text-2xl font-bold text-gray-900 dark:text-white">
          사무소 하루 업무, 전부 들어 있습니다
        </h2>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(f => (
            <div key={f.title} className="rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
              <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-blue-100 dark:bg-blue-500/20">
                <f.icon className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              </div>
              <h3 className="font-bold text-gray-900 dark:text-white">{f.title}</h3>
              <p className="mt-1.5 text-sm text-gray-600 dark:text-gray-400 leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* 신뢰 요소 */}
      <section className="bg-white dark:bg-gray-900 border-y border-gray-100 dark:border-gray-800">
        <div className="mx-auto max-w-5xl px-4 py-14">
          <h2 className="text-center text-2xl font-bold text-gray-900 dark:text-white">
            사무소 데이터, 안심하고 맡기세요
          </h2>
          <div className="mt-8 grid gap-6 md:grid-cols-3">
            {TRUST.map(t => (
              <div key={t.title} className="text-center px-2">
                <div className="mx-auto mb-3 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-100 dark:bg-blue-500/20">
                  <t.icon className="h-6 w-6 text-blue-600 dark:text-blue-400" />
                </div>
                <h3 className="font-bold text-gray-900 dark:text-white">{t.title}</h3>
                <p className="mt-1.5 text-sm text-gray-600 dark:text-gray-400 leading-relaxed">{t.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 시작 3단계 */}
      <section className="mx-auto max-w-5xl px-4 py-14">
        <h2 className="text-center text-2xl font-bold text-gray-900 dark:text-white">5분이면 사무소가 열립니다</h2>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <div key={s.title} className="rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
              <div className="mb-3 inline-flex h-8 w-8 items-center justify-center rounded-full bg-blue-600 text-sm font-black text-white">
                {i + 1}
              </div>
              <h3 className="font-bold text-gray-900 dark:text-white">{s.title}</h3>
              <p className="mt-1.5 text-sm text-gray-600 dark:text-gray-400 leading-relaxed">{s.desc}</p>
            </div>
          ))}
        </div>
        <div className="mt-6 flex items-center justify-center gap-2 text-sm text-gray-500">
          <CheckCircle2 className="h-4 w-4 text-green-500" />
          가입하면 대시보드의 시작 가이드가 첫 매물 등록까지 안내해요
        </div>
      </section>

      {/* 마지막 CTA */}
      <section className="bg-blue-600 text-white">
        <div className="mx-auto max-w-5xl px-4 py-12 text-center">
          <h2 className="text-2xl font-bold">오늘부터 사무소 업무를 한 곳에서</h2>
          <div className="mt-6 flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link href="/auth/signup"
              className="inline-flex items-center gap-2 rounded-xl bg-white px-6 py-3 text-sm font-bold text-blue-700 hover:bg-blue-50 transition-colors">
              무료로 시작하기
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link href="/support"
              className="inline-flex items-center gap-2 rounded-xl border border-blue-300/60 px-6 py-3 text-sm font-semibold text-white hover:bg-blue-500/40 transition-colors">
              <MessageCircle className="h-4 w-4" />
              궁금한 점 물어보기
            </Link>
          </div>
        </div>
      </section>
    </div>
  )
}
