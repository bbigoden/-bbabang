/**
 * 고객 매물 요청(/request/new · /request/[id]/edit) 입력 검증과 표시용 이름.
 *
 * request_posts 의 금액·면적 칸은 모두 integer(int4)다. 화면이 소수(0.5평)를 그대로 보내면
 * DB 가 400 으로 막고, 화면은 '잠시 후 다시 시도해주세요'만 띄워 어느 칸 문제인지 알 수 없었다.
 * 그래서 칸마다 정수·범위를 미리 보고, 막힐 때는 무엇을 고치면 되는지 말해 준다.
 *
 * 문구의 이름(최소값·최소 면적 등)은 모두 받침으로 끝나 '은/을/이'가 맞다.
 * 이름을 바꿀 때는 조사도 같이 확인할 것 — 예전 공용 검사가 '최소 평수이'로 찍었다.
 */
import { formatPrice } from '@/lib/utils'
import { CUSTOMER_PROPERTY_CATEGORIES } from '@/lib/property-types'

export const DEAL_TYPES: readonly string[] = ['매매', '월세', '전세']
export const REQUEST_STEPS = ['거래·매물 유형', '위치', '예산', '상세 조건'] as const

/** 1조 원(만원 단위). int4 한도(약 21조) 안에서 끊는다 — 그 위는 DB 가 받지 못한다. */
export const MAX_PRICE_MAN = 100_000_000
export const MAX_SIZE_PYEONG = 100_000

export type RequestRegion = { sido: string; sigungu: string; dong: string | null }

export type RequestForm = {
  min_price: string
  max_price: string
  min_monthly: string
  max_monthly: string
  min_size: string
  max_size: string
  move_in_date: string
  description: string
}

export const EMPTY_REQUEST_FORM: RequestForm = {
  min_price: '', max_price: '',
  min_monthly: '', max_monthly: '',
  min_size: '', max_size: '',
  move_in_date: '', description: '',
}

export type RequestDraft = {
  dealTypes: string[]
  propertyTypes: string[]
  region: RequestRegion | null
  form: RequestForm
}

type FieldErrors<K extends string> = Partial<Record<K, string>>

/** deal_type·room_type 칸('매매, 월세')을 배열로 — 겹친 값은 한 번만 */
export function splitTypes(raw: string | null | undefined): string[] {
  return [...new Set((raw ?? '').split(',').map(s => s.trim()).filter(Boolean))]
}

// 거래 유형별로 min_price/max_price 가 뜻하는 금액 — 큰 금액부터 적는다
const PRICE_NAME: [string, string][] = [['매매', '매매가'], ['전세', '전세금'], ['월세', '보증금']]

/**
 * 한 쌍뿐인 min_price/max_price 가 고른 거래 유형에서 무엇인지.
 * 매매·월세·전세를 함께 고르면 '매매가·전세금·보증금' — DB 에 금액 칸이 한 쌍뿐이라
 * 유형마다 따로 받을 수 없다. 예전 화면은 칸을 두 벌 그려 놓고 같은 값에 묶어
 * 한쪽을 고치면 다른 쪽이 말없이 같이 바뀌었다.
 */
export function priceLabel(dealTypes: string[]): string {
  const names = PRICE_NAME.filter(([t]) => dealTypes.includes(t)).map(([, name]) => name)
  return names.length ? names.join('·') : '금액'
}

/** 금액 한 범위가 서로 다른 금액(예: 매매가와 보증금)을 함께 뜻하는가 */
export function isMixedPrice(dealTypes: string[]): boolean {
  return DEAL_TYPES.filter(t => dealTypes.includes(t)).length > 1
}

/** 예시 자리표시 — 흐린 숫자만 있으면 채워진 기본값으로 읽혀 '예:'를 붙인다.
 *  여러 유형이면 가장 낮은 쪽(보증금)~가장 높은 쪽(매매가) 예시로 넓게 잡는 법을 보여 준다. */
