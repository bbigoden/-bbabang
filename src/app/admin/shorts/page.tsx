'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '@/lib/auth-context'
import { useToast } from '@/components/toast'
import {
  Film, ArrowLeft, Sparkles, Copy, CheckCircle2, AlertTriangle,
  Megaphone, Mic, FileText, Hash, Image as ImageIcon, Tag, RefreshCw,
  Volume2, Download, Loader2,
} from 'lucide-react'
import { VideoBox } from './video-box'

interface VoiceState {
  loading: boolean
  url: string | null
}

interface ShortScript {
  id: string
  category: string
  title: string
  hook: string
  body: string
  cta: string
  voiceover: string
  b_roll_keywords: string[]
  hashtags: string[]
}

export default function AdminShortsPage() {
  const router = useRouter()
  const auth = useAuth()
  const toast = useToast()

  const [loading, setLoading] = useState(false)
  const [scripts, setScripts] = useState<ShortScript[]>([])
  const [demoMode, setDemoMode] = useState<boolean | null>(null)
  const [demoMessage, setDemoMessage] = useState<string | null>(null)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const [voiceMap, setVoiceMap] = useState<Record<string, VoiceState>>({})
  const voiceUrlsRef = useRef<string[]>([])

  useEffect(() => {
    if (auth.loading) return
    if (!auth.user) { router.push('/auth/login'); return }
    if (auth.profile?.role !== 'admin') { router.push('/'); return }
  }, [auth.loading, auth.user, auth.profile?.role, router])

  // 페이지 언마운트 시 blob URL 메모리 해제
  useEffect(() => {
    const urls = voiceUrlsRef.current
    return () => { urls.forEach(u => URL.revokeObjectURL(u)) }
  }, [])

  const generate = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/shorts/generate', { method: 'POST' })
      const json = await res.json()
      if (!res.ok) {
        toast.error(json?.error ?? '생성에 실패했어요')
        return
      }
      setScripts(json.scripts ?? [])
      setDemoMode(!!json.demo)
      setDemoMessage(json.message ?? null)
      if (json.demo) {
        toast.info('데모 대본을 표시 중입니다')
      } else {
        toast.success(`${json.scripts?.length ?? 0}개 대본 생성 완료`)
      }
    } catch (e) {
      toast.error('네트워크 오류가 발생했어요')
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  const copy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedKey(key)
      toast.success('복사 완료')
      setTimeout(() => setCopiedKey(prev => prev === key ? null : prev), 2000)
    } catch {
      toast.error('복사 실패 — 직접 선택해서 복사해주세요')
    }
  }

  const generateVoice = async (script: ShortScript) => {
    const scriptId = script.id
    // 기존 URL 정리
    setVoiceMap(prev => {
      const old = prev[scriptId]?.url
      if (old) {
        URL.revokeObjectURL(old)
        voiceUrlsRef.current = voiceUrlsRef.current.filter(u => u !== old)
      }
      return { ...prev, [scriptId]: { loading: true, url: null } }
    })
    try {
      const res = await fetch('/api/admin/shorts/voice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: script.voiceover }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        toast.error(json?.message ?? json?.error ?? '음성 생성에 실패했어요')
        setVoiceMap(prev => ({ ...prev, [scriptId]: { loading: false, url: null } }))
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      voiceUrlsRef.current.push(url)
      setVoiceMap(prev => ({ ...prev, [scriptId]: { loading: false, url } }))
      toast.success('음성 생성 완료')
    } catch (e) {
      console.error(e)
      toast.error('네트워크 오류로 음성 생성에 실패했어요')
      setVoiceMap(prev => ({ ...prev, [scriptId]: { loading: false, url: null } }))
    }
  }

  const downloadVoice = (script: ShortScript, url: string) => {
    const a = document.createElement('a')
    a.href = url
    a.download = `shorts-${script.category}-${script.id}.mp3`.replace(/[^a-zA-Z0-9가-힣.\-]/g, '_')
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }

  if (auth.loading || auth.profile?.role !== 'admin') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-950">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <header className="border-b border-gray-800 bg-gray-900 px-4 py-4 sm:px-6">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <Link href="/admin" aria-label="관리자 대시보드로 돌아가기" className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-gray-800 hover:bg-gray-700 transition-colors">
              <ArrowLeft className="h-4 w-4 text-gray-300" aria-hidden="true" />
            </Link>
            <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-pink-500/20">
              <Film className="h-5 w-5 text-pink-400" />
            </div>
            <div className="min-w-0">
              <h1 className="text-lg font-bold text-white truncate">쇼츠 공장</h1>
              <p className="text-xs text-gray-500 truncate">AI가 유튜브 쇼츠 대본을 자동 생성해요</p>
            </div>
          </div>

          <button
            onClick={generate}
            disabled={loading}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-pink-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-pink-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed sm:w-auto"
          >
            {loading ? (
              <>
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                생성 중...
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" />
                오늘의 쇼츠 5개 생성
              </>
            )}
          </button>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-3 py-4 sm:px-6 sm:py-8 space-y-6">

        {scripts.length === 0 && !loading && (
          <div className="rounded-2xl border border-gray-800 bg-gray-900 p-12 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-pink-500/10">
              <Film className="h-8 w-8 text-pink-400" />
            </div>
            <h2 className="mb-2 text-lg font-bold text-white">아직 생성된 대본이 없어요</h2>
            <p className="mb-6 text-sm text-gray-500">
              위 「오늘의 쇼츠 5개 생성」 버튼을 누르면<br />
              AI가 5개 카테고리의 부동산 쇼츠 대본을 만들어줍니다.
            </p>
            <div className="inline-block rounded-xl border border-gray-800 bg-gray-950 px-4 py-3 text-left">
              <p className="mb-1 text-[11px] font-semibold text-gray-500 uppercase tracking-wide">카테고리</p>
              <p className="text-xs text-gray-300">전세사기 · 원룸 화재 · 층간소음 · 계약서 함정 · 임대인 갑질</p>
            </div>
          </div>
        )}

        {demoMode && (
          <div className="rounded-2xl border border-yellow-500/30 bg-yellow-500/5 p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-yellow-400" />
              <div className="flex-1 text-sm">
                <p className="mb-1 font-semibold text-yellow-300">데모 모드로 동작 중</p>
                <p className="text-yellow-200/80 text-xs leading-relaxed">
                  {demoMessage ?? 'GEMINI_API_KEY 환경변수가 설정되지 않았어요.'}
                  <br />
                  실제 AI 자동 생성을 사용하려면 Vercel 프로젝트 설정에서 <code className="rounded bg-yellow-500/20 px-1.5 py-0.5 font-mono text-[11px] text-yellow-200">GEMINI_API_KEY</code>를 추가하세요.
                  키는 <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" className="underline hover:text-yellow-100">Google AI Studio</a>에서 무료로 발급받을 수 있어요.
                </p>
              </div>
            </div>
          </div>
        )}

        {scripts.map((script, idx) => (
          <article key={script.id} className="rounded-2xl border border-gray-800 bg-gray-900 overflow-hidden">
            {/* 카드 헤더 */}
            <div className="flex items-center justify-between border-b border-gray-800 bg-gray-900/80 px-6 py-4">
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-pink-500/20 text-sm font-black text-pink-400">
                  {idx + 1}
                </div>
                <div>
                  <span className="rounded-md bg-pink-500/15 px-2 py-0.5 text-[11px] font-semibold text-pink-300">
                    {script.category}
                  </span>
                </div>
              </div>
              <button
                onClick={() => copy(script.voiceover, `vo-${script.id}`)}
                className="flex items-center gap-1.5 rounded-lg bg-pink-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-pink-500 transition-colors"
              >
                {copiedKey === `vo-${script.id}` ? (
                  <><CheckCircle2 className="h-3.5 w-3.5" /> 복사됨</>
                ) : (
                  <><Copy className="h-3.5 w-3.5" /> 더빙 전체 복사</>
                )}
              </button>
            </div>

            <div className="p-6 space-y-4">
              {/* 음성 더빙 */}
              <VoiceBox
                script={script}
                state={voiceMap[script.id]}
                onGenerate={() => generateVoice(script)}
                onDownload={(url) => downloadVoice(script, url)}
              />

              {/* 영상 자동 합성 */}
              <VideoBox
                scriptId={script.id}
                voiceoverText={script.voiceover}
                bRollKeywords={script.b_roll_keywords}
                audioUrl={voiceMap[script.id]?.url ?? null}
                category={script.category}
              />

              {/* 제목 */}
              <ScriptRow icon={Tag} label="유튜브 제목" copyKey={`title-${script.id}`} copyText={script.title} copy={copy} copiedKey={copiedKey}>
                <p className="text-base font-bold text-white">{script.title}</p>
              </ScriptRow>

              {/* 후킹 */}
              <ScriptRow icon={Megaphone} label="후킹 (첫 3초)" copyKey={`hook-${script.id}`} copyText={script.hook} copy={copy} copiedKey={copiedKey}>
                <p className="text-sm font-semibold text-pink-200 leading-relaxed">{script.hook}</p>
              </ScriptRow>

              {/* 본문 */}
              <ScriptRow icon={FileText} label="본문 (15~20초)" copyKey={`body-${script.id}`} copyText={script.body} copy={copy} copiedKey={copiedKey}>
                <p className="text-sm text-gray-200 leading-relaxed whitespace-pre-line">{script.body}</p>
              </ScriptRow>

              {/* CTA */}
              <ScriptRow icon={Mic} label="마무리 CTA (5초)" copyKey={`cta-${script.id}`} copyText={script.cta} copy={copy} copiedKey={copiedKey}>
                <p className="text-sm text-gray-200 leading-relaxed">{script.cta}</p>
              </ScriptRow>

              {/* 자료화면 키워드 */}
              <ScriptRow icon={ImageIcon} label="자료화면 검색어" copyKey={`broll-${script.id}`} copyText={script.b_roll_keywords.join(', ')} copy={copy} copiedKey={copiedKey}>
                <div className="flex flex-wrap gap-1.5">
                  {script.b_roll_keywords.map((kw, i) => (
                    <span key={i} className="rounded-md bg-gray-800 px-2 py-1 text-xs text-gray-300">{kw}</span>
                  ))}
                </div>
              </ScriptRow>

              {/* 해시태그 */}
              <ScriptRow icon={Hash} label="해시태그" copyKey={`tags-${script.id}`} copyText={script.hashtags.join(' ')} copy={copy} copiedKey={copiedKey}>
                <p className="text-xs text-blue-300 font-mono leading-relaxed">{script.hashtags.join(' ')}</p>
              </ScriptRow>
            </div>
          </article>
        ))}

        {scripts.length > 0 && (
          <div className="flex justify-center pt-2">
            <button
              onClick={generate}
              disabled={loading}
              className="flex items-center gap-2 rounded-xl border border-gray-700 bg-gray-900 px-4 py-2.5 text-sm font-semibold text-gray-300 hover:bg-gray-800 hover:text-white transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              5개 다시 생성
            </button>
          </div>
        )}

      </div>
    </div>
  )
}

