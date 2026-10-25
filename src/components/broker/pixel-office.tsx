'use client'

/**
 * 사무실 화면의 픽셀 사무실 — 한 층짜리 진짜 사무실처럼 그린다.
 *
 *   ┌ 창문 ── 시계 ── 화이트보드 ─────────────────────────────────┐
 *   │ 대표실   │ 협력업체 ┊ Claude 연구실      │ 서버실(사무실 일꾼) │
 *   ├──문──────┴──────문─────────────문───────┴────문─────────────┤
 *   │ 이사실  │ 회의 ┊ 상담실 │ 홍보부(채널 로봇) │ 등록실       │
 *   ├──문─────┴──────문───────┴──────문──────────┴─────문─────────┤
 *   │ 영업부 (직원 책상)       │ 탕비실 │ 매물조사실(수집 로봇)    │
 *   └──────────────────────────┴────────┴──────────────────────────┘
 *   (┊ = 한 방 안의 유리 칸막이. 배치는 2026-10-25 사장님이 정함)
 *
 * 광고 PC 프로그램은 하나지만, 하는 일(카페·블로그·당근·회수·수집·뱅크)마다 로봇을 따로 앉혀
 * 지금 어느 일이 도는지 자리로 보이게 한다 — 그 나눔은 화면(page.tsx)이 걸린 일로 정한다.
 *
 * 그림은 전부 이 파일 안의 사각형으로 그린다(그림 파일 없음). 좌표 단위는 픽셀 하나이고
 * 512×288 판을 화면 폭에 맞춰 키운다. 휴대폰에선 글자가 너무 작아지므로 판을 960px 아래로
 * 줄이지 않고 옆으로 밀어 보게 하고, 누른 자리의 내용은 판 아래에 크게 다시 적는다.
 *
 * 상태는 몸짓으로 보인다:
 *   working  타자 치듯 들썩이고 모니터가 켜진다
 *   waiting  머리 위에 ! 와 노란 말풍선 (사장님 대답·허락을 기다림)
 *   idle     가만히 앉아 있다
 *   off      의자만 있는 빈자리 (일꾼 꺼짐·퇴근)
 */

import { useState } from 'react'

export type SeatState = 'working' | 'waiting' | 'idle' | 'off'
export type SeatKind = 'robot' | 'person' | 'claude'

export interface Seat {
  key: string
  kind: SeatKind
  name: string
  role?: string
  state: SeatState
  /** 말풍선 — 지금 하는 일 */
  say?: string | null
  /** 자세히 보기에 붙는 작은 줄 — 오늘 건수 등 */
  note?: string | null
  /** 사람마다 머리·옷 색을 달리한다 */
  tint?: number
  badge?: string
  /** 방금 끝낸 일 — 머리 위에 초록 '✓' 풍선으로 잠깐 띄운다 */
  flash?: string | null
}

export type RoomKey =
  | 'boss' | 'director' | 'meeting' | 'server'
  | 'sales' | 'promo' | 'research' | 'register'
  | 'consult' | 'partner' | 'pantry' | 'lab'

export interface OfficeLayout {
  /** 방마다 앉을 자리. 없는 방은 빈 방으로 그린다. */
  seats: Partial<Record<RoomKey, Seat[]>>
  /** 상담실 손님 수 — 오늘 업무일지에 적힌 상담 고객 */
  guests: number
  /** 화이트보드에 적을 줄 (서너 줄) */
  board: string[]
  /** 벽시계 HH:MM */
  clock: string
}

// ── 스프라이트 (글자 하나 = 픽셀 하나, '.' 은 비움) ────────────

const PERSON = [
  '....HHHHHH....',
  '...HHHHHHHH...',
  '...HSSSSSSH...',
  '...SSESSESS...',
  '...SSSSSSSS...',
  '....SSSSSS....',
  '.....SSSS.....',
  '...BBBBBBBB...',
  '..BBBBBBBBBB..',
  '..BBBBBBBBBB..',
  '..SBBBBBBBBS..',
]

const ROBOT = [
  '......AA......',
  '......AA......',
  '...GGGGGGGG...',
  '...GLLLLLLG...',
  '...GLCLLCLG...',
  '...GLLLLLLG...',
  '...GGGGGGGG...',
  '.....GGGG.....',
  '...DDDDDDDD...',
  '..GDDDDDDDDG..',
  '..GDDDDDDDDG..',
]

const CLAUDE = [
  '..............',
  '..............',
  '...OOOOOOOO...',
  '...OOOOOOOO...',
  '...OKOOOOKO...',
  '...OOOOOOOO...',
  '.OOOOOOOOOOOO.',
  '.OOOOOOOOOOOO.',
  '...OOOOOOOO...',
  '...OOOOOOOO...',
  '...O.O..O.O...',
]

const SPRITES: Record<SeatKind, string[]> = { person: PERSON, robot: ROBOT, claude: CLAUDE }

/** 직원마다 다른 머리·옷 — 같은 색이 나란히 앉으면 누가 누군지 헷갈린다. */
const PERSON_TINTS = [
  { H: '#3b2a20', B: '#2f5d8c' },
  { H: '#1f1f1f', B: '#c0504d' },
  { H: '#7a4a1e', B: '#4f8a4b' },
  { H: '#2b2b40', B: '#8a5ab3' },
  { H: '#5a3a2a', B: '#d08a2c' },
  { H: '#151515', B: '#2a8a8a' },
  { H: '#6b4423', B: '#b8507a' },
  { H: '#222233', B: '#5b6b7b' },
]

function paletteOf(kind: SeatKind, tint = 0): Record<string, string> {
  if (kind === 'robot') return { A: '#ef4444', G: '#6b7280', L: '#d1d5db', C: '#06b6d4', D: '#475569' }
  if (kind === 'claude') return { O: '#d97757', K: '#1f1f1f' }
  const t = PERSON_TINTS[tint % PERSON_TINTS.length]
  return { H: t.H, S: '#f2c9a0', E: '#1f1f1f', B: t.B }
}

