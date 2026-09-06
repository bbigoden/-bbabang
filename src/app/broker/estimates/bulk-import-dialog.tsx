'use client'

/**
 * 예전 엑셀 견적서를 여러 개 한꺼번에 읽어 들인다.
 *
 * 쓰임새가 둘이다.
 *  - 품목 사전에만 쌓기: 사장님이 실제로 쓰신 단가를 모으는 것이 목적이다.
 *    이게 쌓여야 새 견적서에서 품명만 쳐도 제 단가가 뜬다.
 *  - 견적서로도 만들기: 지난 견적서를 목록에 되살린다. 다만 거래처명·공사명은
 *    엑셀에서 알 수 없어 비어 있고, 공사명 자리에 파일 이름을 넣어 둔다.
 *
 * 한 장짜리 가져오기(import-dialog)와 달리 여기서는 열을 손으로 고치지 않는다.
 * 자동으로 맞힌 결과를 파일마다 요약해 보여 주고, 이상한 것은 체크를 풀게 한다.
 * 고쳐야 하는 파일은 견적서를 열어 한 장씩 가져오는 쪽이 낫다.
 */

import { useRef, useState } from 'react'
import { useToast } from '@/components/toast'
import { X, Upload, FileSpreadsheet, AlertTriangle, Check } from 'lucide-react'
import { fmtComma, type EstimateItem } from '@/lib/estimate'
import {
  decodeCsv, detectHeaderSpan, findHeaderRow, guessMapping, parseRows,
} from '@/lib/estimate-import'

const MAX_FILE = 5 * 1024 * 1024
const MAX_FILES = 30
const MAX_ROWS = 2000

interface Parsed {
  fileName: string
  /** 확장자를 뗀 이름 — 견적서로 만들 때 공사명 자리에 넣는다 */
  baseName: string
  sheetName: string
  items: EstimateItem[]
  total: number
  mismatched: number
  truncated: number
  use: boolean
}

interface Props {
  onClose: () => void
  onDone: (msg: string) => void
  /** 품목 사전에 쌓기 */
  onCatalog: (items: EstimateItem[]) => Promise<number>
  /** 견적서로 만들기 — 만든 건수를 돌려준다 */
  onEstimates: (list: { name: string; items: EstimateItem[] }[]) => Promise<number>
}

