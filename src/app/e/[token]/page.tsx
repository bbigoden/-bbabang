/**
 * 견적서 공개 열람 (로그인 없이 링크로 본다).
 *
 * 카톡으로 링크를 보내면 거래처가 바로 열어본다. PDF 를 첨부하는 것보다 가볍고,
 * 열어봤는지 알 수 있어 영업에 쓸모가 있다.
 *
 * 서버에서 get_shared_estimate RPC 로만 읽는다 — 그 함수가 토큰을 검사하고
 * 내보낼 필드를 좁게 고정하므로, 원가·발송이력 같은 내부 정보는 나가지 않는다.
 */

import { Fragment } from 'react'
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import {
  fmtComma, koreanAmount, sectionSums, splitTotals, isSplitPricing, validUntil, type VatMode,
} from '@/lib/estimate'
import { FileText } from 'lucide-react'

export const dynamic = 'force-dynamic'

interface SharedItem {
  sort_order: number
  is_header: boolean
  category: string | null
  name: string | null
  spec: string | null
  unit: string | null
  qty: number
  unit_price: number
  material_price: number
  labor_price: number
  amount: number
  remark: string | null
}

interface SharedEstimate {
  estimate_no: string
  issue_date: string
  valid_days: number
  client_name: string | null
  client_contact: string | null
  site_address: string | null
  project_name: string | null
  period: string | null
  payment_terms: string | null
  notes: string | null
  overhead_rate: number
  discount: number
  vat_mode: VatMode
  subtotal: number
  overhead_amount: number
  supply_amount: number
  vat: number
  total: number
  company: Record<string, string | null> | null
  items: SharedItem[]
}

async function load(token: string): Promise<SharedEstimate | null> {
  const supabase = await createClient()
  const { data } = await supabase.rpc('get_shared_estimate', { p_token: token })
  return (data as SharedEstimate) ?? null
}

export async function generateMetadata(
  { params }: { params: Promise<{ token: string }> }
): Promise<Metadata> {
  const { token } = await params
  const e = await load(token)
  if (!e) return { title: '견적서', robots: { index: false, follow: false } }

  const title = `${e.project_name || '공사'} 견적서`
  const description = `${e.company?.name ?? ''} · 합계 ${fmtComma(e.total)}원 · ${e.issue_date} 발행`
  return {
    title,
    description,
    // 링크 미리보기(카톡·문자)용. 검색엔진에는 올리지 않는다
    robots: { index: false, follow: false },
    openGraph: { title, description, type: 'website' },
  }
}

