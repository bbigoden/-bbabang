import { describe, it, expect } from 'vitest'
import {
  EMPTY_REQUEST_FORM, MAX_PRICE_MAN, splitTypes, priceLabel, isMixedPrice, pricePlaceholders,
  budgetErrors, sizeErrors, moveInDateError, stepIssues, clampStep, firstIssueStep,
  toRequestPayload, describeSaveError, rangeText, serializeDraft, parseDraft, hasDraftContent,
  readStepHistory, withStepHistory, makeSavedFlash, readSavedFlash,
  type RequestDraft, type RequestForm,
} from '@/lib/request-validation'

const TODAY = '2026-10-21'
const form = (f: Partial<RequestForm> = {}): RequestForm => ({ ...EMPTY_REQUEST_FORM, ...f })
const region = { sido: '충청남도', sigungu: '천안시 서북구', dong: '불당동' }
const draft = (d: Partial<RequestDraft> = {}): RequestDraft => ({
  dealTypes: ['월세'],
  propertyTypes: ['상가'],
  region,
  form: form({ min_price: '500', max_price: '3000' }),
  ...d,
})

describe('splitTypes', () => {
  it('쉼표로 나누고 공백·빈칸·겹침을 걷어 낸다', () =>
    expect(splitTypes(' 매매, 월세,, 월세 ')).toEqual(['매매', '월세']))
  it('null → 빈 배열', () => expect(splitTypes(null)).toEqual([]))
})

describe('priceLabel — 한 쌍뿐인 금액 칸의 이름', () => {
  it('월세만 → 보증금', () => expect(priceLabel(['월세'])).toBe('보증금'))
  it('매매만 → 매매가', () => expect(priceLabel(['매매'])).toBe('매매가'))
  it('전세만 → 전세금', () => expect(priceLabel(['전세'])).toBe('전세금'))
  it('셋 다 → 고른 순서와 무관하게 매매가·전세금·보증금', () =>
    expect(priceLabel(['전세', '월세', '매매'])).toBe('매매가·전세금·보증금'))
  it('아무것도 없으면 금액', () => expect(priceLabel([])).toBe('금액'))
  it('여럿이면 섞인 범위', () => {
    expect(isMixedPrice(['월세'])).toBe(false)
    expect(isMixedPrice(['매매', '월세'])).toBe(true)
  })
})

describe('pricePlaceholders — 예시임을 드러낸다', () => {
  it('월세 → 예: 500 / 예: 3000', () =>
    expect(pricePlaceholders(['월세'])).toEqual({ min: '예: 500', max: '예: 3000' }))
  it('매매+월세 → 보증금 하한 ~ 매매가 상한', () =>
    expect(pricePlaceholders(['매매', '월세'])).toEqual({ min: '예: 500', max: '예: 80000' }))
})

describe('budgetErrors', () => {
  it('정상 범위는 통과', () =>
    expect(budgetErrors(form({ min_price: '500', max_price: '3000' }), ['월세'])).toEqual({}))

  it('빈칸은 다음을 눌러 보기 전엔 탓하지 않는다', () => {
    expect(budgetErrors(form(), ['월세'], { requireFilled: false })).toEqual({})
    expect(budgetErrors(form(), ['월세'])).toEqual({
      min_price: '보증금 최소값을 입력해 주세요',
      max_price: '보증금 최대값을 입력해 주세요',
    })
  })

  it('음수는 예산 단계에서 바로 막는다 — 허용 하한을 말한다', () =>
    expect(budgetErrors(form({ min_price: '-100', max_price: '0' }), ['매매'])).toEqual({
      min_price: '매매가 최소값은 0만원 이상으로 입력해 주세요',
      max_price: '매매가 최대값은 1만원 이상으로 입력해 주세요',
    }))

  it('여러 유형이면 이름을 금액으로 줄인다', () =>
    expect(budgetErrors(form(), ['매매', '월세', '전세'])).toEqual({
      min_price: '금액 최소값을 입력해 주세요',
      max_price: '금액 최대값을 입력해 주세요',
    }))

  it('최소 > 최대는 최대 칸에', () =>
    expect(budgetErrors(form({ min_price: '3000', max_price: '500' }), ['월세'])).toEqual({
      max_price: '보증금 최대값이 최소값보다 작아요',
    }))

  it('DB 가 정수 칸이라 소수는 막는다', () =>
    expect(budgetErrors(form({ min_price: '500.5', max_price: '3000' }), ['월세']).min_price)
      .toBe('보증금 최소값은 만원 단위 정수로 입력해 주세요 (예: 500)'))

  it('상한(1조 원)을 넘으면 상한을 말한다', () =>
    expect(budgetErrors(form({ min_price: '0', max_price: String(MAX_PRICE_MAN + 1) }), ['매매']).max_price)
      .toBe('매매가 최대값은 100,000,000만원(1조 원) 이하로 입력해 주세요'))

  it('월세 칸은 월세를 골랐을 때만, 선택 입력으로 본다', () => {
    const f = form({ min_price: '500', max_price: '3000', min_monthly: '80', max_monthly: '30' })
    expect(budgetErrors(f, ['월세'])).toEqual({ max_monthly: '월세 최대값이 최소값보다 작아요' })
    expect(budgetErrors(f, ['매매'])).toEqual({})
    expect(budgetErrors(form({ min_price: '1', max_price: '2' }), ['월세'])).toEqual({})
  })
})

