'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card, CardBody } from '@/components/ui/card'
import { Copy, Check, RefreshCw, Users } from 'lucide-react'

// 합류 코드는 broker_profiles 칸이 아니라 정책 없는 office_join_codes 에 있다(로그인만 하면 남의
// 사무소 코드까지 읽히던 구멍). 그래서 읽기·재발급 모두 대표 본인만 통과하는 rpc 로 한다.
// 코드 만들기도 서버가 합류 함수와 같은 글자표(I·O·0·1 제외 6자리)로 한다.
export function OfficeCodeCard() {
  const supabase = createClient()
  // undefined = 아직 불러오는 중. 이때 "코드 발급하기"를 보여 주면 대표가 멀쩡한 코드를
  // 갈아치울 수 있어 자리만 잡아 둔다.
  const [code, setCode] = useState<string | null | undefined>(undefined)
  // 불러오기 실패. 이때도 "코드 발급하기"를 보이면 눌렀을 때 직원에게 알려 준 코드가 바뀐다.
  const [loadFailed, setLoadFailed] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let 살아있음 = true
    // 브라우저 클라이언트는 싱글턴이라 여기서 다시 불러도 같은 것 — 의존성 배열을 비워 두려고.
    void createClient().rpc('my_office_code').then(({ data, error }) => {
      if (!살아있음) return
      if (error) { console.error('[office-code] load failed', error); setLoadFailed(true); return }
      setLoadFailed(false)
      setCode(typeof data === 'string' ? data : null)
    })
    return () => { 살아있음 = false }
  }, [reloadKey])

  const handleGenerate = async () => {
    setLoading(true)
    const { data, error } = await supabase.rpc('regenerate_office_code')
    if (error) console.error('[office-code] regenerate failed', error)
    else if (typeof data === 'string') setCode(data)
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

        {loadFailed ? (
          <div className="mb-2 flex items-center justify-between gap-2 rounded-xl bg-gray-100 dark:bg-gray-800 px-4 py-3">
            <span className="text-sm text-gray-500">코드를 불러오지 못했어요</span>
            <button type="button" onClick={() => { setLoadFailed(false); setCode(undefined); setReloadKey(k => k + 1) }}
              className="text-sm font-medium text-blue-600 hover:underline">다시 시도</button>
          </div>
        ) : code === undefined ? (
          <div className="mb-2 h-14 rounded-xl bg-gray-100 dark:bg-gray-800 animate-pulse" />
        ) : code ? (
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
