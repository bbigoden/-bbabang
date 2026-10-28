'use client'

/**
 * 사무실 화면의 픽셀 사무실 — 한 층짜리 진짜 사무실처럼 그린다.
 *
 *   ┌ 창문 ── 시계 ── 화이트보드 ───────────────────────────────────────┐
 *   │ 대표실   │ 협력업체 ┊ 에이전트실                 │ 서버실(사무실 일꾼)    │
 *   ├──문──────────────문─────────────문──────────────문───┬───────────┤
 *   │ 복도 ════════════════════════════════════════════════│ 로비      │
 *   ├──문──────┬──────문───────┬──────문───────────────────┤ 안내 데스크│
 *   │ 이사실   │ 회의 ┊ 상담실 │ 홍보부(채널 ┊ 등록 로봇)  문  소파     ▯ 출입구
 *   ├──문──────┴──────문───────┴──────문───────────────문──┤           │
 *   │ 복도 ════════════════════════════════════════════════│           │
 *   ├──문─────────────문───────┬──────문──┬─────────────문─┴───────────┤
 *   │ 영업부 (직원 책상 여섯)       │ 탕비실   │ 매물조사실(수집 로봇)      │
 *   └───────────────────────────┴──────────┴───────────────────────────────┘
 *   (┊ = 한 방을 둘이 나눠 씀. 배치·폭·복도 둘·로비는 2026-10-26 사장님이 정함)
 *
 * 광고 PC 프로그램은 하나지만, 하는 일(카페·블로그·당근·회수·수집·뱅크)마다 로봇을 따로 앉혀
 * 지금 어느 일이 도는지 자리로 보이게 한다 — 그 나눔은 화면(page.tsx)이 걸린 일로 정한다.
 *
 * 그림은 전부 이 파일 안의 사각형으로 그린다(그림 파일 없음). 좌표 단위는 픽셀 하나이고
 * 576×332 판을 화면 폭에 맞춰 키운다. 휴대폰에선 글자가 너무 작아지므로 판을 1080px 아래로
 * 줄이지 않고 옆으로 밀어 보게 하고, 누른 자리의 내용은 판 아래에 크게 다시 적는다.
 *
 * 상태는 몸짓으로 보인다:
 *   working  타자 치듯 들썩이고 모니터가 켜진다
 *   waiting  머리 위에 ! 와 노란 말풍선 (사장님 대답·허락을 기다림)
 *   idle     가만히 앉아 있다
 *   off      의자만 있는 빈자리 (일꾼 꺼짐·퇴근)
 */

import { useEffect, useRef, useState } from 'react'

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
  /** 쉬는 중에도 말풍선을 늘 띄운다(직원 — 매물·업무일지) */
  pin?: boolean
  /** 이 사람만 따로 고른 포켓몬(NAMED_MONS 의 이름) — 없으면 tint 로 정한다 */
  mon?: string
  /** 자기가 건 일을 하는 자리(일꾼 key) — 책상을 비우고 그 옆으로 걸어가 서 있는다 */
  visit?: string
}

export type RoomKey =
  | 'boss' | 'director' | 'meeting' | 'server'
  | 'sales' | 'promo' | 'research' | 'register'
  | 'partner' | 'pantry' | 'lab'

export interface OfficeLayout {
  /** 방마다 앉을 자리. 없는 방은 빈 방으로 그린다. */
  seats: Partial<Record<RoomKey, Seat[]>>
  /** 상담실 손님 수 — 오늘 고객목록에 새로 등록된 고객 */
  guests: number
  /** 화이트보드에 적을 줄 (서너 줄) */
  board: string[]
  /** 벽시계 HH:MM */
  clock: string
}

// ── 스프라이트 (글자 하나 = 픽셀 하나, '.' 은 비움) ────────────

/**
 * 자리마다 포켓몬 한 마리(2026-10-26 사장님 주문). 직원은 고른 색(tint)마다, 일꾼·에이전트는
 * 자리 이름으로 정해져 늘 같은 포켓몬이 앉는다. 눈은 'E' — 깜빡일 때 lid 색으로 덮는다.
 * main 은 흔드는 손·타자 치는 손 색.
 */
interface Mon { rows: string[]; pal: Record<string, string>; lid: string; main: string }
const mon = (rows: string[], pal: Record<string, string>, main: string, lid = main): Mon => ({ rows, pal, lid, main })

const PIKACHU = mon([
  '..N........N..',
  '..YN......NY..',
  '...YYYYYYYY...',
  '..YYYYYYYYYY..',
  '..YEYYYYYYEY..',
  '..RYYYmmYYYR..',
  '...YYYYYYYY...',
  '....YYYYYY....',
  '...YYYYYYYY...',
  '..YYYYYYYYYY..',
  '..YYYYYYYYYY..',
], { N: '#1f1f1f', Y: '#f8d030', E: '#1f1f1f', R: '#e8504a', m: '#7a3b1f' }, '#f8d030')

const SQUIRTLE = mon([
  '..............',
  '....BBBBBB....',
  '...BBBBBBBB...',
  '..BBBBBBBBBB..',
  '..BBEBBBBEBB..',
  '..BBBBmmBBBB..',
  '...BBBBBBBB...',
  '...HHYYYYHH...',
  '..BHYYYYYYHB..',
  '..BHYYYYYYHB..',
  '...HHYYYYHH...',
], { B: '#6ab0e0', E: '#1f1f1f', m: '#2c5a7a', H: '#a0642c', Y: '#f4e4b0' }, '#6ab0e0')

const CHARMANDER = mon([
  '..............',
  '....FFFFFF....',
  '...FFFFFFFF...',
  '..FFFFFFFFFF..',
  '..FFEFFFFEFF..',
  '..FFFFmmFFFF..',
  '...FFFFFFFF...',
  '...FFYYYYFF.R.',
  '..FFYYYYYYFRrR',
  '..FFYYYYYYFF..',
  '...FFYYYYFF...',
], { F: '#f08030', E: '#1f1f1f', m: '#8a3a10', Y: '#f8e090', R: '#e83a1a', r: '#fbd34d' }, '#f08030')

const BULBASAUR = mon([
  '.....PPPP.....',
  '....PPpPPP....',
  '...PPPPPPPP...',
  '..GGGPPPPGGG..',
  '.GGEGGGGGGEGG.',
  '.GGGGGmmGGGGG.',
  '..GGDGGGGDGG..',
  '...GGGGGGGG...',
  '..GGGGGGGGGG..',
  '..GDGGGGGGDG..',
  '..GG.GGGG.GG..',
], { P: '#3f9a4a', p: '#86d08a', G: '#78c8a0', E: '#b91c1c', m: '#2f6b4f', D: '#3f8f6a' }, '#78c8a0')

const JIGGLYPUFF = mon([
  '......P.......',
  '.....PP.......',
  '...PPPPPPPP...',
  '..PPPPPPPPPP..',
  '.PPEEPPPPEEPP.',
  '.PPEEPPPPEEPP.',
  '.PPPPPmmPPPPP.',
  '.PPPPPPPPPPPP.',
  '..PPPPPPPPPP..',
  '...PPPPPPPP...',
  '...PP....PP...',
], { P: '#f8b8d0', E: '#2a6fa0', m: '#b0507a' }, '#f8b8d0')

const EEVEE = mon([
  '.VV........VV.',
  '.VVV......VVV.',
  '..VVVVVVVVVV..',
  '...VVVVVVVV...',
  '..VVEVVVVEVV..',
  '..VVVVmmVVVV..',
  '...VVVVVVVV...',
  '..YYYYYYYYYY..',
  '.YYYYYYYYYYYY.',
  '..VVYYYYYYVV..',
  '..VVVVVVVVVV..',
], { V: '#c08850', E: '#1f1f1f', m: '#6b4423', Y: '#f4e4c0' }, '#c08850')

const PSYDUCK = mon([
  '.....N.N......',
  '......N.......',
  '...QQQQQQQQ...',
  '..QQQQQQQQQQ..',
  '..QEQQQQQQEQ..',
  '..QQQOOOOQQQ..',
  '...QQOOOOQQ...',
  '....QQQQQQ....',
  '..QQQQQQQQQQ..',
  '.QQQQQQQQQQQQ.',
  '..QQQQQQQQQQ..',
], { N: '#1f1f1f', Q: '#f0d058', E: '#1f1f1f', O: '#f4e4b0' }, '#f0d058')

const MEOWTH = mon([
  '..XX......XX..',
  '..XTX....XTX..',
  '..XXXXZZXXXX..',
  '..XXXXXXXXXX..',
  '..XEXXXXXXEX..',
  '.XXXXXmmXXXXX.',
  '..XXXXXXXXXX..',
  '...XXXXXXXX...',
  '..TXXXXXXXXT..',
  '..XXXXXXXXXX..',
  '..XX......XX..',
], { X: '#f0e0b0', T: '#7a4a1e', Z: '#f8c030', E: '#1f1f1f', m: '#7a4a1e' }, '#f0e0b0')

