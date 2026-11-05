'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { todayKST, ymdKST, hmKST, addDays } from '@/lib/date-kst'

export interface Thread {
  id: string
  kind: 'group' | 'dm' | 'team'
  dm_key: string | null
  title: string | null
  office_broker_id: string
  notice_message_id: string | null
  created_at: string
}
export interface Msg {
  id: string
  thread_id: string
  sender_broker_id: string | null
  body: string
  image_url?: string | null
  image_paths?: string[] | null
  file_url?: string | null
  file_name?: string | null
  reply_to_id?: string | null
  deleted_at?: string | null
  bot_name?: string | null            // 등록 봇 답장(부소장등록 bot.py)
  edited_at?: string | null           // 보낸 뒤 고친 시각(edit_office_chat_message)
  mention_ids?: string[] | null       // 본문의 '@이름' 으로 태그한 사람
  created_at: string
  /** 화면에만 있는 표시 — 보내는 중(아직 저장 전)·못 보냄. DB 에는 없다 */
  pending?: 'sending' | 'failed'
}
export interface Member {
  id: string
  name: string
  status: string | null
  avatarPath: string | null
}
/** 내 멤버 행 — 읽은 시각·고정·알림 끄기 */
export interface MyRow {
  last_read_at: string | null
  pinned_at: string | null
  muted: boolean
}

// 카톡 공감 여섯 가지. DB 에는 키만 둔다(check 제약과 같은 목록)
export const REACTIONS = [
  { key: 'heart', emoji: '❤️', label: '하트' },
  { key: 'like', emoji: '👍', label: '좋아요' },
  { key: 'check', emoji: '✅', label: '체크' },
  { key: 'smile', emoji: '😆', label: '웃겨요' },
  { key: 'surprise', emoji: '😮', label: '놀라워요' },
  { key: 'sad', emoji: '😢', label: '슬퍼요' },
] as const
export type ReactionKey = typeof REACTIONS[number]['key']
export const reactionEmoji = (k: string) => REACTIONS.find(r => r.key === k)?.emoji ?? '❤️'

// 날짜·시각은 한국 기준(AGENTS.md) — 서버·폰 시간대가 달라도 같은 날로 읽힌다
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']
const weekday = (ymd: string) => {
  const [y, m, d] = ymd.split('-').map(Number)
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
}
/** 채팅 목록 시각: 오늘은 오전/오후 시:분, 어제는 '어제', 그 전은 월/일 */
export const listTimeLabel = (iso: string) => {
  const ymd = ymdKST(iso)
  const today = todayKST()
  if (ymd === today) return ampm(iso)
  if (ymd === addDays(today, -1)) return '어제'
  const [y, m, d] = ymd.split('-').map(Number)
  return ymd.slice(0, 4) === today.slice(0, 4) ? `${m}월 ${d}일` : `${y}. ${m}. ${d}.`
}
/** 말풍선 옆 시각: 오후 3:05 */
export const ampm = (iso: string) => {
  const [h, mm] = hmKST(iso).split(':').map(Number)
  if (Number.isNaN(h)) return ''
  return `${h < 12 ? '오전' : '오후'} ${h % 12 === 0 ? 12 : h % 12}:${String(mm).padStart(2, '0')}`
}
/** 날짜 구분선: 2026년 11월 2일 월요일 */
export const dayDivider = (iso: string) => {
  const ymd = ymdKST(iso)
  const [y, m, d] = ymd.split('-').map(Number)
  return `${y}년 ${m}월 ${d}일 ${weekday(ymd)}요일`
}

export const imagesOf = (m: Msg): string[] =>
  m.image_paths?.length ? m.image_paths : m.image_url ? [m.image_url] : []

export const previewText = (m: Pick<Msg, 'body' | 'image_url' | 'image_paths' | 'file_url' | 'file_name' | 'deleted_at'>) => {
  if (m.deleted_at) return '삭제된 메세지입니다.'
  const n = m.image_paths?.length ?? (m.image_url ? 1 : 0)
  if (n > 1) return `사진 ${n}장`
  if (n === 1) return '사진'
  if (m.file_url) return m.file_name || '파일'
  return m.body
}

export { shrinkImage } from '@/lib/shrink-image'

/** 실패 안내 꼬리말 — 'TypeError: Failed to fetch' 같은 영어 원문 대신 할 일을 알려 준다 */
export const whyFailed = (e: unknown) => {
  const m = e instanceof Error ? e.message
    : e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : String(e ?? '')
  return /fetch|network|timeout|load failed/i.test(m) ? '인터넷 연결을 확인해 주세요' : '잠시 후 다시 해 주세요'
}

