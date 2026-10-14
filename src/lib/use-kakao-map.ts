'use client'

/**
 * 카카오맵 JavaScript SDK 로더 훅.
 *
 * 동작:
 * 1. window.kakao.maps 가 이미 있으면 즉시 ready
 * 2. <script data-kakao-map> 가 이미 있으면 로드 완료 대기(poll)
 * 3. 없으면 새 <script> 주입 후 onload → kakao.maps.load(autoload=false)
 *
 * - 키는 NEXT_PUBLIC_KAKAO_MAP_KEY 환경변수 사용 (없으면 error)
 * - libraries=services,clusterer 둘 다 로드
 * - 상태: 'idle' | 'loading' | 'ready' | 'error'
 * - error 사유는 errorReason 으로 노출 (no-key / load-failed / domain-not-allowed)
 *
 * 도메인 미등록 시 카카오는 콘솔 에러만 찍고 onerror 안 부르는 경우가 있어
 * 타임아웃(10초) 안에 ready 안 되면 'load-failed' 로 surface.
 *
 * enabled=false 면 아무것도 받지 않고 'idle' — 매물장처럼 지도를 열 때만 필요한 화면은
 * 목록만 보는 사람에게 SDK(스크립트 4개, ~60KB gz)를 안 받게 한다. 한 번 받은 window.kakao 는 남는다.
 */

import { useEffect, useState } from 'react'

type Status = 'idle' | 'loading' | 'ready' | 'error'
type ErrorReason = 'no-key' | 'load-failed' | null

const KAKAO_KEY = process.env.NEXT_PUBLIC_KAKAO_MAP_KEY ?? ''
const TIMEOUT_MS = 10_000

export function useKakaoMapSdk(enabled = true) {
  const [status, setStatus] = useState<Status>('idle')
  const [errorReason, setErrorReason] = useState<ErrorReason>(null)

  useEffect(() => {
    if (!enabled) return
    if (typeof window === 'undefined') return
    if (!KAKAO_KEY) {
      setStatus('error')
      setErrorReason('no-key')
      return
    }

    const w = window as any

    // maps.load 콜백까지 끝나야 진짜 ready. (CSP 등으로 2단계 스크립트가 막히면 콜백이 영영 안 와서
    // 'loading' 에 갇힌다 → 타임아웃은 window.kakao.maps.load 존재가 아니라 이 플래그로 판단)
    let done = false
    const markReady = () => {
      done = true
      setStatus('ready')
      setErrorReason(null)
    }

    const onReady = () => {
      w.kakao.maps.load(markReady)
    }

    // 이미 로드된 경우
    if (w.kakao?.maps?.load) {
      onReady()
      return
    }

    setStatus('loading')

    // 스크립트 태그 이미 있음 → poll
    const existing = document.querySelector<HTMLScriptElement>('script[data-kakao-map]')
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    if (existing) {
      const poll = setInterval(() => {
        if (cancelled) { clearInterval(poll); return }
        if (w.kakao?.maps?.load) { clearInterval(poll); onReady() }
      }, 100)
      timer = setTimeout(() => {
        cancelled = true
        clearInterval(poll)
        if (!done) {
          setStatus('error')
          setErrorReason('load-failed')
        }
      }, TIMEOUT_MS)
      return () => {
        cancelled = true
        clearInterval(poll)
        if (timer) clearTimeout(timer)
      }
    }

    // 새 스크립트 주입
    const script = document.createElement('script')
    script.setAttribute('data-kakao-map', 'true')
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${KAKAO_KEY}&libraries=services,clusterer&autoload=false`
    script.async = true
    script.onload = () => {
      if (cancelled) return
      if (w.kakao?.maps?.load) onReady()
      else { setStatus('error'); setErrorReason('load-failed') }
    }
    script.onerror = () => {
      if (cancelled) return
      setStatus('error')
      setErrorReason('load-failed')
    }
    document.head.appendChild(script)

    timer = setTimeout(() => {
      cancelled = true
      if (!done) {
        setStatus('error')
        setErrorReason('load-failed')
      }
    }, TIMEOUT_MS)

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [enabled])

  return { status, errorReason, ready: status === 'ready' }
}
