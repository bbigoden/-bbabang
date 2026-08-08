'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth-context'
import { Header } from '@/components/layout/header'
import { PageHeader } from '@/components/layout/page-header'
import { useToast } from '@/components/toast'
import { generateCafePost } from '@/lib/cafe-post'
import { Newspaper, Copy, Check, Eraser, Sparkles } from 'lucide-react'

/**
 * 카페글 변환 — 부동산뱅크·네이버부동산 매물 원문을 붙여넣으면
 * 네이버 카페 게시용 글로 변환해주는 직원용 도구.
 * 변환은 브라우저에서 규칙 기반으로 즉시 처리 (외부 API 연결 없음).
 */
export default function CafePostPage() {
  const router = useRouter()
  const auth = useAuth()
  const toast = useToast()

  const [source, setSource] = useState('')
  const [listingNo, setListingNo] = useState('')
  const [result, setResult] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (auth.loading) return
    if (!auth.user) { router.push('/auth/login?redirect=/broker/cafe-post'); return }
    if (!auth.broker) { router.push('/broker/register'); return }
  }, [auth.loading, auth.user?.id, auth.broker?.id])

  const convert = () => {
    const src = source.trim()
    if (!src) { toast.error('매물 원문을 붙여넣어 주세요.'); return }
    try {
      setResult(generateCafePost(src, listingNo.trim()))
      setCopied(false)
    } catch (e) {
      console.error('[cafe-post] convert failed', e)
      toast.error('변환 중 오류가 발생했습니다. 원문 형식을 확인해 주세요.')
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
                disabled={!source.trim()}
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Sparkles className="h-4 w-4" /> 카페글로 변환
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
              <h2 className="font-bold text-gray-900 dark:text-white">변환 결과 <span className="text-xs font-normal text-gray-400">(수정 가능)</span></h2>
              <button
                onClick={copyResult}
                disabled={!result}
                className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-3 py-2 text-sm font-bold text-white hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {copied ? <><Check className="h-4 w-4" /> 복사됨</> : <><Copy className="h-4 w-4" /> 전체 복사</>}
              </button>
            </div>
            <textarea
              value={result}
              onChange={e => { setResult(e.target.value); setCopied(false) }}
              placeholder="변환 결과가 여기에 표시됩니다. 내용을 직접 수정한 뒤 복사할 수 있어요."
              rows={18}
              className="w-full resize-y rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-2.5 text-sm text-gray-900 dark:text-white placeholder:text-gray-400 focus:border-blue-500 focus:outline-none"
            />
            <p className="mt-3 text-xs text-gray-400">
              변환 결과는 인터넷 표시광고 필수 명시사항 형식을 따르지만, 게시 전 소재지·가격·면적이 원문과 일치하는지 꼭 확인해 주세요.
              &quot;확인 필요&quot;로 표시된 항목과 맨 아래 점검 보고를 채운 뒤 게시하면 됩니다.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
