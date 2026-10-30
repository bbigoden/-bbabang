'use client'

/**
 * 업무일지 3번 '광고현황' — 사무실 공통 칸 (2026-10-29 사장님).
 *
 * 위: 가상사무실 현황판과 같은 숫자(lib/office-board). 오늘 일지를 열면 새로 세어
 *     office_diary_common.ad_board 에 찍어 둔다 — 지난 날짜는 마지막으로 찍힌 숫자를 본다.
 * 아래: 광고현황 메모. 사람마다 한 칸(office_diary_ad_memos).
 *
 * 보이는 범위는 '보고 있는 일지의 주인' 기준이다:
 *   · 대표(김용유)·이사(권세현)의 일지 — 표 전체
 *   · 그 밖의 직원 일지 — 표는 '드래곤'·그 직원·사무실 전체 줄(다른 직원 줄만 뺀다)
 * 메모는 일지의 다른 칸과 같다 — 그 일지 주인의 메모 한 칸만, 본인과 대표만 본다(2026-10-30 사장님).
 * 이사 메모도 직원에게 보이지 않는다. 고치기는 자기 메모, 대표는 모두의 메모. DB 도 같은 규칙(can_see_ad_memo).
 * 숫자를 찍어 두는 건 대표·이사가 열 때만 — 직원 계정은 권한에 따라 덜 셀 수 있어 전체 숫자를 덮으면 안 된다.
 */
import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { fetchOfficeBoard, DIRECTOR_ID, type OfficeBoard } from '@/lib/office-board'
import { todayKST, hmKST } from '@/lib/date-kst'
import { cn } from '@/lib/utils'

