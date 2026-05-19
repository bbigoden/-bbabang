'use client'

import { useEffect, useCallback } from 'react'
import { X, ChevronLeft, ChevronRight, Download } from 'lucide-react'

interface ImageLightboxProps {
  images: string[]
  index: number
  onClose: () => void
  onNext: () => void
  onPrev: () => void
  onGoTo: (i: number) => void
}

export function ImageLightbox({ images, index, onClose, onNext, onPrev, onGoTo }: ImageLightboxProps) {
  const handleKey = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose()
    if (e.key === 'ArrowRight') onNext()
    if (e.key === 'ArrowLeft') onPrev()
  }, [onClose, onNext, onPrev])

  useEffect(() => {
    document.addEventListener('keydown', handleKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', handleKey)
      document.body.style.overflow = ''
    }
  }, [handleKey])

  const handleDownload = async () => {
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/90"
      onClick={onClose}
    >
      {/* 상단 바 */}
      <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-4 py-3 z-10">
        <span className="text-sm font-medium text-white/70">
          {index + 1} / {images.length}
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={e => { e.stopPropagation(); handleDownload() }}
            className="flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-sm text-white hover:bg-white/20 transition-colors"
          >
            <Download className="h-4 w-4" />
            다운로드
          </button>
          <button
            onClick={e => { e.stopPropagation(); onClose() }}
            className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 text-white hover:bg-white/20 transition-colors"
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
            className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/25 transition-colors"
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
        )}

        <img
          src={images[index]}
          alt=""
          decoding="async"
          className="rounded-lg object-contain shadow-2xl"
          style={{
            maxWidth: '80vw',
            maxHeight: images.length > 1
              ? 'calc(100vh - 180px)'   // 상단바 + 하단 썸네일 공간 확보
              : 'calc(100vh - 100px)',  // 상단바만
          }}
        />

        {images.length > 1 && (
          <button
            onClick={e => { e.stopPropagation(); onNext() }}
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
              className={`h-12 w-12 flex-shrink-0 overflow-hidden rounded-lg border-2 transition-all ${
                i === index ? 'border-white scale-110' : 'border-white/30 opacity-60 hover:opacity-90'
              }`}
            >
              <img src={src} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