/**
 * 글자 지도를 사각형으로. 이웃한 같은 색은 한 줄로 묶어 사각형 수를 줄인다.
 * blink 를 주면 눈(E·K·C)을 그 색(눈꺼풀=피부색)으로 잠깐 덮어 깜빡이게 한다. delay 로 사람마다 때를 어긋낸다.
 */
function Sprite({ rows, palette, x, y, blink, delay = 0 }: {
  rows: string[]; palette: Record<string, string>; x: number; y: number; blink?: string; delay?: number
}) {
  const rects: React.ReactNode[] = []
  rows.forEach((row, r) => {
    let c = 0
    while (c < row.length) {
      const ch = row[c]
      let w = 1
      while (c + w < row.length && row[c + w] === ch) w++
      if (ch !== '.' && palette[ch]) {
        const eye = blink && (ch === 'E' || ch === 'K' || ch === 'C')
        rects.push(<rect key={`${r}-${c}`} x={x + c} y={y + r} width={w} height={1} fill={palette[ch]}
          className={eye ? 'pxo-eye' : undefined}
          style={eye ? { ['--eye' as string]: palette[ch], ['--lid' as string]: blink, animationDelay: `${delay}s` } : undefined} />)
      }
      c += w
    }
  })
  return <>{rects}</>
}

/** 자리마다 다른 수 — 깜빡임·움직임 때를 어긋내는 데 쓴다. */
const seed = (s: string) => [...s].reduce((n, ch) => (n * 31 + ch.charCodeAt(0)) % 9973, 7)

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

/** 판 위의 글자 — 바탕이 무엇이든 읽히게 흰 테를 두른다. */
function Label({ x, y, text, size = 4.2, color = '#1f2937', anchor = 'middle', weight = 800 }: {
  x: number; y: number; text: string; size?: number; color?: string; anchor?: 'start' | 'middle' | 'end'; weight?: number
}) {
  return (
    <text x={x} y={y} fontSize={size} fontWeight={weight} textAnchor={anchor} fill={color}
      stroke="#fffaf0" strokeWidth={1.1} paintOrder="stroke" style={{ fontFamily: 'inherit' }}>
      {text}
    </text>
  )
}

// ── 책상 한 자리 (26×28) ─────────────────────────────────

const DOT: Record<SeatState, string> = { working: '#0ea5e9', waiting: '#f59e0b', idle: '#22c55e', off: '#9ca3af' }

function Desk({ seat, x, y, big = false, picked, onPick }: {
  seat: Seat; x: number; y: number; big?: boolean; picked: boolean; onPick: () => void
}) {
  const on = seat.state !== 'off'
  const screen = seat.state === 'working' ? '#7dd3fc' : seat.state === 'waiting' ? '#fcd34d' : on ? '#334155' : '#1f2937'
  const w = big ? 34 : 26
  return (
    <g onClick={onPick} style={{ cursor: 'pointer' }}>
      {/* 누르기 쉽게 자리 전체를 잡는다 */}
      <rect x={x - 2} y={y - 4} width={w + 4} height={36} fill="transparent" />
      {picked && <rect x={x - 2} y={y - 2} width={w + 4} height={33} fill="none" stroke="#2563eb" strokeWidth={0.8} strokeDasharray="2 1" />}
      {/* 의자 */}
      <rect x={x + 3} y={y + 2} width={12} height={9} fill="#3f3f46" />
      <rect x={x + 4} y={y + 3} width={10} height={7} fill="#52525b" />
      {on && (
        <g className={seat.state === 'working' ? 'pxo-type' : undefined}>
          <Sprite rows={SPRITES[seat.kind]} palette={paletteOf(seat.kind, seat.tint)} x={x + 2} y={y}
            blink={seat.kind === 'person' ? '#f2c9a0' : seat.kind === 'claude' ? '#d97757' : '#d1d5db'}
            delay={(seed(seat.key) % 50) / 10} />
        </g>
      )}
      {/* 책상 상판·앞판 */}
      <rect x={x} y={y + 11} width={w} height={3} fill="#c8955f" />
      <rect x={x} y={y + 14} width={w} height={7} fill="#9a6b3f" />
      <rect x={x + 1} y={y + 15} width={w - 2} height={1} fill="#86592f" />
      {/* 키보드·머그 */}
      <rect x={x + 5} y={y + 11} width={7} height={1} fill="#e5e7eb" />
      {on && <rect x={x + 13} y={y + 9} width={2} height={2} fill={seat.kind === 'claude' ? '#f4a261' : '#f8fafc'} />}
      {/* 모니터 */}
      <rect x={x + w - 10} y={y + 3} width={9} height={7} fill="#111827" />
      <rect x={x + w - 9} y={y + 4} width={7} height={5} fill={screen} className={seat.state === 'working' ? 'pxo-blink' : undefined} />
      {/* 일하는 중이면 화면에 글줄이 차례로 찍힌다 */}
      {seat.state === 'working' && [0, 1, 2].map(i => (
        <rect key={i} x={x + w - 8} y={y + 4.8 + i * 1.4} width={[5, 3, 4][i]} height={0.7} fill="#0c4a6e"
          className="pxo-code" style={{ animationDelay: `${i * 0.4}s` }} />
      ))}
      <rect x={x + w - 7} y={y + 10} width={3} height={1} fill="#111827" />
      {big && <rect x={x + 15} y={y + 9} width={4} height={2} fill="#2f855a" />}
      {/* 이름판 */}
      <rect x={x + w / 2 - 1} y={y + 23.2} width={2} height={2} fill={DOT[seat.state]} transform={`translate(${-Math.min(seat.name.length, 7) * 2.1 - 2} 0)`} />
      <Label x={x + w / 2 + 1} y={y + 26} text={cut(seat.name, 7)} size={4} color={on ? '#111827' : '#6b7280'} />
      {seat.badge && (
        <>
          <rect x={x + w - 6} y={y - 1} width={8} height={4.5} fill="#111827" />
          <text x={x + w - 2} y={y + 2.4} fontSize={3.2} fontWeight={800} textAnchor="middle" fill="#fff">{seat.badge}</text>
        </>
      )}
    </g>
  )
}

