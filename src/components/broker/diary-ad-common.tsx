'use client'

/**
 * 업무일지 3번 '광고현황' — 사무실 공통 칸 (2026-10-29 사장님).
 *
 * 위: 가상사무실 현황판과 같은 숫자(lib/office-board). 오늘 일지를 열면 새로 세어
 *     office_diary_common.ad_board 에 찍어 둔다 — 지난 날짜는 마지막으로 찍힌 숫자를 본다.
 * 아래: 광고현황 메모. 사람마다 한 칸(office_diary_ad_memos).
 *
 * 보이는 범위는 '보고 있는 일지의 주인' 기준이다:
 *   · 대표(김용유)·이사(권세현)의 일지 — 표 전체, 모두의 메모
 *   · 그 밖의 직원 일지 — 표는 '드래곤' 줄과 그 직원 줄, 메모는 대표·이사와 그 직원 것
 * 대표가 직원 일지를 열어도 그 직원 눈높이로 보인다. 메모는 DB 도 같은 규칙으로 막는다(can_see_ad_memo).
 * 숫자를 찍어 두는 건 대표·이사가 열 때만 — 직원 계정은 권한에 따라 덜 셀 수 있어 전체 숫자를 덮으면 안 된다.
 */
import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { fetchOfficeBoard, DIRECTOR_ID, type OfficeBoard } from '@/lib/office-board'
import { todayKST, hmKST } from '@/lib/date-kst'
import { cn } from '@/lib/utils'

const isMissingTable = (e: { code?: string } | null) => e?.code === '42P01' || e?.code === 'PGRST205'

interface Memo { author_id: string; memo: string; updated_at: string }