const MAGNEMITE = mon([
  '......II......',
  '......II......',
  '....IIIIII....',
  '...IIIIIIII...',
  '..IIIIIIIIII..',
  'RRIIIWWWWIIIRR',
  'IIIIIWEEWIIIII',
  'BBIIIWWWWIIIBB',
  '..IIIIIIIIII..',
  '...IIIIIIII...',
  '....II..II....',
], { I: '#b8c0c8', W: '#ffffff', E: '#1f1f1f', R: '#e8504a', B: '#3b82f6' }, '#b8c0c8', '#ffffff')

const VOLTORB = mon([
  '..............',
  '....RRRRRR....',
  '...RRRRRRRR...',
  '..RRRRRRRRRR..',
  '..RERRRRRRER..',
  '..RREERREERR..',
  '..NNNNNNNNNN..',
  '..WWWWWWWWWW..',
  '..WWWWWWWWWW..',
  '...WWWWWWWW...',
  '....WWWWWW....',
], { R: '#e8504a', E: '#1f1f1f', N: '#7f1d1d', W: '#f8fafc' }, '#e8504a')

const PORYGON = mon([
  '..............',
  '...PPPP.......',
  '..PPPPPP......',
  '..PPEPPPBBB...',
  '..PPPPPPBBBB..',
  '...PPPPBBBBB..',
  '..BBBPPPPPP...',
  '.BBBBPPPPPPP..',
  '.BBBBPPPPPPP..',
  '..BBB.PPPPP...',
  '......PP.PP...',
], { P: '#f08890', B: '#58a8d0', E: '#1f1f1f' }, '#f08890')

const DITTO = mon([
  '..............',
  '..............',
  '..............',
  '....DDDDDD....',
  '...DDDDDDDD...',
  '..DDEDDDDEDD..',
  '..DDDDDDDDDD..',
  '.DDDDmmmmDDDD.',
  '.DDDDDDDDDDDD.',
  'DDDDDDDDDDDDDD',
  'DDDDDDDDDDDDDD',
], { D: '#b890d8', E: '#1f1f1f', m: '#6b4a8a' }, '#b890d8')

const MEW = mon([
  '..P......P....',
  '..PP....PP....',
  '..PPPPPPPP....',
  '.PPPPPPPPPP...',
  '.PPWEPPWEPP...',
  '.PPWEPPWEPP...',
  '..PPPPPPPP..P.',
  '...PPPPPP...P.',
  '..PPPPPPPP.P..',
  '...PPPPPP.P...',
  '...PP..PPP....',
], { P: '#f8b8d8', W: '#ffffff', E: '#2a6fa0' }, '#f8b8d8', '#ffffff')

const GENGAR = mon([
  '.G..........G.',
  '.GG..G..G..GG.',
  '.GGGGGGGGGGGG.',
  'GGGGGGGGGGGGGG',
  'GGEEGGGGGGEEGG',
  'GGGGGGGGGGGGGG',
  'GGWWWWWWWWWWGG',
  '.GGWWWWWWWWGG.',
  '..GGGGGGGGGG..',
  '..GGGGGGGGGG..',
  '..GG......GG..',
], { G: '#705898', E: '#ef4444', W: '#f8fafc' }, '#705898')

/** 상담실 손님 — 고라파덕·잠만보 */
const SNORLAX = mon([
  '..T........T..',
  '..TTTTTTTTTT..',
  '.TTTTTTTTTTTT.',
  '.TTCCCCCCCCTT.',
  '.TCNNCCCCNNCT.',
  '.TCCCWWWWCCCT.',
  'TTTCCCCCCCCTTT',
  'TTCCCCCCCCCCTT',
  'TTCCCCCCCCCCTT',
  '.TTCCCCCCCCTT.',
  '..CCC....CCC..',
], { T: '#2f5d6b', C: '#f0e0c0', N: '#1f1f1f', W: '#ffffff' }, '#2f5d6b')
const GUESTS = [PSYDUCK, SNORLAX]

/** 님피아 — 2026-10-27 사장님이 이예리 자리에 '이쁜 애로' 골라 줌. 리본 더듬이가 양옆으로 흐른다. */
const SYLVEON = mon([
  '.CC........CC.',
  '.CPC......CPC.',
  '..CCCCCRBRC...',
  '..CCCCCCRRCC..',
  '..CCECCCCECC..',
  '..CPCCmmCCPC..',
  '...CCCCCCCC...',
  '..RRCCCCCCRR..',
  '.RR.CCCCCC.RR.',
  '...CCCCCCCC...',
  '...PP....PP...',
], { C: '#fdf2f8', P: '#f9a8d4', R: '#f472b6', B: '#60a5fa', E: '#1e3a8a', m: '#be185d' }, '#fdf2f8')
const NAMED_MONS: Record<string, Mon> = { sylveon: SYLVEON }

/** 직원 — 고른 색(tint)마다 한 마리. 같은 포켓몬이 나란히 앉지 않게 여덟. */
const STAFF_MONS = [PIKACHU, SQUIRTLE, CHARMANDER, BULBASAUR, JIGGLYPUFF, EEVEE, PSYDUCK, MEOWTH]
/** 사무실 일꾼(서버실·부서 로봇) — 기계 포켓몬 */
const ROBOT_MONS = [MAGNEMITE, VOLTORB, PORYGON]
/** 에이전트실 — 세션마다 */
const AGENT_MONS = [DITTO, MEW, GENGAR]

function monOf(seat: Seat): Mon {
  if (seat.kind === 'robot') return ROBOT_MONS[seed(seat.key) % ROBOT_MONS.length]
  if (seat.kind === 'claude') return AGENT_MONS[seed(seat.key) % AGENT_MONS.length]
  return (seat.mon && NAMED_MONS[seat.mon]) || STAFF_MONS[(seat.tint ?? 0) % STAFF_MONS.length]
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
function seed(s: string) { return [...s].reduce((n, ch) => (n * 31 + ch.charCodeAt(0)) % 9973, 7) }

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

/**
 * 판 위 글자의 대략 폭(판 픽셀). 글자 수로만 재면 한글이 많은 이름판은 좁고 "·"·숫자가 많은 것은
 * 넓었다(2026-10-26). 한글은 글자 크기만큼, 영문·숫자는 그 0.6, 빈칸·가운뎃점은 0.3 으로 센다.
 */
const textW = (s: string, size: number) => [...s].reduce((w, ch) =>
  w + (/[가-힣ㄱ-ㅎㅏ-ㅣ]/.test(ch) ? size : /[\s·.,:!?|()/-]/.test(ch) ? size * 0.32 : size * 0.6), 0)

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

function Desk({ seat, x, y, big = false, away = false, picked, onPick }: {
  seat: Seat; x: number; y: number; big?: boolean; away?: boolean; picked: boolean; onPick: () => void
}) {
  const on = seat.state !== 'off' && !away
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
      {/* 캐릭터 — 1.3배로 키우고 어두운 테를 둘러 바닥·의자 색에 묻히지 않게 한다(2026-10-25 '잘 보였으면').
          몸짓: 일하면 들썩, 기다리면 손 흔들기, 쉬면 직원은 두리번·일꾼은 둥실·에이전트는 가끔 깡충. */}
      {on && (() => {
        const m = monOf(seat)
        const pal = m.pal
        const ink = Object.fromEntries(Object.keys(pal).map(k => [k, '#1f2937']))
        const rows = m.rows
        const cx = x + 9
        const by = y + 11
        const motion = seat.state === 'working' ? 'pxo-type'
          : seat.state === 'waiting' ? 'pxo-bounce'
            : seat.kind === 'robot' ? 'pxo-hover' : seat.kind === 'claude' ? 'pxo-hop' : 'pxo-look'
        const delay = `${(seed(seat.key) % 70) / 10}s`
        return (
          <g transform={`translate(${cx} ${by}) scale(1.3) translate(${-cx} ${-by})`}>
            <g className={motion} style={{ animationDelay: delay }}>
              {[[-0.6, 0], [0.6, 0], [0, -0.6]].map(([ox, oy]) => (
                <Sprite key={`${ox}${oy}`} rows={rows} palette={ink} x={x + 2 + ox} y={y + oy} />
              ))}
              <Sprite rows={rows} palette={pal} x={x + 2} y={y}
                blink={m.lid}
                delay={(seed(seat.key) % 50) / 10} />
              {/* 기다림 — 오른손을 들어 흔든다 */}
              {seat.state === 'waiting' && (
                <g className="pxo-wave">
                  <rect x={x + 13.4} y={y + 2} width={1.6} height={6} fill={m.main} stroke="#1f2937" strokeWidth={0.3} />
                  <rect x={x + 13.2} y={y + 0.4} width={2} height={2} fill={m.main} stroke="#1f2937" strokeWidth={0.3} />
                </g>
              )}
            </g>
          </g>
        )
      })()}
      {/* 책상 상판·앞판 */}
      <rect x={x} y={y + 11} width={w} height={3} fill="#c8955f" />
      <rect x={x} y={y + 14} width={w} height={7} fill="#9a6b3f" />
      <rect x={x + 1} y={y + 15} width={w - 2} height={1} fill="#86592f" />
      {/* 키보드·머그 */}
      <rect x={x + 5} y={y + 11} width={7} height={1} fill="#e5e7eb" />
      {on && <rect x={x + 13} y={y + 9} width={2} height={2} fill={seat.kind === 'claude' ? '#f4a261' : '#f8fafc'} />}
      {/* 일하는 중 — 키보드 위 두 손이 번갈아 누른다 */}
      {seat.state === 'working' && (() => {
        const hand = monOf(seat).main
        return (
          <>
            <g className="pxo-step-a"><rect x={x + 5} y={y + 9.8} width={2.2} height={1.4} fill={hand} stroke="#1f2937" strokeWidth={0.25} /></g>
            <g className="pxo-step-b"><rect x={x + 9.6} y={y + 9.8} width={2.2} height={1.4} fill={hand} stroke="#1f2937" strokeWidth={0.25} /></g>
          </>
        )
      })()}
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
      <rect x={x + w / 2 - 1} y={y + 23} width={2.6} height={2.6} fill={DOT[seat.state]} stroke="#1f2937" strokeWidth={0.3}
        transform={`translate(${-textW(cut(seat.name, 7), 4.4) / 2 - 3.5} 0)`} />
      <Label x={x + w / 2 + 1} y={y + 26.2} text={cut(seat.name, 7)} size={4.4} color={on || away ? '#111827' : '#6b7280'} />
      {seat.badge && (
        <>
          <rect x={x + w - 6} y={y - 1} width={8} height={4.5} fill="#111827" />
          <text x={x + w - 2} y={y + 2.4} fontSize={3.2} fontWeight={800} textAnchor="middle" fill="#fff">{seat.badge}</text>
        </>
      )}
    </g>
  )
}

