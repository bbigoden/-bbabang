'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth-context'
import { Header } from '@/components/layout/header'
import { PageHeader } from '@/components/layout/page-header'
import { useToast } from '@/components/toast'
import { Newspaper, Copy, Check, Loader2, Eraser, Sparkles } from 'lucide-react'

/**
 * 카페글 변환 — 부동산뱅크·네이버부동산 매물 원문을 붙여넣으면
 * 네이버 카페 게시용 글로 변환해주는 직원용 도구.
 * 변환은 /api/broker/cafe-post (Claude API) 스트리밍으로 처리.
 */
export default function CafePostPage() {
  const router = useRouter()
  const auth = useAuth()
  const toast = useToast()

  const [source, setSource] = useState('')
  const [listingNo, setListingNo] = useState('')
  const [result, setResult] = useState('')
  const [converting, setConverting] = useState(false)
  const [copied, setCopied] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const resultRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (auth.loading) return
    if (!auth.user) { router.push('/auth/login?redirect=/broker/cafe-post'); return }
    if (!auth.broker) { router.push('/broker/register'); return }
  }, [auth.loading, auth.user?.id, auth.broker?.id])

  // 스트리밍 중 결과 영역 자동 스크롤
  useEffect(() => {
    if (converting && resultRef.current) {
      resultRef.current.scrollTop = resultRef.current.scrollHeight
    }
  }, [result, converting])

  useEffect(() => () => abortRef.current?.abort(), [])

  const convert = async () => {
    const src = source.trim()
    if (!src) { toast.error('매물 원문을 붙여넣어 주세요.'); return }

    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl

    setConverting(true)
    setResult('')
    setCopied(false)

    try {
      const res = await fetch('/api/broker/cafe-post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: src, listingNo: listingNo.trim() }),
        signal: ctrl.signal,
      })

      if (!res.ok) {
        let code = ''
        try { code = (await res.json())?.error ?? '' } catch { /* not json */ }
        const messages: Record<string, string> = {
          config_missing_anthropic_key: '서버에 API 키가 설정되지 않았습니다. 관리자에게 문의해 주세요.',
          rate_limited: '변환 횟수 제한을 초과했습니다. 잠시 후 다시 시도해 주세요.',
          source_too_long: '원문이 너무 깁니다. 매물 하나 분량만 붙여넣어 주세요.',
          not_broker: '중개사 계정만 사용할 수 있습니다.',
        }
        toast.error(messages[code] ?? '변환에 실패했습니다. 잠시 후 다시 시도해 주세요.')
        return
      }

      const reader = res.body?.getReader()
      if (!reader) { toast.error('응답을 읽을 수 없습니다.'); return }
      const decoder = new TextDecoder()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        setResult(prev => prev + decoder.decode(value, { stream: true }))
      }
    } catch (e: unknown) {
      if ((e as Error)?.name !== 'AbortError') {
        console.error('[cafe-post] convert failed', e)
        toast.error('변환 중 오류가 발생했습니다. 다시 시도해 주세요.')
      }
    } finally {
      if (abortRef.current === ctrl) abortRef.current = null
      setConverting(false)
    }
  }

  const copyResult = async () => {
    if (!result) return
    try {
      await navigator.clipboard.writeText(result)
      setCopied(true)
      toast.success('변환 결과를 복사했습니다. 카페 에디터에 붙여넣어 주세요.')
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('복사에 실패했습니다. 결과를 직접 선택해서 복사해 주세요.')
    }
  }

  const clearAll = () => {
    abortRef.current?.abort()
    setSource('')
    setListingNo('')
    setResult('')
    setCopied(false)
  }

  if (auth.loading || !auth.user || !auth.broker) return (
    <div className="bg-gray-50 dark:bg-gray-950 flex items-center justify-center">
      <div className="text-gray-500 text-sm">불러오는 중...</div>
    </div>
  )

  return (
    <div className="bg-gray-50 dark:bg-gray-950">
      <Header user={auth.user} role="broker" />
      <div className="mx-auto max-w-5xl px-4 py-8">
        <PageHeader
          icon={Newspaper}
          iconColor="text-blue-600"
          title="카페글 변환"
          description="부동산뱅크·네이버부동산 매물 원문을 네이버 카페 게시용 글로 변환합니다"
        />

        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          {/* 입력 */}
          <div className="rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="font-bold text-gray-900 dark:text-white">매물 원문</h2>
              <input
                value={listingNo}
                onChange={e => setListingNo(e.target.value)}
                placeholder="매물번호 (10자리)"
                inputMode="numeric"
                maxLength={10}
                className="w-40 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white placeholder:text-gray-400 focus:border-blue-500 focus:outline-none"
              />
            </div>
            <textarea
              value={source}
              onChange={e => setSource(e.target.value)}
              placeholder={'부동산뱅크나 네이버부동산에서 복사한 매물 내용을 그대로 붙여넣어 주세요.\n\n소재지·면적·가격·준공년월 등이 포함된 원문 전체를 붙여넣으면 됩니다.'}
              rows={18}
              className="w-full resize-y rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2.5 text-sm text-gray-900 dark:text-white placeholder:text-gray-400 focus:border-blue-500 focus:outline-none"
            />
            <div className="mt-3 flex items-center gap-2">
              <button
                onClick={convert}
                disabled={converting || !source.trim()}
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {converting
                  ? <><Loader2 className="h-4 w-4 animate-spin" /> 변환 중...</>
                  : <><Sparkles className="h-4 w-4" /> 카페글로 변환</>}
              </button>
              <button
                onClick={clearAll}
                className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 dark:border-gray-700 px-4 py-2.5 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                <Eraser className="h-4 w-4" /> 지우기
              </button>
            </div>
          </div>

          {/* 결과 */}
          <div className="rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="font-bold text-gray-900 dark:text-white">변환 결과</h2>
              <button
                onClick={copyResult}
                disabled={!result || converting}
                className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-3 py-2 text-sm font-bold text-white hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {copied ? <><Check className="h-4 w-4" /> 복사됨</> : <><Copy className="h-4 w-4" /> 전체 복사</>}
              </button>
            </div>
            <div
              ref={resultRef}
              className="h-[434px] overflow-y-auto rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-2.5"
            >
              {result ? (
                <pre className="whitespace-pre-wrap break-words font-sans text-sm text-gray-900 dark:text-white">{result}</pre>
              ) : (
                <p className="text-sm text-gray-400">
                  {converting ? '변환을 시작하고 있습니다. 잠시만 기다려 주세요...' : '변환 결과가 여기에 표시됩니다.'}
                </p>
              )}
            </div>
            <p className="mt-3 text-xs text-gray-400">
              변환 결과는 인터넷 표시광고 필수 명시사항을 따르지만, 게시 전 소재지·가격·면적이 원문과 일치하는지 꼭 확인해 주세요.
              원문에 문제가 있으면 결과 맨 아래에 점검 보고가 표시됩니다.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