export function DiaryAdCommon({ num, title, officeId, date, myBrokerId, viewedBrokerId, readOnly }: {
  num: number; title: string; officeId: string | null; date: string
  /** 로그인한 사람 */
  myBrokerId: string | null
  /** 보고 있는 일지의 주인 */
  viewedBrokerId: string | null
  readOnly?: boolean
}) {
  const supabase = createClient()
  const [board, setBoard] = useState<OfficeBoard | null>(null)
  const [boardAt, setBoardAt] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [memos, setMemos] = useState<Memo[]>([])
  const [names, setNames] = useState<Record<string, string>>({})
  const [missing, setMissing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)
  const focusedRef = useRef(false)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const isToday = date === todayKST()
  const isLead = (id: string | null) => !!id && (id === officeId || id === DIRECTOR_ID)
  const fullView = isLead(viewedBrokerId)

  useEffect(() => {
    if (!officeId) return
    let gone = false
    setLoaded(false); setBoard(null); setBoardAt(null); setMemos([])
    void (async () => {
      const [common, ms, ps] = await Promise.all([
        supabase.from('office_diary_common').select('ad_board, ad_board_at').eq('office_id', officeId).eq('date', date).maybeSingle(),
        supabase.from('office_diary_ad_memos').select('author_id, memo, updated_at').eq('office_id', officeId).eq('date', date),
        supabase.from('broker_profiles').select('id, profiles:profiles_visible(name)').or(`id.eq.${officeId},parent_broker_id.eq.${officeId}`),
      ])
      if (gone) return
      const c = common.data as { ad_board: OfficeBoard | null; ad_board_at: string | null } | null
      setBoard(c?.ad_board ?? null)
      setBoardAt(c?.ad_board_at ?? null)
      setMissing(isMissingTable(ms.error))
      const list = (ms.data as Memo[] | null) ?? []
      setMemos(list)
      if (!focusedRef.current) setDraft(list.find(m => m.author_id === myBrokerId)?.memo ?? '')
      setNames(Object.fromEntries(((ps.data as unknown as { id: string; profiles: { name: string | null } | null }[] | null) ?? [])
        .map(p => [p.id, p.profiles?.name ?? '이름 없음'])))
      setLoaded(true)
      // 오늘이면 지금 숫자로 새로 센다. 찍어 두는 건 대표·이사가 열 때만
      if (isToday) {
        const fresh = await fetchOfficeBoard(supabase, officeId)
        if (gone) return
        setBoard(fresh)
        if (isLead(myBrokerId) && !isMissingTable(common.error)) {
          await supabase.from('office_diary_common')
            .upsert({ office_id: officeId, date, ad_board: fresh, ad_board_at: new Date().toISOString() }, { onConflict: 'office_id,date' })
        }
      }
    })()
    return () => { gone = true }
  }, [officeId, date, myBrokerId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const el = taRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = el.scrollHeight + 'px'
  }, [draft, readOnly])

  const mine = memos.find(m => m.author_id === myBrokerId)
  const save = async () => {
    focusedRef.current = false
    if (!officeId || !myBrokerId || draft === (mine?.memo ?? '')) { setFailed(false); return }
    setSaving(true)
    const at = new Date().toISOString()
    const { error } = draft.trim()
      ? await supabase.from('office_diary_ad_memos')
          .upsert({ office_id: officeId, date, author_id: myBrokerId, memo: draft, updated_at: at }, { onConflict: 'office_id,date,author_id' })
      : await supabase.from('office_diary_ad_memos').delete().eq('office_id', officeId).eq('date', date).eq('author_id', myBrokerId)
    setSaving(false)
    setFailed(!!error)
    if (!error) setMemos(ms => [...ms.filter(m => m.author_id !== myBrokerId), ...(draft.trim() ? [{ author_id: myBrokerId, memo: draft, updated_at: at }] : [])])
  }

  // 표 — 대표·이사 일지면 전체, 아니면 드래곤 줄과 그 직원 줄
  const lines = !board ? []
    : fullView ? [...board.rows, board.total]
    : board.rows.filter(r => r.name === '드래곤' || (!!viewedBrokerId && r.ids?.includes(viewedBrokerId)))
  // 메모 — 대표·이사 일지면 모두, 아니면 대표·이사와 그 직원. 내 칸은 아래 입력란으로 따로
  const others = memos
    .filter(m => m.author_id !== myBrokerId && (fullView || isLead(m.author_id) || m.author_id === viewedBrokerId))
    .sort((a, b) => Number(isLead(b.author_id)) - Number(isLead(a.author_id)) || a.updated_at.localeCompare(b.updated_at))
  const showMine = !!myBrokerId && (fullView || isLead(myBrokerId) || myBrokerId === viewedBrokerId)

  return (
    <div className="rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden">
      <div className="flex items-center gap-1.5 px-4 py-3 border-b border-gray-100 dark:border-gray-800 bg-gray-50/50">
        <span className="text-sm font-bold text-gray-500 flex-shrink-0">{num}.</span>
        <span className="text-sm font-bold text-gray-800">{title}</span>
        <span className="ml-1 rounded-md bg-blue-50 px-1.5 py-0.5 text-[11px] font-medium text-blue-600">사무실 공통</span>
        {saving && <span className="text-xs text-gray-500 ml-2">저장 중...</span>}
        {!saving && failed && !readOnly && (
          <button onClick={() => void save()} className="ml-2 text-xs font-medium text-red-500 hover:text-red-600 hover:underline">저장 안 됨 · 다시 저장</button>
        )}
        <a href="/broker/office" className="ml-auto text-xs text-gray-400 hover:text-blue-500">현황판 ›</a>
      </div>

      <div className="px-4 pt-3">
        {lines.length > 0 ? (
          <table className="w-full text-xs tabular-nums">
            <thead>
              <tr className="text-gray-400">
                <th className="py-1 text-left font-medium">담당</th>
                <th className="py-1 text-right font-medium">매물장</th>
                <th className="py-1 text-right font-medium">거래가능</th>
                <th className="py-1 text-right font-medium">뱅크</th>
                <th className="py-1 text-right font-medium">당근(오늘)</th>
              </tr>
            </thead>
            <tbody>
              {lines.map(r => {
                const total = r === board!.total
                return (
                  <tr key={r.name} className={cn('border-t border-gray-100 dark:border-gray-800', total ? 'font-bold text-gray-800 dark:text-gray-100' : 'text-gray-600 dark:text-gray-300')}>
                    <td className="py-1">{r.name}</td>
                    <td className="py-1 text-right">{r.props}</td>
                    <td className="py-1 text-right">{r.avail}</td>
                    <td className="py-1 text-right">{r.bank}</td>
                    <td className="py-1 text-right">{r.daangn}{r.daangnToday > 0 && <span className="text-blue-500"> (+{r.daangnToday})</span>}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        ) : (
          <p className="text-xs text-gray-400">{!loaded || isToday ? '숫자 세는 중...' : '이 날짜엔 남겨 둔 현황판 숫자가 없어요'}</p>
        )}
        {board && (
          <p className="mt-1 text-[11px] text-gray-400">
            {isToday ? `${board.at} 기준` : boardAt ? `그날 ${hmKST(boardAt)} 기준` : ''}
          </p>
        )}
      </div>

      {missing ? (
        <p className="px-4 py-3 text-xs text-gray-400">메모 칸은 준비 중이에요.</p>
      ) : (
        <div className="mt-2 border-t border-gray-100 dark:border-gray-800">
          {others.map(m => (
            <div key={m.author_id} className="px-4 py-2 border-b border-gray-50 dark:border-gray-800/60">
              <p className="text-[11px] text-gray-400 mb-0.5">{names[m.author_id] ?? '이름 없음'} · {hmKST(m.updated_at)}</p>
              <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{m.memo}</p>
            </div>
          ))}
          {showMine && (readOnly ? (
            mine && (
              <div className="px-4 py-2">
                <p className="text-[11px] text-gray-400 mb-0.5">내 메모 · {hmKST(mine.updated_at)}</p>
                <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{mine.memo}</p>
              </div>
            )
          ) : (
            <textarea ref={taRef} value={draft} rows={1}
              onChange={e => setDraft(e.target.value)}
              onFocus={() => { focusedRef.current = true }}
              onBlur={() => void save()}
              placeholder="내 광고현황 메모"
              className="w-full px-4 py-3 text-sm text-gray-700 dark:text-gray-300 placeholder-gray-300 resize-none outline-none overflow-hidden focus:ring-2 focus:ring-blue-400/20 focus:ring-inset min-h-[44px]" />
          ))}
        </div>
      )}
    </div>
  )
}
