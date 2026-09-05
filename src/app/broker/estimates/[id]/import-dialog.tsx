'use client'

/**
 * 예전 엑셀 견적서를 내역으로 가져온다.
 *
 * 양식이 집집마다 다르므로 자동으로 맞혀 놓고, 틀린 곳만 고치게 한다.
 * 파일은 브라우저에서만 읽고 서버로 보내지 않는다.
 */

import { useRef, useState } from 'react'
import { useToast } from '@/components/toast'
import { X, Upload, FileSpreadsheet, AlertTriangle } from 'lucide-react'
import { fmtComma, type EstimateItem } from '@/lib/estimate'
import {
  FIELD_LABEL, findHeaderRow, guessMapping, parseRows,
  type Field, type Mapping, type ParseResult, type Sheet,
} from '@/lib/estimate-import'

const MAX_FILE = 5 * 1024 * 1024
const MAX_ROWS = 2000

const FIELD = 'w-full rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm dark:border-gray-800 dark:bg-gray-900 dark:text-white'

interface Props {
  hasItems: boolean
  onClose: () => void
  onApply: (items: EstimateItem[], mode: 'replace' | 'append') => void
}

export function ImportDialog({ hasItems, onClose, onApply }: Props) {
  const toast = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [fileName, setFileName] = useState('')
  const [sheets, setSheets] = useState<Sheet[]>([])
  const [sheetIdx, setSheetIdx] = useState(0)
  const [map, setMap] = useState<Mapping | null>(null)

  const sheet = sheets[sheetIdx]
  const result: ParseResult | null = sheet && map ? parseRows(sheet.rows, map) : null
  const total = result?.items.reduce((s, it) => s + (it.is_header ? 0 : it.amount), 0) ?? 0

  const pick = async (file: File) => {
    if (file.size > MAX_FILE) { toast.error('5MB 이하 파일만 읽을 수 있습니다'); return }
    setBusy(true)
    try {
      // 엑셀 읽기는 이 화면에서만 쓰므로 열 때 가져온다 (평소 앱을 무겁게 하지 않게)
      const XLSX = await import('xlsx')
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf, { type: 'array' })

      const got: Sheet[] = wb.SheetNames.map(name => {
        const ws = wb.Sheets[name]
        const rows = XLSX.utils.sheet_to_json<string[]>(ws, {
          header: 1, raw: false, defval: '', blankrows: false,
        }) as string[][]
        return { name, rows: rows.slice(0, MAX_ROWS) }
      }).filter(s => s.rows.length > 0)

      if (got.length === 0) { toast.error('읽을 내용이 없습니다'); return }

      setSheets(got)
      setFileName(file.name)
      chooseSheet(got, 0)
    } catch {
      toast.error('파일을 읽지 못했습니다. 엑셀(.xlsx)이나 CSV 인지 확인해주세요.')
    } finally {
      setBusy(false)
    }
  }

  /** 시트를 고를 때마다 머리글과 열을 다시 맞혀 본다 */
  const chooseSheet = (list: Sheet[], idx: number) => {
    setSheetIdx(idx)
    const rows = list[idx].rows
    const headerRow = findHeaderRow(rows)
    setMap({ headerRow, cols: guessMapping(rows, headerRow) })
  }

  const setCol = (f: Field, col: number) =>
    setMap(m => m ? { ...m, cols: { ...m.cols, [f]: col } } : m)

  const setHeaderRow = (r: number) => {
    if (!sheet) return
    // 머리글 줄을 바꾸면 열도 다시 맞혀 준다
    setMap({ headerRow: r, cols: guessMapping(sheet.rows, r) })
  }

  const apply = (mode: 'replace' | 'append') => {
    if (!result || result.items.length === 0) return
    const items: EstimateItem[] = result.items.map((it, i) => {
      const { excelAmount: _x, ...rest } = it
      return { ...rest, sort_order: i }
    })
    onApply(items, mode)
  }

  const colCount = sheet ? Math.max(...sheet.rows.slice(0, 50).map(r => r.length), 0) : 0
  const preview = sheet ? sheet.rows.slice(0, 12) : []

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4">
      <div className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl sm:rounded-2xl dark:bg-gray-900">
        <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3 dark:border-gray-800">
          <h2 className="flex items-center gap-1.5 text-sm font-bold text-gray-900 dark:text-white">
            <FileSpreadsheet className="h-4 w-4 text-gray-500" />엑셀에서 내역 가져오기
          </h2>
          <button onClick={onClose} aria-label="닫기"
            className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          {sheets.length === 0 ? (
            <div className="py-8 text-center">
              <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) pick(f); e.target.value = '' }} />
              <button onClick={() => fileRef.current?.click()} disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50">
                <Upload className="h-4 w-4" />{busy ? '읽는 중…' : '엑셀 파일 고르기'}
              </button>
              <p className="mx-auto mt-3 max-w-md text-xs leading-relaxed text-gray-500">
                예전에 만들어 둔 견적서 엑셀(.xlsx·.csv)을 그대로 올리시면 됩니다.
                어느 칸이 품명이고 단가인지 알아서 맞혀 보고, 틀린 곳만 고치시면 됩니다.
                파일은 이 화면에서만 읽고 서버에 올라가지 않습니다. (5MB 이하)
              </p>
            </div>
          ) : (
            <>
              <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
                <span className="font-semibold text-gray-700 dark:text-gray-300">{fileName}</span>
                {sheets.length > 1 && (
                  <select value={sheetIdx} onChange={e => chooseSheet(sheets, Number(e.target.value))}
                    aria-label="시트 고르기" className={`${FIELD} w-auto`}>
                    {sheets.map((s, i) => <option key={i} value={i}>{s.name}</option>)}
                  </select>
                )}
                <button onClick={() => { setSheets([]); setMap(null) }}
                  className="text-xs font-semibold text-blue-600 hover:underline">다른 파일</button>
              </div>

              {/* 미리보기 — 머리글 줄을 눌러서 고른다 */}
              <p className="mb-1.5 text-xs text-gray-500">
                머리글(공종·품명·단가…)이 있는 줄을 눌러 주세요. 그 아래부터 내역으로 읽습니다.
              </p>
              <div className="mb-4 max-h-56 overflow-auto rounded-xl border border-gray-200 dark:border-gray-800">
                <table className="w-full text-xs">
                  <tbody>
                    {preview.map((row, r) => (
                      <tr key={r}
                        onClick={() => setHeaderRow(r)}
                        className={`cursor-pointer border-b border-gray-100 last:border-0 dark:border-gray-800 ${
                          map?.headerRow === r
                            ? 'bg-blue-50 font-bold dark:bg-blue-500/20'
                            : 'hover:bg-gray-50 dark:hover:bg-gray-800/50'
                        }`}>
                        <td className="w-8 px-2 py-1 text-right text-gray-400">{r + 1}</td>
                        {Array.from({ length: colCount }, (_, c) => (
                          <td key={c} className="max-w-[10rem] truncate px-2 py-1 text-gray-700 dark:text-gray-300">
                            {row[c] ?? ''}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* 열 맞추기 */}
              <p className="mb-1.5 text-xs text-gray-500">
                어느 칸이 무엇인지 확인해 주세요. <span className="font-semibold">품명</span>만 있으면 가져올 수 있습니다.
              </p>
              <div className="mb-4 grid gap-2 sm:grid-cols-3">
                {(Object.keys(FIELD_LABEL) as Field[]).map(f => (
                  <div key={f}>
                    <label className="mb-0.5 block text-xs font-semibold text-gray-500" htmlFor={`col-${f}`}>
                      {FIELD_LABEL[f]}
                    </label>
                    <select id={`col-${f}`} value={map?.cols[f] ?? -1}
                      onChange={e => setCol(f, Number(e.target.value))} className={FIELD}>
                      <option value={-1}>— 없음 —</option>
                      {Array.from({ length: colCount }, (_, c) => (
                        <option key={c} value={c}>
                          {map && map.headerRow >= 0 && sheet.rows[map.headerRow]?.[c]
                            ? `${c + 1}. ${sheet.rows[map.headerRow][c]}`
                            : `${c + 1}번째 칸`}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>

              {/* 읽어 낸 결과 */}
              {result && (
                <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-950/50">
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">
                    내역 {result.items.filter(i => !i.is_header).length}줄
                    {result.items.some(i => i.is_header) &&
                      ` · 공정 구분 ${result.items.filter(i => i.is_header).length}줄`}
                    {' · 합계 '}{fmtComma(total)}원
                  </p>
                  {result.skippedTotals > 0 && (
                    <p className="mt-1 text-xs text-gray-500">
                      소계·합계 줄 {result.skippedTotals}개는 건너뛰었습니다 (여기서는 알아서 다시 셈합니다).
                    </p>
                  )}
                  {result.mismatched > 0 && (
                    <p className="mt-1.5 flex items-start gap-1.5 text-xs font-semibold text-amber-700 dark:text-amber-400">
                      <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
                      {result.mismatched}줄은 엑셀에 적힌 금액과 수량×단가가 다릅니다.
                      가져온 뒤 그 줄들을 한 번 확인해 주세요 — 여기서는 수량×단가로 넣습니다.
                    </p>
                  )}
                  {result.items.length === 0 && (
                    <p className="mt-1 text-xs text-gray-500">
                      읽어 낼 줄이 없습니다. 머리글 줄과 품명 칸을 다시 골라 주세요.
                    </p>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {sheets.length > 0 && (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-gray-100 px-4 py-3 dark:border-gray-800">
            <button onClick={onClose}
              className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300">
              취소
            </button>
            {hasItems && (
              <button onClick={() => apply('append')} disabled={!result?.items.length}
                className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300">
                아래에 이어붙이기
              </button>
            )}
            <button onClick={() => apply('replace')} disabled={!result?.items.length}
              className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50">
              {hasItems ? '지금 내역과 바꾸기' : '내역에 넣기'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