/** 머리 위 말풍선. 일하거나 기다릴 때만 띄운다 — 다 띄우면 판이 말풍선으로 덮인다. */
function Bubble({ seat, x, y }: { seat: Seat; x: number; y: number }) {
  // 방금 끝낸 일이 있으면 그것부터 — 일이 끝나는 순간이 사무실에서 가장 볼 만하다.
  const done = !!seat.flash && seat.state !== 'working' && seat.state !== 'waiting'
  if (!done && (!seat.say || (seat.state !== 'working' && seat.state !== 'waiting'))) return null
  const text = cut(done ? seat.flash! : seat.say!, 12)
  const w = Math.max(14, text.length * 3.6 + 6)
  const waiting = seat.state === 'waiting'
  const tone = done ? { bg: '#dcfce7', line: '#15803d', ink: '#14532d' }
    : waiting ? { bg: '#fef3c7', line: '#b45309', ink: '#78350f' }
      : { bg: '#ffffff', line: '#1f2937', ink: '#111827' }
  const cx = x + 9
  return (
    <g className={done ? 'pxo-pop' : waiting ? 'pxo-bounce' : undefined} style={{ pointerEvents: 'none' }}>
      <rect x={cx - w / 2} y={y - 10} width={w} height={7} fill={tone.bg} stroke={tone.line} strokeWidth={0.6} />
      <rect x={cx - 1} y={y - 3} width={2} height={1.5} fill={tone.line} />
      <text x={cx} y={y - 5.2} fontSize={3.6} fontWeight={700} textAnchor="middle" fill={tone.ink}>
        {done ? `✓ ${text}` : waiting ? `! ${text}` : text}
      </text>
    </g>
  )
}

// ── 돌아다니는 것들 — 사무실이 멈춘 그림처럼 보이지 않게 ─────────

const CAT = [
  '.........K.K',
  'C.......CCCC',
  '.C......CWCW',
  '..CCCCCCCCC.',
  '..CCCCCCCC..',
]
const CAT_LEGS = ['..C.C...C.C.', '...C.C..C.C.']

/** 고양이 — 방 바닥을 오가다 멈춰 꼬리를 흔든다. */
function Cat({ x, y, span }: { x: number; y: number; span: number }) {
  const pal = { C: '#e8954a', K: '#c2410c', W: '#1f1f1f' }
  return (
    <g className="pxo-cat" style={{ ['--span' as string]: `${span}px` }}>
      <g transform={`translate(${x} ${y})`}>
        <Sprite rows={CAT} palette={pal} x={0} y={0} />
        <g className="pxo-step-a"><Sprite rows={[CAT_LEGS[0]]} palette={pal} x={0} y={5} /></g>
        <g className="pxo-step-b"><Sprite rows={[CAT_LEGS[1]]} palette={pal} x={0} y={5} /></g>
      </g>
    </g>
  )
}

/** 청소 로봇 — 바닥을 천천히 왕복하며 불이 깜빡인다. */
function Vacuum({ x, y, span }: { x: number; y: number; span: number }) {
  return (
    <g className="pxo-vacuum" style={{ ['--span' as string]: `${span}px` }}>
      <rect x={x + 1} y={y} width={8} height={1} fill="#4b5563" />
      <rect x={x} y={y + 1} width={10} height={3} fill="#6b7280" />
      <rect x={x + 1} y={y + 4} width={8} height={1} fill="#374151" />
      <rect x={x + 4} y={y + 1.5} width={2} height={1} fill="#22c55e" className="pxo-led" />
    </g>
  )
}

/** 시간대마다 창밖 하늘. 밤이면 별이 뜨고 사무실이 조금 어두워진다. */
function skyOf(clock: string) {
  const h = Number(clock.slice(0, 2))
  if (h >= 7 && h < 17) return { sky: '#9fd3f5', night: false }
  if (h >= 17 && h < 19) return { sky: '#f6a46b', night: false }
  if (h >= 5 && h < 7) return { sky: '#fcd9a8', night: false }
  return { sky: '#1e2a4a', night: true }
}

// ── 소품 ───────────────────────────────────────────────

function Plant({ x, y }: { x: number; y: number }) {
  return (
    <g>
      <rect x={x + 1} y={y + 7} width={6} height={5} fill="#a0522d" />
      <rect x={x} y={y + 6} width={8} height={2} fill="#8b4513" />
      <rect x={x + 2} y={y} width={4} height={7} fill="#2f855a" />
      <rect x={x} y={y + 2} width={3} height={4} fill="#38a169" />
      <rect x={x + 5} y={y + 1} width={3} height={4} fill="#48bb78" />
    </g>
  )
}

function Window({ x, sky = '#9fd3f5', night = false }: { x: number; sky?: string; night?: boolean }) {
  return (
    <g>
      <rect x={x} y={4} width={30} height={15} fill="#e2e8f0" />
      <rect x={x + 1.5} y={5.5} width={27} height={12} fill={sky} />
      {night
        ? [[4, 8], [11, 12], [20, 7], [24, 13]].map(([sx, sy]) => (
          <rect key={`${sx}-${sy}`} x={x + sx} y={sy} width={0.8} height={0.8} fill="#fef9c3" className="pxo-led" style={{ animationDelay: `${sx / 10}s` }} />
        ))
        : <rect x={x + 3} y={7} width={6} height={2} fill="#ffffff" opacity={0.85} className="pxo-cloud" />}
      <rect x={x + 14.25} y={5.5} width={1.5} height={12} fill="#e2e8f0" />
      <rect x={x} y={19} width={30} height={1.5} fill="#cbd5e1" />
    </g>
  )
}

