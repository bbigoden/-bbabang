/**
 * 회원가입 입력 검사 + 로그인·가입 redirect 검사.
 *
 * 가입 화면은 예전에 첫 오류에서 멈추고(고칠 때마다 다음 오류가 하나씩), 공백 이름·'abc@example' 같은
 * 끝 없는 이메일을 그대로 받았고, 휴대폰 안내는 '010-XXXX-XXXX 형식'인데 하이픈 없이도 통과했다.
 * redirect 검사는 로그인 화면에만 있다가 가입 화면도 쓰게 되어 lib 으로 옮겼다 — 같은 구멍을 지킨다.
 */
import { describe, it, expect } from 'vitest'
import { validateEmail, validateName, validatePhoneKR, validateSignup, safeRedirectPath, NAME_MAX } from '@/lib/validation'

describe('validateEmail', () => {
  it.each([
    'a@b.co',
    'name@example.com',
    'first.last+tag@mail.example.co.kr',
    '  name@example.com  ', // 앞뒤 공백은 지우고 본다(자동완성이 붙이곤 한다)
  ])('%s 는 통과', (v) => expect(validateEmail(v).valid).toBe(true))

  it.each([
    '',
    '   ',
    'p5-breaker-2021@example', // QA #33 — 도메인에 점이 없다
    'abc@example.',
    'abc@.com',
    'abc@example..com',
    'abc@example.c', // 끝이 한 글자
    'abc.example.com',
    'a b@example.com',
    'a@b@example.com',
  ])('"%s" 는 막는다', (v) => expect(validateEmail(v).valid).toBe(false))
})

describe('validateName', () => {
  it('공백만 넣은 이름은 막는다 (QA #22 — 인사말이 "안녕하세요,    님")', () => {
    expect(validateName('   ').valid).toBe(false)
    expect(validateName('\t ').valid).toBe(false)
    expect(validateName('').valid).toBe(false)
  })
  it('앞뒤 공백이 있어도 글자가 있으면 통과', () => {
    expect(validateName(' 홍길동 ').valid).toBe(true)
  })
  it(`${NAME_MAX}자를 넘는 이름은 막는다 (QA #26 — 520자 이름이 인사말·헤더를 화면 밖으로 밀었다)`, () => {
    expect(NAME_MAX).toBe(30)
    expect(validateName('가'.repeat(NAME_MAX)).valid).toBe(true)
    const r = validateName('가'.repeat(NAME_MAX + 1))
    expect(r.valid).toBe(false)
    if (!r.valid) expect(r.error).toContain(String(NAME_MAX))
  })
  it('길이는 앞뒤 공백을 뺀 뒤 센다 — 저장도 trim 한 값으로 한다', () => {
    expect(validateName(`   ${'가'.repeat(NAME_MAX)}   `).valid).toBe(true)
  })
  it('가입 검사도 같은 상한을 쓴다 — 가입 때만 긴 이름이 들어가는 구멍이 없다', () => {
    const errors = validateSignup({
      name: '가'.repeat(NAME_MAX + 1), email: 'name@example.com', password: 'abcd1234!', passwordConfirm: 'abcd1234!', phone: '', agreeTerms: true,
    })
    expect(Object.keys(errors)).toEqual(['name'])
  })
})

describe('validatePhoneKR — 안내문과 실제 규칙이 같다', () => {
  it.each([
    '010-1234-5678',
    '01012345678', // 하이픈 없이도 — 안내문이 그렇게 말한다
    '010 1234 5678',
    '010.1234.5678', // formatPhoneKR 가 다듬는 구분자는 다 받는다
    '011-123-4567',
  ])('%s 는 통과', (v) => expect(validatePhoneKR(v).valid).toBe(true))

  it.each(['abc-defg', '010-1234', '02-1234-5678', '010-1234-56789', '+82-10-1234-5678'])(
    '"%s" 는 막는다', (v) => expect(validatePhoneKR(v).valid).toBe(false),
  )

  it('막을 때 문구는 하이픈을 강요하지 않고 예시만 든다', () => {
    const r = validatePhoneKR('abc')
    expect(r.valid).toBe(false)
    if (!r.valid) {
      expect(r.error).not.toContain('형식으로 입력')
      expect(r.error).toContain('010-1234-5678')
    }
  })
})

describe('validateSignup — 칸마다 한꺼번에', () => {
  const ok = {
    name: '홍길동',
    email: 'name@example.com',
    password: 'abcd1234!',
    passwordConfirm: 'abcd1234!',
    phone: '',
    agreeTerms: true,
  }

  it('다 맞으면 오류 없음 (휴대폰은 선택 — 비워도 된다)', () => {
    expect(validateSignup(ok)).toEqual({})
  })

  it('여러 칸이 틀리면 첫 오류에서 멈추지 않고 모두 돌려준다 (QA #32)', () => {
    const errors = validateSignup({ ...ok, password: '123', passwordConfirm: '456', phone: 'abc-defg', agreeTerms: false })
    expect(Object.keys(errors).sort()).toEqual(['password', 'passwordConfirm', 'phone', 'terms'].sort())
  })

  it('키 순서가 화면 위→아래 순서다 — 첫 키로 포커스·스크롤한다', () => {
    const errors = validateSignup({
      name: ' ', email: 'x@y', password: '', passwordConfirm: '', phone: '1', agreeTerms: false,
    })
    expect(Object.keys(errors)).toEqual(['name', 'email', 'password', 'passwordConfirm', 'phone', 'terms'])
  })

  it('약관만 빠졌으면 약관 오류 하나 — 버튼을 꺼 두지 않고 이 문구를 띄운다 (QA #29)', () => {
    expect(validateSignup({ ...ok, agreeTerms: false })).toEqual({ terms: '이용약관에 동의해주세요' })
  })

  it('비밀번호 확인이 다르면 확인 칸에 띄운다', () => {
    expect(validateSignup({ ...ok, passwordConfirm: 'different1!' })).toEqual({ passwordConfirm: '비밀번호가 일치하지 않습니다' })
  })
})

describe('safeRedirectPath — 같은 사이트 경로만', () => {
  it.each([
    ['/request/new', '/request/new'],
    ['/broker/properties?focus=abc', '/broker/properties?focus=abc'],
    ['/broker/diary?date=2026-10-21#top', '/broker/diary?date=2026-10-21#top'],
  ])('%s → %s', (raw, out) => expect(safeRedirectPath(raw)).toBe(out))

  it.each([
    'https://evil.example',
    '//evil.example',
    '/\\evil.example',
    '/.//evil.example', // 점 구간이 정리되면 '//evil.example'
    '/a/..//evil.example',
    'request/new', // '/' 로 시작하지 않음
    '',
  ])('"%s" 는 거절', (raw) => expect(safeRedirectPath(raw)).toBeNull())

  it('문자열이 아니면(?redirect=a&redirect=b 는 배열) 거절', () => {
    expect(safeRedirectPath(['/a', '/b'])).toBeNull()
    expect(safeRedirectPath(undefined)).toBeNull()
  })
})
