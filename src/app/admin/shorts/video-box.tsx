'use client'

import { useEffect, useRef, useState } from 'react'
import {
  Video, Loader2, Download, RefreshCw, AlertTriangle, Sparkles,
} from 'lucide-react'
import { useToast } from '@/components/toast'

type Phase = 'idle' | 'uploading' | 'rendering' | 'done' | 'error'

interface Props {
  scriptId: string
  voiceoverText: string
  bRollKeywords: string[]
  audioUrl: string | null  // 음성 blob URL (없으면 비활성)
  category: string
}

interface RenderResp {
  status: 'succeeded' | 'failed' | 'planned' | 'waiting' | 'transcribing' | 'rendering'
  url?: string
  renderId?: string
  audioUrl?: string
  error?: string
  message?: string
}

const POLL_INTERVAL_MS = 4000
const POLL_TIMEOUT_MS = 5 * 60 * 1000  // 최대 5분 polling

async function getAudioDuration(blobUrl: string): Promise<number> {
  return new Promise(resolve => {
    const audio = new Audio()
    audio.preload = 'metadata'
    audio.src = blobUrl
    const onLoad = () => {
      const d = Number.isFinite(audio.duration) ? audio.duration : 30
      audio.removeEventListener('loadedmetadata', onLoad)
      audio.removeEventListener('error', onErr)
      resolve(Math.max(5, Math.min(90, Math.round(d))))
    }
    const onErr = () => {
      audio.removeEventListener('loadedmetadata', onLoad)
      audio.removeEventListener('error', onErr)
      resolve(30)
    }
    audio.addEventListener('loadedmetadata', onLoad, { once: true })
    audio.addEventListener('error', onErr, { once: true })
    // 안전망: 5초 후에도 metadata 안 오면 기본값
    setTimeout(() => onErr(), 5000)
  })
}

