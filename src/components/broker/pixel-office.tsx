'use client'

/**
 * 사무실 화면의 픽셀 사무실 — 한 층짜리 진짜 사무실처럼 그린다.
 *
 *   ┌ 창문 ── 시계 ── 화이트보드 ───────────────── 서버랙 ┐
 *   │ 대표실(유리벽)  문 직원 책상 (3열씩)        │ 일꾼실 │
 *   ├─────────────────┤                          │ (로봇) │
 *   │ 이사실(유리벽)  │ 프린터 ───────┬── 문 ────┴────────┤
 *   │ 책장·손님 의자  문 커피·정수기  │ Claude 연구실     │
 *   └─────────────────┴───────────────┴───────────────────┘
 *
 * 그림은 전부 이 파일 안의 사각형으로 그린다(그림 파일 없음). 좌표 단위는 픽셀 하나이고
 * 384×216 판을 화면 폭에 맞춰 키운다. 휴대폰에선 글자가 너무 작아지므로 판을 720px 아래로
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
}

export interface OfficeLayout {
  /** 대표실에 앉을 사람 */
  boss: Seat | null
  /** 이사실에 앉을 사람 */
  director: Seat | null
  staff: Seat[]
  robots: Seat[]
  claudes: Seat[]
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

/** 글자 지도를 사각형으로. 이웃한 같은 색은 한 줄로 묶어 사각형 수를 줄인다. */
function Sprite({ rows, palette, x, y }: { rows: string[]; palette: Record<string, string>; x: number; y: number }) {
  const rects: React.ReactNode[] = []
  rows.forEach((row, r) => {
    let c = 0
    while (c < row.length) {
      const ch = row[c]
      let w = 1
      while (c + w < row.length && row[c + w] === ch) w++
      if (ch !== '.' && palette[ch]) rects.push(<rect key={`${r}-${c}`} x={x + c} y={y + r} width={w} height={1} fill={palette[ch]} />)
      c += w
    }
  })
  return <>{rects}</>
}

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
          <Sprite rows={SPRITES[seat.kind]} palette={paletteOf(seat.kind, seat.tint)} x={x + 2} y={y} />
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
  if (!seat.say || (seat.state !== 'working' && seat.state !== 'waiting')) return null
  const text = cut(seat.say, 12)
  const w = Math.max(14, text.length * 3.6 + 4)
  const waiting = seat.state === 'waiting'
  const cx = x + 9
  return (
    <g className={waiting ? 'pxo-bounce' : undefined} style={{ pointerEvents: 'none' }}>
      <rect x={cx - w / 2} y={y - 10} width={w} height={7} fill={waiting ? '#fef3c7' : '#ffffff'} stroke={waiting ? '#b45309' : '#1f2937'} strokeWidth={0.6} />
      <rect x={cx - 1} y={y - 3} width={2} height={1.5} fill={waiting ? '#b45309' : '#1f2937'} />
      <text x={cx} y={y - 5.2} fontSize={3.6} fontWeight={700} textAnchor="middle" fill={waiting ? '#78350f' : '#111827'}>
        {waiting ? `! ${text}` : text}
      </text>
    </g>
  )
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

