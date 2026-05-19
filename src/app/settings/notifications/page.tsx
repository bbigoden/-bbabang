'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Bell, BellOff, MessageCircle, Sparkles, Check, AlertCircle, Megaphone, MapPin, X } from 'lucide-react'
import { urlBase64ToUint8Array } from '@/lib/push'
import { RegionPicker, type RegionValue } from '@/components/region-picker'

type Prefs = {
  messages: boolean
  proposals: boolean
  matches: boolean
  announcements: boolean
}

const DEFAULT_PREFS: Prefs = { messages: true, proposals: true, matches: true, announcements: true }

const CATEGORIES: Array<{ key: keyof Prefs; label: string; desc: string; icon: React.ComponentType<{ className?: string }> }> = [
  { key: 'messages',      label: '새 메시지',     desc: '채팅 메시지가 도착하면 알려요',         icon: MessageCircle },
  { key: 'proposals',     label: '새 제안',       desc: '중개사 제안이나 매물 카드가 도착할 때', icon: Sparkles },
  { key: 'matches',       label: '매칭 알림',     desc: '내 조건에 맞는 매물이 등록될 때',       icon: Bell },
  { key: 'announcements', label: '공지·이벤트',   desc: '빠방 공지·업데이트 소식',               icon: Megaphone },
]

