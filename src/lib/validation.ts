/**
 * 폼 입력값 공통 검증 헬퍼.
 * 각 함수는 valid=true면 통과, false면 사용자 메시지 포함.
 */

export type ValidationResult = { valid: true } | { valid: false; error: string }

/** 전화번호를 하이픈 형식으로 정리 — '01073320252' · '010 7332 0252' · '010.7332.0252' → '010-7332-0252'.
 *  숫자와 구분자(공백·하이픈·점·괄호)만으로 된 값만 건드린다. 메모가 섞인 값('010-1234-5678 부인')이나
 *  자릿수가 안 맞는 값은 입력한 그대로 둔다. */
export function formatPhoneKR(value: string): string {
  // 전각 숫자·하이픈(０１０－１２３４)은 반각으로 — 폰 키보드에 따라 섞여 들어온다(10-30 점검)
  value = value.normalize('NFKC')
  const raw = value.trim()
  if (!raw || /[^\d\s\-.()]/.test(raw)) return value
  const d = raw.replace(/\D/g, '')
  if (!d.startsWith('0')) return value
  if (d.startsWith('02')) {
    if (d.length === 9) return `${d.slice(0, 2)}-${d.slice(2, 5)}-${d.slice(5)}`
    if (d.length === 10) return `${d.slice(0, 2)}-${d.slice(2, 6)}-${d.slice(6)}`
    return value
  }
  if (d.length === 11) return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`
  if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`
  return value
}

export function validatePhoneKR(value: string): ValidationResult {
  if (!value.trim()) return { valid: false, error: '전화번호를 입력해주세요' }
  // 하이픈·공백·점은 있어도 없어도 된다 — 숫자만 보고 01X + 7~8자리인지 본다. 안내문이
  // '010-XXXX-XXXX 형식'이라 하이픈을 꼭 넣어야 하는 줄 알았는데 실제로는 빼도 통과했다.
  // 저장 모양은 formatPhoneKR 로 맞춘다.
  if (!/^01[016789]\d{7,8}$/.test(value.replace(/[\s\-.]/g, ''))) {
    return { valid: false, error: '휴대폰 번호를 확인해주세요 (예: 010-1234-5678)' }
  }
  return { valid: true }
}

/** 이메일 형식. 브라우저 type=email 은 'abc@example' 처럼 점 없는 도메인도 통과시킨다(사내망 주소용).
 *  그런 주소로도 계정은 생기지만(가입 즉시 인증) 비밀번호 찾기 메일은 영영 못 받는다.
 *  도메인에 점이 있고 끝(.com·.kr 등)이 두 글자 이상이어야 받는다. 빈 마디('a@.com', 'a@b..com')도 거절. */
const EMAIL_RE = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)*\.[^\s@.]{2,}$/

export function validateEmail(value: string): ValidationResult {
  const v = value.trim()
  if (!v) return { valid: false, error: '이메일을 입력해주세요' }
  if (!EMAIL_RE.test(v)) return { valid: false, error: '올바른 이메일 주소를 입력해주세요 (예: name@example.com)' }
  return { valid: true }
}

/** 이름 최대 길이 — 520자짜리 이름이 그대로 저장돼 대시보드 인사말·헤더가 화면 밖으로 뻗었다(QA #26).
 *  실명·상호 표기에 30자면 넉넉하다. 가입 화면과 설정>내 계정이 같은 값을 써야 가입 때만 긴 이름이
 *  들어가는 구멍이 없다. DB 에는 아직 CHECK 가 없어 화면 검사다. */
export const NAME_MAX = 30

/** 이름 — 앞뒤 공백을 지우고 본다. required 만으론 공백 '   ' 도 통과해 인사말이 '안녕하세요,    님'이 됐다.
 *  길이는 공백을 지운 뒤 센다 — 저장도 trim 한 값으로 한다. */
export function validateName(value: string): ValidationResult {
  const v = value.trim()
  if (!v) return { valid: false, error: '이름을 입력해주세요' }
  if (v.length > NAME_MAX) return { valid: false, error: `이름은 ${NAME_MAX}자까지 입력할 수 있어요` }
  return { valid: true }
}

