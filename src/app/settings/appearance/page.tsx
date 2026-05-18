'use client'

import { Sparkles, Sun, Moon, Monitor } from 'lucide-react'

const THEMES = [
  { key: 'light',  label: '라이트', icon: Sun },
  { key: 'dark',   label: '다크',   icon: Moon },
  { key: 'system', label: '시스템', icon: Monitor },
] as const

export default function SettingsAppearancePage() {
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-gray-200 bg-white p-6">
        <h2 className="mb-1 font-bold text-gray-900 flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-gray-400" /> 테마
        </h2>
        <p className="text-xs text-gray-500 mb-4">화면 색상 모드를 선택해요 <span className="ml-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">곧 제공</span></p>

        <div className="grid grid-cols-3 gap-2">
          {THEMES.map(({ key, label, icon: Icon }) => {
            const active = key === 'light'
            return (
              <button key={key} disabled
                className={`flex flex-col items-center gap-2 rounded-xl border px-3 py-4 text-xs font-medium transition-colors cursor-not-allowed ${
                  active
                    ? 'border-blue-200 bg-blue-50 text-blue-700'
                    : 'border-gray-200 bg-white text-gray-400'
                }`}>
                <Icon className="h-5 w-5" />
                {label}
              </button>
            )
          })}
        </div>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-6">
        <h2 className="mb-1 font-bold text-gray-900">언어</h2>
        <p className="text-xs text-gray-500 mb-4">서비스 언어를 선택해요 <span className="ml-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">곧 제공</span></p>
        <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-500">
          한국어 (기본)
        </div>
      </div>
    </div>
  )
}
