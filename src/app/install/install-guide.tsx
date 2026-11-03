'use client'

import { useState } from 'react'
import Link from 'next/link'
import { CheckCircle2, Download, ExternalLink, Share, SquarePlus, MoreVertical } from 'lucide-react'
import { useInstallPath, promptInstall, openInExternalBrowser, isAndroid } from '@/lib/pwa-install'

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-blue-600 text-sm font-bold text-white">{n}</span>
      <span className="pt-0.5 text-[15px] leading-relaxed text-gray-800 dark:text-gray-200">{children}</span>
    </li>
  )
}

export function InstallGuide() {
  const path = useInstallPath()
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  const install = async () => {
    setBusy(true)
    await promptInstall()
    setBusy(false)
  }

  const copyLink = async () => {
    try { await navigator.clipboard.writeText(window.location.href); setCopied(true) } catch { /* noop */ }
  }

  return (
    <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
      <div className="flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icon-192.png?v=3" alt="" className="h-14 w-14 rounded-2xl" />
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">부소장 앱 설치</h1>
          <p className="text-sm text-gray-500">홈 화면에서 바로 열고, 메시지 알림을 받아요</p>
        </div>
      </div>

      <div className="mt-6">
        {path === null && <p className="text-sm text-gray-500">확인 중…</p>}

        {path === 'installed' && (
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <CheckCircle2 className="h-10 w-10 text-green-600" />
            <p className="font-semibold text-gray-900 dark:text-white">이미 앱으로 설치되어 있어요</p>
            <Link href="/" className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white">시작하기</Link>
          </div>
        )}

        {path === 'prompt' && (
          <button onClick={install} disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 py-4 text-base font-bold text-white hover:bg-blue-700 disabled:opacity-50">
            <Download className="h-5 w-5" />
            {busy ? '설치 중…' : '앱 설치하기'}
          </button>
        )}

        {(path === 'kakao' || path === 'inapp') && (
          <div className="space-y-4">
            <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
              {path === 'kakao' ? '카카오톡' : '이 앱'} 안의 화면에서는 설치가 안 돼요.
              {isAndroid() || path === 'kakao' ? ' 아래 버튼으로 브라우저에서 다시 열어 주세요.' : ''}
            </p>
            {(path === 'kakao' || isAndroid()) ? (
              <button onClick={() => openInExternalBrowser()}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 py-4 text-base font-bold text-white hover:bg-blue-700">
                <ExternalLink className="h-5 w-5" />
                {isAndroid() ? '크롬으로 열기' : 'Safari로 열기'}
              </button>
            ) : (
              <ol className="space-y-3">
                <Step n={1}>화면 아래·위의 <b>…</b> 또는 <Share className="inline h-4 w-4" /> 버튼</Step>
                <Step n={2}><b>Safari로 열기</b>를 누른 뒤 이 화면에서 다시 설치</Step>
              </ol>
            )}
            <button onClick={copyLink} className="w-full text-center text-sm font-semibold text-gray-500 underline">
              {copied ? '주소를 복사했어요 — 브라우저에 붙여 넣으세요' : '안 되면 주소 복사하기'}
            </button>
          </div>
        )}

        {path === 'ios' && (
          <ol className="space-y-4">
            <Step n={1}><b>Safari</b>로 이 화면을 열어요 (다른 브라우저면 주소를 복사해 Safari에 붙여 넣기)</Step>
            <Step n={2}>아래쪽 <Share className="inline h-4 w-4 text-blue-600" /> <b>공유</b> 버튼을 눌러요</Step>
            <Step n={3}>목록을 올려 <SquarePlus className="inline h-4 w-4" /> <b>홈 화면에 추가</b> → <b>추가</b></Step>
            <Step n={4}>홈 화면의 부소장 아이콘으로 열고, 알림 허용을 눌러요</Step>
          </ol>
        )}

        {path === 'manual' && (
          <ol className="space-y-4">
            <Step n={1}>브라우저 오른쪽 위 <MoreVertical className="inline h-4 w-4" /> <b>메뉴</b>를 눌러요</Step>
            <Step n={2}><b>앱 설치</b> 또는 <b>홈 화면에 추가</b>를 눌러요</Step>
            <Step n={3}>홈 화면의 부소장 아이콘으로 열고, 알림 허용을 눌러요</Step>
          </ol>
        )}
      </div>

      {path !== 'installed' && path !== null && (
        <p className="mt-6 border-t border-gray-100 pt-4 text-xs leading-relaxed text-gray-400 dark:border-gray-800">
          새 기능이 나오면 앱을 다시 깔 필요 없이 저절로 바뀌어요. 화면 위에 &apos;새 버전&apos; 안내가 뜨면 눌러 주세요.
        </p>
      )}
    </div>
  )
}
