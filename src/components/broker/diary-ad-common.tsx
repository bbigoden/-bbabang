'use client'

/**
 * 업무일지 3번 '광고현황' — 사무실 공통 칸 (2026-10-29 사장님).
 *
 * 위: 가상사무실 현황판과 같은 숫자(lib/office-board). 오늘 일지를 열면 새로 세어
 *     office_diary_common.ad_board 에 찍어 둔다 — 지난 날짜는 마지막으로 찍힌 숫자를 본다.
 * 아래: 모두가 같이 쓰는 메모 한 칸. 누가 써도 모든 직원 일지에 같은 글.
 *
 * 표는 대표(김용유)·이사(권세현)만 전체를 본다. 나머지 직원은 '드래곤' 줄과 자기 줄만(2026-10-29 사장님).
 * 숫자를 찍어 두는 것도 둘만 한다 — 직원 계정은 권한에 따라 덜 셀 수 있어 전체 숫자를 덮으면 안 된다.
 *
 * 예전처럼 사람마다 적어 둔 광고현황(sections_content.s_ad)이 있으면 그 날짜에만 '내 메모'로 보여 준다.
 */
import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { fetchOfficeBoard, DIRECTOR_ID, type OfficeBoard } from '@/lib/office-board'
import { todayKST, hmKST } from '@/lib/date-kst'
import { cn } from '@/lib/utils'

const isMissingTable = (e: { code?: string } | null) => e?.code === '42P01' || e?.code === 'PGRST205'

interface CommonRow { ad_board: OfficeBoard | null; ad_board_at: string | null; ad_memo: string | null; memo_at: string | null; memo_by: string | null }

export function DiaryAdCommon({ num, title, officeId, date, myBrokerId, ownContent, readOnly }: {
  num: number; title: string; officeId: string | null; date: string; myBrokerId: string | null
  /** 예전에 이 사람 일지에 따로 적어 둔 광고현황 */
  ownContent: string | null
  readOnly?: boolean
}) {
  const supabase = createClient()
  const [row, setRow] = useState<CommonRow | null>(null)
  const [board, setBoard] = useState<OfficeBoard | null>(null)
  const [missing, setMissing] = useState(false)
  const [memoBy, setMemoBy] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)
  const focusedRef = useRef(false)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const isToday = date === todayKST()
  const fullView = !!myBrokerId && (myBrokerId === officeId || myBrokerId === DIRECTOR_ID)

  useEffect(() => {
    if (!officeId) return
    let gone = false
    setRow(null); setBoard(null); setMemoBy(null)
    void (async () => {
      const { data, error } = await supabase.from('office_diary_common')
        .select('ad_board, ad_board_at, ad_memo, memo_at, memo_by').eq('office_id', officeId).eq('date', date).maybeSingle()
      if (gone) return
      if (isMissingTable(error)) setMissing(true)
      const r = (data as CommonRow | null) ?? { ad_board: null, ad_board_at: null, ad_memo: null, memo_at: null, memo_by: null }
      setRow(r)
      if (!focusedRef.current) setDraft(r.ad_memo ?? '')
      setBoard(r.ad_board)
      if (r.memo_by) {
        const { data: p } = await supabase.from('broker_profiles').select('profiles:profiles_visible(name)').eq('id', r.memo_by).maybeSingle()
        if (!gone) setMemoBy((p as unknown as { profiles: { name: string | null } | null } | null)?.profiles?.name ?? null)
      }
      // 오늘이면 지금 숫자로 새로 센다. 찍어 두는 건 대표·이사만 — 메모 칸은 건드리지 않는다
      if (isToday) {
        const fresh = await fetchOfficeBoard(supabase, officeId)
        if (gone) return
        setBoard(fresh)
        if (fullView && !isMissingTable(error)) {
          await supabase.from('office_diary_common')
            .upsert({ office_id: officeId, date, ad_board: fresh, ad_board_at: new Date().toISOString() }, { onConflict: 'office_id,date' })
        }
      }
    })()
    return () => { gone = true }
  }, [officeId, date]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const el = taRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = el.scrollHeight + 'px'
  }, [draft, readOnly])

  const save = async () => {
    focusedRef.current = false
    if (!officeId || draft === (row?.ad_memo ?? '')) { setFailed(false); return }
    setSaving(true)
    const at = new Date().toISOString()
    const { error } = await supabase.from('office_diary_common')
      .upsert({ office_id: officeId, date, ad_memo: draft || null, memo_by: myBrokerId, memo_at: at }, { onConflict: 'office_id,date' })
    setSaving(false)
    setFailed(!!error)
    if (!error) {
      setRow(r => ({ ...(r ?? { ad_board: null, ad_board_at: null, memo_by: null }), ad_memo: draft || null, memo_at: at, memo_by: myBrokerId }))
      setMemoBy('나')
    }
  }

  const lines = !board ? []
    : fullView ? [...board.rows, board.total]
    : board.rows.filter(r => r.name === '드래곤' || (!!myBrokerId && r.ids?.includes(myBrokerId)))
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
          <p className="text-xs text-gray-400">{row === null ? '숫자 세는 중...' : '이 날짜엔 남겨 둔 현황판 숫자가 없어요'}</p>
        )}
        {board && (
          <p className="mt-1 text-[11px] text-gray-400">
            {isToday ? `${board.at} 기준` : row?.ad_board_at ? `그날 ${hmKST(row.ad_board_at)} 기준` : ''}
          </p>
        )}
      </div>

      {missing ? (
        <p className="px-4 py-3 text-xs text-gray-400">공통 메모 칸은 준비 중이에요.</p>
      ) : readOnly ? (
        <div className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap min-h-[44px]">{row?.ad_memo || <span className="text-gray-300">—</span>}</div>
      ) : (
        <textarea ref={taRef} value={draft} rows={1}
          onChange={e => setDraft(e.target.value)}
          onFocus={() => { focusedRef.current = true }}
          onBlur={() => void save()}
          placeholder="공통 메모 — 모든 직원 일지에 같이 보여요"
          className="mt-2 w-full border-t border-gray-100 dark:border-gray-800 px-4 py-3 text-sm text-gray-700 dark:text-gray-300 placeholder-gray-300 resize-none outline-none overflow-hidden focus:ring-2 focus:ring-blue-400/20 focus:ring-inset min-h-[44px]" />
      )}
      {!missing && row?.ad_memo && row.memo_at && (
        <p className="px-4 pb-2 text-[11px] text-gray-400">마지막 수정: {memoBy ?? ''} {hmKST(row.memo_at)}</p>
      )}

      {ownContent && (
        <div className="mx-4 mb-3 rounded-lg bg-gray-50 dark:bg-gray-800/50 px-3 py-2">
          <p className="text-[11px] text-gray-400 mb-0.5">이 일지에 따로 적어 둔 광고현황</p>
          <p className="text-xs text-gray-600 dark:text-gray-300 whitespace-pre-wrap">{ownContent}</p>
        </div>
      )}
    </div>
  )
}
