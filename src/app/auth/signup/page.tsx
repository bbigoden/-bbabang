'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Home, User, Building2, Eye, EyeOff, CheckCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Suspense } from 'react'

function SignupForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = createClient()

  const defaultRole = searchParams.get('role') === 'broker' ? 'broker' : 'user'
  const [role, setRole] = useState<'user' | 'broker'>(defaultRole)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [phone, setPhone] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [agreeTerms, setAgreeTerms] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  const pwMatch = password === passwordConfirm
  const pwStrong = password.length >= 8

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!pwMatch) { setError('鍮꾨?踰덊샇媛 ?쇱튂?섏? ?딆뒿?덈떎.'); return }
    if (!pwStrong) { setError('鍮꾨?踰덊샇??8???댁긽?댁뼱???⑸땲??'); return }
    if (!agreeTerms) { setError('?댁슜?쎄????숈쓽?댁＜?몄슂.'); return }

    setLoading(true)
    setError('')

    let data: any = null
    try {
      const result = await supabase.auth.signUp({
        email,
        password,
        options: { data: { name, phone, role } },
      })
      if (result.error) {
        setError(result.error.message === 'User already registered'
          ? '?대? 媛?낅맂 ?대찓?쇱엯?덈떎.'
          : result.error.message)
        setLoading(false)
        return
      }
      data = result.data
    } catch {
      setError('?ㅻ쪟媛 諛쒖깮?덉뒿?덈떎. ?좎떆 ???ㅼ떆 ?쒕룄?댁＜?몄슂.')
      setLoading(false)
      return
    }

    if (data.user) {
      await supabase.from('profiles').upsert({
        id: data.user.id,
        email,
        name,
        phone,
        role,
      })
    }

    if (role === 'broker') {
      router.push('/broker/register')
    } else {
      setSuccess(true)
    }
    setLoading(false)
  }

  if (success) {
    return (
      <div className="rounded-2xl bg-white p-10 shadow-sm border border-gray-100 text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
          <CheckCircle className="h-8 w-8 text-green-600" />
        </div>
        <h2 className="text-xl font-bold text-gray-900 mb-2">媛???꾨즺! ?럦</h2>
        <p className="text-gray-500 text-sm mb-6">
          ?낅젰?섏떊 ?대찓?쇰줈 ?몄쬆 硫붿씪??蹂대깉?댁슂.<br />
          ?대찓?쇱쓣 ?뺤씤?섍퀬 ?몄쬆???꾨즺?댁＜?몄슂.
        </p>
        <Link href="/auth/login">
          <Button variant="primary" size="lg" className="w-full">濡쒓렇?명븯??媛湲?/Button>
        </Link>
      </div>
    )
  }

  return (
    <>
      <div className="mb-8 text-center">
        <Link href="/" className="inline-flex items-center gap-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600">
            <Home className="h-5 w-5 text-white" />
          </div>
          <span className="text-2xl font-bold text-gray-900">鍮좊갑</span>
        </Link>
        <h1 className="mt-6 text-2xl font-bold text-gray-900">鍮좊갑???ㅼ떊 嫄??섏쁺?댁슂 ?룧</h1>
        <p className="mt-2 text-sm text-gray-500">臾대즺濡??쒖옉?섏꽭??/p>
      </div>

      <div className="rounded-2xl bg-white p-8 shadow-sm border border-gray-100">
        {/* ??븷 ?좏깮 */}
        <div className="mb-6 grid grid-cols-2 gap-3">
          {[
            { value: 'user', label: '吏?援ы븯??遺?, icon: User, desc: '留ㅻЪ ?붿껌 쨌 臾대즺' },
            { value: 'broker', label: '怨듭씤以묎컻??, icon: Building2, desc: '留ㅻЪ ?쒖븞 쨌 ?몄쬆 ?꾩슂' },
          ].map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setRole(option.value as 'user' | 'broker')}
              className={cn(
                'rounded-xl border-2 p-4 text-left transition-all',
                role === option.value ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'
              )}
            >
              <option.icon className={cn('mb-2 h-5 w-5', role === option.value ? 'text-blue-600' : 'text-gray-400')} />
              <div className={cn('font-semibold text-sm', role === option.value ? 'text-blue-700' : 'text-gray-700')}>
                {option.label}
              </div>
              <div className="text-xs text-gray-500 mt-0.5">{option.desc}</div>
            </button>
          ))}
        </div>

        <form onSubmit={handleSignup} className="space-y-4">
          <Input label="?대쫫" placeholder="?띻만?? value={name} onChange={(e) => setName(e.target.value)} required />
          <Input label="?대찓?? type="email" placeholder="your@email.com" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />

          {/* 鍮꾨?踰덊샇 */}
          <div className="relative">
            <Input
              label="鍮꾨?踰덊샇"
              type={showPw ? 'text' : 'password'}
              placeholder="8???댁긽"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="pr-11"
              hint={password && !pwStrong ? '8???댁긽 ?낅젰?댁＜?몄슂' : undefined}
            />
            <button
              type="button"
              onClick={() => setShowPw(v => !v)}
              className="absolute right-3 top-[38px] text-gray-400 hover:text-gray-600"
              tabIndex={-1}
            >
              {showPw ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
            </button>
          </div>

          {/* 鍮꾨?踰덊샇 ?뺤씤 */}
          <div className="relative">
            <Input
              label="鍮꾨?踰덊샇 ?뺤씤"
              type={showPw ? 'text' : 'password'}
              placeholder="鍮꾨?踰덊샇 ?ъ엯??
              value={passwordConfirm}
              onChange={(e) => setPasswordConfirm(e.target.value)}
              required
              className="pr-11"
              error={passwordConfirm && !pwMatch ? '鍮꾨?踰덊샇媛 ?쇱튂?섏? ?딆뒿?덈떎' : undefined}
            />
            {passwordConfirm && pwMatch && (
              <CheckCircle className="absolute right-3 top-[38px] h-5 w-5 text-green-500" />
            )}
          </div>

          <Input label="?대???踰덊샇" placeholder="010-1234-5678" value={phone} onChange={(e) => setPhone(e.target.value)} />

          {/* ?쎄? ?숈쓽 */}
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={agreeTerms}
              onChange={(e) => setAgreeTerms(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-gray-300 accent-blue-600"
            />
            <span className="text-sm text-gray-600">
              <Link href="/terms" className="text-blue-600 hover:underline">?댁슜?쎄?</Link>怨?' '}
              <Link href="/privacy" className="text-blue-600 hover:underline">媛쒖씤?뺣낫泥섎━諛⑹묠</Link>???숈쓽?⑸땲??<span className="text-red-500">*</span>
            </span>
          </label>

          {error && (
            <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">?좑툘 {error}</div>
          )}

          <Button
            type="submit"
            className="w-full"
            size="lg"
            loading={loading}
            disabled={!agreeTerms}
          >
            {role === 'broker' ? '以묎컻?щ줈 媛?낇븯湲? : '?뚯썝媛??}
          </Button>
        </form>

        <div className="mt-6 text-center text-sm text-gray-500">
          ?대? 怨꾩젙???덉쑝?좉???{' '}
          <Link href="/auth/login" className="font-semibold text-blue-600 hover:underline">濡쒓렇??/Link>
        </div>
      </div>
    </>
  )
}

export default function SignupPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-12">
      <div className="w-full max-w-md">
        <Suspense fallback={<div className="text-center text-gray-500">濡쒕뵫 以?..</div>}>
          <SignupForm />
        </Suspense>
      </div>
    </div>
  )
}
