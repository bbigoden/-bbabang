import type { SupabaseClient } from '@supabase/supabase-js'
import { addDays, todayKST } from '@/lib/date-kst'
import { normalize, rangeOf } from '@/lib/bid-analysis'
import { parseMfrc } from '@/lib/bid-notices'
import {
  BID_INDUSTRY_CD, G2bError, g2bDt, g2bGet, toBidRow, toBsisPatch, toNoticeRow, toPrepar, toResultRow,
  type G2bService,
} from '@/lib/g2b'

/**
 * 나라장터에서 도장·방수 공고와 낙찰결과를 받아 bid_* 표에 쌓는다.
 *
 * 한 번 돌 때 하는 일 (시간·한도가 남는 만큼):
 *  1. 최근 3일 공고·기초금액·참가가능지역, 최근 2주 개찰된 낙찰결과 — 목록은 한 번에 999건씩이라 몇 번이면 끝난다
 *  2. 낙찰결과마다 예가 15개(1번) + 업체별 투찰(1번) — **여기가 한도를 다 먹는다**
 *  3. 상세가 다 채워졌으면 과거로 1주씩 거슬러 올라가며 목록을 더 받는다
 *
 * 한도는 서비스마다 하루 1,000건(공고 1,000 / 낙찰 1,000). 넘기면 그날은 막히므로
 * 980 에서 멈춘다(상세는 900 까지). 낙찰 1건 상세에 낙찰 API 2번이라, 하루 과거 낙찰 ~470건씩 채워진다.
 * 도장·방수 낙찰이 1주 ~100건이니 하루에 1달치쯤 거슬러 올라간다.
 */

/**
 * 2026-10-29 운영계정으로 바꿔 한도가 1,000 에서 늘었다(그날 1,030번째도 통과).
 * 정확한 새 한도는 포털 화면에 있다 — 넘으면 나라장터가 22 를 돌려주고 수집은 그 자리에서 멈춘다.
 */
const DAILY_LIMIT = 9_800
/**
 * 상세(공고 1건에 2번)는 여기서 멈추고, 남은 몫은 목록 조회용으로 둔다.
 * 상세가 한도를 다 먹은 날엔 새로 개찰된 낙찰 목록(하루 1~2번)조차 못 받았다.
 */
const DETAIL_LIMIT = 9_000
/** 과거 데이터는 여기까지만 거슬러 올라간다 */
export const BACKFILL_FLOOR = '2023-01-01'
const RECENT_DAYS = 3
/**
 * 낙찰은 '개찰일'로 받는다. 공고 뒤 1~2주에 개찰하므로 최근 낙찰은 2주를 늘 다시 본다.
 * (공고일로 받던 때는 3일 전보다 먼저 공고된 건이 개찰되면 영영 안 들어왔다 — 온양문화원 방수 공사)
 */
const RECENT_RESULT_DAYS = 14
const WINDOW_DAYS = 7
/**
 * 한 번에 몇 건씩 동시에 채울지. 상세 하나에 조회가 2~4번이라 나라장터 응답 시간이 병목이다 —
 * 4건씩이던 때는 280초에 161건뿐이었고, 12건씩은 나라장터 초당 한도에 걸렸다.
 */
const DETAIL_BATCH = 16
const DETAIL_CONCURRENCY = 8
/** 참가가능지역은 나중에(2026-10-29) 붙였다. 그 전에 받아 둔 공고는 이만큼 거슬러 한 번 채운다 */
const RGN_BACKFILL_DAYS = 60

/**
 * spent: 오늘 나라장터가 한도 초과(22)를 돌려준 기능. **한도는 서비스가 아니라 기능마다 따로** 센다 —
 * 2026-10-29 낙찰정보는 운영계정으로 늘었는데 입찰공고정보의 '기초금액 조회'만 1,000 에서 막혔다.
 * 그 기능만 그날 쉬고 나머지는 계속 받는다.
 */
type Calls = { date: string; notice: number; result: number; spent?: string[] }
type Backfill = { until: string; done: boolean }

export type CollectReport = {
  notices: number
  bsis: number
  rgns?: number
  lics?: number
  results: number
  details: number
  backfillUntil: string | null
  calls: Calls
  stoppedBy: 'done' | 'time' | 'limit' | 'error'
  error?: string
  finishedAt: string
}