/**
 * 머리 위 말풍선. 일하거나 기다릴 때만 띄운다 — 다 띄우면 판이 말풍선으로 덮인다.
 * 단, pin 인 자리(직원)는 늘 띄운다. 줄바꿈(\n)으로 여러 줄을 쓸 수 있다.
 */
function Bubble({ seat, x, y }: { seat: Seat; x: number; y: number }) {
  // 방금 끝낸 일이 있으면 그것부터 — 일이 끝나는 순간이 사무실에서 가장 볼 만하다.
  const done = !!seat.flash && seat.state !== 'working' && seat.state !== 'waiting'
  const show = seat.pin || seat.state === 'working' || seat.state === 'waiting'
  if (!done && (!seat.say || !show)) return null
  const waiting = seat.state === 'waiting'
  const lines = (done ? seat.flash! : seat.say!).split('\n').map(l => cut(l, 14))
  lines[0] = (done ? '✓ ' : waiting ? '! ' : '') + lines[0]
  const w = Math.max(14, ...lines.map(l => textW(l, 3.6) + 5))
  const h = 2.6 + lines.length * 4.4
  const tone = done ? { bg: '#dcfce7', line: '#15803d', ink: '#14532d' }
    : waiting ? { bg: '#fef3c7', line: '#b45309', ink: '#78350f' }
      : { bg: '#ffffff', line: '#1f2937', ink: '#111827' }
  const cx = x + 9
  const top = y - 6 - h
  return (
    <g className={done ? 'pxo-pop' : waiting ? 'pxo-bounce' : undefined} style={{ pointerEvents: 'none' }}>
      <rect x={cx - w / 2} y={top} width={w} height={h} fill={tone.bg} stroke={tone.line} strokeWidth={0.6} />
      <rect x={cx - 1} y={y - 6} width={2} height={1.5} fill={tone.line} />
      {lines.map((l, i) => (
        <text key={i} x={cx} y={top + 4.2 + i * 4.4} fontSize={3.6} fontWeight={700} textAnchor="middle" fill={tone.ink}>{l}</text>
      ))}
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

// ── 청소부 — 복도와 문을 지나 방을 옮겨 다니며 바닥을 닦는다 ─────────────
//
// 처음엔 몸·다리·자루를 따로 그리고 0.9칸짜리 조각을 1.3배로 키운 데다, 반짝임까지 든 묶음을
// 통째로 뒤집어 방향을 바꿨다 → 칸이 어긋나고 돌 때 몸이 튀어 '깨져' 보였다(2026-10-26).
// 이제 도구까지 한 장의 칸 그림(16×17)으로 그리고, 왼쪽을 보는 그림은 글자 줄을 거꾸로 뒤집어
// 미리 만들어 둔다. 걸음 두 장 × 방향 두 장을 켰다 껐다만 한다 — 아무것도 뒤집지 않는다.

/** 오른쪽을 보는 청소부. C 모자 c 챙 H 머리 S 살 E 눈 U 작업복 A 앞치마 P 바지 K 신발 W 자루 M 걸레·빗자루 */
/** 청소부 윗몸 (16칸) — 오른쪽 W 가 자루. 꼬부기는 등껍질, 피카츄는 귀 끝이 까맣다. */
const JANITOR_BODIES: Record<string, string[]> = {
  squirtle: [
    '................',
    '....SSSSS.......',
    '...SSSSSSS......',
    '..SSSSSSSSS.....',
    '..SSESSSESS.....',
    '..SSSSmmSSS.....',
    '...SSSSSSS......',
    '..BBYYYYYBB..W..',
    '.SBBYYYYYBBS.W..',
    '.SSBYYYYYBSSW...',
    '..BBYYYYYBB.W...',
    '..BBBYYYBBBW....',
    '...SSSSSSS.W....',
  ],
  pikachu: [
    '...N.....N......',
    '...SN...NS......',
    '...SSSSSSS......',
    '..SSSSSSSSS.....',
    '..SESSSSSES.....',
    '..RSSSmSSSR.....',
    '...SSSSSSS......',
    '...SSSSSSS...W..',
    '..SSSSSSSSS..W..',
    '..SSSSSSSSSSW...',
    '...SSSSSSS..W...',
    '...SSSSSSS.W....',
    '...SSSSSSS.W....',
  ],
}
/**
 * 아랫몸 — 걸을 땐 다리만 벌렸다 모으고 자루·걸레는 그대로 끌고 간다. 예전엔 두 장의 자루 끝이
 * 한 칸 어긋나 걸음마다 걸레가 좌우로 튀었다(2026-10-26 '모션이 이상해').
 * 멈춰 닦을 땐 두 발을 모으고 걸레만 좌우로 쓱쓱.
 */
const JANITOR_WALK = [
  ['...PPP.PPPW.....', '...PP...PPW.....', '..KKK...KKMMMM..', '..........MMMM..'],
  ['....PPPPP.W.....', '....PP.PP.W.....', '....KKKKK.MMMM..', '..........MMMM..'],
]
const JANITOR_CLEAN = [
  ['....PPPPP.W.....', '....PP.PP.W.....', '....KK.KK.MMMM..', '..........MMMM..'],
  ['....PPPPP..W....', '....PP.PP..W....', '....KK.KK..MMMM.', '...........MMMM.'],
]
const mirror = (rows: string[]) => rows.map(r => [...r].reverse().join(''))

type Pt = [number, number, number?]   // x, y, 그 자리에서 머무는 초(청소)

/** 지나갈 자리를 따라 걷는 keyframes — 거리에 비례해 시간을 나누고, 머무는 곳은 그만큼 멈춘다. */
function walkKeyframes(name: string, pts: Pt[], speed: number) {
  const marks: { at: number; x: number; y: number; left: boolean }[] = []
  let t = 0
  let left = false
  const loop = [...pts, pts[0]]
  for (let i = 0; i < loop.length; i++) {
    const [x, y, stay = 0] = loop[i]
    if (i > 0) {
      const [px, py] = loop[i - 1]
      if (x !== px) left = x < px
      t += Math.hypot(x - px, y - py) / speed
    }
    marks.push({ at: t, x, y, left })
    if (stay && i < loop.length - 1) { t += stay; marks.push({ at: t, x, y, left }) }
  }
  const pct = (a: number) => `${((a / t) * 100).toFixed(2)}%`
  const move = marks.map(m => `${pct(m.at)} { transform: translate(${m.x}px, ${m.y}px) }`).join(' ')
  // 방향은 다음 구간이 정한다 — 출발점의 방향을 그 구간 내내 쓴다
  const face = (wantLeft: boolean) => marks.map((m, i) => {
    const next = marks[i + 1] ?? marks[0]
    return `${pct(m.at)} { opacity: ${(next.left === wantLeft) ? 1 : 0} }`
  }).join(' ')
  // 걷는 중인지 닦는 중인지 — 다음 자리가 같은 곳이면 머무는(닦는) 구간
  const doing = (wantClean: boolean) => marks.map((m, i) => {
    const next = marks[i + 1] ?? marks[0]
    const cleaning = next.x === m.x && next.y === m.y && next.at > m.at
    return `${pct(m.at)} { opacity: ${cleaning === wantClean ? 1 : 0} }`
  }).join(' ')
  return {
    css: `@keyframes ${name} { ${move} } @keyframes ${name}-r { ${face(false)} } @keyframes ${name}-l { ${face(true)} }`
      + ` @keyframes ${name}-w { ${doing(false)} } @keyframes ${name}-c { ${doing(true)} }`,
    duration: t,
  }
}

/**
 * 청소부 둘이 도는 길(판 좌표, 그림 왼쪽 위). 방 안은 책상 아래 빈 바닥으로, 방과 방 사이는
 * 복도와 문(벽의 문지방 자리)으로만 다닌다. 세 번째 값은 그 자리에서 닦는 초.
 */
const JANITOR_ROUTES: { id: string; body: string; pal: Record<string, string>; pts: Pt[] }[] = [
  {
    // 아래층: 영업부 바닥 → 아래 복도 → 탕비실 → 아래 복도 → 매물조사실 → 돌아온다 (대걸레)
    id: 'j1', body: 'squirtle', pal: { S: '#6ab0e0', B: '#a0642c', Y: '#f4e4b0', m: '#2c5a7a', P: '#6ab0e0', K: '#3b7fae', M: '#e5e7eb' },
    pts: [[16, 309], [110, 309, 3], [186, 309], [186, 230], [330, 230], [330, 288], [340, 309, 2.5], [330, 288], [330, 230],
      [440, 230], [440, 288], [530, 309, 3], [440, 288], [440, 230], [186, 230], [186, 309]],
  },
  {
    // 가운데·위층: 홍보부 → 아래 복도 → 로비 → 위 복도 → 협력업체·연구실 → 되돌아 (빗자루)
    id: 'j2', body: 'pikachu', pal: { S: '#f8d030', N: '#1f1f1f', R: '#e8504a', m: '#7a3b1f', P: '#f8d030', K: '#c8a020', M: '#f59e0b' },
    pts: [[272, 208], [400, 208, 2.5], [440, 208], [440, 230], [552, 230], [552, 180, 3], [552, 120], [302, 120],
      [302, 92], [140, 92, 2.5], [356, 92, 2.5], [302, 92], [302, 120], [552, 120], [552, 230], [440, 230], [440, 208]],
  },
]

function Janitor({ route }: { route: (typeof JANITOR_ROUTES)[number] }) {
  const { css, duration } = walkKeyframes(`pxo-${route.id}`, route.pts, 12)
  const pal = { E: '#1f1f1f', W: '#a16207', ...route.pal }
  const body = JANITOR_BODIES[route.body]
  const ink = Object.fromEntries(Object.keys(pal).map(k => [k, '#1f2937']))
  const dur = `${duration.toFixed(1)}s`
  const frames = (left: boolean, lower: string[][], [a, b]: [string, string]) => lower.map((step, i) => {
    const rows = left ? mirror([...body, ...step]) : [...body, ...step]
    return (
      <g key={i} className={i === 0 ? a : b}>
        {[[-0.6, 0], [0.6, 0], [0, -0.6], [0, 0.6]].map(([ox, oy]) => (
          <Sprite key={`${ox}${oy}`} rows={rows} palette={ink} x={ox} y={oy} />
        ))}
        <Sprite rows={rows} palette={pal} x={0} y={0} />
      </g>
    )
  })
  // 지나간 바닥이 반짝인다 — 뒤쪽 발치에
  const sparkles = (left: boolean) => [[1, 15], [-2, 13], [3, 12]].map(([sx, sy], i) => {
    const x = left ? 15 - sx : sx
    return (
      <g key={i} className="pxo-sparkle" style={{ animationDelay: `${i * 0.33}s` }}>
        <rect x={x - 1} y={sy} width={3} height={1} fill="#fef08a" />
        <rect x={x} y={sy - 1} width={1} height={3} fill="#fef08a" />
      </g>
    )
  })
  return (
    <g className="pxo-jan" style={{ pointerEvents: 'none' }}>
      <style>{css}</style>
      <g style={{ animation: `pxo-${route.id} ${dur} linear infinite` }}>
        {/* 1.25배 — 앉은 사람(1.3배)과 키가 엇비슷하게 */}
        <g transform="scale(1.25)">
          {[false, true].map(left => (
            <g key={String(left)} style={{ animation: `pxo-${route.id}-${left ? 'l' : 'r'} ${dur} steps(1, end) infinite` }}>
              <g style={{ animation: `pxo-${route.id}-w ${dur} steps(1, end) infinite` }}>
                {frames(left, JANITOR_WALK, ['pxo-step-a', 'pxo-step-b'])}
              </g>
              <g style={{ animation: `pxo-${route.id}-c ${dur} steps(1, end) infinite` }}>
                {sparkles(left)}
                {frames(left, JANITOR_CLEAN, ['pxo-sweep-a', 'pxo-sweep-b'])}
              </g>
            </g>
          ))}
        </g>
      </g>
    </g>
  )
}

/** 방이 몇째 줄인가 — 0 위, 1 가운데, 2 아래. 줄 사이가 복도다. */
const rowOf = (r: RoomBox) => (r.y < HALLS[0].y ? 0 : r.y < HALLS[1].y ? 1 : 2)

/**
 * 책상(from) → 일꾼 앞(to) 길. 방을 나설 땐 문으로, 줄을 바꿀 땐 복도·로비로만 다닌다.
 * 가운데 줄 방은 서 있을 자리가 책상 아래라 아래 복도 쪽 문으로 드나든다.
 */
function walkPath(from: Pt, to: Pt): Pt[] {
  const roomAt = ([x, y]: Pt) => ROOMS.find(r => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h)!
  const HALL_Y = [HALLS[0].y + 3, HALLS[1].y + 3]   // 복도 한가운데(걷는 사람 왼쪽 위)
  const LOBBY_X = LOBBY.x + 44                       // 두 복도를 잇는 로비
  const a = roomAt(from)
  const b = roomAt(to)
  if (a === b) return [from, [from[0], to[1]], to]
  const ra = rowOf(a)
  const rb = rowOf(b)
  const hallOut = ra === 0 ? 0 : ra === 2 ? 1 : rb === 0 ? 0 : 1
  const hallIn = rb === 0 ? 0 : rb === 2 ? 1 : ra === 0 ? 0 : 1
  // 방에서 그 복도로 난 문 중 갈 곳에 가까운 것
  const door = (r: RoomBox, hall: number, toward: number) => {
    const wallY = hall === rowOf(r) ? r.y + r.h - 2 : r.y - 2
    return DOORS.filter(d => d.w > d.h && d.y === wallY && d.x >= r.x && d.x < r.x + r.w)
      .sort((p, q) => Math.abs(p.x - toward) - Math.abs(q.x - toward))[0].x
  }
  const outX = door(a, hallOut, to[0])
  const inX = door(b, hallIn, from[0])
  // 문 앞 — 문이 위 벽이면 방 위쪽 빈 바닥, 아래 벽이면 아래쪽
  const inside = (r: RoomBox, hall: number) => (hall === rowOf(r) ? r.y + r.h - 18 : r.y + 10)
  const pts: Pt[] = [from, [from[0], inside(a, hallOut)], [outX, inside(a, hallOut)], [outX, HALL_Y[hallOut]]]
  if (hallOut !== hallIn) pts.push([LOBBY_X, HALL_Y[hallOut]], [LOBBY_X, HALL_Y[hallIn]])
  pts.push([inX, HALL_Y[hallIn]], [inX, inside(b, hallIn)], [to[0], inside(b, hallIn)], to)
  return pts
}

/**
 * 자기가 건 일을 보러 간 직원 — 책상에서 일어나 복도로 일꾼 앞까지 한 번 걸어가 선다.
 * 키가 그대로면 10초마다 새로 그려도 다시 걷지 않는다.
 */
function Walker({ seat, from, to, onPick }: { seat: Seat; from: Pt; to: Pt; onPick: () => void }) {
  const pts = walkPath(from, to)
  let t = 0
  const at = pts.map((p, i) => (t += i ? Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) / 28 : 0))
  const name = `pxo-go-${seed(seat.key)}`
  const css = `@keyframes ${name} { ${pts.map((p, i) => `${((at[i] / t) * 100).toFixed(2)}% { transform: translate(${p[0]}px, ${p[1]}px) }`).join(' ')} }`
  const m = monOf(seat)
  const ink = Object.fromEntries(Object.keys(m.pal).map(k => [k, '#1f2937']))
  return (
    <g onClick={onPick} style={{ cursor: 'pointer' }}>
      <style>{css}</style>
      <g style={{ animation: `${name} ${t.toFixed(1)}s linear forwards` }}>
        <g transform="scale(1.3)">
          {/* 걷는 동안만 콩콩 — 도착하면 멈춰 선다 */}
          <g className="pxo-bounce" style={{ animationIterationCount: Math.ceil(t / 0.6) }}>
            {[[-0.6, 0], [0.6, 0], [0, -0.6], [0, 0.6]].map(([ox, oy]) => (
              <Sprite key={`${ox}${oy}`} rows={m.rows} palette={ink} x={ox} y={oy} />
            ))}
            <Sprite rows={m.rows} palette={m.pal} x={0} y={0} blink={m.lid} />
            {/* 발 */}
            <rect x={4} y={11} width={2} height={1.4} fill="#1f2937" />
            <rect x={8} y={11} width={2} height={1.4} fill="#1f2937" />
          </g>
        </g>
        <Label x={9} y={21} text={cut(seat.name, 5)} size={3.6} />
      </g>
    </g>
  )
}

/**
 * 로비 — 바깥 유리문으로 들어와 안내 데스크를 지나 두 복도로 갈라진다(2026-10-26 '로비 형식으로').
 * 위·아래 복도가 왼쪽에서 그대로 이어 들어오고, 오른쪽 바깥벽에 출입구가 있다.
 */
function Lobby() {
  const { x, y, w, h } = LOBBY
  const doorY = y + 50
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} fill="url(#pxo-marble)" />
      {/* 안내 데스크 — 둥근 카운터, 종, 모니터 */}
      <rect x={x + 10} y={y + 34} width={34} height={4} fill="#c8955f" />
      <rect x={x + 10} y={y + 38} width={34} height={9} fill="#7c4a24" />
      <rect x={x + 11} y={y + 40} width={32} height={1} fill="#c9a227" />
      <rect x={x + 30} y={y + 28} width={9} height={6} fill="#111827" />
      <rect x={x + 31} y={y + 29} width={7} height={4} fill="#334155" />
      <rect x={x + 16} y={y + 31.5} width={4} height={2.5} fill="#facc15" />
      <rect x={x + 17.5} y={y + 30.5} width={1} height={1} fill="#facc15" />
      {/* 손님 소파와 탁자 */}
      <Sofa x={x + 10} y={y + 88} w={30} color="#14274e" />
      <rect x={x + 16} y={y + 102} width={18} height={6} fill="#8b5a2b" />
      <Plant x={x + 4} y={y + 112} />
      <Plant x={x + w - 12} y={y + 112} />
      {/* 바깥벽과 유리 양문, 매트, 출입구 안내 */}
      <rect x={x + w - 1.5} y={y} width={3} height={doorY - y} fill="#6b7280" />
      <rect x={x + w - 1.5} y={doorY + 34} width={3} height={y + h - doorY - 34} fill="#6b7280" />
      <rect x={x + w - 6} y={doorY} width={6} height={34} fill="#475569" />
      <rect x={x + w - 5.4} y={doorY + 1} width={2.4} height={15.5} fill="#bfdbfe" />
      <rect x={x + w - 5.4} y={doorY + 17.5} width={2.4} height={15.5} fill="#bfdbfe" />
      <rect x={x + w - 2.8} y={doorY + 1} width={2.2} height={32} fill="#dbeafe" />
      <rect x={x + w - 20} y={doorY + 4} width={12} height={26} fill="#4b5563" />
      <rect x={x + w - 19.4} y={doorY + 4.6} width={10.8} height={24.8} fill="none" stroke="#9ca3af" strokeWidth={0.4} />
      <rect x={x + w - 34} y={doorY - 8} width={textW('출입구', 3.8) + 5} height={6} fill="#15803d" />
      <text x={x + w - 31.5} y={doorY - 3.5} fontSize={3.8} fontWeight={800} fill="#fff">출입구</text>
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

const W = 576
/**
 * 복도 두 줄 — 1·2줄 사이, 2·3줄 사이. 어느 방이든 다른 방을 지나지 않고 복도에서 바로 들어간다
 * (대표실에 가려고 이사실·회의실을 지나던 것을 2026-10-26 사장님이 바꿈).
 */
const HALLS = [{ y: 120, h: 22 }, { y: 230, h: 22 }]
/** 로비 — 오른쪽, 두 복도가 만나는 곳. 바깥 유리문으로 들어온다 */
const LOBBY = { x: 496, y: 120, w: 80, h: 132 }
const H = 332

type Floor = 'carpet' | 'oak' | 'wood' | 'parquet' | 'server' | 'lab' | 'tile' | 'green'

/**
 * 방(벽으로 둘러싼 칸). 자리 무리(RoomKey)와 따로 둔다 — 한 방에 두 무리가 앉는 곳이 있다
 * (협력업체 + 에이전트실, 회의실 + 상담실 — 2026-10-25 사장님이 합침, 칸막이 없이).
 */
type BoxKey = 'boss' | 'partnerLab' | 'server' | 'director' | 'meetConsult' | 'promo' | 'sales' | 'pantry' | 'research'

interface RoomBox { key: BoxKey; label: string; x: number; y: number; w: number; h: number; floor: Floor; color: string }

/** 방 배치(사장님이 정한 순서). 좌표는 판 픽셀. 위 벽(창문)이 0~24 를 쓴다. */
const ROOMS: RoomBox[] = [
  { key: 'boss', label: '대표실', x: 0, y: 24, w: 120, h: 96, floor: 'carpet', color: '#1e3a8a' },
  { key: 'partnerLab', label: '협력업체 · 에이전트실', x: 120, y: 24, w: 288, h: 96, floor: 'lab', color: '#6d28d9' },
  { key: 'server', label: '서버실', x: 408, y: 24, w: 168, h: 96, floor: 'server', color: '#0f172a' },
  { key: 'director', label: '이사실', x: 0, y: 142, w: 120, h: 88, floor: 'oak', color: '#14532d' },
  { key: 'meetConsult', label: '회의 · 상담실', x: 120, y: 142, w: 140, h: 88, floor: 'parquet', color: '#7c2d12' },
  { key: 'promo', label: '홍보부', x: 260, y: 142, w: 236, h: 88, floor: 'wood', color: '#be185d' },
  { key: 'sales', label: '영업부', x: 0, y: 252, w: 300, h: 80, floor: 'wood', color: '#1d4ed8' },
  { key: 'pantry', label: '탕비실', x: 300, y: 252, w: 80, h: 80, floor: 'tile', color: '#78350f' },
  { key: 'research', label: '매물조사실', x: 380, y: 252, w: 196, h: 80, floor: 'lab', color: '#0e7490' },
]

/** 문 — 벽 위에 문지방 색을 덧칠해 구멍을 낸다. */
const DOORS = [
  // 1줄 → 위 복도
  { x: 50, y: 118, w: 18, h: 4 }, { x: 160, y: 118, w: 18, h: 4 }, { x: 300, y: 118, w: 18, h: 4 }, { x: 430, y: 118, w: 18, h: 4 },
  // 위 복도 → 2줄
  { x: 60, y: 140, w: 18, h: 4 }, { x: 190, y: 140, w: 18, h: 4 }, { x: 300, y: 140, w: 18, h: 4 },
  // 2줄 → 아래 복도
  { x: 60, y: 228, w: 18, h: 4 }, { x: 190, y: 228, w: 18, h: 4 }, { x: 290, y: 228, w: 18, h: 4 }, { x: 440, y: 228, w: 18, h: 4 },
  // 아래 복도 → 3줄
  { x: 60, y: 250, w: 18, h: 4 }, { x: 190, y: 250, w: 18, h: 4 }, { x: 330, y: 250, w: 18, h: 4 }, { x: 440, y: 250, w: 18, h: 4 },
  // 방끼리 통하는 문은 탕비실 양옆뿐 — 나머지는 복도로만 다닌다(2026-10-26 사장님이 막음)
  { x: 298, y: 282, w: 4, h: 20 }, { x: 378, y: 282, w: 4, h: 20 },
]

/** 자리 무리마다 어느 방 어디에 책상을 놓나: 첫 자리(dx, dy), 가로·세로 간격(sx, sy), 한 줄에 몇, 최대 몇. */
const SLOTS: Partial<Record<RoomKey, { box: BoxKey; dx: number; dy: number; sx: number; sy: number; cols: number; max: number; big?: boolean }>> = {
  boss: { box: 'boss', dx: 44, dy: 40, sx: 0, sy: 0, cols: 1, max: 1, big: true },
  partner: { box: 'partnerLab', dx: 8, dy: 20, sx: 38, sy: 34, cols: 2, max: 4 },
  lab: { box: 'partnerLab', dx: 94, dy: 22, sx: 40, sy: 34, cols: 4, max: 8 },
  server: { box: 'server', dx: 70, dy: 50, sx: 0, sy: 0, cols: 1, max: 1 },
  director: { box: 'director', dx: 42, dy: 32, sx: 0, sy: 0, cols: 1, max: 1, big: true },
  // 홍보 넷 + 등록 둘을 한 줄로 — 두 줄이면 아랫줄 말풍선이 윗줄 이름판을 가렸다
  promo: { box: 'promo', dx: 10, dy: 34, sx: 38, sy: 0, cols: 4, max: 4 },
  // 등록 로봇도 홍보부에 앉는다 — 2026-10-25 사장님이 등록실을 홍보부로 합침(칸막이 없이)
  register: { box: 'promo', dx: 166, dy: 34, sx: 36, sy: 0, cols: 2, max: 2 },
  // 책상 여섯 — 2026-10-26 사장님이 늘림
  sales: { box: 'sales', dx: 12, dy: 30, sx: 46, sy: 0, cols: 6, max: 6 },
  research: { box: 'research', dx: 12, dy: 25, sx: 48, sy: 27, cols: 3, max: 6 },
}

/** 아무도 없어도 빈 책상을 두는 무리 — 비어 있어야 '방' 으로 보인다. */
const EMPTY_DESKS: Partial<Record<RoomKey, number>> = { sales: 6, promo: 4, research: 2, register: 2, partner: 2, lab: 4 }

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
function Decor({ room, guests }: { room: RoomBox; guests: number }) {
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
          <Label x={x + 44} y={y + 88} text="협력업체" size={3.6} color="#6d28d9" />
          <Label x={x + 170} y={y + 88} text="에이전트실" size={3.6} color="#9a3412" />
          <rect x={x + w - 18} y={y + 3} width={14} height={6} fill="#d97757" />
          <text x={x + w - 11} y={y + 7.4} fontSize={3.4} fontWeight={800} textAnchor="middle" fill="#fff">LAB</text>
        </g>
      )
    case 'director':
      // 풀소유 이사실 — 사장님 주문(2026-10-25): 모든 게 갖춰진 방.
      return (
        <g>
          {/* 벽: 금테 그림 · 실적 TV · 트로피장 */}
          <rect x={x + 34} y={y + 3} width={16} height={11} fill="#c9a227" />
          <rect x={x + 35.5} y={y + 4.5} width={13} height={8} fill="#7dd3fc" />
          <rect x={x + 35.5} y={y + 9} width={13} height={3.5} fill="#4ade80" />
          <rect x={x + 40} y={y + 6} width={3} height={3} fill="#fde047" />
          <rect x={x + 54} y={y + 3} width={30} height={13} fill="#111827" />
          <rect x={x + 55.5} y={y + 4.5} width={27} height={10} fill="#0f172a" />
          {[3, 5, 4, 7, 6, 8].map((hgt, i) => (
            <rect key={i} x={x + 57 + i * 4.2} y={y + 13.5 - hgt} width={2.6} height={hgt} fill={i === 5 ? '#facc15' : '#38bdf8'}
              className="pxo-code" style={{ animationDelay: `${i * 0.25}s`, animationDuration: '3s' }} />
          ))}
          <rect x={x + 88} y={y + 3} width={27} height={20} fill="#7c4a24" />
          <rect x={x + 89} y={y + 4} width={25} height={18} fill="#e0f2fe" opacity={0.85} />
          <rect x={x + 89} y={y + 12.5} width={25} height={1} fill="#7c4a24" />
          {[0, 1, 2].map(i => (
            <g key={i}>
              <rect x={x + 91 + i * 8} y={y + 6} width={4} height={3} fill="#facc15" />
              <rect x={x + 92 + i * 8} y={y + 9} width={2} height={2} fill="#ca8a04" />
              <rect x={x + 91 + i * 8} y={y + 11} width={4} height={1} fill="#a16207" />
            </g>
          ))}
          {[0, 1, 2].map(i => <rect key={`m${i}`} x={x + 92 + i * 8} y={y + 16} width={3} height={3} fill={['#fbbf24', '#d1d5db', '#d97706'][i]} />)}

          {/* 왼쪽: 책장 · 어항 · 금고 */}
          <Bookshelf x={x + 4} y={y + 12} rows={2} />
          <rect x={x + 4} y={y + 31} width={22} height={13} fill="#475569" />
          <rect x={x + 5} y={y + 32} width={20} height={10} fill="#38bdf8" opacity={0.85} />
          <rect x={x + 5} y={y + 40} width={20} height={2} fill="#fde68a" />
          <rect x={x + 7} y={y + 37} width={1} height={3} fill="#22c55e" />
          <rect x={x + 21} y={y + 36} width={1} height={4} fill="#16a34a" />
          <g className="pxo-fish"><rect x={x + 6} y={y + 34} width={3} height={1.6} fill="#f97316" /><rect x={x + 5.2} y={y + 34.3} width={1} height={1} fill="#f97316" /></g>
          <g className="pxo-fish" style={{ animationDelay: '-4s', animationDuration: '7s' }}><rect x={x + 7} y={y + 37.5} width={2.4} height={1.4} fill="#facc15" /></g>
          <rect x={x + 16} y={y + 33} width={0.8} height={0.8} fill="#e0f2fe" className="pxo-steam" />
          <rect x={x + 4} y={y + 46} width={11} height={11} fill="#b8860b" />
          <rect x={x + 5} y={y + 47} width={9} height={9} fill="#d4a017" />
          <rect x={x + 8.5} y={y + 50} width={2} height={2} fill="#78350f" />
          <rect x={x + 12} y={y + 50} width={1} height={3} fill="#78350f" />

          {/* 가운데: 페르시안 러그 · 손님 가죽 소파 둘 */}
          <rect x={x + 28} y={y + 24} width={62} height={48} fill="#9a3b3b" opacity={0.5} />
          <rect x={x + 30} y={y + 26} width={58} height={44} fill="none" stroke="#fbbf24" strokeWidth={0.8} />
          <rect x={x + 33} y={y + 29} width={52} height={38} fill="none" stroke="#fbbf24" strokeWidth={0.4} strokeDasharray="1.5 1" />
          {[46, 64].map(cx => (
            <g key={cx}>
              <rect x={x + cx - 1} y={y + 62} width={12} height={9} fill="#7f1d1d" />
              <rect x={x + cx} y={y + 63} width={10} height={5} fill="#991b1b" />
              <rect x={x + cx - 2} y={y + 63} width={2} height={7} fill="#7f1d1d" />
              <rect x={x + cx + 10} y={y + 63} width={2} height={7} fill="#7f1d1d" />
            </g>
          ))}

          {/* 오른쪽: 미니바(와인) · 안마의자 · 스탠드 */}
          <rect x={x + 96} y={y + 27} width={18} height={18} fill="#1f2937" />
          <rect x={x + 97} y={y + 28} width={16} height={7} fill="#374151" />
          {[0, 1, 2, 3].map(i => <rect key={i} x={x + 98 + i * 4} y={y + 29} width={2} height={5} fill={['#7f1d1d', '#065f46', '#7f1d1d', '#f59e0b'][i]} />)}
          <rect x={x + 97} y={y + 36} width={16} height={8} fill="#e5e7eb" />
          <rect x={x + 110} y={y + 38} width={1} height={4} fill="#9ca3af" />
          {/* 안마의자 — 옆에서 본 모양, 뒤로 젖힌 등판·머리 덮개·발 받침. 밝은 몸통에 갈색 가죽, 금테 — 짙은 마루에 묻히지 않게.
              예전 것은 빨간 네모 둘이라 안마의자로 안 읽혔다(2026-10-27 사장님 '안마의자 하나'). */}
          <rect x={x + 109} y={y + 42} width={6} height={2} fill="#e7e5e4" />
          <rect x={x + 107} y={y + 44} width={9} height={5} fill="#e7e5e4" />
          <rect x={x + 108} y={y + 45} width={5} height={3} fill="#7c2d12" />
          <rect x={x + 112} y={y + 49} width={3} height={4} fill="#e7e5e4" />
          <rect x={x + 106} y={y + 48} width={6} height={4} fill="#92400e" />
          <rect x={x + 110} y={y + 52} width={3} height={3} fill="#e7e5e4" />
          <rect x={x + 104} y={y + 52} width={6} height={3} fill="#92400e" />
          <rect x={x + 98} y={y + 55} width={12} height={3} fill="#92400e" />
          <rect x={x + 98} y={y + 55} width={12} height={0.8} fill="#b45309" />
          <rect x={x + 103} y={y + 52} width={5} height={4} fill="#e7e5e4" />
          <rect x={x + 103} y={y + 52} width={5} height={0.7} fill="#d4a017" />
          <rect x={x + 104} y={y + 53.5} width={1} height={1} fill="#22c55e" className="pxo-blink" />
          <rect x={x + 106} y={y + 53.5} width={1} height={1} fill="#38bdf8" />
          <rect x={x + 95} y={y + 57} width={4} height={3} fill="#92400e" />
          <rect x={x + 94} y={y + 60} width={5} height={3} fill="#e7e5e4" />
          <rect x={x + 99} y={y + 58} width={12} height={3} fill="#e7e5e4" />
          <rect x={x + 99} y={y + 61} width={12} height={1.2} fill="#d4a017" />
          <rect x={x + 100} y={y + 62.2} width={2} height={1.2} fill="#57534e" />
          <rect x={x + 108} y={y + 62.2} width={2} height={1.2} fill="#57534e" />
          {/* 돌아가는 중 — 등판 뒤로 진동 줄 */}
          {[0, 1].map(i => (
            <rect key={`v${i}`} x={x + 116.4} y={y + 46 + i * 4} width={1.4} height={0.6} fill="#f59e0b"
              className="pxo-steam" style={{ animationDelay: `${i * 0.5}s` }} />
          ))}
          <rect x={x + 92} y={y + 64} width={1} height={18} fill="#78716c" />
          <rect x={x + 89} y={y + 61} width={7} height={4} fill="#fef3c7" />
          <rect x={x + 88} y={y + 65} width={9} height={6} fill="#fef9c3" opacity={0.25} />

          {/* 바닥 앞쪽: 골프 퍼팅 매트 · 지구본 · 큰 화분 */}
          <rect x={x + 4} y={y + 70} width={28} height={13} fill="#15803d" />
          <rect x={x + 5} y={y + 71} width={26} height={11} fill="#22c55e" />
          <rect x={x + 26} y={y + 75} width={2.4} height={2.4} fill="#14532d" />
          <rect x={x + 27} y={y + 67} width={0.8} height={9} fill="#e5e7eb" />
          <rect x={x + 27.8} y={y + 67} width={4} height={2.6} fill="#ef4444" />
          <rect x={x + 9} y={y + 77} width={1.6} height={1.6} fill="#ffffff" />
          <rect x={x + 76} y={y + 72} width={8} height={8} fill="#2563eb" />
          <rect x={x + 77} y={y + 73} width={3} height={3} fill="#22c55e" />
          <rect x={x + 80} y={y + 76} width={3} height={2} fill="#22c55e" />
          <rect x={x + 79} y={y + 80} width={2} height={3} fill="#a16207" />
          <rect x={x + 76} y={y + 83} width={8} height={1} fill="#a16207" />
          <Plant x={x + 104} y={y + 70} />
          <Plant x={x + 36} y={y + 72} />
        </g>
      )
    case 'meetConsult':
      return (
        <g>
          {/* 왼쪽 회의 — 긴 탁자(현황판은 2026-10-26 사장님이 뺌) */}
          {[0, 1, 2, 3].map(i => <rect key={`t${i}`} x={x + 10 + i * 13} y={y + 38} width={8} height={6} fill="#3f3f46" />)}
          <rect x={x + 6} y={y + 44} width={56} height={18} fill="#8b5a2b" />
          <rect x={x + 7} y={y + 45} width={54} height={3} fill="#a87443" />
          {[0, 1, 2, 3].map(i => <rect key={`b${i}`} x={x + 10 + i * 13} y={y + 63} width={8} height={6} fill="#3f3f46" />)}
          {/* 오른쪽 상담 — 상담 책상과 손님 의자 */}
          {[0, 1].map(i => (
            <g key={i}>
              <rect x={x + 88 + i * 16} y={y + 60} width={12} height={9} fill="#3f3f46" />
              {i < guests && <Sprite rows={GUESTS[i].rows} palette={GUESTS[i].pal} x={x + 87 + i * 16} y={y + 54} />}
            </g>
          ))}
          <Label x={x + 108} y={y + 80} text={`오늘 등록 고객 ${guests}명`} size={3.6} color="#166534" />
          <Plant x={x + 124} y={y + 70} />
        </g>
      )
    case 'server':
      return (
        <g>
          {[4, 16, 28, w - 40, w - 28, w - 16].map(dx => <ServerRack key={dx} x={x + dx} y={y + 14} />)}
          <rect x={x + 60} y={y + 16} width={22} height={10} fill="#e5e7eb" />
          <text x={x + 71} y={y + 23} fontSize={3.4} fontWeight={800} textAnchor="middle" fill="#0f172a">UPS</text>
        </g>
      )
    case 'sales':
      return (
        <g>
          <Plant x={x + w - 14} y={y + h - 16} />
          {/* 프린터 */}
          <rect x={x + 240} y={y + h - 14} width={16} height={10} fill="#e5e7eb" />
          <rect x={x + 241} y={y + h - 13} width={14} height={3} fill="#9ca3af" />
        </g>
      )
    case 'promo':
      return (
        <g>
          {/* 게시판 — 붙인 광고 */}
          <rect x={x + 94} y={y + 3} width={36} height={13} fill="#c08457" />
          {[0, 1, 2].map(i => <rect key={i} x={x + 97 + i * 11} y={y + 5} width={8} height={9} fill={['#fde68a', '#bfdbfe', '#fbcfe8'][i]} />)}
          {/* 서류함 — 등록 로봇 쪽 */}
          <rect x={x + w - 26} y={y + 3} width={16} height={14} fill="#9ca3af" />
          <rect x={x + w - 25} y={y + 5} width={14} height={4} fill="#d1d5db" />
          <rect x={x + w - 25} y={y + 11} width={14} height={4} fill="#d1d5db" />
          <Plant x={x + w - 14} y={y + h - 16} />
        </g>
      )
    case 'research':
      return (
        <g>
          {/* 벽 지도 */}
          <rect x={x + w - 60} y={y + 3} width={44} height={14} fill="#d1fae5" />
          <rect x={x + w - 56} y={y + 6} width={12} height={7} fill="#86efac" />
          <rect x={x + w - 42} y={y + 8} width={20} height={6} fill="#93c5fd" />
          <rect x={x + w - 34} y={y + 5} width={2} height={2} fill="#ef4444" />
          <Plant x={x + w - 14} y={y + h - 16} />
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

export function PixelOffice({ layout, loading = false }: { layout: OfficeLayout; loading?: boolean }) {
  const [picked, setPicked] = useState<string | null>(null)
  // 누르면 자세히 칸이 보이게 — 휴대폰에선 그 칸이 아래 메뉴줄에 가려 눌러도 바뀐 게 없어 보였다(2026-10-28 점검)
  const detailRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (picked) detailRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [picked])
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

  // 일하러 간 사람 — 일꾼 책상 앞(아래)에 선다. 한 일꾼에 여럿이면 옆으로 비켜 선다.
  const crowd: Record<string, number> = {}
  const walkers = placed.flatMap(p => {
    const target = p.seat.visit && placed.find(q => q.seat.key === p.seat.visit)
    if (!target) return []
    const n = (crowd[target.seat.key] = (crowd[target.seat.key] ?? -1) + 1)
    return [{ seat: p.seat, from: [p.x + 2, p.y] as Pt, to: [target.x + 2 + n * 14, target.y + 29] as Pt }]
  })
  const away = new Set(walkers.map(w => w.seat.key))

  return (
    <div className="pxo-fit">
      <style>{`
        @keyframes pxo-type { 0%, 100% { transform: translateY(0) } 50% { transform: translateY(.6px) } }
        .pxo-type { animation: pxo-type .5s steps(1) infinite; }
        @keyframes pxo-blink { 0%, 100% { opacity: 1 } 50% { opacity: .6 } }
        .pxo-blink { animation: pxo-blink 1.2s steps(2) infinite; }
        @keyframes pxo-bounce { 0%, 100% { transform: translateY(0) } 50% { transform: translateY(-1px) } }
        .pxo-bounce { animation: pxo-bounce .6s steps(1) infinite; }
        @keyframes pxo-look { 0%, 58% { transform: translateX(0) } 60%, 72% { transform: translateX(-.7px) } 74%, 86% { transform: translateX(.7px) } 88%, 100% { transform: translateX(0) } }
        .pxo-look { animation: pxo-look 7s steps(1) infinite; }
        @keyframes pxo-hover { 0%, 100% { transform: translateY(0) } 50% { transform: translateY(-.8px) } }
        .pxo-hover { animation: pxo-hover 2.4s ease-in-out infinite; }
        @keyframes pxo-hop { 0%, 82% { transform: translateY(0) } 86% { transform: translateY(-2px) } 90% { transform: translateY(0) } 93% { transform: translateY(-1px) } 96%, 100% { transform: translateY(0) } }
        .pxo-hop { animation: pxo-hop 5s steps(1) infinite; }
        @keyframes pxo-wave { 0%, 49% { transform: translateY(0) } 50%, 100% { transform: translateY(-1px) } }
        .pxo-wave { animation: pxo-wave .35s steps(1) infinite; }
        @keyframes pxo-fish { 0% { transform: translateX(0) scaleX(1) } 45% { transform: translateX(12px) scaleX(1) } 50% { transform: translateX(12px) scaleX(-1) } 95% { transform: translateX(0) scaleX(-1) } 100% { transform: translateX(0) scaleX(1) } }
        .pxo-fish { transform-box: fill-box; transform-origin: center; animation: pxo-fish 9s linear infinite; }
        .pxo-sweep-a { animation: pxo-step .5s steps(1) infinite; }
        .pxo-sweep-b { animation: pxo-step .5s steps(1) infinite reverse; }
        @keyframes pxo-sparkle { 0%, 100% { opacity: 0 } 30%, 60% { opacity: 1 } }
        .pxo-sparkle { animation: pxo-sparkle 1s steps(3) infinite; }
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
        /* PC 에선 스크롤 없이 한 화면에 — 화면 높이에 맞춰 폭을 정하고 가운데에(비율은 그대로). 휴대폰은 옆으로 민다 */
        @media (min-width: 1024px) { .pxo-fit { width: min(100%, calc((100dvh - 240px) * ${W} / ${H})); margin: 0 auto; } }
        @media (prefers-reduced-motion: reduce) {
          .pxo-type, .pxo-blink, .pxo-bounce, .pxo-led, .pxo-steam, .pxo-eye, .pxo-code, .pxo-pop, .pxo-colon,
          .pxo-cloud, .pxo-paper, .pxo-cat, .pxo-vacuum, .pxo-step-a, .pxo-step-b,
          .pxo-look, .pxo-hover, .pxo-hop, .pxo-wave, .pxo-fish, .pxo-sparkle, .pxo-sweep-a, .pxo-sweep-b { animation: none }
          .pxo-jan, .pxo-jan * { animation: none !important }
        }
      `}</style>

      <p className="mb-1 text-[11px] text-gray-500 lg:hidden">← 사무실을 옆으로 밀어 다른 방도 보세요 →</p>
      <div className="relative overflow-x-auto border-4 border-gray-800 dark:border-gray-600">
        {loading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/60 dark:bg-gray-950/60">
            <span className="border-2 border-gray-800 bg-[#fff7e6] px-3 py-1.5 text-sm font-bold text-gray-800">사무실을 불러오는 중…</span>
          </div>
        )}
        <svg viewBox={`0 0 ${W} ${H}`} shapeRendering="crispEdges" className="pxo-scene block w-full min-w-[1080px] lg:min-w-0"
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
            <pattern id="pxo-marble" width="16" height="16" patternUnits="userSpaceOnUse">
              <rect width="16" height="16" fill="#f5f5f4" />
              <rect width="8" height="8" fill="#e7e5e4" />
              <rect x="8" y="8" width="8" height="8" fill="#e7e5e4" />
              <rect x="3" y="5" width="4" height="0.5" fill="#d6d3d1" />
            </pattern>
            <pattern id="pxo-hall" width="12" height="11" patternUnits="userSpaceOnUse">
              <rect width="12" height="11" fill="#d6d3d1" />
              <rect width="12" height="0.6" fill="#c4c0bb" />
              <rect width="0.6" height="11" fill="#c4c0bb" />
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
          {[10, 64, 132, 186, 392, 440, 488, 536].map(wx => <Window key={wx} x={wx} sky={sky} night={night} />)}
          <rect x={244} y={5} width={22} height={11} fill="#1f2937" />
          <rect x={245} y={6} width={20} height={9} fill="#0f172a" />
          <text x={255} y={13} fontSize={6} fontWeight={800} textAnchor="middle" fill="#4ade80" style={{ fontFamily: 'monospace' }}>
            {layout.clock.slice(0, 2)}<tspan className="pxo-colon">:</tspan>{layout.clock.slice(3)}
          </text>
          <rect x={274} y={3} width={86} height={17} fill="#9ca3af" />
          <rect x={275} y={4} width={84} height={15} fill="#f8fafc" />
          {layout.board.slice(0, 3).map((l, i) => (
            <text key={l} x={278} y={9 + i * 4.5} fontSize={3.6} fontWeight={700} fill={['#1d4ed8', '#b91c1c', '#15803d'][i]}>{cut(l, 36)}</text>
          ))}

          {/* ── 복도 둘: 돌바닥 ── */}
          {HALLS.map((h, i) => (
            <g key={`hall-${i}`}>
              <rect x={0} y={h.y} width={LOBBY.x} height={h.h} fill="url(#pxo-hall)" />
              <Plant x={4} y={h.y + 6} />
              <Plant x={244} y={h.y + 6} />
            </g>
          ))}
          <Lobby />

          {/* ── 방: 바닥 → 소품 → 벽 → 문 → 이름판 ── */}
          {ROOMS.map(r => <rect key={`f-${r.key}`} x={r.x} y={r.y} width={r.w} height={r.h} fill={FLOOR_FILL[r.floor]} />)}
          {ROOMS.map(r => <Decor key={`d-${r.key}`} room={r} guests={layout.guests} />)}
          {ROOMS.map(r => (
            <g key={`w-${r.key}`} fill="#6b7280">
              <rect x={r.x} y={r.y + r.h - 1.5} width={r.w} height={3} />
              <rect x={r.x + r.w - 1.5} y={r.y} width={3} height={r.h} />
              {HALLS.some(h => r.y === h.y + h.h) && <rect x={r.x} y={r.y - 1.5} width={r.w} height={3} />}
            </g>
          ))}
          <rect x={0} y={24} width={2} height={H - 24} fill="#6b7280" />
          {DOORS.map((d, i) => <rect key={i} x={d.x} y={d.y} width={d.w} height={d.h} fill="#cbb79a" />)}
          {ROOMS.map(r => (
            <g key={`l-${r.key}`}>
              <rect x={r.x + 4} y={r.y + 3} width={textW(r.label, 4.6) + 5} height={7.5} fill="#fff7e6" stroke={r.color} strokeWidth={0.6} />
              <text x={r.x + 6.5} y={r.y + 8.8} fontSize={4.6} fontWeight={800} fill={r.color}>{r.label}</text>
            </g>
          ))}

          {/* 영업부 프린터 — 가끔 종이가 나온다 */}
          <rect x={241} y={314} width={14} height={2} fill="#f8fafc" className="pxo-paper" />
          {/* 돌아다니는 것들 — 책상보다 먼저 그려 책상 뒤로 지나가게 한다 */}
          <Vacuum x={14} y={318} span={160} />
          <Cat x={122} y={220} span={56} />
          <Cat x={386} y={324} span={110} />
          {JANITOR_ROUTES.map(r => <Janitor key={r.id} route={r} />)}

          {empties.map(e => <EmptyDesk key={e.key} x={e.x} y={e.y} />)}
          {overflow.map(o => <Label key={o.key} x={o.x} y={o.y} text={`+${o.n}`} size={4} anchor="start" />)}

          {/* ── 직원·일꾼·에이전트 ── */}
          {placed.map(p => (
            <Desk key={p.seat.key} seat={p.seat} x={p.x} y={p.y} big={p.big} away={away.has(p.seat.key)}
              picked={picked === p.seat.key} onPick={pick(p.seat)} />
          ))}
          {walkers.map(w => <Walker key={`${w.seat.key}-${w.seat.visit}`} seat={w.seat} from={w.from} to={w.to} onPick={pick(w.seat)} />)}
          {/* 밤 — 사무실 불빛만 남기고 어둡게. 모니터·말풍선은 이 위에 그려 밝게 둔다 */}
          {night && <rect x={0} y={24} width={W} height={H - 24} fill="#0b1026" opacity={0.28} style={{ pointerEvents: 'none' }} />}
          {/* 말풍선은 맨 위에 — 책상 뒤에 가리지 않게 따로 한 번 더 그린다 */}
          {placed.filter(p => !away.has(p.seat.key)).map(p => <Bubble key={`b-${p.seat.key}`} seat={p.seat} x={p.x + 2} y={p.y} />)}
        </svg>
      </div>

      {/* 누른 자리 — 판 위 글자가 작은 휴대폰에서도 읽히게 크게 다시 적는다 */}
      <div ref={detailRef} className="mt-2 min-h-[44px] scroll-mb-24 border-2 border-gray-800 bg-[#fff7e6] px-3 py-2 text-sm dark:border-gray-500 dark:bg-gray-900">
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
