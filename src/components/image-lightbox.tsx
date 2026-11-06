'use client'

import { useEffect, useCallback, useRef, useState } from 'react'
import { X, ChevronLeft, ChevronRight, Download, RotateCw } from 'lucide-react'

interface ImageLightboxProps {
  images: string[]
  index: number
  onClose: () => void
  onNext: () => void
  onPrev: () => void
  onGoTo: (i: number) => void
  /** 넘기면 기본 받기(photo_N.jpg) 대신 이걸 부른다 — 원래 파일 이름으로 받아야 하는 곳(자료실)용 */
  onDownload?: (i: number) => void
  /** 위쪽에 같이 보일 파일 이름 — 넘기다 보면 지금 것이 무엇인지 몰랐다 */
  names?: string[]
}

export function ImageLightbox({ images, index, onClose, onNext, onPrev, onGoTo, onDownload, names }: ImageLightboxProps) {
  // 보기만 돌린다(파일은 그대로). 다른 사진으로 넘기면 똑바로 돌아온다
  const [turn, setTurn] = useState(0)
  // 느린 회선에서 원본이 뜨기까지 몇 초씩 검은 화면만 보였다 — 그동안 도는 표시를 둔다
  const [loaded, setLoaded] = useState(false)
  useEffect(() => { setTurn(0); setLoaded(false) }, [index])
  const rotate = useCallback(() => setTurn(t => t + 1), [])
  const sideways = turn % 2 === 1
  const maxH = images.length > 1
    ? 'calc(100vh - 180px)'   // 상단바 + 하단 썸네일 공간 확보
    : 'calc(100vh - 100px)'   // 상단바만

  const handleKey = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose()
    if (e.key === 'r' || e.key === 'R') rotate()
    if (e.key === 'ArrowRight') onNext()
    if (e.key === 'ArrowLeft') onPrev()
  }, [onClose, onNext, onPrev, rotate])

  // 휴대폰 뒤로가기는 사진 창만 닫는다 — 기록을 한 칸 쌓지 않으면 그 뒤로가기가 아래 화면(메시지 방)까지 닫았다.
  // 개발 모드의 두 번 붙이기에도 칸이 두 번 쌓이지 않게, 이미 쌓인 칸이 있으면 그걸 쓰고 닫힌 게 확실할 때만 되돌린다
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    let token = (history.state as { lightbox?: number } | null)?.lightbox
    if (!token) {
      token = Date.now()
      history.pushState({ ...history.state, lightbox: token }, '')
    }
    const onPop = () => closeRef.current()
    window.addEventListener('popstate', onPop)
    return () => {
      window.removeEventListener('popstate', onPop)
      setTimeout(() => {
        if ((history.state as { lightbox?: number } | null)?.lightbox === token
          && !document.querySelector('[aria-label="이미지 뷰어"]')) history.back()
      }, 0)
    }
  }, [])

  useEffect(() => {
    document.addEventListener('keydown', handleKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', handleKey)
      document.body.style.overflow = ''
    }
  }, [handleKey])

  const handleDownload = async () => {
    if (onDownload) { onDownload(index); return }
    const url = images[index]
    try {
      const res = await fetch(url)
      const blob = await res.blob()
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `photo_${index + 1}.jpg`
      a.click()
      URL.revokeObjectURL(a.href)
    } catch {
      window.open(url, '_blank')
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="이미지 뷰어"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/90"
      onClick={onClose}
    >
      {/* 상단 바 */}
      <div className="absolute top-0 left-0 right-0 flex items-center justify-between gap-3 px-4 py-3 z-10">
        <span className="min-w-0 truncate text-sm font-medium text-white/70">
          {index + 1} / {images.length}{names?.[index] ? ` · ${names[index]}` : ''}
        </span>
        <div className="flex flex-shrink-0 items-center gap-2">
          <button
            onClick={e => { e.stopPropagation(); rotate() }}
            aria-label="돌리기" title="돌리기 (R)"
            className="flex h-11 w-11 items-center justify-center rounded-lg bg-white/10 text-white hover:bg-white/20 transition-colors sm:h-9 sm:w-9"
          >
            <RotateCw className="h-5 w-5" />
          </button>
          <button
            onClick={e => { e.stopPropagation(); handleDownload() }}
            aria-label="다운로드"
            className="flex h-11 items-center gap-1.5 rounded-lg bg-white/10 px-3 text-sm text-white hover:bg-white/20 transition-colors sm:h-9"
          >
            <Download className="h-4 w-4" />
            <span className="hidden sm:inline">다운로드</span>
          </button>
          <button
            onClick={e => { e.stopPropagation(); onClose() }}
            aria-label="닫기"
            className="flex h-11 w-11 items-center justify-center rounded-lg bg-white/10 text-white hover:bg-white/20 transition-colors sm:h-9 sm:w-9"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* 이미지 + 화살표 묶음 */}
      <div className="flex items-center gap-3" onClick={e => e.stopPropagation()}>
        {images.length > 1 && (
          <button
            onClick={e => { e.stopPropagation(); onPrev() }}
            aria-label="이전 이미지"
            className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/25 transition-colors"
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
        )}

        <div className="relative flex items-center justify-center">
          {!loaded && (
            <div className="absolute h-10 w-10 animate-spin rounded-full border-4 border-white/20 border-t-white" role="status" aria-label="사진 불러오는 중" />
          )}
          <img
            key={images[index]}
            src={images[index]}
            alt="매물 사진"
            decoding="async"
            onLoad={() => setLoaded(true)}
            onError={() => setLoaded(true)}
            className="rounded-lg object-contain shadow-2xl transition-transform duration-200"
            style={{
              // 옆으로 누우면 가로·세로 한도를 맞바꿔야 화면 밖으로 안 나간다.
              // 양옆 화살표(44px)+틈 자리를 빼야 폰에서 이전 화살표가 화면 밖으로 잘리지 않는다
              maxWidth: sideways ? maxH : images.length > 1 ? 'min(80vw, calc(100vw - 8rem))' : '80vw',
              maxHeight: sideways ? (images.length > 1 ? 'min(80vw, calc(100vw - 8rem))' : '80vw') : maxH,
              transform: `rotate(${turn * 90}deg)`,
            }}
          />
        </div>

        {images.length > 1 && (
          <button
            onClick={e => { e.stopPropagation(); onNext() }}
            aria-label="다음 이미지"
            className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/25 transition-colors"
          >
            <ChevronRight className="h-6 w-6" />
          </button>
        )}
      </div>

      {/* 하단 썸네일 */}
      {images.length > 1 && (
        <div
          className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2"
          onClick={e => e.stopPropagation()}
        >
          {images.map((src, i) => (
            <button
              key={i}
              onClick={() => onGoTo(i)}
              aria-label={`사진 ${i + 1}`}
              className={`h-12 w-12 flex-shrink-0 overflow-hidden rounded-lg border-2 transition-all ${
                i === index ? 'border-white scale-110' : 'border-white/30 opacity-60 hover:opacity-90'
              }`}
            >
              <img src={src} alt="매물 사진" loading="lazy" decoding="async" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
