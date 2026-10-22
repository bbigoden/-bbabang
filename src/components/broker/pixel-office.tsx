/**
 * 사무실 화면의 픽셀 사무실 — 일꾼·직원·Claude 를 책상에 앉은 캐릭터로 그린다.
 *
 * 그림은 전부 이 파일 안의 글자 지도(스프라이트)로 그린다. 그림 파일을 따로 두면 PWA 캐시·
 * 다크 모드마다 손볼 곳이 늘고, 칸이 16×16 남짓이라 글자로 두는 편이 고치기도 쉽다.
 *
 * 상태는 몸짓으로 보인다:
 *   working  타자 치듯 들썩이고 모니터가 켜진다
 *   waiting  머리 위에 ! 가 튄다 (사장님 대답·허락을 기다림)
 *   idle     가만히 앉아 있다
 *   off      자리가 비어 있다 (일꾼 꺼짐·퇴근)
 */

export type SeatState = 'working' | 'waiting' | 'idle' | 'off'
export type SeatKind = 'robot' | 'person' | 'claude'

export interface Seat {
  key: string
  kind: SeatKind
  name: string
  role?: string
  state: SeatState
  /** 말풍선 — 지금 하는 일. 비우면 말풍선 없이 앉아만 있다. */
  say?: string | null
  /** 이름 아래 작은 줄 — 오늘 건수 등 */
  note?: string | null
  /** 사람마다 머리·옷 색을 달리한다 */
  tint?: number
  badge?: string
}

export interface Room {
  key: string
  title: string
  seats: Seat[]
  empty?: string
}

// ── 스프라이트 ─────────────────────────────────────────
// 글자 하나가 픽셀 하나. '.' 은 비움. 색은 아래 팔레트에서 고른다.

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
]

function paletteOf(kind: SeatKind, tint = 0): Record<string, string> {
  if (kind === 'robot') return { A: '#ef4444', G: '#6b7280', L: '#d1d5db', C: '#06b6d4', D: '#475569' }
  if (kind === 'claude') return { O: '#d97757', K: '#1f1f1f' }
  const t = PERSON_TINTS[tint % PERSON_TINTS.length]
  return { H: t.H, S: '#f2c9a0', E: '#1f1f1f', B: t.B }
}

/** 글자 지도를 SVG 사각형으로. 이웃한 같은 색은 한 줄로 묶어 사각형 수를 줄인다. */
function Pixels({ rows, palette, x = 0, y = 0 }: { rows: string[]; palette: Record<string, string>; x?: number; y?: number }) {
  const rects: React.ReactNode[] = []
  rows.forEach((row, r) => {
    let c = 0
    while (c < row.length) {
      const ch = row[c]
      let w = 1
      while (c + w < row.length && row[c + w] === ch) w++
      if (ch !== '.' && palette[ch]) {
        rects.push(<rect key={`${r}-${c}`} x={x + c} y={y + r} width={w} height={1} fill={palette[ch]} />)
      }
      c += w
    }
  })
  return <>{rects}</>
}

/** 책상 하나 — 캐릭터, 의자, 책상, 모니터. 24×26 칸을 5배로 키워 그린다. */
function Desk({ seat }: { seat: Seat }) {
  const on = seat.state !== 'off'
  const screen = seat.state === 'working' ? '#7dd3fc' : seat.state === 'waiting' ? '#fcd34d' : on ? '#334155' : '#1f2937'
  return (
    // 위로 4칸 더 잡는다 — 기다림의 느낌표가 머리 위에 선다.
    // 휴대폰에선 조금 줄여 한 줄에 셋을 앉힌다 — 둘씩이면 직원 여섯이 세 줄로 길게 늘어진다.
    <svg viewBox="0 -4 24 26" shapeRendering="crispEdges" aria-hidden className="block h-auto w-[88px] sm:w-[120px]">
      {/* 의자 등받이 */}
      <rect x={3} y={5} width={12} height={8} fill="#8b5a3c" />
      <rect x={4} y={6} width={10} height={6} fill="#a16b47" />
      {/* 캐릭터 — 자리를 비웠으면 그리지 않는다. 모니터(오른쪽)에 몸이 가리지 않게 왼쪽에 앉힌다. */}
      {on && (
        <g className={seat.state === 'working' ? 'pxo-type' : undefined}>
          <Pixels rows={SPRITES[seat.kind]} palette={paletteOf(seat.kind, seat.tint)} x={2} y={2} />
        </g>
      )}
      {/* 책상 */}
      <rect x={0} y={13} width={24} height={2} fill="#b7834f" />
      <rect x={0} y={15} width={24} height={1} fill="#8a5d33" />
      <rect x={1} y={16} width={2} height={6} fill="#8a5d33" />
      <rect x={21} y={16} width={2} height={6} fill="#8a5d33" />
      {/* 모니터 — 일하는 중이면 켜진다 */}
      <rect x={15} y={7} width={8} height={6} fill="#1f2937" />
      <rect x={16} y={8} width={6} height={4} fill={screen} className={seat.state === 'working' ? 'pxo-blink' : undefined} />
      <rect x={18} y={13} width={2} height={1} fill="#1f2937" />
      {/* 키보드 */}
      <rect x={5} y={12} width={6} height={1} fill="#e5e7eb" />
      {/* 기다림 — 머리 위 느낌표 */}
      {seat.state === 'waiting' && (
        <g className="pxo-bounce">
          <rect x={8} y={-4} width={2} height={3} fill="#f59e0b" />
          <rect x={8} y={0} width={2} height={1} fill="#f59e0b" />
        </g>
      )}
    </svg>
  )
}

