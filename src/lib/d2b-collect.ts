import type { SupabaseClient } from '@supabase/supabase-js'
import { addDays, todayKST, ymdKST } from '@/lib/date-kst'
import { normalize, rangeOf } from '@/lib/bid-analysis'
import { BACKFILL_FLOOR } from '@/lib/bid-collect'
import { bidFloor, trimBids } from '@/lib/bid-trim'
import { BID_INDUSTRY_CD } from '@/lib/g2b'
import {
  D2bError, d2bCmpetBid, d2bCodes, d2bDate, d2bGet, d2bKeyOf, d2bNo, d2bNoticeRow, d2bOrd, d2bOthbcBid, d2bPrices,
  type D2bRaw,
} from '@/lib/d2b'

/**
 * 국방전자조달(D2B) 시설공사를 bid_* 표에 쌓는다 — 나라장터 수집(bid-collect.ts)과 같은 일을 D2B 에서.
 *
 *  1. 마감 전 공고(공개수의협상·경쟁입찰) 중 공사만 골라 상세를 한 번 받고, 면허에 4992 가 있는 것만 넣는다.
 *     4992 가 아닌 공사는 번호를 기억해 다시 묻지 않는다(하루 공사 공고 ~20건)
 *  2. 최근 2주 결과 목록 → 우리 공고면 낙찰 줄을 만든다. 공고를 아직 못 본(오래된) 것은 공고 상세로 면허를 본다
 *  3. 결과마다 참가업체·복수예비가격을 받아 나라장터와 같은 값(사정률·1순위 y)을 채운다
 *  4. 남는 시간엔 과거 결과로 한 주씩 거슬러 간다(2023-01-01 까지)
 */

export type D2bReport = {
  notices: number
  results: number
  details: number
  calls: number
  backfillUntil: string | null
  stoppedBy: 'done' | 'time' | 'limit' | 'error'
  error?: string
}

type D2bState = { skip: string[]; backfill: string | null; done: boolean }

const PER_SECOND = 8
const RECENT_RESULT_DAYS = 14
const WINDOW_DAYS = 7
const DETAIL_BATCH = 12
// 공개수의는 개찰 뒤 한참 있다가 순위가 붙는다(11/03 개찰 → 11/05 순위확정). 1순위가 없으면 이 간격으로 다시 본다
const RECHECK_HOURS = 3
/** 4992 아닌 공사 번호는 이만큼만 기억한다(오래된 것부터 버린다) */
const SKIP_KEEP = 4000

class StopError extends Error {}