export const URL_RE = /https?:\/\/[^\s<>"']+/g
/** 말풍선 속 전화번호 — 010-1234-5678 · 01012345678 · 041-123-4567 · 0507-1379-1665 · 1588-1234 */
export const PHONE_RE = /(?<![\d-])(?:0\d{1,3}[-. ]?\d{3,4}[-. ]?\d{4}|1[5-9]\d{2}-?\d{4})(?![\d-])/g
export const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, '')}`

// 첨부 버킷은 비공개 — DB에는 경로만 저장하고 렌더 시 서명 URL로 연다.
// 과거 메시지는 public URL 전체가 저장돼 있으므로 경로를 추출해 호환.
export const CHAT_BUCKET = 'office-chat-images'
export const chatStoragePath = (v: string | null | undefined): string | null => {
  if (!v) return null
  if (!v.startsWith('http')) return v
  const marker = `/${CHAT_BUCKET}/`
  const i = v.indexOf(marker)
  return i >= 0 ? decodeURIComponent(v.slice(i + marker.length).split('?')[0]) : null
}

// 서명 URL 은 화면 여러 곳(목록 프로필·대화·서랍)이 같은 경로를 쓰므로 모듈에 한 벌만 둔다.
// 24시간 유효라 한 번 받은 것은 폰에 적어 두고 앱을 다시 켜도 쓴다 — 주소가 같아야 폰이 이미 받은
// 사진을 다시 내려받지 않는다. 앱을 켤 때마다 새 주소를 받아 같은 사진을 매번 다시 받았다(2026-11-05).
// 남은 시간이 3시간 아래면 버리고 새로 받는다(오래 켜 둔 화면에서 사진이 깨지지 않게).
const SIGN_SECONDS = 60 * 60 * 24
const SIGN_STORE = 'oc-signed-v1'
const SIGN_MIN_LEFT_MS = 3 * 3600_000
const signedAt: Record<string, number> = {}   // 경로 → 만료 시각(ms)
const signed: Record<string, string> = (() => {
  const out: Record<string, string> = {}
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(SIGN_STORE) : null
    const saved = raw ? (JSON.parse(raw) as Record<string, [string, number]>) : {}
    const now = Date.now()
    for (const [p, [url, exp]] of Object.entries(saved)) {
      if (exp - now > SIGN_MIN_LEFT_MS) { out[p] = url; signedAt[p] = exp }
    }
  } catch { /* 저장소를 못 쓰는 폰이면 예전처럼 매번 받는다 */ }
  return out
})()
const saveSigned = () => {
  try {
    localStorage.setItem(SIGN_STORE, JSON.stringify(
      Object.fromEntries(Object.entries(signed).filter(([p]) => signedAt[p]).map(([p, u]) => [p, [u, signedAt[p]]]))))
  } catch { /* 가득 찼거나 막힘 — 다음에 다시 받으면 된다 */ }
}
const pending = new Set<string>()
const listeners = new Set<() => void>()

/** 저장값(경로 또는 과거 public URL) 목록 → 열 수 있는 URL 맵(경로 키). 서명 전 경로는 맵에 없다 */
export function useSignedUrls(values: (string | null | undefined)[]): Record<string, string> {
  const [, bump] = useState(0)
  const key = values.map(v => chatStoragePath(v) ?? '').join('|')

  useEffect(() => {
    const l = () => bump(n => n + 1)
    listeners.add(l)
    return () => { listeners.delete(l) }
  }, [])

  useEffect(() => {
    const paths = Array.from(new Set(key.split('|'))).filter(p => p && !signed[p] && !pending.has(p))
    if (paths.length === 0) return
    paths.forEach(p => pending.add(p))
    const exp = Date.now() + SIGN_SECONDS * 1000
    createClient().storage.from(CHAT_BUCKET).createSignedUrls(paths, SIGN_SECONDS)
      .then(({ data }) => {
        for (const r of data ?? []) if (r.signedUrl && r.path) { signed[r.path] = r.signedUrl; signedAt[r.path] = exp }
        saveSigned()
      })
      .finally(() => {
        paths.forEach(p => pending.delete(p))
        listeners.forEach(l => l())
      })
  }, [key])

  return signed
}

/**
 * 보내는 중인 사진을 폰에 있는 그림(blob URL)으로 먼저 보여 준다 — 올리기가 끝나기 전에 말풍선이 뜬다.
 * 폰에 적어 두지는 않는다(signedAt 이 없어 saveSigned 가 거른다). 다음에 열 땐 서명 URL 을 새로 받는다.
 */
export function primeLocalUrl(path: string, blobUrl: string) {
  signed[path] = blobUrl
  listeners.forEach(l => l())
}

/** 저장값 → 열 수 있는 URL. 서명 전이면 null */
export const urlOf = (map: Record<string, string>, v: string | null | undefined): string | null => {
  const p = chatStoragePath(v)
  return p ? (map[p] ?? null) : null
}