export function pricePlaceholders(dealTypes: string[]): { min: string; max: string } {
  const min = dealTypes.includes('월세') ? 500 : dealTypes.includes('전세') ? 20000 : 50000
  const max = dealTypes.includes('매매') ? 80000 : dealTypes.includes('전세') ? 50000 : 3000
  return { min: `예: ${min}`, max: `예: ${max}` }
}

type NumberRule = {
  name: string
  required: boolean
  min: number
  max: number
  unit: string
  maxText?: string
  integerHint: string
}

const fmt = (n: number) => n.toLocaleString('ko-KR')

function numberError(raw: string, r: NumberRule): string | null {
  const v = raw.trim()
  if (v === '') return r.required ? `${r.name}을 입력해 주세요` : null
  const n = Number(v)
  if (!Number.isFinite(n)) return `${r.name}은 숫자로 입력해 주세요`
  if (n < r.min) return `${r.name}은 ${fmt(r.min)}${r.unit} 이상으로 입력해 주세요`
  if (n > r.max) return `${r.name}은 ${r.maxText ?? `${fmt(r.max)}${r.unit}`} 이하로 입력해 주세요`
  if (!Number.isInteger(n)) return `${r.name}은 ${r.integerHint}`
  return null
}

const toNumber = (v: string | number | null | undefined): number | null => {
  if (v == null) return null
  if (typeof v === 'string' && v.trim() === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

const PRICE_RULE = {
  unit: '만원',
  max: MAX_PRICE_MAN,
  maxText: `${fmt(MAX_PRICE_MAN)}만원(1조 원)`,
  integerHint: '만원 단위 정수로 입력해 주세요 (예: 500)',
}

export type BudgetField = 'min_price' | 'max_price' | 'min_monthly' | 'max_monthly'

/**
 * 예산 단계 검사. 예전엔 빈칸만 보고 넘겨 -100만~0만원이 요약까지 갔다가 마지막 등록에서야 막혔다.
 * requireFilled=false 면 빈 필수칸은 아직 탓하지 않는다('다음'을 눌러 보기 전).
 * 월세 칸은 선택 입력이고, 월세를 골랐을 때만 본다.
 */
export function budgetErrors(
  form: Pick<RequestForm, BudgetField>,
  dealTypes: string[],
  { requireFilled = true }: { requireFilled?: boolean } = {},
): FieldErrors<BudgetField> {
  // 여러 유형이면 '매매가·전세금·보증금 최소값은…'이 반 칸 너비에 세 줄로 접혀 '금액'으로 줄인다(칸 위 제목이 이름을 보여 준다)
  const label = isMixedPrice(dealTypes) ? '금액' : priceLabel(dealTypes)
  const out: FieldErrors<BudgetField> = {}
  const minErr = numberError(form.min_price, { ...PRICE_RULE, name: `${label} 최소값`, required: requireFilled, min: 0 })
  const maxErr = numberError(form.max_price, { ...PRICE_RULE, name: `${label} 최대값`, required: requireFilled, min: 1 })
  if (minErr) out.min_price = minErr
  if (maxErr) out.max_price = maxErr
  if (!minErr && !maxErr) {
    const lo = toNumber(form.min_price), hi = toNumber(form.max_price)
    if (lo != null && hi != null && lo > hi) out.max_price = `${label} 최대값이 최소값보다 작아요`
  }

  if (dealTypes.includes('월세')) {
    const mMin = numberError(form.min_monthly, { ...PRICE_RULE, name: '월세 최소값', required: false, min: 0, integerHint: '만원 단위 정수로 입력해 주세요 (예: 30)' })
    const mMax = numberError(form.max_monthly, { ...PRICE_RULE, name: '월세 최대값', required: false, min: 1, integerHint: '만원 단위 정수로 입력해 주세요 (예: 80)' })
    if (mMin) out.min_monthly = mMin
    if (mMax) out.max_monthly = mMax
    if (!mMin && !mMax) {
      const lo = toNumber(form.min_monthly), hi = toNumber(form.max_monthly)
      if (lo != null && hi != null && lo > hi) out.max_monthly = '월세 최대값이 최소값보다 작아요'
    }
  }
  return out
}

export type SizeField = 'min_size' | 'max_size'

const SIZE_RULE = {
  required: false,
  min: 1,
  max: MAX_SIZE_PYEONG,
  unit: '평',
  integerHint: '정수로 입력해 주세요 (예: 24.5평 → 24 또는 25)',
}

/** 면적(평) — 선택 입력. DB 가 정수 칸이라 소수는 여기서 막는다. */
export function sizeErrors(form: Pick<RequestForm, SizeField>): FieldErrors<SizeField> {
  const out: FieldErrors<SizeField> = {}
  const minErr = numberError(form.min_size, { ...SIZE_RULE, name: '최소 면적' })
  const maxErr = numberError(form.max_size, { ...SIZE_RULE, name: '최대 면적' })
  if (minErr) out.min_size = minErr
  if (maxErr) out.max_size = maxErr
  if (!minErr && !maxErr) {
    const lo = toNumber(form.min_size), hi = toNumber(form.max_size)
    if (lo != null && hi != null && lo > hi) out.max_size = '최대 면적이 최소 면적보다 작아요'
  }
  return out
}

/**
 * 입주 희망일 — 오늘(한국 날짜)부터. today 는 todayKST() 를 넘긴다.
 * keep: 수정 화면에서 이미 저장돼 있던 값. 그 사이 지난 날짜가 됐어도 다른 칸을 고치려는
 * 사람을 막지 않도록 그대로 두는 것은 허용한다(새로 고르는 날짜만 본다).
 */
export function moveInDateError(value: string, today: string, keep?: string | null): string | null {
  if (!value) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return '입주 희망일을 달력에서 다시 골라 주세요'
  if (keep && value === keep) return null
  if (value < today) return `입주 희망일은 오늘(${today}) 또는 그 뒤 날짜로 골라 주세요`
  return null
}

export type StepOptions = { keepMoveInDate?: string | null }

/**
 * 이 단계에서 '다음'으로 못 가는 이유들. 비어 있으면 넘어갈 수 있다.
 * 예전엔 버튼만 회색으로 꺼서 왜 안 눌리는지 알 수 없었다 — 이 문구를 버튼 위에 보여 준다.
 */
export function stepIssues(step: number, d: RequestDraft, today: string, opts: StepOptions = {}): string[] {
  if (step === 0) {
    const out: string[] = []
    if (d.dealTypes.length === 0) out.push('거래 유형을 하나 이상 골라 주세요')
    if (d.propertyTypes.length === 0) out.push('매물 유형을 하나 이상 골라 주세요')
    return out
  }
  if (step === 1) return d.region ? [] : ['관심 지역을 검색해서 목록에서 골라 주세요']
  if (step === 2) return Object.values(budgetErrors(d.form, d.dealTypes)).filter((m): m is string => !!m)
  if (step === 3) {
    const dateErr = moveInDateError(d.form.move_in_date, today, opts.keepMoveInDate)
    return [...Object.values(sizeErrors(d.form)), dateErr].filter((m): m is string => !!m)
  }
  return []
}

/** 앞 단계가 비어 있으면 그 단계까지만 — 복원·앞으로 가기로 빈 단계를 건너뛰지 않게 */
export function clampStep(step: number, d: RequestDraft, today: string, opts: StepOptions = {}): number {
  const target = Math.max(0, Math.min(REQUEST_STEPS.length - 1, Math.trunc(step) || 0))
  for (let s = 0; s < target; s++) {
    if (stepIssues(s, d, today, opts).length > 0) return s
  }
  return target
}

/** 처음부터 끝까지 통과하지 못하는 첫 단계. 다 통과하면 null */
export function firstIssueStep(d: RequestDraft, today: string, opts: StepOptions = {}): number | null {
  for (let s = 0; s < REQUEST_STEPS.length; s++) {
    if (stepIssues(s, d, today, opts).length > 0) return s
  }
  return null
}

const intOrNull = (v: string) => (v.trim() === '' ? null : Number(v.trim()))

/** request_posts 에 쓰는 값(등록·수정 공통). 검사를 통과한 뒤에 부른다. */
export function toRequestPayload(d: RequestDraft & { region: RequestRegion }) {
  const monthly = d.dealTypes.includes('월세')
  const description = d.form.description.trim()
  return {
    deal_type: d.dealTypes.join(', '),
    room_type: d.propertyTypes.join(', '),
    city: d.region.sido,
    district: d.region.sigungu,
    dong: d.region.dong,
    min_price: Number(d.form.min_price.trim()),
    max_price: Number(d.form.max_price.trim()),
    min_monthly: monthly ? intOrNull(d.form.min_monthly) : null,
    max_monthly: monthly ? intOrNull(d.form.max_monthly) : null,
    min_size: intOrNull(d.form.min_size),
    max_size: intOrNull(d.form.max_size),
    move_in_date: d.form.move_in_date || null,
    description: description || null,
  }
}

/**
 * 저장 실패를 사람 말로. 검사를 거치면 거의 안 나지만, 그래도 나면 어느 쪽을 고칠지는 알려 준다.
 * (Postgres 22P02 = 정수 칸에 '0.5' 같은 값, 22003 = 정수 범위 넘음, 42501 = RLS 거부)
 */
export function describeSaveError(
  err: { code?: string | null; message?: string | null } | null | undefined,
  action: '등록' | '수정',
): string {
  const code = err?.code ?? ''
  if (code === '22P02') return '금액·면적 칸에 정수가 아닌 값이 있어요. 소수점 없이 고쳐 주세요.'
  if (code === '22003') return '금액이나 면적 숫자가 너무 커요. 값을 줄여 주세요.'
  if (code === '22007' || code === '22008') return '입주 희망일을 달력에서 다시 골라 주세요.'
  if (code === '42501' || code === 'PGRST301' || /jwt/i.test(err?.message ?? '')) {
    return '로그인이 풀렸을 수 있어요. 다시 로그인한 뒤 시도해 주세요.'
  }
  return `${action} 중 오류가 발생했어요. 잠시 후 다시 시도해 주세요.`
}

/** '30만~80만', 한쪽만 있으면 '30만 이상'/'80만 이하', 둘 다 없으면 null */
export function rangeText(min: string | number | null | undefined, max: string | number | null | undefined): string | null {
  const lo = toNumber(min), hi = toNumber(max)
  if (lo != null && hi != null) return `${formatPrice(lo)}~${formatPrice(hi)}`
  if (lo != null) return `${formatPrice(lo)} 이상`
  if (hi != null) return `${formatPrice(hi)} 이하`
  return null
}

// ── 작성 중 임시 저장(sessionStorage) ──────────────────────────
// 새로고침하면 1단계로 돌아가 고른 것이 전부 사라졌다. 탭을 닫으면 지워지는 sessionStorage 에 둔다.

const DRAFT_VERSION = 1
const CUSTOMER_TYPES = new Set(CUSTOMER_PROPERTY_CATEGORIES.flatMap(c => c.types))

export type SavedDraft = RequestDraft & { step: number }

export function serializeDraft(d: SavedDraft): string {
  return JSON.stringify({ v: DRAFT_VERSION, ...d })
}

/** 저장본을 읽는다. 모양이 다르거나 깨졌으면 null — 남이 고쳐 넣은 값도 아는 값만 남긴다. */
export function parseDraft(raw: string | null | undefined): SavedDraft | null {
  if (!raw) return null
  let v: unknown
  try { v = JSON.parse(raw) } catch { return null }
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  if (o.v !== DRAFT_VERSION) return null

  const strings = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string') : [])
  const r = o.region && typeof o.region === 'object' ? (o.region as Record<string, unknown>) : null
  const region: RequestRegion | null =
    r && typeof r.sido === 'string' && typeof r.sigungu === 'string' && (r.dong == null || typeof r.dong === 'string')
      ? { sido: r.sido, sigungu: r.sigungu, dong: typeof r.dong === 'string' ? r.dong : null }
      : null
  const f = o.form && typeof o.form === 'object' ? (o.form as Record<string, unknown>) : {}
  const form = { ...EMPTY_REQUEST_FORM }
  for (const k of Object.keys(EMPTY_REQUEST_FORM) as (keyof RequestForm)[]) {
    if (typeof f[k] === 'string') form[k] = f[k] as string
  }
  const step = typeof o.step === 'number' && Number.isInteger(o.step)
    ? Math.max(0, Math.min(REQUEST_STEPS.length - 1, o.step))
    : 0

  return {
    step,
    dealTypes: [...new Set(strings(o.dealTypes).filter(t => DEAL_TYPES.includes(t)))],
    propertyTypes: [...new Set(strings(o.propertyTypes).filter(t => CUSTOMER_TYPES.has(t)))],
    region,
    form,
  }
}

/** 이어 쓸 만한 내용이 있는가('불러왔어요' 안내를 띄울지) */
export function hasDraftContent(d: RequestDraft): boolean {
  return d.dealTypes.length > 0 || d.propertyTypes.length > 0 || d.region != null
    || Object.values(d.form).some(v => v.trim() !== '')
}

// ── 단계를 브라우저 기록에 싣기 ──────────────────────────
// 단계가 화면 메모리에만 있어 브라우저 '뒤로'가 이전 단계가 아니라 대시보드로 나갔다.
// 단계마다 기록을 하나씩 쌓고(pushState), 각 기록에 단계 번호를 적는다.
// requestStepBase: 이 화면에 들어온 첫 기록의 단계 — 그보다 앞으로는 history.back() 으로
// 갈 수 없으니(그 앞은 다른 화면) '이전' 버튼이 직접 단계를 옮긴다.

export function readStepHistory(state: unknown): { step: number | null; base: number | null } {
  const o = state && typeof state === 'object' ? (state as Record<string, unknown>) : {}
  const n = (x: unknown) =>
    typeof x === 'number' && Number.isInteger(x) && x >= 0 && x < REQUEST_STEPS.length ? x : null
  return { step: n(o.requestStep), base: n(o.requestStepBase) }
}

/** 지금 기록(Next.js 내부 값 포함)을 그대로 두고 단계만 덧쓴 새 state */
export function withStepHistory(state: unknown, step: number, base?: number): Record<string, unknown> {
  const o = state && typeof state === 'object' ? (state as Record<string, unknown>) : {}
  return { ...o, requestStep: step, ...(base === undefined ? {} : { requestStepBase: base }) }
}

// ── 저장 직후 상세 화면 안내 ──────────────────────────
// 등록하면 안내 없이 상세로 넘어가 저장됐는지 의심하고 '수정'을 눌러 보게 됐다.
// 주소에 ?saved= 를 붙이면 새로고침·공유 때마다 다시 뜨므로 한 번 읽고 지우는 표식을 쓴다.

export const REQUEST_SAVED_FLASH_KEY = 'request-saved-flash'
export type SavedKind = 'new' | 'edit'

export function makeSavedFlash(id: string, kind: SavedKind): string {
  return JSON.stringify({ id, kind })
}

export function readSavedFlash(raw: string | null | undefined, id: string): SavedKind | null {
  if (!raw) return null
  try {
    const o = JSON.parse(raw) as { id?: unknown; kind?: unknown }
    if (o?.id !== id) return null
    return o.kind === 'new' || o.kind === 'edit' ? o.kind : null
  } catch {
    return null
  }
}
