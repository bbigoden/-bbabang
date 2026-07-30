'use client'

import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { SUPPORT_EMAIL } from '@/lib/support'
import { Ban, AlertCircle, Mail, Home } from 'lucide-react'

export default function AccountSuspendedPage() {
  const sp = useSearchParams()
  const reason = sp.get('reason') ?? 'suspended'
  const until = sp.get('until')
  const supabaseRef = useRef(createClient())

  const isBanned = reason === 'banned'

  const signOut = async () => {
    await supabaseRef.current.auth.signOut({ scope: 'local' })  // 이 기기만
    window.location.href = '/'
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md rounded-2xl bg-white dark:bg-gray-900 p-8 shadow-lg text-center">
        <div className={`mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full ${
          isBanned ? 'bg-red-100' : 'bg-yellow-100'
        }`}>
          {isBanned ? (
            <Ban className="h-8 w-8 text-red-500" />
          ) : (
            <AlertCircle className="h-8 w-8 text-yellow-500" />
          )}
        </div>

        <h1 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
          {isBanned ? '계정이 차단되었어요' : '계정이 일시 정지되었어요'}
        </h1>

        <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
          {isBanned ? (
            <>이용약관 위반 등으로 빠방 서비스를 더 이상 이용할 수 없습니다.<br />문의 사항이 있다면 고객지원으로 연락 주세요.</>
          ) : (
            <>일시적으로 서비스 이용이 제한됐습니다.<br />문의 사항은 고객지원을 통해 알려주세요.</>
          )}
        </p>

        {!isBanned && until && (
          <div className="mt-4 rounded-xl border border-yellow-200 bg-yellow-50 px-4 py-3">
            <p className="text-xs font-semibold text-yellow-700 mb-0.5">정지 해제 예정</p>
            <p className="text-sm font-bold text-yellow-900">
              {new Date(until).toLocaleString('ko-KR', {
                year: 'numeric', month: 'long', day: 'numeric',
                hour: '2-digit', minute: '2-digit'
              })}
            </p>
          </div>
        )}

        <div className="mt-7 space-y-3">
          <a href={`mailto:${SUPPORT_EMAIL}`}
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white hover:bg-blue-700 transition-colors">
            <Mail className="h-4 w-4" />
            고객지원에 문의
          </a>
          <div className="flex gap-2">
            <button onClick={signOut}
              className="flex-1 rounded-xl border border-gray-200 dark:border-gray-800 py-2.5 text-sm font-medium text-gray-600 dark:text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 dark:bg-gray-950 transition-colors">
              로그아웃
            </button>
            <Link href="/" className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl border border-gray-200 dark:border-gray-800 py-2.5 text-sm font-medium text-gray-600 dark:text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 dark:bg-gray-950 transition-colors">
              <Home className="h-3.5 w-3.5" /> 홈
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
