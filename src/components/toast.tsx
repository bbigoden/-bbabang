'use client'

import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { CheckCircle, AlertCircle, Info, X } from 'lucide-react'

type ToastKind = 'success' | 'error' | 'info'
type ToastItem = { id: number; kind: ToastKind; message: string }
type ToastApi = {
  success: (m: string) => void
  error: (m: string) => void
  info: (m: string) => void
}

const ToastCtx = createContext<ToastApi | null>(null)

export function useToast(): ToastApi {
  const ctx = useContext(ToastCtx)
  if (!ctx) {
    // Provider 없이 호출돼도 깨지지 않도록 fallback (개발 중 누락 대응)
    return {
      success: (m) => console.log('[toast.success]', m),
      error: (m) => console.error('[toast.error]', m),
      info: (m) => console.info('[toast.info]', m),
    }
  }
  return ctx
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])

  const push = useCallback((kind: ToastKind, message: string) => {
    const id = Date.now() + Math.random()
    setItems((prev) => [...prev, { id, kind, message }])
    setTimeout(() => {
      setItems((prev) => prev.filter((t) => t.id !== id))
    }, 3500)
  }, [])

  const api: ToastApi = {
    success: (m) => push('success', m),
    error: (m) => push('error', m),
    info: (m) => push('info', m),
  }

  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="true"
        className="pointer-events-none fixed bottom-4 right-4 z-[100] flex flex-col gap-2 sm:bottom-6 sm:right-6"
      >
        {items.map((t) => (
          <ToastView key={t.id} item={t} onClose={() => setItems((prev) => prev.filter((x) => x.id !== t.id))} />
        ))}
      </div>
    </ToastCtx.Provider>
  )
}

function ToastView({ item, onClose }: { item: ToastItem; onClose: () => void }) {
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => setVisible(true))
    return () => cancelAnimationFrame(id)
  }, [])

  const Icon = item.kind === 'success' ? CheckCircle : item.kind === 'error' ? AlertCircle : Info
  const colorMap = {
    success: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300',
    error: 'border-red-200 bg-red-50 text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300',
    info: 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-300',
  }

  return (
    <div
      className={`pointer-events-auto flex items-start gap-2 rounded-xl border px-4 py-3 shadow-md transition-all max-w-sm ${
        colorMap[item.kind]
      } ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'}`}
      role={item.kind === 'error' ? 'alert' : 'status'}
    >
      <Icon className="h-4 w-4 flex-shrink-0 mt-0.5" />
      <p className="text-sm font-medium flex-1">{item.message}</p>
      <button
        type="button"
        onClick={onClose}
        aria-label="닫기"
        className="flex-shrink-0 rounded p-0.5 hover:bg-black/5 dark:hover:bg-white/10"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