export default async function SharedEstimatePage(
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params
  const e = await load(token)

  if (!e) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gray-50 px-4 dark:bg-gray-950">
        <div className="text-center">
          <FileText className="mx-auto mb-3 h-10 w-10 text-gray-300 dark:text-gray-700" />
          <h1 className="mb-1 text-lg font-bold text-gray-900 dark:text-white">견적서를 볼 수 없습니다</h1>
          <p className="text-sm text-gray-500">링크가 만료되었거나 회수되었습니다. 보내주신 분께 문의해주세요.</p>
        </div>
      </main>
    )
  }

  const co = e.company ?? {}
  const until = validUntil(e.issue_date, e.valid_days)
  // 공종 구분이 둘 이상일 때만 소계를 찍는다 (하나뿐이면 전체 합계와 같다)
  const subs = new Map(sectionSums(e.items).map(x => [x.afterIndex, x]))
  // 재료비·인건비를 나눠 적었으면 그대로 보여 준다 (원가는 나가지 않는다)
  const split = isSplitPricing(e.items)
  const st = split ? splitTotals(e.items) : null
  const cols = split ? 9 : 7

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-8 dark:bg-gray-950">
      <div className="mx-auto max-w-3xl">
        <div className="rounded-2xl bg-white p-6 shadow-sm dark:bg-gray-900 sm:p-8">
          <h1 className="mb-1 text-center text-2xl font-black tracking-[0.3em] text-gray-900 dark:text-white">견 적 서</h1>
          <p className="mb-6 text-center text-xs text-gray-500">
            견적번호 {e.estimate_no} · 발행일 {e.issue_date}
          </p>

          <div className="mb-6 grid gap-4 sm:grid-cols-2">
            <section className="rounded-xl border border-gray-200 p-4 dark:border-gray-800">
              <h2 className="mb-2 text-xs font-bold text-gray-500">수신</h2>
              <p className="mb-2 text-lg font-bold text-gray-900 dark:text-white">{e.client_name || ''} 귀중</p>
              {e.client_contact && <Line k="담당자" v={e.client_contact} />}
              {e.site_address && <Line k="현장" v={e.site_address} />}
            </section>

            <section className="rounded-xl border border-gray-200 p-4 dark:border-gray-800">
              <h2 className="mb-2 text-xs font-bold text-gray-500">공급자</h2>
              <p className="mb-2 text-lg font-bold text-gray-900 dark:text-white">{co.name ?? ''}</p>
              {co.ceo && <Line k="대표자" v={co.ceo} />}
              {co.biz_no && <Line k="등록번호" v={co.biz_no} />}
              {co.address && <Line k="소재지" v={co.address} />}
              {co.phone && <Line k="연락처" v={co.phone} />}
              {(co.manager_name || co.manager_phone) && (
                <Line k="담당자" v={[co.manager_name, co.manager_phone].filter(Boolean).join(' ')} />
              )}
            </section>
          </div>

          <div className="mb-6 flex flex-wrap items-center justify-between gap-2 rounded-xl border-2 border-blue-700 px-4 py-3 dark:border-blue-500">
            <span className="text-sm font-bold text-blue-800 dark:text-blue-300">합계금액</span>
            <span className="text-lg font-bold text-gray-900 dark:text-white">{koreanAmount(e.total)}</span>
            <span className="text-lg font-black text-blue-800 dark:text-blue-300">₩{fmtComma(e.total)}</span>
          </div>

          <dl className="mb-6 grid gap-x-4 gap-y-2 rounded-xl border border-gray-200 p-4 text-sm dark:border-gray-800 sm:grid-cols-2">
            <Field k="공사명" v={e.project_name} />
            <Field k="공사기간" v={e.period} />
            <Field k="유효기간" v={`${e.issue_date} ~ ${until}`} />
            <Field k="결제조건" v={e.payment_terms} />
          </dl>

          <div className="mb-4 overflow-x-auto">
            <table className={`w-full ${split ? 'min-w-[46rem]' : 'min-w-[36rem]'} text-sm`}>
              <thead className="border-y border-gray-300 bg-gray-50 text-xs dark:border-gray-700 dark:bg-gray-950/50">
                <tr>
                  <th className="px-2 py-2 text-left font-bold">공종</th>
                  <th className="px-2 py-2 text-left font-bold">품명</th>
                  <th className="px-2 py-2 text-left font-bold">규격</th>
                  <th className="px-2 py-2 text-center font-bold">단위</th>
                  <th className="px-2 py-2 text-right font-bold">수량</th>
                  {split ? (
                    <>
                      <th className="px-2 py-2 text-right font-bold">재료비</th>
                      <th className="px-2 py-2 text-right font-bold">인건비</th>
                    </>
                  ) : null}
                  <th className="px-2 py-2 text-right font-bold">단가</th>
                  <th className="px-2 py-2 text-right font-bold">금액</th>
                </tr>
              </thead>
              <tbody>
                {e.items.map((it, i) => (
                  <Fragment key={i}>
                    {it.is_header ? (
                      <tr className="bg-gray-50 dark:bg-gray-800/40">
                        <td colSpan={cols} className="px-2 py-1.5 font-bold text-gray-800 dark:text-gray-200">
                          {it.name ?? it.category}
                        </td>
                      </tr>
                    ) : (
                      <tr className="border-b border-gray-100 dark:border-gray-800">
                        <td className="px-2 py-1.5 text-gray-600 dark:text-gray-400">{it.category ?? ''}</td>
                        <td className="px-2 py-1.5 text-gray-900 dark:text-white">
                          {it.name ?? ''}
                          {/* 비고는 PDF 에는 열로 나가는데 여기엔 아예 없었다. '폐기물 별도'
                              같은 단서가 링크로 본 사람에게만 빠지면 나중에 말이 달라진다.
                              열을 하나 더 두면 폰에서 표가 더 넓어지므로 품명 밑에 붙인다. */}
                          {it.remark ? (
                            <span className="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">
                              {it.remark}
                            </span>
                          ) : null}
                        </td>
                        <td className="px-2 py-1.5 text-gray-600 dark:text-gray-400">{it.spec ?? ''}</td>
                        <td className="px-2 py-1.5 text-center text-gray-600 dark:text-gray-400">{it.unit ?? ''}</td>
                        <td className="px-2 py-1.5 text-right text-gray-600 dark:text-gray-400">{it.qty}</td>
                        {split ? (
                          <>
                            <td className="px-2 py-1.5 text-right text-gray-500">
                              {it.material_price ? fmtComma(it.material_price) : ''}
                            </td>
                            <td className="px-2 py-1.5 text-right text-gray-500">
                              {it.labor_price ? fmtComma(it.labor_price) : ''}
                            </td>
                          </>
                        ) : null}
                        <td className="px-2 py-1.5 text-right text-gray-600 dark:text-gray-400">{fmtComma(it.unit_price)}</td>
                        <td className="px-2 py-1.5 text-right font-semibold text-gray-900 dark:text-white">{fmtComma(it.amount)}</td>
                      </tr>
                    )}

                    {/* 공종이 끝나는 자리에 그 공종만의 합계.
                        거래처는 총액보다 "방수만 얼마요?" 를 먼저 묻는다. */}
                    {subs.has(i) ? (
                      <tr className="border-y border-gray-200 bg-gray-100/70 dark:border-gray-700 dark:bg-gray-800/60">
                        <td colSpan={cols - 1} className="px-2 py-1.5 text-right font-bold text-gray-600 dark:text-gray-400">
                          {subs.get(i)!.name} 소계
                        </td>
                        <td className="px-2 py-1.5 text-right font-bold text-gray-900 dark:text-white">
                          {fmtComma(subs.get(i)!.amount)}
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mb-6 flex justify-end">
            <dl className="w-full max-w-xs text-sm">
              {st ? (
                <>
                  <Sum k="재료비" v={st.material} />
                  <Sum k="인건비" v={st.labor} />
                </>
              ) : null}
              <Sum k="소계" v={e.subtotal} />
              {e.overhead_amount > 0 && <Sum k={`경비 (${(e.overhead_rate * 100).toFixed(1)}%)`} v={e.overhead_amount} />}
              {e.discount > 0 && <Sum k="할인" v={-e.discount} />}
              <Sum k="공급가액" v={e.supply_amount} />
              <Sum k={e.vat_mode === 'none' ? '부가세 (없음)' : '부가세 (10%)'} v={e.vat} />
              <div className="mt-1 flex items-center justify-between border-t border-gray-300 pt-2 dark:border-gray-700">
                <dt className="font-bold text-gray-900 dark:text-white">합계</dt>
                <dd className="text-lg font-black text-blue-800 dark:text-blue-300">{fmtComma(e.total)}원</dd>
              </div>
            </dl>
          </div>

          {(e.notes || co.bank_account) && (
            <div className="rounded-xl border border-gray-200 p-4 text-sm dark:border-gray-800">
              {e.notes && (
                <>
                  <h2 className="mb-1 text-xs font-bold text-gray-500">특기사항</h2>
                  <p className="whitespace-pre-wrap leading-relaxed text-gray-700 dark:text-gray-300">{e.notes}</p>
                </>
              )}
              {co.bank_account && (
                <p className={`text-gray-700 dark:text-gray-300 ${e.notes ? 'mt-3' : ''}`}>
                  <b>입금계좌</b> {co.bank_account}
                </p>
              )}
            </div>
          )}
        </div>

        <p className="mt-4 text-center text-xs text-gray-400">
          {co.name ?? ''}{co.phone ? ` · ${co.phone}` : ''}
        </p>
      </div>
    </main>
  )
}

function Line({ k, v }: { k: string; v: string }) {
  return (
    <p className="text-sm text-gray-600 dark:text-gray-400">
      <span className="mr-2 inline-block w-14 text-gray-500">{k}</span>{v}
    </p>
  )
}

function Field({ k, v }: { k: string; v: string | null }) {
  if (!v) return null
  return (
    <div className="flex gap-2">
      <dt className="w-16 shrink-0 font-semibold text-gray-500">{k}</dt>
      <dd className="flex-1 text-gray-800 dark:text-gray-200">{v}</dd>
    </div>
  )
}

function Sum({ k, v }: { k: string; v: number }) {
  return (
    <div className="flex items-center justify-between py-1">
      <dt className="text-gray-500">{k}</dt>
      <dd className={`font-semibold ${v < 0 ? 'text-red-600' : 'text-gray-800 dark:text-gray-200'}`}>{fmtComma(v)}</dd>
    </div>
  )
}