export function VideoBox({ scriptId: _scriptId, voiceoverText, bRollKeywords, audioUrl, category }: Props) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [progressMsg, setProgressMsg] = useState<string>('')
  const [progressPct, setProgressPct] = useState<number>(0)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const pollAbortRef = useRef<boolean>(false)
  const toast = useToast()

  useEffect(() => {
    return () => { pollAbortRef.current = true }
  }, [])

  const startPolling = async (renderId: string) => {
    const start = Date.now()
    let last: RenderResp | null = null
    while (!pollAbortRef.current && Date.now() - start < POLL_TIMEOUT_MS) {
      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS))
      if (pollAbortRef.current) return
      try {
        const res = await fetch(`/api/admin/shorts/render?id=${renderId}`)
        const j = (await res.json()) as RenderResp
        last = j
        if (j.status === 'succeeded' && j.url) {
          setProgressPct(100)
          setVideoUrl(j.url)
          setPhase('done')
          toast.success('영상 생성 완료!')
          return
        }
        if (j.status === 'failed') {
          throw new Error(j.message ?? 'Creatomate render 실패')
        }
        // 진행 중 — 진행률을 시간 기반으로 추정 (20% → 95%)
        const elapsed = (Date.now() - start) / 1000
        const pct = Math.min(95, 25 + Math.round(elapsed * 1.5))
        setProgressPct(pct)
        setProgressMsg(`Creatomate 합성 중... (${j.status}, ${Math.round(elapsed)}초 경과)`)
      } catch (e) {
        console.error('[video-box] poll error', e)
        throw e
      }
    }
    throw new Error(`타임아웃 (5분 초과). renderId=${last?.renderId ?? renderId}`)
  }

  const generate = async () => {
    if (!audioUrl) {
      toast.error('먼저 「음성 만들기」로 더빙 음성을 생성해주세요')
      return
    }
    setErrorMsg(null)
    setProgressPct(0)
    setVideoUrl(null)
    pollAbortRef.current = false

    try {
      // 1) 음성 blob + duration 수집
      setPhase('uploading')
      setProgressMsg('음성 업로드 + 자료화면 검색 중...')
      setProgressPct(5)
      const audioBlob = await (await fetch(audioUrl)).blob()
      const audioDuration = await getAudioDuration(audioUrl)
      setProgressPct(10)

      // 2) form-data로 render API 호출
      const form = new FormData()
      form.append('audio', audioBlob, 'voice.mp3')
      form.append('voiceoverText', voiceoverText)
      form.append('bRollKeywords', JSON.stringify(bRollKeywords))
      form.append('audioDuration', String(audioDuration))
      form.append('category', category)

      setProgressMsg(`Creatomate 영상 합성 시작 (${audioDuration}초)...`)
      setProgressPct(20)
      setPhase('rendering')

      const res = await fetch('/api/admin/shorts/render', { method: 'POST', body: form })
      const j = (await res.json()) as RenderResp

      if (j.status === 'succeeded' && j.url) {
        setProgressPct(100)
        setVideoUrl(j.url)
        setPhase('done')
        toast.success('영상 생성 완료!')
        return
      }
      if (j.status === 'failed') {
        throw new Error(j.message ?? 'Creatomate render 실패')
      }
      if (!res.ok && res.status !== 202) {
        throw new Error(j.message ?? j.error ?? `HTTP ${res.status}`)
      }
      // 202 — 아직 처리 중, polling 시작
      if (!j.renderId) throw new Error('renderId 누락')
      setProgressMsg('Creatomate 합성 중... (보통 30초~2분)')
      await startPolling(j.renderId)
    } catch (e) {
      console.error('[video-box] error', e)
      const detail = e instanceof Error ? e.message : String(e)
      setErrorMsg(detail || '영상 생성 실패')
      setPhase('error')
      toast.error(detail.slice(0, 100))
    }
  }

  const download = () => {
    if (!videoUrl) return
    // Creatomate URL은 cross-origin이라 a.download 작동 안 함 → 새 탭으로 열기
    window.open(videoUrl, '_blank', 'noopener,noreferrer')
  }

  const isWorking = phase === 'uploading' || phase === 'rendering'

  return (
    <div className="rounded-xl border border-purple-500/30 bg-gradient-to-br from-purple-500/10 to-blue-500/5 p-4">
      <div className="mb-3 flex items-center gap-1.5 text-xs font-semibold text-purple-300">
        <Video className="h-3.5 w-3.5" />
        AI 영상 자동 합성 (Creatomate · 9:16 쇼츠)
      </div>

      {!audioUrl && phase === 'idle' && (
        <div className="rounded-lg border border-gray-700 bg-gray-900/50 px-3 py-2.5 text-center text-xs text-gray-500">
          먼저 위에서 「음성 만들기」를 해주세요
        </div>
      )}

      {audioUrl && phase === 'idle' && !videoUrl && (
        <button
          onClick={generate}
          className="w-full flex items-center justify-center gap-2 rounded-lg bg-purple-600 px-4 py-3 text-sm font-semibold text-white hover:bg-purple-500 transition-colors"
        >
          <Sparkles className="h-4 w-4" />
          영상 만들기 (자료화면 자동 + 자막 + 음성 합성)
        </button>
      )}

      {isWorking && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <Loader2 className="h-4 w-4 animate-spin" />
            {progressMsg}
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-gray-800">
            <div className="h-full bg-purple-500 transition-all" style={{ width: `${progressPct}%` }} />
          </div>
          <p className="text-[11px] text-gray-400">
            * Creatomate 서버에서 합성 중. 사장님 PC는 안 씁니다. 탭 닫지 마세요.
          </p>
        </div>
      )}

      {phase === 'error' && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2.5">
          <div className="flex items-start gap-2 text-xs">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-400" />
            <div className="flex-1">
              <p className="font-semibold text-red-300 mb-1">영상 생성 실패</p>
              <p className="text-red-200/80 break-all">{errorMsg}</p>
              <button
                onClick={() => { setPhase('idle'); setErrorMsg(null) }}
                className="mt-2 rounded-md bg-red-500/20 px-2 py-1 text-[11px] font-semibold text-red-300 hover:bg-red-500/30"
              >
                다시 시도
              </button>
            </div>
          </div>
        </div>
      )}

      {phase === 'done' && videoUrl && (
        <div className="space-y-2">
          <video controls src={videoUrl} className="w-full rounded-lg bg-black" style={{ maxHeight: 480 }} />
          <div className="flex gap-2">
            <button
              onClick={download}
              className="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-purple-600 px-3 py-2 text-xs font-semibold text-white hover:bg-purple-500 transition-colors"
            >
              <Download className="h-3.5 w-3.5" />
              MP4 다운로드 (새 탭)
            </button>
            <button
              onClick={() => { setVideoUrl(null); setPhase('idle') }}
              className="flex items-center justify-center gap-1.5 rounded-lg border border-purple-500/40 bg-purple-500/10 px-3 py-2 text-xs font-semibold text-purple-300 hover:bg-purple-500/20 transition-colors"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              다시 만들기
            </button>
          </div>
          <p className="text-[11px] text-gray-400">
            * MP4는 새 탭에서 열립니다. 우클릭 → 「다른 이름으로 비디오 저장」 으로 다운로드. 그대로 유튜브 스튜디오에 업로드 가능.
          </p>
        </div>
      )}
    </div>
  )
}