/**
 * 1초에 이만큼만 보낸다. 나라장터는 초당 요청도 센다 — 12건씩 동시에 보내다 걸렸고,
 * 걸린 뒤로는 다시 보내도 한동안 풀리지 않아 그 회차가 통째로 멈췄다.
 */
const PER_SECOND = 8

/** 초당 요청 한도 초과 — 코드 23, 또는 문구로 온다 */
const isPerSecond = (e: G2bError) => e.code === '23' || /초당|PER_SECOND/i.test(e.message)

/** 오늘 한도를 다 쓴 기능을 또 부르려 할 때 */
class SpentError extends Error {
  constructor(readonly op: string) { super(`${op} 오늘 한도 초과`) }
}

class StopError extends Error {
  constructor(readonly reason: 'time' | 'limit') { super(reason) }
}

export async function collectBids(supa: SupabaseClient, opts: { timeBudgetMs?: number } = {}): Promise<CollectReport> {
  const deadline = Date.now() + (opts.timeBudgetMs ?? 50_000)
  const today = todayKST()

  const state = await readState(supa)
  const calls: Calls = state.calls?.date === today ? state.calls : { date: today, notice: 0, result: 0 }
  const backfill: Backfill = state.backfill ?? { until: addDays(today, -RECENT_DAYS), done: false }
  let rgnUntil = state.rgn_until ?? addDays(today, -RECENT_DAYS)
  let licUntil = state.lic_until ?? addDays(today, -RECENT_DAYS)

  const report: CollectReport = {
    notices: 0, bsis: 0, results: 0, details: 0, backfillUntil: backfill.until,
    calls, stoppedBy: 'done', finishedAt: '',
  }

  // 한도·시간을 부르기 전에 확인한다. 넘으면 StopError 로 빠져나가 지금까지 한 것만 남긴다
  const guard = (svc: G2bService, limit = DAILY_LIMIT) => {
    if (Date.now() > deadline) throw new StopError('time')
    if (calls[svc] >= limit) throw new StopError('limit')
  }
  // 최근 1초 안에 보낸 시각들. 다 차면 가장 오래된 것이 1초를 넘길 때까지 기다린다
  const sentAt: number[] = []
  const pace = async () => {
    for (;;) {
      const now = Date.now()
      while (sentAt.length && now - sentAt[0] >= 1000) sentAt.shift()
      if (sentAt.length < PER_SECOND) { sentAt.push(now); return }
      await new Promise(res => setTimeout(res, 1000 - (now - sentAt[0]) + 5))
    }
  }
  const call = async (svc: G2bService, op: string, params: Record<string, string | number>, limit = DAILY_LIMIT) => {
    guard(svc, limit)
    if (calls.spent?.includes(op)) throw new SpentError(op)
    for (let tries = 0; ; tries++) {
      try {
        await pace()
        return await g2bGet(svc, op, params, s => { calls[s]++ })
      } catch (e) {
        if (e instanceof G2bError && e.code === '22') {
          calls.spent = [...new Set([...(calls.spent ?? []), op])]
          throw new SpentError(op)
        }
        // 초당 한도(23) — 운영계정으로 한도가 늘자 12건 동시에 보내다 걸렸다. 잠깐 쉬고 다시
        if (e instanceof G2bError && isPerSecond(e) && tries < 4) {
          await new Promise(res => setTimeout(res, 800 * (tries + 1) + Math.random() * 400))
          guard(svc, limit)
          continue
        }
        throw e
      }
    }
  }
  /** 날짜 범위 목록을 999건씩 끝까지 */
  const listAll = async (svc: G2bService, op: string, from: string, to: string, extra: Record<string, string> = {}) => {
    const out: Record<string, string>[] = []
    try {
      for (let page = 1; ; page++) {
        const { items, total } = await call(svc, op, {
          numOfRows: 999, pageNo: page, inqryDiv: 1,
          inqryBgnDt: g2bDt(from, '0000'), inqryEndDt: g2bDt(to, '2359'), ...extra,
        })
        out.push(...items)
        if (out.length >= total || items.length === 0) break
      }
    } catch (e) {
      // 이 목록 기능만 오늘 한도가 찼다 — 받은 데까지만 쓰고 다른 목록은 계속 받는다
      if (!(e instanceof SpentError)) throw e
    }
    return out
  }

  /** 개찰일 기간 하나의 낙찰 목록을 받아 넣는다. 조회구분 2 = 개찰일 (1 은 공고일) */
  const syncResults = async (from: string, to: string) => {
    const results = await listAll('result', 'getScsbidListSttusCnstwkPPSSrch', from, to, { indstrytyCd: BID_INDUSTRY_CD, inqryDiv: '2' })
    const rrows = dedupe(results.map(toResultRow), r => `${r.bid_ntce_no}/${r.bid_ntce_ord}/${r.rbid_no}`)
    await upsert(supa, 'bid_results', rrows, 'bid_ntce_no,bid_ntce_ord,rbid_no')
    report.results += rrows.length
  }

  /**
   * 공고일 기간 하나의 공고·기초금액(·참가가능지역)과, 같은 기간 개찰된 낙찰을 받아 넣는다.
   * 참가가능지역은 마감 전 공고에만 쓸모 있어 최근 기간에만 받는다(1주에 조회 ~17번이라 과거까지는 아깝다).
   */
  const syncWindow = async (from: string, to: string, opts: { regions?: boolean } = {}) => {
    const notices = await listAll('notice', 'getBidPblancListInfoCnstwkPPSSrch', from, to, { indstrytyCd: BID_INDUSTRY_CD })
    const nrows = dedupe(notices.map(toNoticeRow), r => `${r.bid_ntce_no}/${r.bid_ntce_ord}`)
    await upsert(supa, 'bid_notices', nrows, 'bid_ntce_no,bid_ntce_ord')
    report.notices += nrows.length

    // 참가가능지역도 업종으로 못 거른다 — 모든 업무 하루 ~2,300줄을 받아 우리 공고에 붙인다.
    // 한 줄도 없으면 지역제한이 없는 공고(전국)라, 이 기간에 공고된 것은 모두 '받음'으로 적는다
    if (opts.regions) {
      const rgns = await listAll('notice', 'getBidPblancListInfoPrtcptPsblRgn', from, to)
      report.rgns = (report.rgns ?? 0) + await applyRgns(supa, rgns, from, to)
      // 주력분야(면허제한) — 하루 ~2,000줄. 같은 면허(4992)라도 석공 공사가 섞여 있어 이걸로 거른다
      const lics = await listAll('notice', 'getBidPblancListInfoLicenseLimit', from, to)
      report.lics = (report.lics ?? 0) + await applyLics(supa, lics, from, to)
    }

    // 기초금액은 업종으로 못 거른다 — 공사 전체(1주 ~2,400건)를 받아 우리 공고만 남긴다
    const bsis = await listAll('notice', 'getBidPblancListInfoCnstwkBsisAmount', from, to)
    report.bsis += await applyBsis(supa, bsis.map(toBsisPatch))

    await syncResults(from, to)
  }

  /** 낙찰 한 건의 예가·투찰·하한율·A값을 채운다 */
  const fillDetail = async (r: { bid_ntce_no: string; bid_ntce_ord: string; rbid_no: string }) => {
    const key = { bidNtceNo: r.bid_ntce_no, bidNtceOrd: r.bid_ntce_ord }
    // 서로 기다릴 일이 없는 조회는 한꺼번에 보낸다
    const [prepar, compt, { data: n0 }] = await Promise.all([
      call('result', 'getOpengResultListInfoCnstwkPreparPcDetail', { numOfRows: 30, pageNo: 1, inqryDiv: 2, ...key }, DETAIL_LIMIT),
      call('result', 'getOpengResultListInfoOpengCompt', { numOfRows: 999, pageNo: 1, ...key }, DETAIL_LIMIT),
      supa.from('bid_notices').select('lwlt_rate, a_amount, bssamt')
        .eq('bid_ntce_no', r.bid_ntce_no).eq('bid_ntce_ord', r.bid_ntce_ord).maybeSingle(),
    ])
    const p = toPrepar(prepar.items.filter(x => (x.rbidNo || '000') === r.rbid_no))
    const bids = dedupe(
      compt.items.filter(x => (x.rbidNo || '000') === r.rbid_no).map(x => toBidRow(x, r.rbid_no)).filter(b => b.bizno),
      b => `${b.rank}/${b.bizno}`,
    )

    // 하한율·A값은 공고 쪽에 있다. 과거 공고가 아직 안 들어와 있으면 번호로 찾는다(둘은 동시에)
    const needNotice = !n0 || n0.lwlt_rate == null
    const needBsis = !n0 || n0.a_amount == null
    const [nRes, bRes] = await Promise.all([
      needNotice ? call('notice', 'getBidPblancListInfoCnstwk', { numOfRows: 5, pageNo: 1, inqryDiv: 2, bidNtceNo: r.bid_ntce_no }, DETAIL_LIMIT) : null,
      needBsis ? call('notice', 'getBidPblancListInfoCnstwkBsisAmount', { numOfRows: 5, pageNo: 1, inqryDiv: 2, bidNtceNo: r.bid_ntce_no }, DETAIL_LIMIT) : null,
    ])
    const n = { lwlt_rate: n0?.lwlt_rate ?? null, a_amount: n0?.a_amount ?? null, bssamt: n0?.bssamt ?? null }
    if (nRes) {
      const row = nRes.items.map(toNoticeRow).find(x => x.bid_ntce_ord === r.bid_ntce_ord)
      if (row) { await upsert(supa, 'bid_notices', [row], 'bid_ntce_no,bid_ntce_ord'); report.notices++ }
      n.lwlt_rate = row?.lwlt_rate ?? null
    }
    if (bRes) {
      const b = bRes.items.map(toBsisPatch).find(x => x.bid_ntce_ord === r.bid_ntce_ord)
      // 공고 줄을 방금 넣었으니 기초금액도 거기 붙는다
      if (b) { report.bsis += await applyBsis(supa, [b]); n.a_amount = b.a_amount }
    }

    if (bids.length) await upsert(supa, 'bid_result_bids', bids, 'bid_ntce_no,bid_ntce_ord,rbid_no,rank,bizno')
    const bssamt = p?.bssamt ?? n.bssamt ?? null
    const plnprc = p?.plnprc ?? null
    const norm = bssamt && plnprc && n.lwlt_rate
      ? normalize({ bssamt, plnprc, lwlt_rate: Number(n.lwlt_rate), a_amount: n.a_amount, amounts: bids.map(b => b.amount ?? 0).filter(a => a > 0) })
      : null
    const now = new Date().toISOString()
    const { error } = await supa.from('bid_results').update({
      bssamt,
      plnprc,
      prices: p?.prices ?? null,
      lwlt_rate: n.lwlt_rate,
      a_amount: n.a_amount,
      sajeong: norm?.r ?? null,
      win_y: norm && Number.isFinite(norm.minAbove) ? norm.minAbove : null,
      rng: bssamt ? rangeOf(bssamt, p?.prices) : null,
      detail_at: now,
      bids_at: now,
    }).eq('bid_ntce_no', r.bid_ntce_no).eq('bid_ntce_ord', r.bid_ntce_ord).eq('rbid_no', r.rbid_no)
    if (error) throw error
    report.details++
  }

  try {
    // 1. 최근
    await syncWindow(addDays(today, -RECENT_DAYS), today, { regions: true })
    await syncResults(addDays(today, -RECENT_RESULT_DAYS), today)

    // 참가가능지역 — 예전에 받은 공고에도 한 번 붙인다(한 주에 조회 ~17번)
    while (rgnUntil > addDays(today, -RGN_BACKFILL_DAYS)) {
      const to = addDays(rgnUntil, -1)
      const from = addDays(rgnUntil, -WINDOW_DAYS)
      const rgns = await listAll('notice', 'getBidPblancListInfoPrtcptPsblRgn', from, to)
      report.rgns = (report.rgns ?? 0) + await applyRgns(supa, rgns, from, to)
      rgnUntil = from
    }
    // 주력분야도 나중에(2026-10-29) 붙였다 — 같은 식으로 한 번 거슬러 채운다
    while (licUntil > addDays(today, -RGN_BACKFILL_DAYS)) {
      const to = addDays(licUntil, -1)
      const from = addDays(licUntil, -WINDOW_DAYS)
      const lics = await listAll('notice', 'getBidPblancListInfoLicenseLimit', from, to)
      report.lics = (report.lics ?? 0) + await applyLics(supa, lics, from, to)
      licUntil = from
    }

    // 2·3. 상세를 먼저 채우고, 밀린 상세가 없으면 과거로 한 주 더
    while (true) {
      const { data: todo, error } = await supa.from('bid_results')
        .select('bid_ntce_no, bid_ntce_ord, rbid_no')
        .is('detail_at', null).order('openg_at', { ascending: false, nullsFirst: false }).limit(DETAIL_BATCH)
      if (error) throw error
      if (todo?.length) {
        for (let i = 0; i < todo.length; i += DETAIL_CONCURRENCY) {
          await Promise.all(todo.slice(i, i + DETAIL_CONCURRENCY).map(r => fillDetail(r).catch(async e => {
            // 한 건이 계속 오류를 내면 매번 그 건에서 멈춰 뒤가 영영 안 채워진다.
            // 한도·시간 초과가 아니면 빈 채로 넘기고 다음 건으로 간다
            // 상세에 필요한 기능이 바닥났으면 틀린 값(A값 없이)으로 채우지 말고 내일로 미룬다
            if (e instanceof StopError || e instanceof SpentError || (e instanceof G2bError && isPerSecond(e))) throw e
            console.warn('[bid-collect] 상세 건너뜀', r.bid_ntce_no, e instanceof Error ? e.message : e)
            await supa.from('bid_results').update({ detail_at: new Date().toISOString() })
              .eq('bid_ntce_no', r.bid_ntce_no).eq('bid_ntce_ord', r.bid_ntce_ord).eq('rbid_no', r.rbid_no)
          })))
        }
        continue
      }
      if (backfill.done) break
      const to = addDays(backfill.until, -1)
      const from = addDays(backfill.until, -WINDOW_DAYS)
      await syncWindow(from, to)
      backfill.until = from
      if (from <= BACKFILL_FLOOR) backfill.done = true
      report.backfillUntil = backfill.until
    }
  } catch (e) {
    if (e instanceof StopError) report.stoppedBy = e.reason
    else if (e instanceof SpentError) report.stoppedBy = 'limit'  // 포털 쪽 한도 초과(기능 하나)
    else if (e instanceof G2bError && isPerSecond(e)) {  // 쉬어도 계속 초당 한도 — 다음 회차에
      report.stoppedBy = 'limit'
      report.error = e.message
    }
    else {
      report.stoppedBy = 'error'
      report.error = e instanceof Error ? e.message : String(e)
      console.error('[bid-collect]', e)
    }
  }

  report.finishedAt = new Date().toISOString()
  await writeState(supa, { calls, backfill, rgn_until: rgnUntil, lic_until: licUntil, last_run: report })
  return report
}