function ServerRack({ x, y }: { x: number; y: number }) {
  return (
    <g>
      <rect x={x} y={y} width={10} height={22} fill="#1f2937" />
      {[0, 1, 2, 3, 4].map(i => (
        <g key={i}>
          <rect x={x + 1} y={y + 1 + i * 4} width={8} height={3} fill="#374151" />
          <rect x={x + 2} y={y + 2 + i * 4} width={1} height={1} fill={i % 2 ? '#22c55e' : '#38bdf8'} className="pxo-led" style={{ animationDelay: `${i * 0.37}s` }} />
          <rect x={x + 4} y={y + 2 + i * 4} width={4} height={1} fill="#4b5563" />
        </g>
      ))}
    </g>
  )
}

// ── 판 ─────────────────────────────────────────────────

const W = 512
const H = 288

type Floor = 'carpet' | 'oak' | 'wood' | 'parquet' | 'server' | 'lab' | 'tile' | 'green'

/**
 * 방(벽으로 둘러싼 칸). 자리 무리(RoomKey)와 따로 둔다 — 한 방에 두 무리가 앉는 곳이 있다
 * (협력업체 + Claude 연구실, 회의실 + 상담실 — 2026-10-25 사장님이 합침).
 */
type BoxKey = 'boss' | 'partnerLab' | 'server' | 'director' | 'meetConsult' | 'promo' | 'register' | 'sales' | 'pantry' | 'research'

interface RoomBox { key: BoxKey; label: string; x: number; y: number; w: number; h: number; floor: Floor; color: string }

/** 방 배치(사장님이 정한 순서). 좌표는 판 픽셀. 위 벽(창문)이 0~24 를 쓴다. */
const ROOMS: RoomBox[] = [
  { key: 'boss', label: '대표실', x: 0, y: 24, w: 120, h: 96, floor: 'carpet', color: '#1e3a8a' },
  { key: 'partnerLab', label: '협력업체 · Claude 연구실', x: 120, y: 24, w: 256, h: 96, floor: 'lab', color: '#6d28d9' },
  { key: 'server', label: '서버실', x: 376, y: 24, w: 136, h: 96, floor: 'server', color: '#0f172a' },
  { key: 'director', label: '이사실', x: 0, y: 120, w: 116, h: 88, floor: 'oak', color: '#14532d' },
  { key: 'meetConsult', label: '회의 · 상담실', x: 116, y: 120, w: 140, h: 88, floor: 'parquet', color: '#7c2d12' },
  { key: 'promo', label: '홍보부', x: 256, y: 120, w: 136, h: 88, floor: 'wood', color: '#be185d' },
  { key: 'register', label: '등록실', x: 392, y: 120, w: 120, h: 88, floor: 'lab', color: '#4338ca' },
  { key: 'sales', label: '영업부', x: 0, y: 208, w: 200, h: 80, floor: 'wood', color: '#1d4ed8' },
  { key: 'pantry', label: '탕비실', x: 200, y: 208, w: 80, h: 80, floor: 'tile', color: '#78350f' },
  { key: 'research', label: '매물조사실', x: 280, y: 208, w: 232, h: 80, floor: 'lab', color: '#0e7490' },
]

/** 문 — 벽 위에 문지방 색을 덧칠해 구멍을 낸다. */
const DOORS = [
  // 1·2줄 사이 벽
  { x: 50, y: 118, w: 18, h: 4 }, { x: 160, y: 118, w: 18, h: 4 }, { x: 300, y: 118, w: 18, h: 4 }, { x: 430, y: 118, w: 18, h: 4 },
  // 1줄 세로 벽
  { x: 118, y: 62, w: 4, h: 20 }, { x: 374, y: 70, w: 4, h: 20 },
  // 2줄 세로 벽
  { x: 114, y: 150, w: 4, h: 22 }, { x: 254, y: 150, w: 4, h: 22 }, { x: 390, y: 150, w: 4, h: 22 },
  // 2·3줄 사이 벽
  { x: 60, y: 206, w: 18, h: 4 }, { x: 226, y: 206, w: 18, h: 4 }, { x: 330, y: 206, w: 18, h: 4 }, { x: 440, y: 206, w: 18, h: 4 },
  // 3줄 세로 벽
  { x: 198, y: 238, w: 4, h: 20 }, { x: 278, y: 238, w: 4, h: 20 },
]

/** 자리 무리마다 어느 방 어디에 책상을 놓나: 첫 자리(dx, dy), 가로·세로 간격(sx, sy), 한 줄에 몇, 최대 몇. */
const SLOTS: Partial<Record<RoomKey, { box: BoxKey; dx: number; dy: number; sx: number; sy: number; cols: number; max: number; big?: boolean }>> = {
  boss: { box: 'boss', dx: 44, dy: 40, sx: 0, sy: 0, cols: 1, max: 1, big: true },
  partner: { box: 'partnerLab', dx: 8, dy: 20, sx: 38, sy: 34, cols: 2, max: 4 },
  lab: { box: 'partnerLab', dx: 94, dy: 22, sx: 40, sy: 34, cols: 4, max: 8 },
  server: { box: 'server', dx: 56, dy: 50, sx: 0, sy: 0, cols: 1, max: 1 },
  director: { box: 'director', dx: 42, dy: 32, sx: 0, sy: 0, cols: 1, max: 1, big: true },
  consult: { box: 'meetConsult', dx: 90, dy: 20, sx: 0, sy: 0, cols: 1, max: 1 },
  promo: { box: 'promo', dx: 14, dy: 20, sx: 60, sy: 34, cols: 2, max: 4 },
  register: { box: 'register', dx: 10, dy: 20, sx: 52, sy: 34, cols: 2, max: 4 },
  sales: { box: 'sales', dx: 12, dy: 20, sx: 46, sy: 30, cols: 4, max: 8 },
  research: { box: 'research', dx: 12, dy: 20, sx: 48, sy: 30, cols: 4, max: 8 },
}

/** 아무도 없어도 빈 책상을 두는 무리 — 비어 있어야 '방' 으로 보인다. */
const EMPTY_DESKS: Partial<Record<RoomKey, number>> = { sales: 4, promo: 4, research: 2, register: 2, partner: 2, lab: 4 }