describe('sizeErrors — 조사와 허용 범위', () => {
  it('비어 있으면 통과(선택 입력)', () => expect(sizeErrors(form())).toEqual({}))
  it('1e9 → 상한을 말하고 조사가 맞다', () =>
    expect(sizeErrors(form({ min_size: '1e9' })).min_size).toBe('최소 면적은 100,000평 이하로 입력해 주세요'))
  it('-5.5 → 하한', () =>
    expect(sizeErrors(form({ max_size: '-5.5' })).max_size).toBe('최대 면적은 1평 이상으로 입력해 주세요'))
  it('0.5 → 하한(1평)', () =>
    expect(sizeErrors(form({ min_size: '0.5' })).min_size).toBe('최소 면적은 1평 이상으로 입력해 주세요'))
  it('24.5 → 정수로', () =>
    expect(sizeErrors(form({ min_size: '24.5' })).min_size).toBe('최소 면적은 정수로 입력해 주세요 (예: 24.5평 → 24 또는 25)'))
  it('최소 > 최대', () =>
    expect(sizeErrors(form({ min_size: '30', max_size: '10' }))).toEqual({ max_size: '최대 면적이 최소 면적보다 작아요' }))
  it('잘못된 조사가 다시 나오지 않는다', () => {
    const all = [
      ...Object.values(sizeErrors(form({ min_size: '1e9', max_size: '-1' }))),
      ...Object.values(budgetErrors(form({ min_price: '-1', max_price: 'x' }), ['매매', '월세', '전세'])),
    ].join('\n')
    expect(all).not.toMatch(/평수이|평수은|면적이 너무|값이 너무/)
  })
})

describe('moveInDateError — 한국 날짜 기준 오늘부터', () => {
  it('비어 있으면 통과', () => expect(moveInDateError('', TODAY)).toBeNull())
  it('오늘은 통과', () => expect(moveInDateError(TODAY, TODAY)).toBeNull())
  it('과거는 막고 오늘 날짜를 알려 준다', () =>
    expect(moveInDateError('1999-01-01', TODAY)).toBe('입주 희망일은 오늘(2026-10-21) 또는 그 뒤 날짜로 골라 주세요'))
  it('수정 화면: 저장돼 있던 지난 날짜는 그대로 두는 것을 허용', () =>
    expect(moveInDateError('2026-01-01', TODAY, '2026-01-01')).toBeNull())
  it('수정 화면이라도 새로 고른 과거 날짜는 막는다', () =>
    expect(moveInDateError('2025-12-31', TODAY, '2026-01-01')).not.toBeNull())
})

describe('stepIssues — 다음으로 못 가는 이유', () => {
  it('1단계: 둘 다 비면 둘 다 말한다', () =>
    expect(stepIssues(0, draft({ dealTypes: [], propertyTypes: [] }), TODAY)).toEqual([
      '거래 유형을 하나 이상 골라 주세요',
      '매물 유형을 하나 이상 골라 주세요',
    ]))
  it('2단계: 지역', () =>
    expect(stepIssues(1, draft({ region: null }), TODAY)).toEqual(['관심 지역을 검색해서 목록에서 골라 주세요']))
  it('3단계: 예산 빈칸', () =>
    expect(stepIssues(2, draft({ form: form() }), TODAY)).toEqual([
      '보증금 최소값을 입력해 주세요',
      '보증금 최대값을 입력해 주세요',
    ]))
  it('4단계: 면적·입주일', () =>
    expect(stepIssues(3, draft({ form: form({ min_price: '1', max_price: '2', min_size: '0.5', move_in_date: '1999-01-01' }) }), TODAY))
      .toHaveLength(2))
  it('다 채우면 비어 있다', () => {
    for (let s = 0; s < 4; s++) expect(stepIssues(s, draft(), TODAY)).toEqual([])
    expect(firstIssueStep(draft(), TODAY)).toBeNull()
  })
})

describe('clampStep — 빈 단계를 건너뛰지 않는다', () => {
  it('지역이 비면 3단계로 가려 해도 2단계(1)', () => expect(clampStep(3, draft({ region: null }), TODAY)).toBe(1))
  it('다 채웠으면 그대로', () => expect(clampStep(3, draft(), TODAY)).toBe(3))
  it('범위 밖 값은 잘라 낸다', () => {
    expect(clampStep(99, draft(), TODAY)).toBe(3)
    expect(clampStep(-1, draft(), TODAY)).toBe(0)
  })
})