export const SIGNUP_PASSWORD_MIN = 8

export type SignupField = 'name' | 'email' | 'password' | 'passwordConfirm' | 'phone' | 'terms'
export type SignupErrors = Partial<Record<SignupField, string>>

/**
 * 회원가입 칸을 한꺼번에 본다. 예전엔 첫 오류에서 멈추고 버튼 위 한 곳에만 띄워, 고칠 때마다
 * 다음 오류가 하나씩 튀어나왔다. 칸마다 오류를 돌려주고, 키는 화면 위→아래 순서로 넣는다
 * (첫 키가 맨 위 오류 칸 — 거기로 포커스·스크롤).
 * 휴대폰은 선택 칸이라 비어 있으면 보지 않는다.
 */
export function validateSignup(input: {
  name: string
  email: string
  password: string
  passwordConfirm: string
  phone: string
  agreeTerms: boolean
}): SignupErrors {
  const errors: SignupErrors = {}
  const name = validateName(input.name)
  if (!name.valid) errors.name = name.error
  const email = validateEmail(input.email)
  if (!email.valid) errors.email = email.error
  if (!input.password) errors.password = '비밀번호를 입력해주세요'
  else if (input.password.length < SIGNUP_PASSWORD_MIN) errors.password = `비밀번호는 ${SIGNUP_PASSWORD_MIN}자 이상이어야 합니다`
  if (!input.passwordConfirm) errors.passwordConfirm = '비밀번호를 한 번 더 입력해주세요'
  else if (input.password !== input.passwordConfirm) errors.passwordConfirm = '비밀번호가 일치하지 않습니다'
  if (input.phone.trim()) {
    const phone = validatePhoneKR(input.phone)
    if (!phone.valid) errors.phone = phone.error
  }
  if (!input.agreeTerms) errors.terms = '이용약관에 동의해주세요'
  return errors
}

/**
 * 로그인·가입 뒤 돌아갈 주소(redirect)는 같은 사이트 경로만 받는다. '/' 로 시작하고 '//' 가 아니어도
 * '/\evil.example' 은 브라우저가 https://evil.example 로 읽어서, 로그인된 사람이
 * 링크만 열어도 마운트 effect 가 바로 외부로 보냈다. 실제로 풀어 본 주소가
 * 같은 출처일 때만 그 경로를 쓴다(가짜 출처로 풀어 보고 출처가 바뀌면 거절).
 * 쿼리(?focus=…, ?date=…)는 그대로 살려 돌려준다 — proxy 가 쿼리까지 담아 보낸다.
 *
 * 풀어 본 결과도 '//' 로 시작하면 거절한다. '/.//evil.example'·'/a/..//evil.example' 은
 * 앞 검사를 지나고 출처도 그대로인데, 점 구간이 정리되며 경로가 '//evil.example' 이 된다.
 * 그걸 router.replace 에 넘기면 브라우저가 외부 주소로 읽어 그쪽으로 나간다.
 *
 * 로그인 화면에만 있다가 가입 화면도 redirect 를 이어 받게 되며 여기로 옮겼다 — 두 화면이
 * 같은 검사를 써야 가입 쪽이 새 구멍이 되지 않는다.
 */
export function safeRedirectPath(raw: unknown): string | null {
  // ?redirect=a&redirect=b 처럼 겹치면 배열로 온다 — 문자열 하나일 때만 받는다
  if (typeof raw !== 'string' || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return null
  const base = 'http://same-origin.invalid'
  try {
    const u = new URL(raw, base)
    const path = u.pathname + u.search + u.hash
    return u.origin === base && !path.startsWith('//') ? path : null
  } catch {
    return null
  }
}

/** 연락처 칸에 전화번호로 볼 만한 숫자(9자리 이상)가 있는지 — 메모를 함께 적는 일이 있어 막지는 않고 알려만 준다 */
export function looksLikePhone(value: string): boolean {
  return value.normalize('NFKC').replace(/\D/g, '').length >= 9
}