function Window({ x }: { x: number }) {
  return (
    <g>
      <rect x={x} y={4} width={30} height={15} fill="#e2e8f0" />
      <rect x={x + 1.5} y={5.5} width={27} height={12} fill="#9fd3f5" />
      <rect x={x + 3} y={7} width={6} height={2} fill="#ffffff" opacity={0.85} />
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

const W = 384
const H = 216

/** 직원 책상 자리 — 3열, 줄마다 34씩 내려간다. 아홉 명 넘으면 넘친 사람은 '+n' 으로. */
const STAFF_SLOTS = Array.from({ length: 9 }, (_, i) => ({ x: 132 + (i % 3) * 50, y: 40 + Math.floor(i / 3) * 33 }))
const ROBOT_SLOTS = [{ x: 300, y: 54 }, { x: 340, y: 54 }, { x: 320, y: 88 }]
const CLAUDE_SLOTS = Array.from({ length: 8 }, (_, i) => ({ x: 212 + (i % 4) * 43, y: 150 + Math.floor(i / 4) * 32 }))
const BOSS_SLOT = { x: 44, y: 54 }
const DIRECTOR_SLOT = { x: 44, y: 152 }

export function PixelOffice({ layout }: { layout: OfficeLayout }) {
  const [picked, setPicked] = useState<string | null>(null)
  const all = [layout.boss, layout.director, ...layout.staff, ...layout.robots, ...layout.claudes].filter(Boolean) as Seat[]
  const pickedSeat = all.find(s => s.key === picked) ?? null
  const pick = (s: Seat) => () => setPicked(p => (p === s.key ? null : s.key))

  const staff = layout.staff.slice(0, STAFF_SLOTS.length)
  const claudes = layout.claudes.slice(0, CLAUDE_SLOTS.length)
  // 연구실 책상은 넷은 늘 둔다 — 아무도 없을 때도 '방' 으로 보여야 한다.
  const claudeDesks = Math.max(4, claudes.length)

  const placed: { seat: Seat; x: number; y: number; big?: boolean }[] = [
    ...(layout.boss ? [{ seat: layout.boss, ...BOSS_SLOT, big: true }] : []),
    ...(layout.director ? [{ seat: layout.director, ...DIRECTOR_SLOT, big: true }] : []),
    ...staff.map((s, i) => ({ seat: s, ...STAFF_SLOTS[i] })),
    ...layout.robots.slice(0, ROBOT_SLOTS.length).map((s, i) => ({ seat: s, ...ROBOT_SLOTS[i] })),
    ...claudes.map((s, i) => ({ seat: s, ...CLAUDE_SLOTS[i] })),
  ]

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
        .dark .pxo-scene { filter: brightness(.8) saturate(.9); }
        @media (prefers-reduced-motion: reduce) { .pxo-type, .pxo-blink, .pxo-bounce, .pxo-led, .pxo-steam { animation: none } }
      `}</style>

      <p className="mb-1 text-[11px] text-gray-500 sm:hidden">← 사무실을 옆으로 밀어 일꾼실·연구실도 보세요 →</p>
      <div className="overflow-x-auto border-4 border-gray-800 dark:border-gray-600">
        <svg viewBox={`0 0 ${W} ${H}`} shapeRendering="crispEdges" className="pxo-scene block w-full min-w-[720px]"
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

          {/* ── 바닥 ── */}
          <rect x={0} y={24} width={W} height={H - 24} fill="url(#pxo-wood)" />
          <rect x={0} y={24} width={118} height={88} fill="url(#pxo-carpet)" />
          <rect x={0} y={112} width={118} height={H - 112} fill="url(#pxo-oak)" />
          <rect x={290} y={24} width={W - 290} height={98} fill="url(#pxo-server)" />
          <rect x={200} y={130} width={W - 200} height={H - 130} fill="url(#pxo-lab)" />

          {/* ── 뒷벽: 창문·시계·화이트보드·액자 ── */}
          <rect x={0} y={0} width={W} height={24} fill="#e9dcc6" />
          <rect x={0} y={21} width={W} height={3} fill="#8a6f52" />
          <Window x={10} />
          <Window x={60} />
          <Window x={240} />
          {/* 시계 */}
          <rect x={126} y={5} width={22} height={11} fill="#1f2937" />
          <rect x={127} y={6} width={20} height={9} fill="#0f172a" />
          <text x={137} y={13} fontSize={6} fontWeight={800} textAnchor="middle" fill="#4ade80" style={{ fontFamily: 'monospace' }}>{layout.clock}</text>
          {/* 화이트보드 — 오늘 숫자 */}
          <rect x={156} y={3} width={76} height={17} fill="#9ca3af" />
          <rect x={157} y={4} width={74} height={15} fill="#f8fafc" />
          {layout.board.slice(0, 3).map((l, i) => (
            <text key={l} x={160} y={9 + i * 4.5} fontSize={3.6} fontWeight={700} fill={['#1d4ed8', '#b91c1c', '#15803d'][i]}>{cut(l, 24)}</text>
          ))}
          <rect x={200} y={19} width={20} height={1} fill="#6b7280" />
          {/* 서버랙 */}
          <ServerRack x={296} y={26} />
          <ServerRack x={308} y={26} />
          <ServerRack x={364} y={26} />

          {/* ── 대표실: 유리벽, 문은 직원 쪽으로 ── */}
          <rect x={116} y={24} width={3} height={62} fill="#94a3b8" />
          <rect x={116.8} y={30} width={1.4} height={52} fill="#dbeafe" opacity={0.9} />
          <rect x={116} y={104} width={3} height={8} fill="#94a3b8" />
          <rect x={0} y={110} width={119} height={3} fill="#94a3b8" />
          <Label x={58} y={32} text="대표실" size={4.6} color="#1e3a8a" />
          {/* 책장 */}
          <rect x={4} y={26} width={22} height={24} fill="#7c4a24" />
          {[0, 1, 2].map(r => (
            <g key={r}>
              <rect x={5} y={27 + r * 8} width={20} height={6} fill="#5c3416" />
              {[0, 1, 2, 3, 4].map(b => <rect key={b} x={6 + b * 4} y={28 + r * 8} width={3} height={5} fill={['#c0504d', '#2f5d8c', '#d08a2c', '#4f8a4b', '#8a5ab3'][(b + r) % 5]} />)}
            </g>
          ))}
          <Plant x={102} y={94} />
          <Plant x={4} y={94} />

          {/* ── 일꾼실 벽 ── */}
          <rect x={288} y={24} width={3} height={42} fill="#64748b" />
          <rect x={288} y={84} width={3} height={38} fill="#64748b" />
          <rect x={288} y={120} width={W - 288} height={3} fill="#64748b" />
          <Label x={348} y={36} text="일꾼실" size={4.4} color="#0f172a" />

          {/* ── Claude 연구실 벽 ── */}
          <rect x={198} y={128} width={3} height={H - 128} fill="#64748b" />
          <rect x={198} y={128} width={40} height={3} fill="#64748b" />
          <rect x={262} y={128} width={W - 262} height={3} fill="#64748b" />
          <rect x={366} y={132} width={14} height={6} fill="#d97757" />
          <text x={373} y={136.4} fontSize={3.4} fontWeight={800} textAnchor="middle" fill="#fff">LAB</text>
          <Label x={300} y={136} text="Claude 연구실" size={4.4} color="#9a3412" />

          {/* ── 이사실: 대표실 아래, 유리벽·문 ── */}
          <rect x={116} y={112} width={3} height={64} fill="#94a3b8" />
          <rect x={116.8} y={118} width={1.4} height={52} fill="#dbeafe" opacity={0.9} />
          <rect x={116} y={196} width={3} height={H - 196} fill="#94a3b8" />
          <Label x={58} y={120} text="이사실" size={4.6} color="#14532d" />
          {/* 책장 */}
          <rect x={4} y={114} width={22} height={16} fill="#7c4a24" />
          {[0, 1].map(r => (
            <g key={r}>
              <rect x={5} y={115 + r * 7} width={20} height={6} fill="#5c3416" />
              {[0, 1, 2, 3, 4].map(b => <rect key={b} x={6 + b * 4} y={116 + r * 7} width={3} height={5} fill={['#4f8a4b', '#d08a2c', '#2f5d8c', '#8a5ab3', '#c0504d'][(b + r) % 5]} />)}
            </g>
          ))}
          {/* 러그 — 책상 아래 */}
          <rect x={22} y={140} width={78} height={58} fill="#9a3b3b" opacity={0.45} />
          <rect x={25} y={143} width={72} height={52} fill="none" stroke="#f5deb3" strokeWidth={0.8} />
          {/* 손님 의자 둘 — 책상 앞 */}
          <rect x={44} y={186} width={9} height={7} fill="#3f3f46" />
          <rect x={45} y={187} width={7} height={4} fill="#52525b" />
          <rect x={64} y={186} width={9} height={7} fill="#3f3f46" />
          <rect x={65} y={187} width={7} height={4} fill="#52525b" />
          {/* 금고·트로피 장 */}
          <rect x={94} y={114} width={18} height={14} fill="#6b7280" />
          <rect x={95} y={115} width={16} height={12} fill="#9ca3af" />
          <rect x={101} y={116} width={4} height={5} fill="#facc15" />
          <rect x={102} y={121} width={2} height={2} fill="#ca8a04" />
          <Plant x={4} y={196} />
          <Plant x={104} y={196} />

          {/* ── 탕비실 구석: 커피머신·정수기 ── */}
          <rect x={166} y={200} width={30} height={4} fill="#9a6b3f" />
          <rect x={170} y={188} width={10} height={12} fill="#374151" />
          <rect x={172} y={190} width={6} height={3} fill="#111827" />
          <rect x={174} y={196} width={2} height={3} fill="#f8fafc" />
          <rect x={174} y={184} width={1} height={3} fill="#e5e7eb" className="pxo-steam" />
          <rect x={176} y={185} width={1} height={2} fill="#e5e7eb" className="pxo-steam" style={{ animationDelay: '.9s' }} />
          <rect x={186} y={186} width={7} height={14} fill="#e5e7eb" />
          <rect x={186} y={182} width={7} height={5} fill="#93c5fd" />
          <Plant x={124} y={196} />

          {/* ── 사무 공간 소품 ── */}
          <rect x={150} y={164} width={16} height={12} fill="#e5e7eb" />
          <rect x={151} y={165} width={14} height={3} fill="#9ca3af" />
          <rect x={153} y={176} width={10} height={2} fill="#f8fafc" />
          <Label x={158} y={186} text="프린터" size={3.6} color="#374151" weight={700} />
          <Plant x={270} y={26} />

          {/* ── 빈 연구실 책상 ── */}
          {Array.from({ length: claudeDesks - claudes.length }, (_, i) => {
            const s = CLAUDE_SLOTS[claudes.length + i]
            return (
              <g key={`empty-${i}`} opacity={0.75}>
                <rect x={s.x + 3} y={s.y + 2} width={12} height={9} fill="#3f3f46" />
                <rect x={s.x} y={s.y + 11} width={26} height={3} fill="#c8955f" />
                <rect x={s.x} y={s.y + 14} width={26} height={7} fill="#9a6b3f" />
                <rect x={s.x + 16} y={s.y + 3} width={9} height={7} fill="#111827" />
              </g>
            )
          })}
          {layout.claudes.length > CLAUDE_SLOTS.length && (
            <Label x={374} y={212} text={`+${layout.claudes.length - CLAUDE_SLOTS.length}`} size={4} anchor="end" />
          )}
          {layout.staff.length > STAFF_SLOTS.length && (
            <Label x={284} y={140} text={`+${layout.staff.length - STAFF_SLOTS.length}명`} size={4} anchor="end" />
          )}

          {/* ── 사람·일꾼·Claude ── */}
          {placed.map(p => (
            <Desk key={p.seat.key} seat={p.seat} x={p.x} y={p.y} big={p.big}
              picked={picked === p.seat.key} onPick={pick(p.seat)} />
          ))}
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