// ── 상태 ──────────────────────────────────────────────────

type State = { calls?: Calls; backfill?: Backfill; rgn_until?: string; lic_until?: string; last_run?: CollectReport }

async function readState(supa: SupabaseClient): Promise<State> {
  const { data } = await supa.from('bid_sync').select('key, value').in('key', ['calls', 'backfill', 'rgn_until', 'lic_until'])
  return Object.fromEntries((data ?? []).map(r => [r.key, r.value])) as State
}

async function writeState(supa: SupabaseClient, s: Required<State>) {
  const now = new Date().toISOString()
  const { error } = await supa.from('bid_sync').upsert(
    Object.entries(s).map(([key, value]) => ({ key, value, updated_at: now })),
  )
  if (error) console.error('[bid-collect] 상태 저장 실패', error)
}

// ── DB 도우미 ─────────────────────────────────────────────

async function upsert(supa: SupabaseClient, table: string, rows: object[], onConflict: string) {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supa.from(table).upsert(rows.slice(i, i + 500), { onConflict })
    if (error) throw error
  }
}

/**
 * 기초금액을 우리가 가진 공고에만 덧붙인다. 붙인 건수를 돌려준다.
 *
 * 한 줄씩 update 하면 최근 3일치(~100건)만으로 50초 예산을 거의 다 먹어 상세가 8건밖에
 * 못 채워졌다. 그래서 한 번에 upsert 한다 — name 은 not null 이라 같이 실어 보낸다.
 */