const FLOOR_FILL: Record<Floor, string> = {
  carpet: 'url(#pxo-carpet)', oak: 'url(#pxo-oak)', wood: 'url(#pxo-wood)', parquet: 'url(#pxo-parquet)',
  server: 'url(#pxo-server)', lab: 'url(#pxo-lab)', tile: 'url(#pxo-tile)', green: 'url(#pxo-green)',
}

function EmptyDesk({ x, y }: { x: number; y: number }) {
  return (
    <g opacity={0.8}>
      <rect x={x + 3} y={y + 2} width={12} height={9} fill="#3f3f46" />
      <rect x={x} y={y + 11} width={26} height={3} fill="#c8955f" />
      <rect x={x} y={y + 14} width={26} height={7} fill="#9a6b3f" />
      <rect x={x + 16} y={y + 3} width={9} height={7} fill="#111827" />
    </g>
  )
}

function Bookshelf({ x, y, rows = 3 }: { x: number; y: number; rows?: number }) {
  const colors = ['#c0504d', '#2f5d8c', '#d08a2c', '#4f8a4b', '#8a5ab3']
  return (
    <g>
      <rect x={x} y={y} width={22} height={rows * 8} fill="#7c4a24" />
      {Array.from({ length: rows }, (_, r) => (
        <g key={r}>
          <rect x={x + 1} y={y + 1 + r * 8} width={20} height={6} fill="#5c3416" />
          {[0, 1, 2, 3, 4].map(b => <rect key={b} x={x + 2 + b * 4} y={y + 2 + r * 8} width={3} height={5} fill={colors[(b + r) % 5]} />)}
        </g>
      ))}
    </g>
  )
}

function Sofa({ x, y, w = 40, color = '#2f5d8c' }: { x: number; y: number; w?: number; color?: string }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={5} fill={color} />
      <rect x={x} y={y + 5} width={w} height={6} fill={color} opacity={0.85} />
      <rect x={x - 3} y={y + 2} width={4} height={10} fill={color} />
      <rect x={x + w - 1} y={y + 2} width={4} height={10} fill={color} />
    </g>
  )
}