export async function collectD2b(supa: SupabaseClient, opts: { timeBudgetMs: number }): Promise<D2bReport> {
  const deadline = Date.now() + opts.timeBudgetMs
  const today = todayKST()
  const { data: st } = await supa.from('bid_sync').select('value').eq('key', 'd2b').maybeSingle()
  const state: D2bState = { skip: [], backfill: null, done: false, ...(st?.value as Partial<D2bState> | undefined) }
  const skip = new Set(state.skip)
  const report: D2bReport = { notices: 0, results: 0, details: 0, calls: 0, backfillUntil: state.backfill, stoppedBy: 'done' }

  const sentAt: number[] = []
  const call = async (svc: 'BidPblancInfoService' | 'BidResultInfoService', op: string, params: Record<string, string | number>) => {
    for (let tries = 0; ; tries++) {
      if (Date.now() > deadline) throw new StopError()
      for (;;) {
        const now = Date.now()
        while (sentAt.length && now - sentAt[0] >= 1000) sentAt.shift()
        if (sentAt.length < PER_SECOND) { sentAt.push(now); break }
        await new Promise(res => setTimeout(res, 1000 - (now - sentAt[0]) + 5))
      }
      try {
        report.calls++
        return await d2bGet(svc, op, params)
      } catch (e) {
        if (e instanceof D2bError && e.code === '22') throw e  // 오늘 한도
        if (tries < 2 && !(e instanceof D2bError && e.code !== 'bad_response')) {
          await new Promise(res => setTimeout(res, 1500 * (tries + 1)))
          continue
        }
        throw e
      }
    }
  }
  const listAll = async (svc: 'BidPblancInfoService' | 'BidResultInfoService', op: string, params: Record<string, string>) => {
    const out: D2bRaw[] = []
    for (let page = 1; ; page++) {
      const { items, total } = await call(svc, op, { numOfRows: 999, pageNo: page, ...params })
      out.push(...items)
      if (out.length >= total || !items.length) return out
    }
  }
  const existing = async (nos: string[]) => {
    const have = new Set<string>()
    for (let i = 0; i < nos.length; i += 200) {
      const { data, error } = await supa.from('bid_notices').select('bid_ntce_no, bid_ntce_ord').in('bid_ntce_no', nos.slice(i, i + 200))
      if (error) throw error
      for (const n of data ?? []) have.add(`${n.bid_ntce_no}/${n.bid_ntce_ord}`)
    }
    return have
  }

  /** 공고 상세를 받아 4992 면 넣는다. 넣었으면 true */
  const takeNotice = async (kind: 'othbc' | 'cmpet', x: D2bRaw, ntceAt: string): Promise<boolean> => {
    const k = `${d2bNo(x.pblancNo, x.cntrwkNo)}/${d2bOrd(x.pblancOdr)}`
    const { items } = kind === 'othbc'
      ? await call('BidPblancInfoService', 'getFcltyOthbcVltrnNtatPlanDetail', {
        orntCode: x.orntCode || x.pblancNo.slice(0, 3), cntrwkNo: x.cntrwkNo, ntatPlanDate: x.ntatPlanDate, pblancNo: x.pblancNo, pblancOdr: x.pblancOdr,
      })
      : await call('BidPblancInfoService', 'getFcltyCmpetBidPblancDetail', {
        pblancYear: x.pblancYear || x.cntrwkNo.slice(0, 4), pblancSeCode: x.pblancSeCode || 'A', pblancNo: x.pblancNo, pblancOdr: x.pblancOdr,
        cntrwkNo: x.cntrwkNo, orntCode: x.orntCode || x.pblancNo.slice(0, 3),
      })
    const d = items[0]
    // 상세가 안 나오면(경쟁입찰 공고구분을 짐작으로 넣은 지난 공고) 기억하지 않고 다음에 다시 본다
    if (!d) return false
    if (!d2bCodes(d.lcnsLmttList).includes(BID_INDUSTRY_CD)) { skip.add(k); return false }
    // 공개수의 상세엔 공고번호·차수·개찰이 빠지기도 한다 — 목록 값으로 채운다
    const row = d2bNoticeRow({ ...x, ...d, pblancNo: x.pblancNo, pblancOdr: x.pblancOdr, cntrwkNo: x.cntrwkNo, opengDt: d.opengDt || x.opengDt }, ntceAt)
    const { error } = await supa.from('bid_notices').upsert(row, { onConflict: 'bid_ntce_no,bid_ntce_ord' })
    if (error) throw error
    report.notices++
    return true
  }

  /** 마감 전 공고 */
  const syncNotices = async () => {
    const [othbc, cmpet] = await Promise.all([
      listAll('BidPblancInfoService', 'getFcltyOthbcVltrnNtatPlanList', { prqudoPresentnClosDateBegin: d2bDate(addDays(today, -2)), prqudoPresentnClosDateEnd: d2bDate(addDays(today, 45)) }),
      listAll('BidPblancInfoService', 'getFcltyCmpetBidPblancList', { opengDateBegin: d2bDate(addDays(today, -2)), opengDateEnd: d2bDate(addDays(today, 60)) }),
    ])
    const todo = [...othbc.map(x => ({ kind: 'othbc' as const, x })), ...cmpet.map(x => ({ kind: 'cmpet' as const, x }))]
      .filter(({ x }) => x.busiDivs === '공사' && x.pblancNo && x.cntrwkNo && !/취소/.test(x.progrsSttus ?? ''))
    const have = await existing([...new Set(todo.map(({ x }) => d2bNo(x.pblancNo, x.cntrwkNo)))])
    const now = new Date().toISOString()
    for (const { kind, x } of todo) {
      const k = `${d2bNo(x.pblancNo, x.cntrwkNo)}/${d2bOrd(x.pblancOdr)}`
      if (have.has(k) || skip.has(k)) continue
      await takeNotice(kind, x, now)
    }
    // 기초금액·A값은 기초예비가격을 공개한 뒤에 채워진다(문경 샤워장: 처음엔 A 0, 제이비드엔 568,416원).
    // 이미 넣은 마감 전 공고는 6시간마다 상세를 다시 받는다 — 공고일은 처음 본 날 그대로 둔다
    const stale = new Date(Date.now() - 6 * 3_600_000).toISOString()
    const { data: open } = await supa.from('bid_notices').select('bid_ntce_no, bid_ntce_ord, ntce_at')
      .like('bid_ntce_no', '%-%').gt('bid_close_at', now).lt('updated_at', stale)
    const byKey = new Map(todo.map(t => [`${d2bNo(t.x.pblancNo, t.x.cntrwkNo)}/${d2bOrd(t.x.pblancOdr)}`, t]))
    for (const n of open ?? []) {
      const t = byKey.get(`${n.bid_ntce_no}/${n.bid_ntce_ord}`)
      if (t) await takeNotice(t.kind, t.x, n.ntce_at ?? now)
    }
  }

  /** 결과 목록 한 구간 → 우리 공고면 낙찰 줄 */
  const syncResults = async (from: string, to: string) => {
    const [othbc, cmpet] = await Promise.all([
      listAll('BidResultInfoService', 'getFcltyOthbcVltrnNtatResultList', { ntatComptDateBegin: d2bDate(from), ntatComptDateEnd: d2bDate(to) }),
      listAll('BidResultInfoService', 'getFcltyCmpetBidResultList', { opengDateBegin: d2bDate(from), opengDateEnd: d2bDate(to) }),
    ])
    const all = [
      ...othbc.map(x => ({ kind: 'othbc' as const, x: { ...x, cntrwkNm: x.othbcNtatNm || x.cntrwkNm, opengDt: x.othbcNtatDt || x.opengDt } as D2bRaw })),
      ...cmpet.map(x => ({ kind: 'cmpet' as const, x: { ...x, ntatPlanDate: x.opengDate } as D2bRaw })),
    ].filter(({ x }) => x.pblancNo && x.cntrwkNo && !/유찰|취소|진행/.test(x.ntatResult || x.bidResult || ''))
    const have = await existing([...new Set(all.map(({ x }) => d2bNo(x.pblancNo, x.cntrwkNo)))])
    const rows: object[] = []
    for (const { kind, x } of all) {
      const no = d2bNo(x.pblancNo, x.cntrwkNo), ord = d2bOrd(x.pblancOdr)
      const k = `${no}/${ord}`
      if (skip.has(k)) continue
      if (!have.has(k)) {
        // 공고를 처음 본다(지난 공고) — 공고일을 몰라 개찰 1주 전으로 둔다
        const openIso = x.opengDt ? new Date(`${x.opengDt.slice(0, 4)}-${x.opengDt.slice(4, 6)}-${x.opengDt.slice(6, 8)}T00:00:00+09:00`) : new Date()
        if (!await takeNotice(kind, x, new Date(openIso.getTime() - 7 * 86_400_000).toISOString())) continue
      }
      rows.push({
        bid_ntce_no: no, bid_ntce_ord: ord, rbid_no: '000',
        name: (x.cntrwkNm ?? '').trim(), dminstt_cd: x.pblancNo.slice(0, 3), dminstt_nm: x.ornt || null,
        openg_at: x.opengDt ? new Date(`${x.opengDt.slice(0, 4)}-${x.opengDt.slice(4, 6)}-${x.opengDt.slice(6, 8)}T${x.opengDt.slice(8, 10) || '00'}:${x.opengDt.slice(10, 12) || '00'}:00+09:00`).toISOString() : null,
      })
    }
    // 이미 상세까지 채운 줄을 덮지 않게 새 줄만 넣는다
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await supa.from('bid_results').upsert(rows.slice(i, i + 500), { onConflict: 'bid_ntce_no,bid_ntce_ord,rbid_no', ignoreDuplicates: true })
      if (error) throw error
    }
    report.results += rows.length
  }

  /** 결과 한 건 — 참가업체·예가로 1순위·예정가격·사정률 */
  const fillDetail = async (r: { bid_ntce_no: string; bid_ntce_ord: string; openg_at: string | null }) => {
    const key = d2bKeyOf(r.bid_ntce_no, r.bid_ntce_ord)
    const { data: n } = await supa.from('bid_notices').select('cntrct_mthd, lwlt_rate, a_amount, bssamt, openg_at')
      .eq('bid_ntce_no', r.bid_ntce_no).eq('bid_ntce_ord', r.bid_ntce_ord).maybeSingle()
    const openg = r.openg_at ?? n?.openg_at
    const now = new Date().toISOString()
    if (!key || !n || !openg) {
      await supa.from('bid_results').update({ detail_at: now }).eq('bid_ntce_no', r.bid_ntce_no).eq('bid_ntce_ord', r.bid_ntce_ord).eq('rbid_no', '000')
      return
    }
    const othbc = n.cntrct_mthd === '수의계약'
    const p = { orntCode: key.orntCode, cntrwkNo: key.cntrwkNo, ntatPlanDate: d2bDate(ymdKST(openg)), pblancNo: key.pblancNo, pblancOdr: key.pblancOdr }
    // A값·기초금액이 공고를 처음 받은 뒤에 채워지기도 해 개찰 뒤 값으로 다시 본다(공개수의만 — 경쟁입찰 상세는 공고구분이 있어야 부른다)
    if (othbc) {
      const d = (await call('BidPblancInfoService', 'getFcltyOthbcVltrnNtatPlanDetail', p)).items[0]
      if (d) {
        const fresh = d2bNoticeRow({ ...d, pblancNo: key.pblancNo, cntrwkNo: key.cntrwkNo, pblancOdr: key.pblancOdr }, openg)
        n.bssamt = fresh.bssamt ?? n.bssamt
        n.a_amount = fresh.a_amount
        n.lwlt_rate = fresh.lwlt_rate ?? n.lwlt_rate
        await supa.from('bid_notices').update({ bssamt: n.bssamt, a_amount: n.a_amount, lwlt_rate: n.lwlt_rate, rng_bgn: fresh.rng_bgn, rng_end: fresh.rng_end, updated_at: new Date().toISOString() })
          .eq('bid_ntce_no', r.bid_ntce_no).eq('bid_ntce_ord', r.bid_ntce_ord)
      }
    }
    const [mnuf, bsic] = await Promise.all([
      listAll('BidResultInfoService', othbc ? 'getFcltyOthbcVltrnNtatResultMnufList' : 'getFcltyCmpetBidResultMnufList', p),
      listAll('BidResultInfoService', othbc ? 'getFcltyOthbcVltrnNtatResultBsicList' : 'getFcltyCmpetBidResultBsicList', p),
    ])
    const seen = new Set<string>()
    const bids = mnuf.map(x => (othbc ? d2bOthbcBid : d2bCmpetBid)(x, r.bid_ntce_no, r.bid_ntce_ord))
      .filter(b => b.bizno && !seen.has(`${b.rank}/${b.bizno}`) && seen.add(`${b.rank}/${b.bizno}`))
    const { prices, plnprc } = d2bPrices(bsic)
    // 순위확정 무렵 API 가 일부만(1,198곳 중 21곳) 주기도 했다 — 가진 것보다 적으면 덮지 않고 나중에 다시 본다
    const { count: had } = await supa.from('bid_result_bids').select('bizno', { count: 'exact', head: true })
      .eq('bid_ntce_no', r.bid_ntce_no).eq('bid_ntce_ord', r.bid_ntce_ord)
    if (bids.length < (had ?? 0)) {
      await supa.from('bid_results').update({ detail_at: now }).eq('bid_ntce_no', r.bid_ntce_no).eq('bid_ntce_ord', r.bid_ntce_ord).eq('rbid_no', '000')
      return
    }
    if (bids.length) {
      // 순위가 나중에 붙으면 키(rank)가 바뀌어 예전 '순위 없음' 줄이 남는다 — 지우고 다시 넣는다
      const { error: delErr } = await supa.from('bid_result_bids').delete().eq('bid_ntce_no', r.bid_ntce_no).eq('bid_ntce_ord', r.bid_ntce_ord)
      if (delErr) throw delErr
      // 줄은 1순위 앞뒤만 보관한다(bid-trim.ts). 참여 수·1순위·사정률은 아래에서 전체(bids)로 센다
      const kept = trimBids(bids, bidFloor(plnprc, n.lwlt_rate, n.a_amount))
      const { error } = await supa.from('bid_result_bids').upsert(kept, { onConflict: 'bid_ntce_no,bid_ntce_ord,rbid_no,rank,bizno' })
      if (error) throw error
    }
    const winner = bids.filter(b => b.rank > 0).sort((a, b) => a.rank - b.rank)[0]
    const bssamt = n.bssamt ?? null
    // 개찰 직후엔 참가업체만 있고 금액이 비어 오기도 한다 — 그대로 계산하면 '1순위 없음'(win_y 없음)이 돼
    // 실험실·낙찰결과가 아무 금액이나 낙찰로 센다. 금액이 들어올 때까지 사정률을 비워 둔다(1순위 없으면 다시 받는다)
    const amounts = bids.map(b => b.amount ?? 0).filter(a => a > 0)
    const norm = bssamt && plnprc && n.lwlt_rate && amounts.length
      ? normalize({ bssamt, plnprc, lwlt_rate: Number(n.lwlt_rate), a_amount: n.a_amount, amounts })
      : null
    const { error } = await supa.from('bid_results').update({
      prtcpt_cnum: bids.length || null,
      winner_nm: winner?.company_nm ?? null,
      winner_bizno: winner?.bizno ?? null,
      sucsf_amt: winner?.amount ?? null,
      sucsf_rate: winner?.rate ?? null,
      bssamt,
      plnprc,
      prices: prices.length ? prices : null,
      lwlt_rate: n.lwlt_rate,
      a_amount: n.a_amount,
      sajeong: norm?.r ?? null,
      win_y: norm && Number.isFinite(norm.minAbove) ? norm.minAbove : null,
      rng: bssamt ? rangeOf(bssamt, prices) : null,
      detail_at: now,
      bids_at: now,
    }).eq('bid_ntce_no', r.bid_ntce_no).eq('bid_ntce_ord', r.bid_ntce_ord).eq('rbid_no', '000')
    if (error) throw error
    report.details++
  }

  try {
    await syncNotices()
    await syncResults(addDays(today, -RECENT_RESULT_DAYS), today)
    let backfill = state.backfill ?? addDays(today, -RECENT_RESULT_DAYS)
    {
      const { error } = await supa.from('bid_results').update({ detail_at: null })
        .like('bid_ntce_no', '%-%').is('winner_nm', null)
        .gte('openg_at', new Date(Date.now() - RECENT_RESULT_DAYS * 864e5).toISOString())
        .lt('detail_at', new Date(Date.now() - RECHECK_HOURS * 36e5).toISOString())
      if (error) throw error
    }
    while (true) {
      const { data: todo, error } = await supa.from('bid_results').select('bid_ntce_no, bid_ntce_ord, openg_at')
        .like('bid_ntce_no', '%-%').is('detail_at', null).order('openg_at', { ascending: false, nullsFirst: false }).limit(DETAIL_BATCH)
      if (error) throw error
      if (todo?.length) {
        for (let i = 0; i < todo.length; i += 4) {
          await Promise.all(todo.slice(i, i + 4).map(r => fillDetail(r).catch(async e => {
            if (e instanceof StopError || (e instanceof D2bError && e.code === '22')) throw e
            console.warn('[d2b-collect] 상세 건너뜀', r.bid_ntce_no, e instanceof Error ? e.message : e)
            await supa.from('bid_results').update({ detail_at: new Date().toISOString() })
              .eq('bid_ntce_no', r.bid_ntce_no).eq('bid_ntce_ord', r.bid_ntce_ord).eq('rbid_no', '000')
          })))
        }
        continue
      }
      if (state.done) break
      const to = addDays(backfill, -1), from = addDays(backfill, -WINDOW_DAYS)
      await syncResults(from, to)
      backfill = from
      state.backfill = backfill
      report.backfillUntil = backfill
      if (from <= BACKFILL_FLOOR) { state.done = true }
    }
  } catch (e) {
    if (e instanceof StopError) report.stoppedBy = 'time'
    else if (e instanceof D2bError && e.code === '22') report.stoppedBy = 'limit'
    else {
      report.stoppedBy = 'error'
      report.error = e instanceof Error ? e.message : (e as { message?: string })?.message ?? String(e)
      console.error('[d2b-collect]', e)
    }
  }

  const value: D2bState = { skip: [...skip].slice(-SKIP_KEEP), backfill: state.backfill, done: state.done }
  await supa.from('bid_sync').upsert([
    { key: 'd2b', value, updated_at: new Date().toISOString() },
    { key: 'd2b_last_run', value: { ...report, finishedAt: new Date().toISOString() }, updated_at: new Date().toISOString() },
  ])
  return report
}