async function applyBsis(supa: SupabaseClient, patches: ReturnType<typeof toBsisPatch>[]): Promise<number> {
  if (!patches.length) return 0
  const byNo = new Map(patches.map(p => [`${p.bid_ntce_no}/${p.bid_ntce_ord}`, p]))
  const nos = [...new Set(patches.map(p => p.bid_ntce_no))]
  const now = new Date().toISOString()
  const rows: object[] = []
  for (let i = 0; i < nos.length; i += 200) {
    const { data, error } = await supa.from('bid_notices')
      .select('bid_ntce_no, bid_ntce_ord, name').in('bid_ntce_no', nos.slice(i, i + 200))
    if (error) throw error
    for (const n of data ?? []) {
      const p = byNo.get(`${n.bid_ntce_no}/${n.bid_ntce_ord}`)
      if (p) rows.push({ ...p, name: n.name, updated_at: now })
    }
  }
  await upsert(supa, 'bid_notices', rows, 'bid_ntce_no,bid_ntce_ord')
  return rows.length
}

/** 참가가능지역을 그 기간(공고일 기준, 한국시간)에 공고된 우리 공고에 붙인다. 붙인 건수를 돌려준다 */
async function applyRgns(supa: SupabaseClient, items: Record<string, string>[], from: string, to: string): Promise<number> {
  const byKey = new Map<string, { sno: number; nm: string }[]>()
  for (const x of items) {
    const k = `${x.bidNtceNo}/${x.bidNtceOrd || '000'}`
    const nm = (x.prtcptPsblRgnNm ?? '').trim()
    if (nm) byKey.set(k, [...(byKey.get(k) ?? []), { sno: Number(x.lmtSno) || 0, nm }])
  }
  const { data, error } = await supa.from('bid_notices')
    .select('bid_ntce_no, bid_ntce_ord, name')
    .gte('ntce_at', `${from}T00:00:00+09:00`).lte('ntce_at', `${to}T23:59:59+09:00`)
  if (error) throw error
  const now = new Date().toISOString()
  const rows = (data ?? []).map(n => ({
    ...n,
    prtcpt_rgns: [...new Set((byKey.get(`${n.bid_ntce_no}/${n.bid_ntce_ord}`) ?? []).sort((a, b) => a.sno - b.sno).map(r => r.nm))],
    updated_at: now,
  }))
  await upsert(supa, 'bid_notices', rows, 'bid_ntce_no,bid_ntce_ord')
  return rows.length
}