/** 방마다 놓는 소품. 자리(책상)는 따로 그린다. */
function Decor({ room, guests, board }: { room: RoomBox; guests: number; board: string[] }) {
  const { x, y, w, h } = room
  switch (room.key) {
    case 'boss':
      return (
        <g>
          <Bookshelf x={x + 4} y={y + 14} />
          <rect x={x + 32} y={y + 34} width={58} height={36} fill="#1e3a8a" opacity={0.35} />
          <rect x={x + 34} y={y + 36} width={54} height={32} fill="none" stroke="#c9a227" strokeWidth={0.8} />
          <Sofa x={x + 62} y={y + 76} w={40} color="#1e3a8a" />
          <Plant x={x + 104} y={y + 12} />
          <Plant x={x + 6} y={y + 78} />
        </g>
      )
    case 'partnerLab':
      return (
        <g>
          {/* 왼쪽 협력업체 자리와 오른쪽 연구실 사이 낮은 유리 칸막이 */}
          <rect x={x + 86} y={y + 14} width={2} height={74} fill="#94a3b8" />
          <rect x={x + 86.5} y={y + 18} width={1} height={66} fill="#dbeafe" />
          <Label x={x + 44} y={y + 88} text="협력업체" size={3.6} color="#6d28d9" />
          <Label x={x + 170} y={y + 88} text="Claude 연구실" size={3.6} color="#9a3412" />
          <rect x={x + w - 18} y={y + 3} width={14} height={6} fill="#d97757" />
          <text x={x + w - 11} y={y + 7.4} fontSize={3.4} fontWeight={800} textAnchor="middle" fill="#fff">LAB</text>
        </g>
      )
    case 'director':
      return (
        <g>
          <Bookshelf x={x + 4} y={y + 12} rows={2} />
          <rect x={x + 92} y={y + 12} width={18} height={14} fill="#6b7280" />
          <rect x={x + 93} y={y + 13} width={16} height={12} fill="#9ca3af" />
          <rect x={x + 99} y={y + 14} width={4} height={5} fill="#facc15" />
          <rect x={x + 30} y={y + 26} width={58} height={46} fill="#9a3b3b" opacity={0.4} />
          <rect x={x + 46} y={y + 64} width={9} height={7} fill="#3f3f46" />
          <rect x={x + 64} y={y + 64} width={9} height={7} fill="#3f3f46" />
          <Plant x={x + 6} y={y + 70} />
          <Plant x={x + 100} y={y + 70} />
        </g>
      )
    case 'meetConsult':
      return (
        <g>
          {/* 왼쪽 회의 — 벽걸이 TV(오늘 숫자)와 긴 탁자 */}
          <rect x={x + 10} y={y + 12} width={46} height={18} fill="#111827" />
          <rect x={x + 12} y={y + 14} width={42} height={14} fill="#1e293b" />
          {board.slice(0, 3).map((l, i) => (
            <text key={l} x={x + 14} y={y + 18.5 + i * 4} fontSize={3.1} fontWeight={700} fill={['#93c5fd', '#fca5a5', '#86efac'][i]}>{cut(l, 17)}</text>
          ))}
          {[0, 1, 2, 3].map(i => <rect key={`t${i}`} x={x + 10 + i * 13} y={y + 38} width={8} height={6} fill="#3f3f46" />)}
          <rect x={x + 6} y={y + 44} width={56} height={18} fill="#8b5a2b" />
          <rect x={x + 7} y={y + 45} width={54} height={3} fill="#a87443" />
          {[0, 1, 2, 3].map(i => <rect key={`b${i}`} x={x + 10 + i * 13} y={y + 63} width={8} height={6} fill="#3f3f46" />)}
          {/* 오른쪽 상담 — 칸막이 너머 상담 책상과 손님 의자 */}
          <rect x={x + 76} y={y + 14} width={2} height={70} fill="#94a3b8" />
          <rect x={x + 76.5} y={y + 18} width={1} height={62} fill="#dbeafe" />
          {[0, 1].map(i => (
            <g key={i}>
              <rect x={x + 88 + i * 16} y={y + 50} width={12} height={9} fill="#3f3f46" />
              {i < guests && <Sprite rows={PERSON} palette={{ H: '#4b5563', S: '#f2c9a0', E: '#1f1f1f', B: '#9ca3af' }} x={x + 87 + i * 16} y={y + 44} />}
            </g>
          ))}
          <Label x={x + 108} y={y + 70} text={guests > 0 ? `오늘 상담 ${guests}명` : '상담'} size={3.6} color="#166534" />
          <Plant x={x + 124} y={y + 70} />
        </g>
      )
    case 'server':
      return (
        <g>
          {[4, 16, 28, 96, 108, 120].map(dx => <ServerRack key={dx} x={x + dx} y={y + 14} />)}
          <rect x={x + 46} y={y + 16} width={22} height={10} fill="#e5e7eb" />
          <text x={x + 57} y={y + 23} fontSize={3.4} fontWeight={800} textAnchor="middle" fill="#0f172a">UPS</text>
        </g>
      )
    case 'sales':
      return (
        <g>
          <Plant x={x + w - 14} y={y + h - 16} />
          {/* 프린터 */}
          <rect x={x + 150} y={y + h - 14} width={16} height={10} fill="#e5e7eb" />
          <rect x={x + 151} y={y + h - 13} width={14} height={3} fill="#9ca3af" />
        </g>
      )
    case 'promo':
      return (
        <g>
          {/* 게시판 — 붙인 광고 */}
          <rect x={x + 94} y={y + 3} width={36} height={13} fill="#c08457" />
          {[0, 1, 2].map(i => <rect key={i} x={x + 97 + i * 11} y={y + 5} width={8} height={9} fill={['#fde68a', '#bfdbfe', '#fbcfe8'][i]} />)}
          <Plant x={x + w - 14} y={y + h - 16} />
        </g>
      )
    case 'research':
      return (
        <g>
          {/* 벽 지도 */}
          <rect x={x + 150} y={y + 3} width={44} height={14} fill="#d1fae5" />
          <rect x={x + 154} y={y + 6} width={12} height={7} fill="#86efac" />
          <rect x={x + 168} y={y + 8} width={20} height={6} fill="#93c5fd" />
          <rect x={x + 176} y={y + 5} width={2} height={2} fill="#ef4444" />
          <Plant x={x + w - 14} y={y + h - 16} />
        </g>
      )
    case 'register':
      return (
        <g>
          {/* 서류함 */}
          <rect x={x + 98} y={y + 3} width={16} height={14} fill="#9ca3af" />
          <rect x={x + 99} y={y + 5} width={14} height={4} fill="#d1d5db" />
          <rect x={x + 99} y={y + 11} width={14} height={4} fill="#d1d5db" />
        </g>
      )
    case 'pantry':
      return (
        <g>
          <rect x={x + 4} y={y + 32} width={56} height={4} fill="#9a6b3f" />
          <rect x={x + 8} y={y + 20} width={10} height={12} fill="#374151" />
          <rect x={x + 10} y={y + 22} width={6} height={3} fill="#111827" />
          <rect x={x + 12} y={y + 28} width={2} height={3} fill="#f8fafc" />
          <rect x={x + 12} y={y + 16} width={1} height={3} fill="#e5e7eb" className="pxo-steam" />
          <rect x={x + 14} y={y + 17} width={1} height={2} fill="#e5e7eb" className="pxo-steam" style={{ animationDelay: '.9s' }} />
          <rect x={x + 24} y={y + 18} width={7} height={14} fill="#e5e7eb" />
          <rect x={x + 24} y={y + 14} width={7} height={5} fill="#93c5fd" />
          <rect x={x + 40} y={y + 12} width={14} height={20} fill="#f1f5f9" />
          <rect x={x + 40} y={y + 21} width={14} height={1} fill="#94a3b8" />
          <rect x={x + 16} y={y + 50} width={28} height={14} fill="#8b5a2b" />
          <Plant x={x + 62} y={y + 62} />
        </g>
      )
  }
  return null
}

