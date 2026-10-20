import { describe, it, expect } from 'vitest'
import { validatePhoneKR, formatPhoneKR, validateName, NAME_MAX } from '@/lib/validation'

// 설정 > 내 계정의 이름 저장 규칙 — 가입 화면과 같은 validateName 을 쓴다(상한 NAME_MAX, 화면에서 지운 지역 상수 없음).
// 예전엔 이 화면만 30자를 봐서, 가입 때 들어간 520자 이름은 못 막았다.
describe('내 계정 이름', () => {
  it('빈 이름·공백만은 막는다', () => {
    expect(validateName('').valid).toBe(false)
    expect(validateName('   ').valid).toBe(false)
  })
  it(`${NAME_MAX}자까지 통과, 넘으면 막는다 — 가입 화면과 같은 값`, () => {
    expect(validateName('가'.repeat(NAME_MAX)).valid).toBe(true)
    expect(validateName('가'.repeat(NAME_MAX + 1)).valid).toBe(false)
  })
  it('막을 때는 화면에 띄울 문구를 준다', () => {
    const r = validateName('가'.repeat(NAME_MAX + 1))
    expect(r.valid).toBe(false)
    if (!r.valid) expect(r.error).toContain(String(NAME_MAX))
  })
})

// 설정 > 내 계정의 전화번호 저장 규칙 — 가입 화면과 같은 validatePhoneKR 로 거르고,
// 통과한 값만 formatPhoneKR 로 다듬어 저장한다. 예전엔 검사 없이 'abc' 도 '저장됐습니다'로 들어갔다.
// (검사 문구·세부 자릿수 규칙은 가입 화면 쪽이 정한다 — 여기선 내 계정이 기대는 경계만 본다)
describe('내 계정 전화번호', () => {
  it.each([
    '010-1234-5678',
    '01012345678',
    '010 1234 5678',
    '010-123-4567',
    '011-123-4567',
  ])('%s 는 통과', (v) => expect(validatePhoneKR(v).valid).toBe(true))

  it.each([
    '',
    '   ',
    'abc',
    '010-1234-56789',
    '02-1234-5678',
    '+82-10-1234-5678',
    '010-1234-5678 부인',
  ])('"%s" 는 막는다', (v) => expect(validatePhoneKR(v).valid).toBe(false))

  it('막을 때는 화면에 띄울 문구를 준다', () => {
    const r = validatePhoneKR('abc')
    expect(r.valid).toBe(false)
    if (!r.valid) expect(r.error.length).toBeGreaterThan(0)
  })

  // 통과한 값은 모두 하이픈 한 모양으로 저장돼야 한다
  it.each([
    ['01012345678', '010-1234-5678'],
    ['010 1234 5678', '010-1234-5678'],
    ['010-12345678', '010-1234-5678'],
    ['010-123-4567', '010-123-4567'],
  ])('통과한 %s 는 %s 로 저장된다', (input, saved) => {
    expect(validatePhoneKR(input).valid).toBe(true)
    expect(formatPhoneKR(input)).toBe(saved)
  })
})
