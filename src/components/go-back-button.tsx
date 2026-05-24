'use client'

import { Button } from '@/components/ui/button'
import { ArrowLeft } from 'lucide-react'

/** 404/에러 화면용 — 브라우저 history 뒤로 가기 */
export function GoBackButton() {
  return (
    <Button variant="secondary" size="lg" onClick={() => window.history.back()}>
      <ArrowLeft className="mr-2 h-4 w-4" />
      뒤로가기
    </Button>
  )
}
