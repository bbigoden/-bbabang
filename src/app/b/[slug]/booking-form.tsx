'use client'

import { useEffect, useMemo, useState } from 'react'
import { bookableDays, slotsFor, weekdayOf, type BookingConfig } from '@/lib/booking'
import { CalendarCheck, Check } from 'lucide-react'

const WEEK = ['일', '월', '화', '수', '목', '금', '토']
const won = (n: number | null) => (n == null ? '' : `${n.toLocaleString()}원`)
function timeLabel(hm: string) {
  const [h, m] = hm.split(':').map(Number)
  return `${h < 12 ? '오전' : '오후'} ${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')}`
}

export function BookingForm({ slug }: { slug: string }) {
  const [cfg, setCfg] = useState<BookingConfig | null>(null)
  const [state, setState] = useState<'loading' | 'missing' | 'ready' | 'done'>('loading')
  const [from, setFrom] = useState<string | null>(null)
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [product, setProduct] = useState('')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [request, setRequest] = useState('')
  const [consent, setConsent] = useState(false)
  const [website, setWebsite] = useState('')   // 로봇 걸러내기용 숨은 칸
  const [sending, setSending] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    // useSearchParams 는 Suspense 경계가 필요해 주소에서 바로 읽는다
    setFrom(new URLSearchParams(window.location.search).get('from'))
    fetch(`/api/booking/${encodeURIComponent(slug)}`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (d) { setCfg(d); setState('ready') } else setState('missing') })
      .catch(() => setState('missing'))
  }, [slug])

  const days = useMemo(() => (cfg ? bookableDays(cfg) : []), [cfg])
  const slots = useMemo(() => (cfg && date ? slotsFor(cfg, date) : []), [cfg, date])
  useEffect(() => { if (time && !slots.includes(time)) setTime('') }, [slots, time])

  const products = cfg?.products ?? []
  const canSend = !!date && !!time && (!products.length || !!product) && !!name.trim() && phone.replace(/\D/g, '').length >= 9 && consent

  const submit = async () => {
    if (!canSend || sending) return
    setSending(true); setErr('')
    try {
      const r = await fetch(`/api/booking/${encodeURIComponent(slug)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, time, product, name, phone, request, consent, from, website }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { setErr(d.error || '접수하지 못했어요. 잠시 뒤에 다시 해 주세요.'); return }
      setState('done')
      window.scrollTo({ top: 0 })
    } catch {
      setErr('인터넷 연결을 확인해 주세요.')
    } finally {
      setSending(false)
    }
  }

  const box = 'rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900'
  const label = 'mb-2 block text-sm font-bold text-gray-900 dark:text-white'
  const inp = 'w-full rounded-xl border border-gray-300 bg-white px-3 py-3 text-base text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-white'
  const chip = (on: boolean) => `rounded-xl border px-3 py-2 text-sm font-semibold transition-colors ${on ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-300 bg-white text-gray-800 hover:border-blue-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200'}`

  if (state === 'loading') return <main className="flex min-h-screen items-center justify-center bg-gray-50 text-sm text-gray-500 dark:bg-gray-950">불러오는 중...</main>
  if (state === 'missing' || !cfg) return <main className="flex min-h-screen items-center justify-center bg-gray-50 px-6 text-center text-sm text-gray-500 dark:bg-gray-950">지금은 예약을 받지 않는 페이지예요.</main>

  if (state === 'done') {
    const [, m, d] = date.split('-').map(Number)
    return (
      <main className="min-h-screen bg-gray-50 px-4 py-16 dark:bg-gray-950">
        <div className={`${box} mx-auto max-w-md text-center`}>
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-green-100 text-green-700"><Check className="h-6 w-6" /></div>
          <h1 className="text-lg font-bold text-gray-900 dark:text-white">예약 신청이 접수됐어요</h1>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
            {m}월 {d}일({WEEK[weekdayOf(date)]}) {timeLabel(time)}{product ? ` · ${product}` : ''}
          </p>
          <p className="mt-3 text-sm text-gray-600 dark:text-gray-400">확인 후 <b>{phone}</b>(으)로 연락드릴게요.</p>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-gray-50 px-4 pb-16 pt-8 dark:bg-gray-950">
      <div className="mx-auto max-w-md space-y-3">
        <header className="px-1 pb-1">
          <h1 className="flex items-center gap-2 text-xl font-bold text-gray-900 dark:text-white"><CalendarCheck className="h-5 w-5 text-blue-600" />{cfg.title}</h1>
          {cfg.intro && <p className="mt-1 whitespace-pre-wrap text-sm text-gray-600 dark:text-gray-400">{cfg.intro}</p>}
        </header>

        <section className={box}>
          <span className={label}>1. 날짜</span>
          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
            {days.map(d => {
              const [, m, dd] = d.split('-').map(Number)
              const w = weekdayOf(d)
              return (
                <button key={d} type="button" onClick={() => setDate(d)} className={`${chip(date === d)} flex shrink-0 flex-col items-center px-3`}>
                  <span className={`text-[11px] ${date === d ? 'text-white/80' : w === 0 ? 'text-rose-500' : w === 6 ? 'text-blue-500' : 'text-gray-500'}`}>{WEEK[w]}</span>
                  <span>{m}/{dd}</span>
                </button>
              )
            })}
            {days.length === 0 && <p className="text-sm text-gray-500">지금은 고를 수 있는 날짜가 없어요.</p>}
          </div>
        </section>

        <section className={box}>
          <span className={label}>2. 시간</span>
          {date ? (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {slots.map(t => <button key={t} type="button" onClick={() => setTime(t)} className={chip(time === t)}>{timeLabel(t)}</button>)}
            </div>
          ) : <p className="text-sm text-gray-400">날짜를 먼저 골라 주세요</p>}
        </section>

        {products.length > 0 && (
          <section className={box}>
            <span className={label}>3. 상품</span>
            <div className="space-y-2">
              {products.map(p => (
                <button key={p.name} type="button" onClick={() => setProduct(p.name)}
                  className={`${chip(product === p.name)} flex w-full items-center justify-between py-3 text-left`}>
                  <span>{p.name}</span>{p.price != null && <span className={product === p.name ? 'text-white/90' : 'text-gray-500'}>{won(p.price)}</span>}
                </button>
              ))}
            </div>
          </section>
        )}

        <section className={`${box} space-y-3`}>
          <span className={label}>{products.length ? '4' : '3'}. 연락처</span>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="이름" autoComplete="name" className={inp} />
          <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="휴대폰 번호" type="tel" inputMode="tel" autoComplete="tel" className={inp} />
          <textarea value={request} onChange={e => setRequest(e.target.value)} rows={3} placeholder="요청사항 (색감, 리본 문구, 예산 등)" className={inp} />
          {/* 로봇만 채우는 칸 — 사람에겐 안 보인다 */}
          <input value={website} onChange={e => setWebsite(e.target.value)} tabIndex={-1} autoComplete="off" aria-hidden className="absolute -left-[9999px] h-0 w-0 opacity-0" />
          <label className="flex items-start gap-2 rounded-xl bg-gray-50 p-3 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-400">
            <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} className="mt-0.5 h-4 w-4" />
            <span><b className="text-gray-800 dark:text-gray-200">개인정보 수집·이용 동의 (필수)</b><br />이름·연락처를 예약 확인과 연락에만 씁니다. 원하시면 언제든 지워 드려요.</span>
          </label>
        </section>

        {err && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{err}</p>}
        <button type="button" onClick={submit} disabled={!canSend || sending}
          className="w-full rounded-2xl bg-blue-600 py-4 text-base font-bold text-white hover:bg-blue-700 disabled:opacity-40">
          {sending ? '보내는 중...' : '예약 신청'}
        </button>
        {!canSend && <p className="text-center text-xs text-gray-400">날짜·시간{products.length ? '·상품' : ''}·이름·연락처를 고르고 동의하면 신청할 수 있어요</p>}
      </div>
    </main>
  )
}