export default function SettingsNotificationsPage() {
  const supabase = createClient()
  const [user, setUser] = useState<{ id: string } | null>(null)
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  // 푸시 구독 상태
  const [pushSupported, setPushSupported] = useState(false)
  const [pushPermission, setPushPermission] = useState<NotificationPermission>('default')
  const [pushSubscribed, setPushSubscribed] = useState(false)
  const [pushBusy, setPushBusy] = useState(false)

  // 관심 지역 (중개사 전용)
  const [brokerId, setBrokerId] = useState<string | null>(null)
  const [regions, setRegions] = useState<RegionValue[]>([])
  const [regionMsg, setRegionMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  useEffect(() => {
    ;(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      setUser({ id: user.id })
      const { data: p } = await supabase.from('profiles').select('notification_preferences').eq('id', user.id).single()
      if (p?.notification_preferences) setPrefs({ ...DEFAULT_PREFS, ...p.notification_preferences })

      // 중개사면 broker_profile + alert_regions 가져오기
      const { data: bp } = await supabase
        .from('broker_profiles')
        .select('id, alert_regions')
        .eq('user_id', user.id)
        .maybeSingle()
      if (bp) {
        setBrokerId(bp.id)
        if (Array.isArray(bp.alert_regions)) setRegions(bp.alert_regions as RegionValue[])
      }

      setLoading(false)
    })()

    if (typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window) {
      setPushSupported(true)
      setPushPermission(Notification.permission)
      navigator.serviceWorker.ready
        .then(reg => reg.pushManager.getSubscription())
        .then(sub => setPushSubscribed(!!sub))
        .catch(() => {})
    }
  }, [])

  const saveAll = async (next: Prefs) => {
    if (!user) return
    setPrefs(next)
    setSaving(true); setMsg(null)
    const { error } = await supabase.from('profiles').update({ notification_preferences: next }).eq('id', user.id)
    setSaving(false)
    if (error) setMsg({ type: 'err', text: '저장 중 오류가 발생했습니다.' })
    else { setMsg({ type: 'ok', text: '저장됐습니다.' }); setTimeout(() => setMsg(null), 2000) }
  }

  const toggle = (k: keyof Prefs) => saveAll({ ...prefs, [k]: !prefs[k] })

  // 관심 지역 저장 (alert_regions JSONB 통째로 업데이트) — 실패 시 이전 값으로 롤백
  const saveRegions = async (next: RegionValue[]) => {
    if (!brokerId) return
    const prev = regions
    setRegions(next); setRegionMsg(null)
    const { error } = await supabase.from('broker_profiles').update({ alert_regions: next }).eq('id', brokerId)
    if (error) {
      console.error('[notifications] saveRegions failed', error)
      setRegions(prev)
      setRegionMsg({ type: 'err', text: '저장 중 오류가 발생했습니다.' })
    }
    else { setRegionMsg({ type: 'ok', text: '저장됐습니다.' }); setTimeout(() => setRegionMsg(null), 2000) }
  }
  const addRegion = (r: RegionValue) => {
    const key = `${r.sido}|${r.sigungu}|${r.dong}`
    if (regions.some(x => `${x.sido}|${x.sigungu}|${x.dong}` === key)) return
    saveRegions([...regions, r])
  }
  const removeRegion = (idx: number) => saveRegions(regions.filter((_, i) => i !== idx))
  const regionKeys = new Set(regions.map(r => `${r.sido}|${r.sigungu}|${r.dong}`))

  const enablePush = async () => {
    setPushBusy(true)
    try {
      const permission = await Notification.requestPermission()
      setPushPermission(permission)
      if (permission !== 'granted') { setPushBusy(false); return }
      const reg = await navigator.serviceWorker.ready
      const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
      if (!publicKey) throw new Error('VAPID 공개키 누락')
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
      })
      const json = sub.toJSON()
      const res = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys, userAgent: navigator.userAgent }),
      })
      if (res.ok) setPushSubscribed(true)
    } catch (e) {
      console.error('[push] enable failed', e)
    }
    setPushBusy(false)
  }

  const disablePush = async () => {
    setPushBusy(true)
    try {
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      if (sub) {
        await fetch(`/api/push/subscribe?endpoint=${encodeURIComponent(sub.endpoint)}`, { method: 'DELETE' })
        await sub.unsubscribe()
      }
      setPushSubscribed(false)
    } catch (e) {
      console.error('[push] disable failed', e)
    }
    setPushBusy(false)
  }

  if (loading) return <div className="flex items-center justify-center py-20"><div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" /></div>

  return (
    <div className="space-y-4">
      {/* 푸시 구독 마스터 토글 */}
      <div className="rounded-2xl border border-gray-200 bg-white p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-bold text-gray-900 flex items-center gap-2">
              {pushSubscribed ? <Bell className="h-4 w-4 text-blue-500" /> : <BellOff className="h-4 w-4 text-gray-400" />}
              브라우저 푸시 알림
            </h2>
            <p className="mt-1 text-xs text-gray-500">
              {!pushSupported && '이 브라우저는 푸시 알림을 지원하지 않아요.'}
              {pushSupported && pushPermission === 'denied' && '브라우저 알림이 차단되어 있어요. 주소창 옆 자물쇠 → 알림 → 허용으로 변경해주세요.'}
              {pushSupported && pushPermission !== 'denied' && (pushSubscribed
                ? '이 디바이스에서 알림을 받고 있어요'
                : '허용하면 이 디바이스로 알림이 와요')}
            </p>
          </div>
          {pushSupported && pushPermission !== 'denied' && (
            pushSubscribed
              ? <button onClick={disablePush} disabled={pushBusy}
                  className="rounded-xl border border-gray-200 px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors flex-shrink-0">
                  {pushBusy ? '해제 중...' : '해제'}
                </button>
              : <button onClick={enablePush} disabled={pushBusy}
                  className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50 transition-colors flex-shrink-0">
                  {pushBusy ? '설정 중...' : '허용하기'}
                </button>
          )}
        </div>
      </div>

      {/* 관심 지역 (중개사 전용) */}
      {brokerId && (
        <div className="rounded-2xl border border-gray-200 bg-white p-6">
          <h2 className="font-bold text-gray-900 mb-1 flex items-center gap-2">
            <MapPin className="h-4 w-4 text-blue-500" /> 관심 지역
          </h2>
          <p className="text-xs text-gray-500 mb-4">선택한 지역에서 새 고객 요청이 들어오면 알림을 받아요. 동·읍·면 단위까지 설정할 수 있어요.</p>

          {regions.length > 0 && (
            <ul className="mb-3 flex flex-wrap gap-2">
              {regions.map((r, i) => (
                <li key={`${r.sido}|${r.sigungu}|${r.dong}`}
                    className="flex items-center gap-1.5 rounded-full bg-blue-50 border border-blue-200 px-3 py-1.5 text-xs font-semibold text-blue-700">
                  <MapPin className="h-3 w-3" />
                  <span>{r.sido} {r.sigungu}{r.dong ? ` ${r.dong}` : ''}</span>
                  <button type="button" onClick={() => removeRegion(i)} className="text-blue-500 hover:text-blue-700 ml-0.5">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <RegionPicker
            placeholder="동·읍·면으로 검색해서 지역 추가 (예: 불당동, 강남, 영통)"
            selectedKeys={regionKeys}
            onPick={addRegion}
          />

          {regionMsg && (
            <div className={`mt-3 flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${regionMsg.type === 'ok' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
              {regionMsg.type === 'ok' ? <Check className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
              {regionMsg.text}
            </div>
          )}

          {regions.length === 0 && (
            <p className="mt-3 text-xs text-gray-400">
              아직 관심 지역이 없어요. 위 검색창에 동 이름을 입력해서 추가해주세요.
            </p>
          )}
        </div>
      )}

      {/* 카테고리별 토글 */}
      <div className="rounded-2xl border border-gray-200 bg-white p-6">
        <h2 className="font-bold text-gray-900 mb-1">카테고리</h2>
        <p className="text-xs text-gray-500 mb-4">어떤 종류의 알림을 받을지 선택해요</p>
        <ul className="divide-y divide-gray-100">
          {CATEGORIES.map(({ key, label, desc, icon: Icon }) => (
            <li key={key} className="flex items-center gap-4 py-3.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gray-50 text-gray-400 flex-shrink-0">
                <Icon className="h-4 w-4" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-800">{label}</p>
                <p className="text-xs text-gray-400 mt-0.5">{desc}</p>
              </div>
              <button onClick={() => toggle(key)} disabled={saving}
                role="switch" aria-checked={prefs[key]}
                className={`relative h-6 w-11 rounded-full transition-colors flex-shrink-0 ${prefs[key] ? 'bg-blue-600' : 'bg-gray-300'}`}>
                <span className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${prefs[key] ? 'translate-x-5' : 'translate-x-0'}`} />
              </button>
            </li>
          ))}
        </ul>
        {msg && (
          <div className={`mt-4 flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${msg.type === 'ok' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
            {msg.type === 'ok' ? <Check className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
            {msg.text}
          </div>
        )}
      </div>
    </div>
  )
}
