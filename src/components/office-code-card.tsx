'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card, CardBody } from '@/components/ui/card'
import { Copy, Check, RefreshCw, Users } from 'lucide-react'

interface OfficeCodeCardProps {
  brokerId: string
  initialCode: string | null
}

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // 혼동 문자 제외 (I,O,0,1)
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
}

export function OfficeCodeCard({ brokerId, initialCode }: OfficeCodeCardProps) {
  const supabase = createClient()
  const [code, setCode] = useState(initialCode)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)

  const handleGenerate = async () => {
    setLoading(true)
    const newCode = generateCode()
    const { error } = await supabase
      .from('broker_profiles')
      .update({ office_code: newCode })
      .eq('id', brokerId)
    if (!error) setCode(newCode)
    setLoading(false)
  }

  const handleCopy = async () => {
    if (!code) return
    await navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Card>
      <CardBody>
        <div className="flex items-center gap-2 mb-3">
          <Users className="h-4 w-4 text-indigo-500" />
          <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">직원 합류 코드</span>
        </div>

        {code ? (
          <>
            <div className="flex items-center gap-2 mb-2">
              <span className="flex-1 rounded-xl bg-gray-100 dark:bg-gray-800 px-4 py-3 text-center text-2xl font-mono font-black tracking-widest text-gray-900 dark:text-white">
                {code}
              </span>
              <button
                onClick={handleCopy}
                aria-label={copied ? '복사 완료' : '초대 코드 복사'}
                title={copied ? '복사 완료' : '초대 코드 복사'}
                className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800 dark:bg-gray-950 transition-colors"
              >
                {copied
                  ? <Check className="h-5 w-5 text-green-500" />
                  : <Copy className="h-5 w-5 text-gray-500" />
                }
              </button>
            </div>
            <p className="text-xs text-gray-500 mb-3">1회용 코드입니다. 직원이 등록 신청하면 자동으로 새 코드가 발급됩니다</p>
            <button
              onClick={handleGenerate}
              disabled={loading}
              className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-600 dark:text-gray-500 transition-colors"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              코드 수동 재발급
            </button>
          </>
        ) : (
          <>
            <p className="mb-3 text-sm text-gray-500">코드를 발급하면 직원이 사무소에 합류할 수 있습니다</p>
            <button
              onClick={handleGenerate}
              disabled={loading}
              className="w-full rounded-xl border-2 border-dashed border-gray-200 dark:border-gray-800 py-3 text-sm font-medium text-gray-500 hover:border-blue-300 hover:text-blue-600 transition-colors"
            >
              {loading ? '발급 중...' : '+ 코드 발급하기'}
            </button>
          </>
        )}
      </CardBody>
    </Card>
  )
}