const STATE_DOT: Record<SeatState, string> = {
  working: 'bg-sky-500',
  waiting: 'bg-amber-500',
  idle: 'bg-green-500',
  off: 'bg-gray-400',
}

function SeatView({ seat }: { seat: Seat }) {
  return (
    <div className="flex w-[100px] flex-col items-center sm:w-[146px]" title={[seat.name, seat.say, seat.note].filter(Boolean).join('\n')}>
      {/* 말풍선 — 높이를 늘 잡아 둔다. 없다고 줄이면 책상들이 들쭉날쭉해진다. */}
      <div className="flex h-[42px] w-full items-end justify-center">
        {seat.say && (
          <div className={`relative max-w-full border-2 px-1.5 py-0.5 text-[10px] font-bold leading-tight shadow-[2px_2px_0_0_rgba(0,0,0,0.25)] ${
            seat.state === 'waiting'
              ? 'border-amber-700 bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-100'
              : 'border-gray-800 bg-white text-gray-800 dark:border-gray-300 dark:bg-gray-800 dark:text-gray-100'}`}>
            <span className="line-clamp-2 break-all">{seat.say}</span>
          </div>
        )}
      </div>
      <Desk seat={seat} />
      <div className="mt-1 flex max-w-full items-center gap-1 border-2 border-gray-800 bg-[#fff7e6] px-1.5 py-0.5 dark:border-gray-300 dark:bg-gray-900">
        <span className={`h-1.5 w-1.5 flex-shrink-0 ${STATE_DOT[seat.state]}`} />
        <span className="truncate text-[11px] font-black text-gray-900 dark:text-white">{seat.name}</span>
        {seat.badge && <span className="flex-shrink-0 bg-gray-800 px-1 text-[9px] font-bold text-white dark:bg-gray-200 dark:text-gray-900">{seat.badge}</span>}
      </div>
      {(seat.role || seat.note) && (
        <p className="mt-0.5 w-full truncate text-center text-[10px] text-gray-600 dark:text-gray-400">
          {[seat.role, seat.note].filter(Boolean).join(' · ')}
        </p>
      )}
    </div>
  )
}

/** 방 하나 — 벽에 이름판, 바닥은 체크무늬. */
function RoomView({ room }: { room: Room }) {
  return (
    <section className="overflow-hidden border-4 border-gray-800 dark:border-gray-600">
      <div className="flex items-center justify-between bg-[#6d8fb3] px-3 py-1.5 dark:bg-[#2f3f57]">
        <h3 className="border-2 border-gray-800 bg-[#fff7e6] px-2 text-xs font-black text-gray-900 dark:border-gray-300 dark:bg-gray-900 dark:text-white">
          {room.title}
        </h3>
        <span className="text-[10px] font-bold text-white/90">{room.seats.filter(s => s.state !== 'off').length}/{room.seats.length} 자리</span>
      </div>
      <div className="pxo-floor flex flex-wrap justify-center gap-x-1 gap-y-4 px-1 pb-4 pt-1 sm:justify-start sm:gap-x-2 sm:px-2">
        {room.seats.length === 0
          ? <p className="w-full py-6 text-center text-xs font-bold text-gray-700 dark:text-gray-300">{room.empty ?? '빈 방입니다'}</p>
          : room.seats.map(s => <SeatView key={s.key} seat={s} />)}
      </div>
    </section>
  )
}

export function PixelOffice({ rooms }: { rooms: Room[] }) {
  return (
    <div className="space-y-4">
      <style>{`
        .pxo-floor {
          background-color: #e8d8b8;
          background-image: conic-gradient(#dfcca6 25%, transparent 0 50%, #dfcca6 0 75%, transparent 0);
          background-size: 32px 32px;
        }
        .dark .pxo-floor {
          background-color: #2a2535;
          background-image: conic-gradient(#25202f 25%, transparent 0 50%, #25202f 0 75%, transparent 0);
        }
        @keyframes pxo-type { 0%, 100% { transform: translateY(0) } 50% { transform: translateY(1px) } }
        .pxo-type { animation: pxo-type .5s steps(1) infinite; }
        @keyframes pxo-blink { 0%, 100% { opacity: 1 } 50% { opacity: .65 } }
        .pxo-blink { animation: pxo-blink 1.2s steps(2) infinite; }
        @keyframes pxo-bounce { 0%, 100% { transform: translateY(0) } 50% { transform: translateY(-1px) } }
        .pxo-bounce { animation: pxo-bounce .6s steps(1) infinite; }
        @media (prefers-reduced-motion: reduce) { .pxo-type, .pxo-blink, .pxo-bounce { animation: none } }
      `}</style>
      {rooms.map(r => <RoomView key={r.key} room={r} />)}
    </div>
  )
}
