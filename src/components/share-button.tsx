'use client'

import { useState } from 'react'
import { Share2, Copy, Check } from 'lucide-react'

interface Props {
  title: string
  text: string
  url: string
}

export function ShareButton({ title, text, url }: Props) {
  const [copied, setCopied] = useState(false)

  const handleShare = async () => {
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({ title, text, url })
      } catch (e) {
        // 사용자가 취소한 경우 무시
      }
    } else {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <button
      onClick={handleShare}
      className="flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-600 hover:border-blue-300 hover:text-blue-600 transition-all"
    >
      {copied
        ? <><Check className="h-4 w-4 text-green-500" /> <span className="text-green-600">복사됨!</span></>
        : <><Share2 className="h-4 w-4" /> 공유</>
      }
    </button>
  )
}