const isMissingTable = (e: { code?: string } | null) => e?.code === '42P01' || e?.code === 'PGRST205'
const n = (v: number) => v.toLocaleString()

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
  const [missing, setMissing] = useState(false)
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
        supabase.from('broker_profiles').select('id, is_approved, profiles:profiles_visible(name)').or(`id.eq.${officeId},parent_broker_id.eq.${officeId}`),
      ])
      if (gone) return
      const c = common.data as { ad_board: OfficeBoard | null; ad_board_at: string | null } | null
      setBoard(c?.ad_board ?? null)
      setBoardAt(c?.ad_board_at ?? null)
      setMissing(isMissingTable(ms.error))
      const list = (ms.data as Memo[] | null) ?? []
      setMemos(list)
      const people = (ps.data as unknown as { id: string; is_approved: boolean | null; profiles: { name: string | null } | null }[] | null) ?? []
      setLoaded(true)
      // 오늘이면 지금 숫자로 새로 센다. 찍어 두는 건 대표·이사가 열 때만
      if (isToday) {
        // 위에서 받은 명단을 넘겨 다시 묻지 않는다(느린 폰 회선에서 왕복 하나 = 2초)
        const members = people.filter(m => m.id === officeId || m.is_approved)
          .sort((a, b) => (a.id === officeId ? -1 : b.id === officeId ? 1 : 0))
        const fresh = await fetchOfficeBoard(supabase, officeId, ps.error ? undefined : members)
        if (gone) return
        setBoard(fresh)
        if (isLead(myBrokerId) && !isMissingTable(common.error)) {
          await supabase.from('office_diary_common')
            .upsert({ office_id: officeId, date, ad_board: fresh, ad_board_at: new Date().toISOString() }, { onConflict: 'office_id,date' })
        }
      }
    })()
    return () => { gone = true }
  }, [officeId, date, myBrokerId, viewedBrokerId]) // eslint-disable-line react-hooks/exhaustive-deps

  // 메모는 '이 일지 주인의 메모' 한 칸만 — 일지의 다른 칸처럼 남의 메모는 보이지 않는다
  const mine = memos.find(m => m.author_id === viewedBrokerId)
  // 고치기: 자기 메모, 그리고 대표는 모두의 메모(2026-10-29 사장님). 대표가 고쳐도 글의 주인은 그대로다
  const canEdit = (author: string) => !readOnly && !!myBrokerId && (author === myBrokerId || myBrokerId === officeId)
  const save = async (author: string, text: string): Promise<boolean> => {
    if (!officeId) return false
    const at = new Date().toISOString()
    const { error } = text.trim()
      ? await supabase.from('office_diary_ad_memos')
          .upsert({ office_id: officeId, date, author_id: author, memo: text, updated_at: at }, { onConflict: 'office_id,date,author_id' })
      : await supabase.from('office_diary_ad_memos').delete().eq('office_id', officeId).eq('date', date).eq('author_id', author)
    if (!error) setMemos(ms => [...ms.filter(m => m.author_id !== author), ...(text.trim() ? [{ author_id: author, memo: text, updated_at: at }] : [])])
    return !error
  }

  // 표 — 대표·이사 일지면 전체, 아니면 다른 직원 줄만 빼고 드래곤·그 직원·사무실 전체(2026-10-29 사장님)
  const lines = !board ? []
    : fullView ? [...board.rows, board.total]
    : [...board.rows.filter(r => r.name === '드래곤' || (!!viewedBrokerId && r.ids?.includes(viewedBrokerId))), board.total]

  return (
    <div className="rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden">
      <div className="flex items-center gap-1.5 px-4 py-3 border-b border-gray-100 dark:border-gray-800 bg-gray-50/50">
        <span className="text-sm font-bold text-gray-500 flex-shrink-0">{num}.</span>
        <span className="text-sm font-bold text-gray-800">{title}</span>
        <a href="/broker/office" className="ml-auto text-xs text-gray-400 hover:text-blue-500">현황판 ›</a>
      </div>

      <div className="px-4 pt-3">
        {lines.length > 0 ? (
          // 현황판 칠판과 같은 칸 — 이름 · 매물장(거래가능)(+오늘) · 뱅크 · 당근(+오늘). 숫자는 오른쪽 끝을 맞춘다
          <table className="w-full table-fixed text-[13px] tabular-nums">
            <colgroup><col className="w-[28%]" /><col className="w-[32%]" /><col className="w-[16%]" /><col className="w-[24%]" /></colgroup>
            <thead>
              <tr className="text-[11px] text-gray-400">
                <th className="pb-1.5 text-left font-medium">담당</th>
                <th className="pb-1.5 pr-[calc(0.75rem+2.6em)] text-right font-medium">매물장<span className="text-gray-300">(거래가능)</span></th>
                <th className="pb-1.5 pr-3 text-right font-medium">뱅크</th>
                <th className="pb-1.5 pr-7 text-right font-medium">당근</th>
              </tr>
            </thead>
            <tbody>
              {lines.map(r => {
                const total = r === board!.total
                return (
                  <tr key={r.name} className={cn(total ? 'border-t border-gray-200 dark:border-gray-700 font-bold text-gray-900 dark:text-gray-100' : 'text-gray-700 dark:text-gray-300')}>
                    <td className="py-1 truncate">{r.name}</td>
                    <td className="py-1 pr-3 text-right">
                      {/* 매물장(거래가능)은 붙여서 오른쪽 끝 맞춤, +오늘은 그 뒤 고정 칸(2026-10-29 사장님 엑셀 모양) */}
                      {n(r.props)}<span className="text-[11px] font-normal text-gray-400">({n(r.avail)})</span>
                      <span className="inline-block w-[2.6em] pl-[0.4em] text-left text-[11px] font-medium text-emerald-500">{r.propsToday ? `+${r.propsToday}` : ''}</span>
                    </td>
                    <td className="py-1 pr-3 text-right whitespace-nowrap">
                      {n(r.bank)}<span className="ml-1 inline-block w-6 text-left text-[11px] font-medium text-emerald-500">{r.bankToday ? `+${r.bankToday}` : ''}</span>
                    </td>
                    <td className="py-1 text-right whitespace-nowrap">
                      {n(r.daangn)}<span className="ml-1 inline-block w-6 text-left text-[11px] font-medium text-emerald-500">{r.daangnToday > 0 ? `+${r.daangnToday}` : ''}</span>
                    </td>
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

      {/* 메모는 불러온 뒤에만 — 다 오기 전에 칸을 눌렀다 나가면 빈 글로 저장돼 남의 메모가 지워질 수 있다 */}
      {!loaded ? null : missing ? (
        <p className="px-4 py-3 text-xs text-gray-400">메모 칸은 준비 중이에요.</p>
      ) : (
        <div className="mt-2 border-t border-gray-100 dark:border-gray-800">
          {viewedBrokerId && (
            <MemoBox key={`${date}|${viewedBrokerId}`} memo={mine}
              editable={canEdit(viewedBrokerId)} onSave={t => save(viewedBrokerId, t)} />
          )}
        </div>
      )}
    </div>
  )
}

/** 메모 한 칸 — 고칠 수 있으면 입력란, 아니면 글만. 저장은 칸을 벗어날 때. */
function MemoBox({ memo, editable, onSave }: {
  memo: Memo | undefined; editable: boolean
  onSave: (text: string) => Promise<boolean>
}) {
  const [draft, setDraft] = useState(memo?.memo ?? '')
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)
  const focusedRef = useRef(false)
  const taRef = useRef<HTMLTextAreaElement>(null)
  // 입력 중이 아닐 때만 저장된 글로 맞춘다 — 이어 쓰던 글자를 덮지 않게
  useEffect(() => { if (!focusedRef.current) setDraft(memo?.memo ?? '') }, [memo?.memo])
  useEffect(() => {
    const el = taRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = el.scrollHeight + 'px'
  }, [draft, editable])
  const save = async () => {
    focusedRef.current = false
    if (draft === (memo?.memo ?? '')) { setFailed(false); return }
    setSaving(true)
    setFailed(!(await onSave(draft)))
    setSaving(false)
  }
  const head = (saving || failed) && (
    <p className="px-4 text-[11px] text-gray-400">
      {saving && <span className="ml-2 text-gray-500">저장 중...</span>}
      {!saving && failed && (
        <button onClick={() => void save()} className="ml-2 font-medium text-red-500 hover:underline">저장 안 됨 · 다시 저장</button>
      )}
    </p>
  )
  if (!editable) {
    return (
      <div className="py-2 border-b border-gray-50 dark:border-gray-800/60 last:border-b-0">
        {head}
        <p className="px-4 pt-0.5 text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{memo?.memo || <span className="text-gray-300">—</span>}</p>
      </div>
    )
  }
  return (
    <div className="pt-2 border-b border-gray-50 dark:border-gray-800/60 last:border-b-0">
      {head}
      <textarea ref={taRef} value={draft} rows={1}
        onChange={e => setDraft(e.target.value)}
        onFocus={() => { focusedRef.current = true }}
        onBlur={() => void save()}
        placeholder="광고현황 입력..."
        className="w-full px-4 pt-0.5 pb-2 text-sm text-gray-700 dark:text-gray-300 placeholder-gray-300 resize-none outline-none overflow-hidden focus:ring-2 focus:ring-blue-400/20 focus:ring-inset min-h-[36px]" />
    </div>
  )
}
