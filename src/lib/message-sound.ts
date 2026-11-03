'use client'

/**
 * 앱을 보고 있을 때 새 메세지 알림음.
 * 앱이 닫혀 있거나 내려가 있으면 푸시 알림(휴대폰·PC 알림 소리)이 맡는다 — 여기는 화면이 떠 있을 때만.
 * 소리 파일 없이 WebAudio 로 '띵똥' 두 음을 낸다.
 */

const KEY = 'busojang_msg_sound'

let ctx: AudioContext | null = null
let openThreadId: string | null = null

/** 브라우저는 사용자가 한 번 누르기 전엔 소리를 막는다 — 첫 터치·클릭 때 소리 장치를 깨워 둔다 */
if (typeof window !== 'undefined') {
  const unlock = () => {
    try {
      ctx ??= new AudioContext()
      if (ctx.state === 'suspended') ctx.resume()
    } catch { /* noop */ }
  }
  window.addEventListener('pointerdown', unlock, { passive: true })
  window.addEventListener('keydown', unlock)
}

export function isMessageSoundOn(): boolean {
  try { return localStorage.getItem(KEY) !== 'off' } catch { return true }
}

export function setMessageSoundOn(on: boolean) {
  try { localStorage.setItem(KEY, on ? 'on' : 'off') } catch { /* noop */ }
}

/** 지금 화면에 펼쳐 둔 대화방 — 그 방 메세지는 눈으로 보고 있으니 울리지 않는다 */
export function setOpenOfficeThread(id: string | null) {
  openThreadId = id
}

export function shouldRingFor(threadId: string): boolean {
  if (typeof document === 'undefined' || document.visibilityState !== 'visible') return false
  if (threadId === openThreadId) return false
  return isMessageSoundOn()
}

export function playMessageSound() {
  try {
    ctx ??= new AudioContext()
    if (ctx.state === 'suspended') ctx.resume()
    const t0 = ctx.currentTime
    for (const [freq, at] of [[1046.5, 0], [784, 0.13]] as const) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.0001, t0 + at)
      gain.gain.exponentialRampToValueAtTime(0.25, t0 + at + 0.01)
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + 0.35)
      osc.connect(gain).connect(ctx.destination)
      osc.start(t0 + at)
      osc.stop(t0 + at + 0.4)
    }
  } catch { /* 소리 장치가 없으면 조용히 넘어간다 */ }
}