function VoiceBox({
  script, state, onGenerate, onDownload,
}: {
  script: ShortScript
  state: VoiceState | undefined
  onGenerate: () => void
  onDownload: (url: string) => void
}) {
  const loading = state?.loading ?? false
  const url = state?.url ?? null

  return (
    <div className="rounded-xl border border-pink-500/30 bg-gradient-to-br from-pink-500/10 to-purple-500/5 p-4">
      <div className="mb-3 flex items-center gap-1.5 text-xs font-semibold text-pink-300">
        <Volume2 className="h-3.5 w-3.5" />
        AI 더빙 음성 (ElevenLabs · Adam Voice)
      </div>

      {!url && !loading && (
        <button
          onClick={onGenerate}
          className="w-full flex items-center justify-center gap-2 rounded-lg bg-pink-600 px-4 py-3 text-sm font-semibold text-white hover:bg-pink-500 transition-colors"
        >
          <Mic className="h-4 w-4" />
          이 대본으로 음성 만들기 ({script.voiceover.length}자)
        </button>
      )}

      {loading && (
        <div className="flex items-center justify-center gap-2 rounded-lg bg-pink-600/50 px-4 py-3 text-sm font-semibold text-white">
          <Loader2 className="h-4 w-4 animate-spin" />
          음성 생성 중... (5~15초)
        </div>
      )}

      {url && !loading && (
        <div className="space-y-2">
          <audio controls src={url} className="w-full h-10" />
          <div className="flex gap-2">
            <button
              onClick={() => onDownload(url)}
              className="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-pink-600 px-3 py-2 text-xs font-semibold text-white hover:bg-pink-500 transition-colors"
            >
              <Download className="h-3.5 w-3.5" />
              MP3 다운로드
            </button>
            <button
              onClick={onGenerate}
              className="flex items-center justify-center gap-1.5 rounded-lg border border-pink-500/40 bg-pink-500/10 px-3 py-2 text-xs font-semibold text-pink-300 hover:bg-pink-500/20 transition-colors"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              다시 생성
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function ScriptRow({
  icon: Icon, label, children, copyKey, copyText, copy, copiedKey,
}: {
  icon: any
  label: string
  children: React.ReactNode
  copyKey: string
  copyText: string
  copy: (t: string, k: string) => void
  copiedKey: string | null
}) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-950/40 px-4 py-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-500">
          <Icon className="h-3.5 w-3.5" />
          {label}
        </div>
        <button
          onClick={() => copy(copyText, copyKey)}
          className="flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] text-gray-500 hover:bg-gray-800 hover:text-white transition-colors"
        >
          {copiedKey === copyKey ? (
            <><CheckCircle2 className="h-3 w-3 text-green-400" /> <span className="text-green-400">복사됨</span></>
          ) : (
            <><Copy className="h-3 w-3" /> 복사</>
          )}
        </button>
      </div>
      <div>{children}</div>
    </div>
  )
}