/**
 * 주력분야를 그 기간에 공고된 우리 공고에 붙인다. 면허제한 줄 중 우리 면허(…/4992) 줄의 주력분야만 본다
 * — 다른 업종으로도 들어갈 수 있게 열린 공고는 그 업종 줄이 따로 온다. 줄이 없으면 '지정 없음'.
 */
async function applyLics(supa: SupabaseClient, items: Record<string, string>[], from: string, to: string): Promise<number> {
  const byKey = new Map<string, string[]>()
  for (const x of items) {
    if (!(x.lcnsLmtNm ?? '').endsWith(`/${BID_INDUSTRY_CD}`)) continue
    const k = `${x.bidNtceNo}/${x.bidNtceOrd || '000'}`
    byKey.set(k, [...(byKey.get(k) ?? []), ...parseMfrc(x.indstrytyMfrcFldList)])
  }
  const { data, error } = await supa.from('bid_notices')
    .select('bid_ntce_no, bid_ntce_ord, name')
    .gte('ntce_at', `${from}T00:00:00+09:00`).lte('ntce_at', `${to}T23:59:59+09:00`)
  if (error) throw error
  const now = new Date().toISOString()
  const rows = (data ?? []).map(n => ({
    ...n,
    mfrc_flds: [...new Set(byKey.get(`${n.bid_ntce_no}/${n.bid_ntce_ord}`) ?? [])],
    updated_at: now,
  }))
  await upsert(supa, 'bid_notices', rows, 'bid_ntce_no,bid_ntce_ord')
  return rows.length
}

/** 같은 열쇠가 두 번 오면 upsert 가 'cannot affect row a second time' 으로 통째로 실패한다 */
function dedupe<T>(rows: T[], key: (r: T) => string): T[] {
  const m = new Map<string, T>()
  for (const r of rows) m.set(key(r), r)
  return [...m.values()]
}
