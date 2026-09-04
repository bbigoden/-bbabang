'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '@/lib/auth-context'
import { Header } from '@/components/layout/header'
import { ArrowLeft, Building2, Users, Layers, Mail } from 'lucide-react'
import { CompaniesTab } from './companies'
import { ClientsTab } from './clients'
import { TemplatesTab } from './templates'
import { MailTab } from './mail'

type Tab = 'companies' | 'clients' | 'templates' | 'mail'

const TABS: { id: Tab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'companies', label: '발행 회사', icon: Building2 },
  { id: 'clients',   label: '거래처', icon: Users },
  { id: 'templates', label: '공사 프리셋', icon: Layers },
  { id: 'mail',      label: '메일 설정', icon: Mail },
]

export default function EstimateSettingsPage() {
  const router = useRouter()
  const { broker, loading } = useAuth()
  const [tab, setTab] = useState<Tab>('companies')

  if (loading) {
    return (
      <div className="bg-gray-50 dark:bg-gray-950">
        <Header />
        <h1 className="sr-only">견적서 설정</h1>
        <div className="px-4 py-8 text-center text-sm text-gray-500">불러오는 중…</div>
      </div>
    )
  }

  if (!broker) {
    return (
      <div className="bg-gray-50 dark:bg-gray-950">
        <Header />
        <h1 className="sr-only">견적서 설정</h1>
        <div className="px-4 py-8 text-center text-sm text-gray-500">
          사무소 정보를 찾을 수 없습니다. <Link href="/broker/register" className="text-blue-600 underline">사무소 등록</Link>이 필요합니다.
        </div>
      </div>
    )
  }

  return (
    <div className="bg-gray-50 dark:bg-gray-950 overflow-x-hidden">
      <Header />

      <div className="px-4 py-6">
        <div className="mb-2 flex items-center gap-3">
          <button onClick={() => router.push('/broker/estimates')} aria-label="견적서 목록으로" title="견적서 목록으로"
            className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h1 className="text-xl font-black text-gray-900 dark:text-white">견적서 설정</h1>
        </div>

        <div className="mb-5 ml-11 flex gap-1 border-b border-gray-200 dark:border-gray-800">
          {TABS.map(t => {
            const Icon = t.icon
            const active = tab === t.id
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`-mb-px flex items-center gap-1.5 border-b-2 px-4 py-2.5 text-sm font-bold transition-colors ${
                  active
                    ? 'border-blue-600 text-blue-700 dark:text-blue-300'
                    : 'border-transparent text-gray-500 hover:text-gray-800 dark:hover:text-gray-200'
                }`}
              >
                <Icon className="h-4 w-4" />{t.label}
              </button>
            )
          })}
        </div>

        {tab === 'companies' && <CompaniesTab brokerId={broker.id} />}
        {tab === 'clients' && <ClientsTab brokerId={broker.id} />}
        {tab === 'templates' && <TemplatesTab brokerId={broker.id} />}
        {tab === 'mail' && <MailTab brokerId={broker.id} />}
      </div>
    </div>
  )
}