describe('toRequestPayload', () => {
  it('동을 싣고, 숫자는 정수로', () => {
    const p = toRequestPayload({ ...draft({ form: form({ min_price: ' 500 ', max_price: '3000', min_monthly: '30', max_monthly: '', min_size: '24', description: '  주차 필수 ' }) }), region })
    expect(p).toMatchObject({
      deal_type: '월세', room_type: '상가', city: '충청남도', district: '천안시 서북구', dong: '불당동',
      min_price: 500, max_price: 3000, min_monthly: 30, max_monthly: null, min_size: 24, max_size: null,
      move_in_date: null, description: '주차 필수',
    })
  })
  it('월세를 빼면 월세 칸은 비운다', () => {
    const p = toRequestPayload({ ...draft({ dealTypes: ['매매'], form: form({ min_price: '1', max_price: '2', min_monthly: '30', max_monthly: '80' }) }), region })
    expect(p.min_monthly).toBeNull()
    expect(p.max_monthly).toBeNull()
  })
})

describe('describeSaveError', () => {
  it('정수 아님(22P02)', () => expect(describeSaveError({ code: '22P02' }, '등록')).toContain('소수점 없이'))
  it('범위 넘음(22003)', () => expect(describeSaveError({ code: '22003' }, '등록')).toContain('너무 커요'))
  it('RLS 거부(42501)', () => expect(describeSaveError({ code: '42501' }, '수정')).toContain('다시 로그인'))
  it('그 밖은 동작 이름을 넣은 일반 문구', () =>
    expect(describeSaveError(null, '수정')).toBe('수정 중 오류가 발생했어요. 잠시 후 다시 시도해 주세요.'))
})

describe('rangeText', () => {
  it('둘 다', () => expect(rangeText(30, 80)).toBe('30만~80만'))
  it('억 단위', () => expect(rangeText('20000', '50000')).toBe('2억~5억'))
  it('한쪽만', () => {
    expect(rangeText(30, null)).toBe('30만 이상')
    expect(rangeText('', '80')).toBe('80만 이하')
  })
  it('둘 다 없으면 null', () => expect(rangeText(null, '')).toBeNull())
})

describe('임시 저장 — serializeDraft/parseDraft', () => {
  it('왕복', () => {
    const d = { ...draft(), step: 2 }
    expect(parseDraft(serializeDraft(d))).toEqual(d)
  })
  it('깨졌거나 판이 다르면 null', () => {
    expect(parseDraft(null)).toBeNull()
    expect(parseDraft('{')).toBeNull()
    expect(parseDraft(JSON.stringify({ v: 999, step: 1 }))).toBeNull()
  })
  it('모르는 값은 걸러 낸다', () => {
    const raw = JSON.stringify({
      v: 1, step: 42, dealTypes: ['매매', '임대', 3], propertyTypes: ['상가', '우주정거장'],
      region: { sido: 1 }, form: { min_price: 500, max_price: '3000', hack: 'x' },
    })
    expect(parseDraft(raw)).toEqual({
      step: 3, dealTypes: ['매매'], propertyTypes: ['상가'], region: null,
      form: { ...EMPTY_REQUEST_FORM, max_price: '3000' },
    })
  })
  it('내용이 있는지', () => {
    expect(hasDraftContent({ dealTypes: [], propertyTypes: [], region: null, form: form() })).toBe(false)
    expect(hasDraftContent({ dealTypes: [], propertyTypes: [], region: null, form: form({ description: '주차' }) })).toBe(true)
  })
})

describe('단계 기록(history.state)', () => {
  it('Next.js 내부 값은 그대로 두고 단계만 덧쓴다', () => {
    const next = withStepHistory({ __NA: true, tree: 't', requestStepBase: 0 }, 2)
    expect(next).toEqual({ __NA: true, tree: 't', requestStep: 2, requestStepBase: 0 })
    expect(readStepHistory(next)).toEqual({ step: 2, base: 0 })
  })
  it('base 를 주면 바꾼다', () =>
    expect(withStepHistory({ requestStep: 3, requestStepBase: 0 }, 1, 1)).toEqual({ requestStep: 1, requestStepBase: 1 }))
  it('없거나 이상한 값은 null', () => {
    expect(readStepHistory(null)).toEqual({ step: null, base: null })
    expect(readStepHistory({ requestStep: 9, requestStepBase: '0' })).toEqual({ step: null, base: null })
  })
})

describe('저장 직후 안내 표식', () => {
  it('같은 요청이면 종류를 돌려준다', () =>
    expect(readSavedFlash(makeSavedFlash('abc', 'new'), 'abc')).toBe('new'))
  it('다른 요청·깨진 값이면 null', () => {
    expect(readSavedFlash(makeSavedFlash('abc', 'edit'), 'xyz')).toBeNull()
    expect(readSavedFlash('nope', 'abc')).toBeNull()
    expect(readSavedFlash(null, 'abc')).toBeNull()
  })
})