export function BulkImportDialog({ onClose, onDone, onCatalog, onEstimates }: Props) {
  const toast = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [rows, setRows] = useState<Parsed[]>([])

  const pick = async (files: FileList) => {
    if (files.length > MAX_FILES) {
      toast.error(`한 번에 ${MAX_FILES}개까지 읽을 수 있습니다`)
      return
    }
    setBusy(true)
    try {
      const XLSX = await import('xlsx')
      const out: Parsed[] = []

      for (const file of Array.from(files)) {
        if (file.size > MAX_FILE) {
          toast.error(`${file.name}: 5MB 를 넘어 건너뜁니다`)
          continue
        }
        try {
          const buf = await file.arrayBuffer()
          const wb = /\.csv$/i.test(file.name)
            ? XLSX.read(decodeCsv(buf), { type: 'string' })
            : XLSX.read(buf, { type: 'array' })

          // 시트가 여럿이면 내역이 가장 많이 잡히는 것을 고른다
          let best: Parsed | null = null
          for (const sheetName of wb.SheetNames) {
            const all = XLSX.utils.sheet_to_json<string[]>(wb.Sheets[sheetName], {
              header: 1, raw: false, defval: '', blankrows: false,
            }) as string[][]
            const sheet = all.slice(0, MAX_ROWS)
            const headerRow = findHeaderRow(sheet)
            const headerSpan = detectHeaderSpan(sheet, headerRow)
            const cols = guessMapping(sheet, headerRow, headerSpan)
            const r = parseRows(sheet, { headerRow, headerSpan, cols })

            const items: EstimateItem[] = r.items.map((it, i) => {
              const { excelAmount: _x, ...rest } = it
              return { ...rest, sort_order: i }
            })
            const real = items.filter(i => !i.is_header).length
            if (best && real <= best.items.filter(i => !i.is_header).length) continue

            best = {
              fileName: file.name,
              baseName: file.name.replace(/\.[^.]+$/, ''),
              sheetName,
              items,
              total: items.reduce((s, it) => s + (it.is_header ? 0 : it.amount), 0),
              mismatched: r.mismatched,
              truncated: Math.max(0, all.length - MAX_ROWS),
              // 읽어 낸 줄이 없으면 꺼 둔다 — 양식이 달라 손봐야 하는 파일이다
              use: real > 0,
            }
          }
          if (best) out.push(best)
          else toast.error(`${file.name}: 읽을 내용이 없습니다`)
        } catch {
          toast.error(`${file.name}: 읽지 못했습니다`)
        }
      }

      if (out.length === 0) { toast.error('읽어 낸 파일이 없습니다'); return }
      setRows(out)
    } finally {
      setBusy(false)
    }
  }

  const chosen = rows.filter(r => r.use)
  const totalRows = chosen.reduce((s, r) => s + r.items.filter(i => !i.is_header).length, 0)
  const totalAmount = chosen.reduce((s, r) => s + r.total, 0)

  const runCatalog = async () => {
    if (chosen.length === 0) return
    setBusy(true)
    try {
      const n = await onCatalog(chosen.flatMap(r => r.items))
      onDone(`품목 ${n}건을 사전에 쌓았습니다`)
    } catch {
      toast.error('사전에 쌓지 못했습니다')
    } finally {
      setBusy(false)
    }
  }

  const runEstimates = async () => {
    if (chosen.length === 0) return
    setBusy(true)
    try {
      const made = await onEstimates(chosen.map(r => ({ name: r.baseName, items: r.items })))
      onDone(`견적서 ${made}건을 만들었습니다`)
    } catch {
      toast.error('견적서를 만들지 못했습니다')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4">
      <div className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl sm:rounded-2xl dark:bg-gray-900">
        <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3 dark:border-gray-800">
          <h2 className="flex items-center gap-1.5 text-sm font-bold text-gray-900 dark:text-white">
            <FileSpreadsheet className="h-4 w-4 text-gray-500" />예전 견적서 한꺼번에 가져오기
          </h2>
          <button onClick={onClose} aria-label="닫기"
            className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          {rows.length === 0 ? (
            <div className="py-8 text-center">
              <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" multiple className="hidden"
                onChange={e => { if (e.target.files?.length) pick(e.target.files); e.target.value = '' }} />
              <button onClick={() => fileRef.current?.click()} disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50">
                <Upload className="h-4 w-4" />{busy ? '읽는 중…' : '엑셀 파일 여러 개 고르기'}
              </button>
              <p className="mx-auto mt-3 max-w-lg text-xs leading-relaxed text-gray-500">
                예전에 만들어 둔 견적서 엑셀을 한꺼번에 고르시면 됩니다(한 번에 {MAX_FILES}개까지).
                어느 칸이 품명이고 단가인지 알아서 맞히고, 파일마다 몇 줄을 읽었는지 보여 드립니다.
                시트가 여럿이면 내역이 가장 많은 것을 고릅니다.
                파일은 이 화면에서만 읽고 서버에 올라가지 않습니다.
              </p>
            </div>
          ) : (
            <>
              <div className="mb-2 flex items-center justify-between text-sm">
                <span className="font-semibold text-gray-700 dark:text-gray-300">
                  {rows.length}개 파일에서 읽었습니다
                </span>
                <button onClick={() => { setRows([]) }}
                  className="text-xs font-semibold text-blue-600 hover:underline">다시 고르기</button>
              </div>

              <div className="mb-3 overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800">
                {rows.map((r, i) => (
                  <label key={i}
                    className="flex cursor-pointer items-start gap-3 border-b border-gray-100 px-3 py-2.5 last:border-0 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-800/50">
                    <input
                      type="checkbox"
                      checked={r.use}
                      onChange={e => setRows(prev => prev.map((x, j) => j === i ? { ...x, use: e.target.checked } : x))}
                      className="mt-0.5 h-4 w-4 shrink-0 rounded border-gray-300"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-gray-900 dark:text-white">
                        {r.fileName}
                      </span>
                      <span className="mt-0.5 block text-xs text-gray-500">
                        {r.items.filter(x => !x.is_header).length === 0
                          ? <span className="font-semibold text-amber-700 dark:text-amber-400">
                              읽어 낸 줄이 없습니다 — 견적서를 열어 한 장씩 가져오세요
                            </span>
                          : <>
                              내역 {r.items.filter(x => !x.is_header).length}줄
                              {r.items.some(x => x.is_header) && ` · 공종 ${r.items.filter(x => x.is_header).length}개`}
                              {' · '}{fmtComma(r.total)}원
                              {wb(r.sheetName)}
                            </>}
                      </span>
                      {(r.mismatched > 0 || r.truncated > 0) && (
                        <span className="mt-1 flex items-start gap-1 text-xs text-amber-700 dark:text-amber-400">
                          <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
                          {r.mismatched > 0 && `${r.mismatched}줄은 엑셀 금액과 수량×단가가 다릅니다. `}
                          {r.truncated > 0 && `${r.truncated}줄은 너무 길어 잘렸습니다.`}
                        </span>
                      )}
                    </span>
                  </label>
                ))}
              </div>

              <p className="text-sm text-gray-700 dark:text-gray-300">
                고른 {chosen.length}개 · 내역 <b>{totalRows}줄</b> · 합계 <b>{fmtComma(totalAmount)}원</b>
              </p>
            </>
          )}
        </div>

        {rows.length > 0 && (
          <div className="border-t border-gray-100 px-4 py-3 dark:border-gray-800">
            <div className="flex flex-wrap items-center justify-end gap-2">
              <button onClick={onClose}
                className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300">
                취소
              </button>
              <button onClick={runEstimates} disabled={busy || chosen.length === 0}
                className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300">
                견적서로도 만들기
              </button>
              <button onClick={runCatalog} disabled={busy || chosen.length === 0}
                className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50">
                <Check className="h-4 w-4" />{busy ? '넣는 중…' : '품목 사전에만 쌓기'}
              </button>
            </div>
            <p className="mt-2 text-right text-xs text-gray-500">
              견적서로 만들면 품목 사전에도 함께 쌓입니다. 거래처명·공사명은 엑셀에 없어
              비어 있고, 공사명 자리에 파일 이름이 들어갑니다.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

/** 시트가 하나뿐인 흔한 경우엔 시트 이름을 굳이 보여 주지 않는다 */
function wb(sheetName: string) {
  return sheetName && sheetName !== 'Sheet1' ? ` · [${sheetName}]` : ''
}