export function PixelOffice({ layout }: { layout: OfficeLayout }) {
  const [picked, setPicked] = useState<string | null>(null)
  const all = Object.values(layout.seats).flat() as Seat[]
  const pickedSeat = all.find(s => s.key === picked) ?? null
  const pick = (s: Seat) => () => setPicked(p => (p === s.key ? null : s.key))
  const { sky, night } = skyOf(layout.clock)

  // 방마다 자리를 놓는다. 넘치는 사람은 방 오른쪽 아래에 '+n'.
  const placed: { seat: Seat; x: number; y: number; big?: boolean }[] = []
  const empties: { key: string; x: number; y: number }[] = []
  const overflow: { key: string; x: number; y: number; n: number }[] = []
  for (const [group, slot] of Object.entries(SLOTS) as [RoomKey, NonNullable<(typeof SLOTS)[RoomKey]>][]) {
    const room = ROOMS.find(r => r.key === slot.box)!
    const seats = layout.seats[group] ?? []
    const at = (i: number) => ({ x: room.x + slot.dx + (i % slot.cols) * slot.sx, y: room.y + slot.dy + Math.floor(i / slot.cols) * slot.sy })
    seats.slice(0, slot.max).forEach((seat, i) => placed.push({ seat, ...at(i), big: slot.big }))
    for (let i = seats.length; i < Math.min(EMPTY_DESKS[group] ?? 0, slot.max); i++) empties.push({ key: `${group}-${i}`, ...at(i) })
    if (seats.length > slot.max) {
      const last = at(slot.max - 1)
      overflow.push({ key: group, x: last.x + 30, y: last.y + 26, n: seats.length - slot.max })
    }
  }

  return (
    <div>
      <style>{`
        @keyframes pxo-type { 0%, 100% { transform: translateY(0) } 50% { transform: translateY(.6px) } }
        .pxo-type { animation: pxo-type .5s steps(1) infinite; }
        @keyframes pxo-blink { 0%, 100% { opacity: 1 } 50% { opacity: .6 } }
        .pxo-blink { animation: pxo-blink 1.2s steps(2) infinite; }
        @keyframes pxo-bounce { 0%, 100% { transform: translateY(0) } 50% { transform: translateY(-1px) } }
        .pxo-bounce { animation: pxo-bounce .6s steps(1) infinite; }
        @keyframes pxo-led { 0%, 60% { opacity: 1 } 61%, 100% { opacity: .25 } }
        .pxo-led { animation: pxo-led 1.4s steps(1) infinite; }
        @keyframes pxo-steam { 0% { transform: translateY(0); opacity: .8 } 100% { transform: translateY(-5px); opacity: 0 } }
        .pxo-steam { animation: pxo-steam 2s linear infinite; }
        @keyframes pxo-eye { 0%, 95% { fill: var(--eye) } 96%, 100% { fill: var(--lid) } }
        .pxo-eye { animation: pxo-eye 4.5s steps(1) infinite; }
        @keyframes pxo-code { 0% { opacity: 0 } 30%, 80% { opacity: 1 } 100% { opacity: 0 } }
        .pxo-code { animation: pxo-code 1.2s steps(3) infinite; }
        @keyframes pxo-pop { 0% { transform: translateY(2px); opacity: 0 } 15%, 85% { transform: translateY(0); opacity: 1 } 100% { transform: translateY(-2px); opacity: 0 } }
        .pxo-pop { animation: pxo-pop 4s ease-out infinite; }
        @keyframes pxo-colon { 0%, 49% { opacity: 1 } 50%, 100% { opacity: 0 } }
        .pxo-colon { animation: pxo-colon 1s steps(1) infinite; }
        @keyframes pxo-cloud { 0%, 100% { transform: translateX(0) } 50% { transform: translateX(14px) } }
        .pxo-cloud { animation: pxo-cloud 40s ease-in-out infinite; }
        @keyframes pxo-paper { 0%, 80% { transform: translateY(0); opacity: 0 } 85% { opacity: 1 } 100% { transform: translateY(4px); opacity: 1 } }
        .pxo-paper { animation: pxo-paper 9s steps(6) infinite; }
        @keyframes pxo-walk { 0% { transform: translateX(0) scaleX(1) } 40% { transform: translateX(var(--span)) scaleX(1) }
          50% { transform: translateX(var(--span)) scaleX(-1) } 90% { transform: translateX(0) scaleX(-1) } 100% { transform: translateX(0) scaleX(1) } }
        .pxo-cat, .pxo-vacuum { transform-box: fill-box; transform-origin: center; }
        .pxo-cat { animation: pxo-walk 26s steps(90) infinite; }
        .pxo-vacuum { animation: pxo-walk 34s linear infinite; }
        @keyframes pxo-step { 0%, 49% { opacity: 1 } 50%, 100% { opacity: 0 } }
        .pxo-step-a { animation: pxo-step .4s steps(1) infinite; }
        .pxo-step-b { animation: pxo-step .4s steps(1) infinite reverse; }
        .dark .pxo-scene { filter: brightness(.8) saturate(.9); }
        @media (prefers-reduced-motion: reduce) {
          .pxo-type, .pxo-blink, .pxo-bounce, .pxo-led, .pxo-steam, .pxo-eye, .pxo-code, .pxo-pop, .pxo-colon,
          .pxo-cloud, .pxo-paper, .pxo-cat, .pxo-vacuum, .pxo-step-a, .pxo-step-b { animation: none }
        }
      `}</style>

      <p className="mb-1 text-[11px] text-gray-500 lg:hidden">← 사무실을 옆으로 밀어 다른 방도 보세요 →</p>
      <div className="overflow-x-auto border-4 border-gray-800 dark:border-gray-600">
        <svg viewBox={`0 0 ${W} ${H}`} shapeRendering="crispEdges" className="pxo-scene block w-full min-w-[960px]"
          role="img" aria-label="사무실 배치도">
          <defs>
            <pattern id="pxo-wood" width="24" height="6" patternUnits="userSpaceOnUse">
              <rect width="24" height="6" fill="#dcb98c" />
              <rect y="5" width="24" height="1" fill="#c9a274" />
              <rect x="11" width="1" height="5" fill="#c9a274" />
            </pattern>
            <pattern id="pxo-carpet" width="4" height="4" patternUnits="userSpaceOnUse">
              <rect width="4" height="4" fill="#7b8fb8" />
              <rect width="1" height="1" fill="#8c9fc6" />
            </pattern>
            <pattern id="pxo-oak" width="16" height="8" patternUnits="userSpaceOnUse">
              <rect width="16" height="8" fill="#a8744a" />
              <rect y="7" width="16" height="1" fill="#93623b" />
              <rect x="5" width="1" height="7" fill="#93623b" />
              <rect x="13" y="0" width="3" height="7" fill="#b07c51" />
            </pattern>
            <pattern id="pxo-parquet" width="8" height="8" patternUnits="userSpaceOnUse">
              <rect width="8" height="8" fill="#c99a6b" />
              <rect width="4" height="4" fill="#b98a5c" />
              <rect x="4" y="4" width="4" height="4" fill="#b98a5c" />
            </pattern>
            <pattern id="pxo-tile" width="12" height="12" patternUnits="userSpaceOnUse">
              <rect width="12" height="12" fill="#ece4d2" />
              <rect width="6" height="6" fill="#e0d6bf" />
              <rect x="6" y="6" width="6" height="6" fill="#e0d6bf" />
            </pattern>
            <pattern id="pxo-green" width="4" height="4" patternUnits="userSpaceOnUse">
              <rect width="4" height="4" fill="#8fb996" />
              <rect width="1" height="1" fill="#9fc6a5" />
            </pattern>
            <pattern id="pxo-lab" width="10" height="10" patternUnits="userSpaceOnUse">
              <rect width="10" height="10" fill="#d6dde8" />
              <rect width="10" height="0.6" fill="#c3ccda" />
              <rect width="0.6" height="10" fill="#c3ccda" />
            </pattern>
            <pattern id="pxo-server" width="8" height="8" patternUnits="userSpaceOnUse">
              <rect width="8" height="8" fill="#aeb8c4" />
              <rect width="8" height="0.6" fill="#9aa5b2" />
              <rect width="0.6" height="8" fill="#9aa5b2" />
            </pattern>
          </defs>

          {/* ── 뒷벽: 창문·시계·화이트보드 ── */}
          <rect x={0} y={0} width={W} height={24} fill="#e9dcc6" />
          <rect x={0} y={21} width={W} height={3} fill="#8a6f52" />
          {[10, 64, 132, 186, 384, 430, 476].map(wx => <Window key={wx} x={wx} sky={sky} night={night} />)}
          <rect x={244} y={5} width={22} height={11} fill="#1f2937" />
          <rect x={245} y={6} width={20} height={9} fill="#0f172a" />
          <text x={255} y={13} fontSize={6} fontWeight={800} textAnchor="middle" fill="#4ade80" style={{ fontFamily: 'monospace' }}>
            {layout.clock.slice(0, 2)}<tspan className="pxo-colon">:</tspan>{layout.clock.slice(3)}
          </text>
          <rect x={274} y={3} width={86} height={17} fill="#9ca3af" />
          <rect x={275} y={4} width={84} height={15} fill="#f8fafc" />
          {layout.board.slice(0, 3).map((l, i) => (
            <text key={l} x={278} y={9 + i * 4.5} fontSize={3.6} fontWeight={700} fill={['#1d4ed8', '#b91c1c', '#15803d'][i]}>{cut(l, 26)}</text>
          ))}

          {/* ── 방: 바닥 → 소품 → 벽 → 문 → 이름판 ── */}
          {ROOMS.map(r => <rect key={`f-${r.key}`} x={r.x} y={r.y} width={r.w} height={r.h} fill={FLOOR_FILL[r.floor]} />)}
          {ROOMS.map(r => <Decor key={`d-${r.key}`} room={r} guests={layout.guests} board={layout.board} />)}
          {ROOMS.map(r => (
            <g key={`w-${r.key}`} fill="#6b7280">
              <rect x={r.x} y={r.y + r.h - 1.5} width={r.w} height={3} />
              <rect x={r.x + r.w - 1.5} y={r.y} width={3} height={r.h} />
            </g>
          ))}
          <rect x={0} y={24} width={2} height={H - 24} fill="#6b7280" />
          {DOORS.map((d, i) => <rect key={i} x={d.x} y={d.y} width={d.w} height={d.h} fill="#cbb79a" />)}
          {ROOMS.map(r => (
            <g key={`l-${r.key}`}>
              <rect x={r.x + 4} y={r.y + 3} width={r.label.length * 4.6 + 5} height={7.5} fill="#fff7e6" stroke={r.color} strokeWidth={0.6} />
              <text x={r.x + 6.5} y={r.y + 8.8} fontSize={4.6} fontWeight={800} fill={r.color}>{r.label}</text>
            </g>
          ))}

          {/* 영업부 프린터 — 가끔 종이가 나온다 */}
          <rect x={151} y={270} width={14} height={2} fill="#f8fafc" className="pxo-paper" />
          {/* 돌아다니는 것들 — 책상보다 먼저 그려 책상 뒤로 지나가게 한다 */}
          <Vacuum x={14} y={262} span={110} />
          <Cat x={122} y={198} span={56} />
          <Cat x={300} y={280} span={170} />

          {empties.map(e => <EmptyDesk key={e.key} x={e.x} y={e.y} />)}
          {overflow.map(o => <Label key={o.key} x={o.x} y={o.y} text={`+${o.n}`} size={4} anchor="start" />)}

          {/* ── 사람·일꾼·Claude ── */}
          {placed.map(p => (
            <Desk key={p.seat.key} seat={p.seat} x={p.x} y={p.y} big={p.big}
              picked={picked === p.seat.key} onPick={pick(p.seat)} />
          ))}
          {/* 밤 — 사무실 불빛만 남기고 어둡게. 모니터·말풍선은 이 위에 그려 밝게 둔다 */}
          {night && <rect x={0} y={24} width={W} height={H - 24} fill="#0b1026" opacity={0.28} style={{ pointerEvents: 'none' }} />}
          {/* 말풍선은 맨 위에 — 책상 뒤에 가리지 않게 따로 한 번 더 그린다 */}
          {placed.map(p => <Bubble key={`b-${p.seat.key}`} seat={p.seat} x={p.x + 2} y={p.y} />)}
        </svg>
      </div>

      {/* 누른 자리 — 판 위 글자가 작은 휴대폰에서도 읽히게 크게 다시 적는다 */}
      <div className="mt-2 min-h-[44px] border-2 border-gray-800 bg-[#fff7e6] px-3 py-2 text-sm dark:border-gray-500 dark:bg-gray-900">
        {pickedSeat ? (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="inline-block h-2 w-2" style={{ background: DOT[pickedSeat.state] }} />
            <b className="text-gray-900 dark:text-white">{pickedSeat.name}</b>
            {pickedSeat.role && <span className="text-xs text-gray-500">{pickedSeat.role}</span>}
            <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">
              {{ working: '일하는 중', waiting: '대답 기다림', idle: '쉬는 중', off: '자리 비움' }[pickedSeat.state]}
            </span>
            {pickedSeat.say && <span className="w-full text-xs text-gray-700 dark:text-gray-300">💬 {pickedSeat.say}</span>}
            {pickedSeat.note && <span className="w-full text-[11px] text-gray-500">{pickedSeat.note}</span>}
          </div>
        ) : (
          <p className="text-xs text-gray-500">책상을 누르면 그 자리에서 무슨 일을 하는지 자세히 보입니다.</p>
        )}
      </div>
    </div>
  )
}
