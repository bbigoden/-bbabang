'use client'

import { useState } from 'react'
import Link from 'next/link'
import { CheckCircle2, Download, Smartphone } from 'lucide-react'
import { useInstallPath, promptInstall } from '@/lib/pwa-install'

/** 설정 화면의 앱 설치 칸 — 바로 설치창을 띄울 수 있으면 띄우고, 아니면 /install 안내로 보낸다 */
export function InstallAppCard() {
  const path = useInstallPath()
  const [busy, setBusy] = useState(false)
  if (path === null) return null

  const install = async () => {
    setBusy(true)
    await promptInstall()
    setBusy(false)
  }

  return (
    <div className="rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 p-6">
      <h2 className="mb-1 font-bold text-gray-900 dark:text-white flex items-center gap-2">
        <Smartphone className="h-4 w-4 text-gray-500" /> 앱 설치
      </h2>
      {path === 'installed' ? (
        <p className="flex items-center gap-1.5 text-sm text-green-700 dark:text-green-400">
          <CheckCircle2 className="h-4 w-4" /> 이 기기에 앱으로 설치되어 있어요
        </p>
      ) : (
        <>
          <p className="mb-4 text-sm text-gray-500">홈 화면에서 바로 열고, 메세지 알림을 받아요</p>
          {path === 'prompt' ? (
            <button onClick={install} disabled={busy}
              className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50">
              <Download className="h-4 w-4" /> {busy ? '설치 중…' : '앱 설치하기'}
            </button>
          ) : (
            <Link href="/install"
              className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-blue-700">
              <Download className="h-4 w-4" /> 설치 방법 보기
            </Link>
          )}
        </>
      )}
    </div>
  )
}
