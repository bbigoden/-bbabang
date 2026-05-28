'use client'

import { useEffect, useRef, useState } from 'react'
import {
  Video, Loader2, Download, RefreshCw, AlertTriangle, FileVideo, FileText,
} from 'lucide-react'
import { FFmpeg } from '@ffmpeg/ffmpeg'
import { toBlobURL } from '@ffmpeg/util'
import { useToast } from '@/components/toast'

interface BRollClip {
  id: number
  duration: number
  poster: string
  downloadUrl: string
  width: number
  height: number
}
interface BRollResult {
  keyword: string
  englishQuery: string
  clips: BRollClip[]
}

type Phase = 'idle' | 'searching' | 'loading_ffmpeg' | 'downloading' | 'rendering' | 'done' | 'error'

interface Props {
  scriptId: string
  voiceoverText: string
  bRollKeywords: string[]
  audioUrl: string | null  // 음성 생성 완료된 blob URL (없으면 비활성)
  category: string
}

export function VideoBox({ scriptId, voiceoverText, bRollKeywords, audioUrl, category }: Props) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [progressMsg, setProgressMsg] = useState<string>('')
  const [progressPct, setProgressPct] = useState<number>(0)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const ffmpegRef = useRef<any>(null)
  const generatedUrlsRef = useRef<string[]>([])
  const toast = useToast()

  useEffect(() => {
    const urls = generatedUrlsRef.current
    return () => { urls.forEach(u => URL.revokeObjectURL(u)) }
  }, [])

  const generate = async () => {
    if (!audioUrl) {
      toast.error('먼저 「음성 만들기」로 더빙 음성을 생성해주세요')
      return
    }
    setErrorMsg(null)
    setProgressPct(0)

    try {
      // 1) Pexels 자료화면 검색
      setPhase('searching')
      setProgressMsg('자료화면 검색 중...')
      const brRes = await fetch('/api/admin/shorts/b-roll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keywords: bRollKeywords }),
      })
      if (!brRes.ok) {
        const j = await brRes.json().catch(() => ({}))
        throw new Error(j?.message ?? j?.error ?? 'b-roll 검색 실패')
      }
      const brJson = (await brRes.json()) as { results: BRollResult[] }
      const allClips = brJson.results.flatMap(r => r.clips)
      if (allClips.length === 0) {
        throw new Error('자료화면을 찾지 못했어요. 다시 시도해주세요.')
      }
      // 최대 5개까지만 사용 (다운로드/렌더 시간 절약)
      const useClips = allClips.slice(0, 5)
      setProgressPct(15)

      // 2) FFmpeg.wasm lazy load (core wasm은 첫 클릭 시점에 unpkg에서 받음)
      setPhase('loading_ffmpeg')
      setProgressMsg('영상 엔진 로딩 중... (최초 1회 약 30MB 다운로드)')
      if (!ffmpegRef.current) {
        const ffmpeg = new FFmpeg()
        ffmpeg.on('progress', ({ progress }: { progress: number }) => {
          // 렌더링 단계에서만 의미있는 값
          if (phase === 'rendering' || (typeof progress === 'number' && progress > 0)) {
            const pct = Math.max(0, Math.min(100, Math.round(progress * 100)))
            setProgressPct(60 + Math.round(pct * 0.35))
            setProgressMsg(`영상 합성 중... ${pct}%`)
          }
        })
        // classWorkerURL을 명시해서 @ffmpeg/ffmpeg 내부의 동적 worker 생성을 우회
        // (Turbopack이 패키지 내부 dynamic import 분석 실패하는 케이스 회피)
        const coreBase = 'https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd'
        const ffmpegBase = 'https://unpkg.com/@ffmpeg/ffmpeg@0.12.15/dist/esm'
        await ffmpeg.load({
          classWorkerURL: await toBlobURL(`${ffmpegBase}/worker.js`, 'text/javascript'),
          coreURL: await toBlobURL(`${coreBase}/ffmpeg-core.js`, 'text/javascript'),
          wasmURL: await toBlobURL(`${coreBase}/ffmpeg-core.wasm`, 'application/wasm'),
        })
        ffmpegRef.current = ffmpeg
      }
      const ffmpeg = ffmpegRef.current
      setProgressPct(35)

      // 3) 음성 + 자료화면 다운로드
      setPhase('downloading')
      setProgressMsg(`자료화면 ${useClips.length}개 다운로드 중...`)
      const audioBuf = new Uint8Array(await (await fetch(audioUrl)).arrayBuffer())
      await ffmpeg.writeFile('audio.mp3', audioBuf)

      const clipNames: string[] = []
      const clipErrors: string[] = []
      for (let i = 0; i < useClips.length; i++) {
        const clip = useClips[i]
        try {
          // Pexels 직접 fetch는 CORS 차단 가능 → 빠방 서버 프록시 우회
          const proxyUrl = `/api/admin/shorts/b-roll-proxy?url=${encodeURIComponent(clip.downloadUrl)}`
          const res = await fetch(proxyUrl)
          if (!res.ok) {
            clipErrors.push(`clip${i}: HTTP ${res.status}`)
            continue
          }
          const buf = new Uint8Array(await res.arrayBuffer())
          if (buf.byteLength === 0) {
            clipErrors.push(`clip${i}: empty`)
            continue
          }
          const name = `clip${i}.mp4`
          await ffmpeg.writeFile(name, buf)
          clipNames.push(name)
        } catch (e) {
          console.warn('[video-box] clip download failed', clip.id, e)
          clipErrors.push(`clip${i}: ${e instanceof Error ? e.message : 'fetch err'}`)
        }
        setProgressPct(35 + Math.round(((i + 1) / useClips.length) * 20))
      }
      if (clipNames.length === 0) {
        throw new Error(`자료화면 다운로드 0건. 상세: ${clipErrors.join(' | ').slice(0, 200)}`)
      }

      // 4) FFmpeg 합성: 자료화면들 concat → 9:16 crop → 음성 트랙 → mp4
      setPhase('rendering')
      setProgressPct(60)
      setProgressMsg('영상 합성 중... (수십 초 ~ 수 분 걸려요)')

      const filterParts: string[] = []
      const concatInputs: string[] = []
      clipNames.forEach((_, i) => {
        // 각 클립을 9:16로 crop+scale, 동일 fps로 강제 (concat 호환)
        filterParts.push(
          `[${i}:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,fps=30[v${i}]`
        )
        concatInputs.push(`[v${i}]`)
      })
      const concatFilter = `${concatInputs.join('')}concat=n=${clipNames.length}:v=1:a=0[catv];[catv]loop=loop=-1:size=32767:start=0[outv]`
      const filterComplex = filterParts.join(';') + ';' + concatFilter

      const ffmpegArgs: string[] = []
      clipNames.forEach(n => { ffmpegArgs.push('-i', n) })
      ffmpegArgs.push('-i', 'audio.mp3')
      ffmpegArgs.push('-filter_complex', filterComplex)
      ffmpegArgs.push('-map', '[outv]', '-map', `${clipNames.length}:a`)
      ffmpegArgs.push('-shortest')
      ffmpegArgs.push('-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28')
      ffmpegArgs.push('-c:a', 'aac', '-b:a', '128k')
      ffmpegArgs.push('-pix_fmt', 'yuv420p', '-r', '30')
      ffmpegArgs.push('-movflags', '+faststart')
      ffmpegArgs.push('output.mp4')

      await ffmpeg.exec(ffmpegArgs)
      setProgressPct(95)
      setProgressMsg('마무리 중...')

      // 5) 결과 읽기
      const data = await ffmpeg.readFile('output.mp4') as Uint8Array
      const videoBlob = new Blob([data.buffer as ArrayBuffer], { type: 'video/mp4' })
      const url = URL.createObjectURL(videoBlob)
      generatedUrlsRef.current.push(url)

      // 클린업
      for (const n of clipNames) {
        try { await ffmpeg.deleteFile(n) } catch {}
      }
      try { await ffmpeg.deleteFile('audio.mp3') } catch {}
      try { await ffmpeg.deleteFile('output.mp4') } catch {}

      setVideoUrl(url)
      setProgressPct(100)
      setPhase('done')
      toast.success('영상 생성 완료!')
    } catch (e) {
      console.error('[video-box] error', e)
      const errObj = e as { name?: string; message?: string; cause?: unknown }
      const parts = [
        errObj?.name && errObj.name !== 'Error' ? `[${errObj.name}]` : '',
        e instanceof Error ? e.message : String(e),
        errObj?.cause ? ` (cause: ${String(errObj.cause).slice(0, 100)})` : '',
      ].filter(Boolean).join(' ').trim()
      const detail = parts || `영상 생성 실패 (단계: ${phase})`
      setErrorMsg(detail)
      setPhase('error')
      toast.error(detail.slice(0, 100))
    }
  }

  const downloadMp4 = () => {
    if (!videoUrl) return
    const a = document.createElement('a')
    a.href = videoUrl
    a.download = `shorts-${category}-${scriptId}.mp4`.replace(/[^a-zA-Z0-9가-힣.\-]/g, '_')
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }

  const downloadSrt = () => {
    // 단순 SRT: voiceover 전체를 0초~30초 단일 자막으로 출력
    // (정확한 시간 분할은 차후 단계 — 사장님이 CapCut 등에서 미세 조정 가능)
    const srt = `1\n00:00:00,000 --> 00:00:30,000\n${voiceoverText}\n`
    const blob = new Blob([srt], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `shorts-${category}-${scriptId}.srt`.replace(/[^a-zA-Z0-9가-힣.\-]/g, '_')
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const isWorking = phase !== 'idle' && phase !== 'done' && phase !== 'error'

  return (
    <div className="rounded-xl border border-purple-500/30 bg-gradient-to-br from-purple-500/10 to-blue-500/5 p-4">
      <div className="mb-3 flex items-center gap-1.5 text-xs font-semibold text-purple-300">
        <Video className="h-3.5 w-3.5" />
        AI 영상 자동 합성 (Pexels 자료화면 + FFmpeg)
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
          <Video className="h-4 w-4" />
          영상 만들기 (자료화면 자동 검색 + 합성)
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
            * 사장님 브라우저에서 합성합니다 (서버 비용 0원). 탭 닫지 마세요.
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
          <video controls src={videoUrl} className="w-full rounded-lg bg-black" style={{ maxHeight: 360 }} />
          <div className="flex gap-2">
            <button
              onClick={downloadMp4}
              className="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-purple-600 px-3 py-2 text-xs font-semibold text-white hover:bg-purple-500 transition-colors"
            >
              <FileVideo className="h-3.5 w-3.5" />
              MP4 다운로드
            </button>
            <button
              onClick={downloadSrt}
              className="flex items-center justify-center gap-1.5 rounded-lg border border-purple-500/40 bg-purple-500/10 px-3 py-2 text-xs font-semibold text-purple-300 hover:bg-purple-500/20 transition-colors"
              title="CapCut 등에서 자막 입히기용"
            >
              <FileText className="h-3.5 w-3.5" />
              자막 SRT
            </button>
            <button
              onClick={() => { setVideoUrl(null); setPhase('idle') }}
              className="flex items-center justify-center gap-1.5 rounded-lg border border-purple-500/40 bg-purple-500/10 px-3 py-2 text-xs font-semibold text-purple-300 hover:bg-purple-500/20 transition-colors"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              다시
            </button>
          </div>
          <p className="text-[11px] text-gray-400">
            * 자막은 별도 SRT 파일. CapCut/유튜브 스튜디오에 영상+SRT 함께 올리면 자막 자동 적용됩니다.
          </p>
        </div>
      )}
    </div>
  )
}
