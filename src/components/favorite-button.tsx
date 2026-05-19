'use client'

import { useEffect, useRef, useState, MouseEvent } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useAuthOptional } from '@/lib/auth-context'
import { Heart } from 'lucide-react'

type Target = 'broker' | 'property' | 'request'

interface Props {
  type: Target
  id: string
  variant?: 'icon' | 'pill'
  className?: string
  /**
   * 부모에서 미리 favorited 여부를 알고 있을 때 전달 (배치 fetch 최적화).
   * 미지정 시 mount 후 자체 fetch.
   */
  initialFavorited?: boolean
}

export function FavoriteButton({ type, id, variant = 'icon', className = '', initialFavorited }: Props) {
  const router = useRouter()
  const supabaseRef = useRef(createClient())
  const supabase = supabaseRef.current
  const { user } = useAuthOptional()

  const [favorited, setFavorited] = useState<boolean | null>(initialFavorited ?? null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (initialFavorited !== undefined) return
    if (!user) { setFavorited(false); return }
    let cancelled = false
    ;(async () => {
      const { data } = await supabase
        .from('favorites')
        .select('id')
        .eq('user_id', user.id)
        .eq('target_type', type)
        .eq('target_id', id)
        .maybeSingle()
      if (!cancelled) setFavorited(!!data)
    })()
    return () => { cancelled = true }
  }, [user, type, id, initialFavorited, supabase])

  const toggle = async (e: MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (busy) return
    if (!user) {
      router.push('/auth/login')
      return
    }
    setBusy(true)
    const next = !favorited
    setFavorited(next)
    if (next) {
      const { error } = await supabase
        .from('favorites')
        .insert({ user_id: user.id, target_type: type, target_id: id })
      if (error && (error as any).code !== '23505') {
        setFavorited(!next)
      }
    } else {
      const { error } = await supabase
        .from('favorites')
        .delete()
        .eq('user_id', user.id)
        .eq('target_type', type)
        .eq('target_id', id)
      if (error) setFavorited(!next)
    }
    setBusy(false)
  }

  const isFav = favorited === true
  const label = isFav ? '찜 해제' : '찜하기'

  if (variant === 'pill') {
    return (
      <button
        type="button"
        onClick={toggle}
        disabled={busy || favorited === null}
        aria-pressed={isFav}
        aria-label={label}
        className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition-all disabled:opacity-50 ${
          isFav
            ? 'border-pink-200 bg-pink-50 text-pink-600 hover:bg-pink-100'
            : 'border-gray-200 bg-white text-gray-500 hover:bg-gray-50'
        } ${className}`}
      >
        <Heart className={`h-3.5 w-3.5 ${isFav ? 'fill-pink-500 text-pink-500' : ''}`} />
        {isFav ? '찜함' : '찜'}
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy || favorited === null}
      aria-pressed={isFav}
      aria-label={label}
      title={label}
      className={`flex h-8 w-8 items-center justify-center rounded-full bg-white/90 backdrop-blur shadow-sm hover:bg-white transition-colors disabled:opacity-50 ${className}`}
    >
      <Heart className={`h-4 w-4 ${isFav ? 'fill-pink-500 text-pink-500' : 'text-gray-500'}`} />
    </button>
  )
}
