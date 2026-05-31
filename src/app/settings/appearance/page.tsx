'use client'

import { useTheme } from '@/lib/theme-context'
import { Sun, Moon, Monitor, Type, Check } from 'lucide-react'

export default function SettingsAppearancePage() {
  const { theme, setTheme, fontSize, setFontSize } = useTheme()

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
        <h2 className="mb-1 font-bold text-gray-900 dark:text-white">테마</h2>
        <p className="text-xs text-gray-500 dark:text-gray-500 mb-4">기본은 시스템 설정을 따라가요</p>

        <div className="grid grid-cols-3 gap-3">
          {([
            { key: 'light' as const, label: '라이트', icon: Sun },
            { key: 'dark' as const, label: '다크', icon: Moon },
            { key: 'system' as const, label: '시스템', icon: Monitor },
          ]).map(t => {
            const active = theme === t.key
            const Icon = t.icon
            return (
              <button key={t.key} onClick={() => setTheme(t.key)}
                className={`flex flex-col items-center gap-2 rounded-xl border-2 px-3 py-4 transition-all ${
                  active
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-500/10'
                    : 'border-gray-200 bg-white hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:hover:bg-gray-800'
                }`}>
                <Icon className={`h-6 w-6 ${active ? 'text-blue-600' : 'text-gray-500 dark:text-gray-500'}`} />
                <span className={`text-sm font-semibold ${active ? 'text-blue-700 dark:text-blue-300' : 'text-gray-700 dark:text-gray-300'}`}>
                  {t.label}
                </span>
                {active && <Check className="h-3.5 w-3.5 text-blue-600" />}
              </button>
            )
          })}
        </div>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
        <h2 className="mb-1 flex items-center gap-2 font-bold text-gray-900 dark:text-white">
          <Type className="h-4 w-4 text-gray-500" />
          글꼴 크기
        </h2>
        <p className="text-xs text-gray-500 dark:text-gray-500 mb-4">화면 전체 글자 크기를 조절해요</p>

        <div className="grid grid-cols-4 gap-2">
          {([
            { key: 'sm' as const, label: '작게', size: 'text-xs' },
            { key: 'md' as const, label: '보통', size: 'text-sm' },
            { key: 'lg' as const, label: '크게', size: 'text-base' },
            { key: 'xl' as const, label: '아주 크게', size: 'text-lg' },
          ]).map(f => {
            const active = fontSize === f.key
            return (
              <button key={f.key} onClick={() => setFontSize(f.key)}
                className={`rounded-xl border-2 px-2 py-3 transition-all ${
                  active
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-500/10'
                    : 'border-gray-200 bg-white hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:hover:bg-gray-800'
                }`}>
                <p className={`${f.size} font-bold ${active ? 'text-blue-700 dark:text-blue-300' : 'text-gray-700 dark:text-gray-300'}`}>가</p>
                <p className={`mt-1 text-[10px] font-medium ${active ? 'text-blue-700 dark:text-blue-300' : 'text-gray-500 dark:text-gray-500'}`}>{f.label}</p>
              </button>
            )
          })}
        </div>
        <p className="mt-3 text-[11px] text-gray-500">설정은 이 디바이스에만 저장돼요</p>
      </div>

      <div className="rounded-2xl border border-blue-100 bg-blue-50 p-4 dark:border-blue-500/20 dark:bg-blue-500/10">
        <p className="text-xs text-blue-700 dark:text-blue-300">
          💡 변경 사항은 즉시 적용됩니다. 다크 모드와 글꼴 크기는 모든 페이지에 반영돼요.
        </p>
      </div>
    </div>
  )
}
