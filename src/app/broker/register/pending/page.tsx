'use client'

import { Header } from '@/components/layout/header'
import { Clock } from 'lucide-react'

export default function PendingPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      <div className="mx-auto max-w-xl px-4 py-20 text-center">
        <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-yellow-100">
          <Clock className="h-10 w-10 text-yellow-500" />
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mb-3">승인 대기 중</h1>
        <p className="text-gray-500 text-sm leading-relaxed">
          등록 신청이 완료되었습니다.<br />
          대표가 승인하면 서비스를 이용할 수 있습니다.<br />
          승인 여부는 대표에게 문의해주세요.
        </p>
      </div>
    </div>
  )
}
