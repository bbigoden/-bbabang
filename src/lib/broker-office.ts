/**
 * 사무소 등록(/broker/register)·사무소 설정(/settings/office)이 같이 쓰는 입력 검사와 안내 문구.
 *
 * 예전엔 두 화면이 칸이 비었는지만 보고(공백만 넣어도 통과) 받은 값을 그대로 저장했고,
 * 저장이 막히면 이유와 상관없이 '등록(저장) 중 오류가 발생했습니다'만 보였다.
 * DB 가 막는 이유(계정당 사무소 1개·자격증 번호·사업자번호 중복)를 칸별 문구로 바꿔 준다.
 */

export interface OfficeForm {
  office_name: string
  address: string
  license_number: string
  office_reg_number: string
  business_reg_number: string
}

export type OfficeField = keyof OfficeForm
export type OfficeFormErrors = Partial<Record<OfficeField, string>>

/** 사업자등록번호에서 숫자만 */
export function businessDigits(v: string): string {
  return (v ?? '').replace(/\D/g, '')
}

/** 하이픈·공백을 빼고 숫자 10자리인지 */
export function isBusinessNumber(v: string): boolean {
  return /^\d{10}$/.test((v ?? '').replace(/[\s-]/g, ''))
}

/**
 * 10자리면 123-45-67890 으로 맞춘다. 중복 막기(유니크 인덱스)가 글자 그대로 비교하므로,
 * '1234567890' 과 '123-45-67890' 이 서로 다른 번호로 들어가지 않게 한 모양으로 저장한다.
 */
export function formatBusinessNumber(v: string): string {
  const d = businessDigits(v)
  return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}` : (v ?? '').trim()
}

const squash = (v: string) => (v ?? '').replace(/\s+/g, ' ').trim()

/** 앞뒤·겹친 공백을 정리하고 사업자번호 모양을 맞춘 값 — 저장은 늘 이 값으로 */
export function normalizeOfficeForm(f: OfficeForm): OfficeForm {
  return {
    office_name: squash(f.office_name),
    address: squash(f.address),
    license_number: squash(f.license_number),
    office_reg_number: squash(f.office_reg_number),
    business_reg_number: formatBusinessNumber(squash(f.business_reg_number)),
  }
}

// 자격증·등록번호는 지역·연도마다 모양이 달라(제20-01234호, 44133-2025-09302, 가1234-567 …)
// 정확한 형식 대신 '숫자가 4개 이상 + 번호에 쓰는 글자만'으로 엉터리 값만 거른다.
const ID_CHARS = /^[0-9A-Za-z가-힣\s\-().]+$/
const digitCount = (v: string) => businessDigits(v).length

/** 칸별 오류 문구. 빈 객체면 통과. 넘기기 전에 normalizeOfficeForm 을 거친 값이어야 한다. */
export function validateOfficeForm(f: OfficeForm): OfficeFormErrors {
  const e: OfficeFormErrors = {}
  // 태그 모양(<…>)은 화면에서 실행되진 않지만 상호·주소로 쓸 값이 아니다
  const hasTag = (v: string) => /[<>]/.test(v)

  if (!f.office_name) e.office_name = '상호명을 적어 주세요.'
  else if (f.office_name.length > 50) e.office_name = '상호명은 50자 안으로 적어 주세요.'
  else if (hasTag(f.office_name)) e.office_name = '상호명에 < > 는 쓸 수 없어요.'

  if (!f.address) e.address = '사무소 주소를 적어 주세요.'
  else if (f.address.length < 5) e.address = '시·군·구부터 번지까지 주소를 적어 주세요.'
  else if (f.address.length > 120) e.address = '주소는 120자 안으로 적어 주세요.'
  else if (hasTag(f.address)) e.address = '주소에 < > 는 쓸 수 없어요.'

  if (!f.license_number) e.license_number = '공인중개사 자격증 번호를 적어 주세요.'
  else if (f.license_number.length > 40 || !ID_CHARS.test(f.license_number) || digitCount(f.license_number) < 4)
    e.license_number = '자격증에 적힌 번호를 그대로 적어 주세요. (예: 제20-01234호)'

  if (!f.office_reg_number) e.office_reg_number = '중개사무소 등록번호를 적어 주세요.'
  else if (f.office_reg_number.length > 40 || !ID_CHARS.test(f.office_reg_number) || digitCount(f.office_reg_number) < 4)
    e.office_reg_number = '등록증에 적힌 번호를 그대로 적어 주세요. (예: 11680-2024-00123)'

  if (!f.business_reg_number) e.business_reg_number = '사업자등록번호를 적어 주세요.'
  else if (!isBusinessNumber(f.business_reg_number)) e.business_reg_number = '사업자등록번호는 숫자 10자리예요. (예: 123-45-67890)'

  return e
}

/** 번호가 이미 다른 사무소에 있을 때 그 칸 아래 문구 — 등록 전 확인(/api/brokers/check-numbers)과 409 가 같이 쓴다 */
export const NUMBER_TAKEN_MESSAGE = {
  license_number: '이 자격증 번호는 이미 다른 사무소에 등록돼 있어요. 본인 번호가 맞다면 고객센터로 문의해 주세요.',
  business_reg_number: '이 사업자등록번호는 이미 다른 사무소에 등록돼 있어요. 본인 번호가 맞다면 고객센터로 문의해 주세요.',
} as const

type DbError = { code?: string | null; message?: string | null; details?: string | null } | null | undefined

/**
 * broker_profiles 저장 실패 → 사람이 읽을 문구. field 가 있으면 그 칸 아래에 띄운다.
 * 23505(중복): 제약 이름이 message 에, 겹친 칸이 details 에 온다
 *   broker_profiles_user_id_key / broker_profiles_license_unique_idx / broker_profiles_business_reg_unique_idx
 */
export function officeSaveError(err: DbError): { field?: OfficeField; message: string; alreadyRegistered?: boolean } {
  const text = `${err?.message ?? ''} ${err?.details ?? ''}`
  if (err?.code === '23505' || /duplicate key/i.test(text)) {
    if (/user_id/.test(text)) {
      return { alreadyRegistered: true, message: '이 계정은 이미 사무소가 등록돼 있어요.' }
    }
    if (/license/.test(text)) {
      return { field: 'license_number', message: NUMBER_TAKEN_MESSAGE.license_number }
    }
    if (/business_reg/.test(text)) {
      return { field: 'business_reg_number', message: NUMBER_TAKEN_MESSAGE.business_reg_number }
    }
    return { message: '이미 등록된 정보와 겹쳐요. 번호를 다시 확인해 주세요.' }
  }
  if (err?.code === '42501') return { message: '이 정보를 바꿀 권한이 없어요. 사무소 대표 계정인지 확인해 주세요.' }
  return { message: '저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.' }
}

/**
 * /api/brokers/verify-business 실패 코드 → 안내 문구. 개발용 코드(config_missing_… 등)는 화면에 내보내지 않는다.
 * 국세청 확인은 선택이라, 안 되면 '그대로 신청하면 관리자가 확인'으로 다음 할 일을 알려 준다.
 */
export function bizVerifyMessage(code: string | null | undefined): string {
  switch (code) {
    case 'invalid_business_number': return '사업자등록번호 10자리를 다시 확인해 주세요.'
    case 'rate_limited': return '국세청 확인은 한 시간에 5번까지예요. 그대로 신청하시면 관리자가 확인해요.'
    case 'unauthorized': return '로그인이 풀렸어요. 다시 로그인해 주세요.'
    default: return '지금은 국세청 확인을 할 수 없어요. 그대로 신청하시면 관리자가 확인해요.'
  }
}

export type VerificationState =
  | { kind: 'verified' }
  | { kind: 'pending' }               // 처음 등록 — 아직 한 번도 승인된 적 없음
  | { kind: 'rejected'; reason: string }
  | { kind: 'revoked' }               // 승인됐다가 관리자가 취소

/**
 * 사무소 인증 상태. 관리자 화면(admin/brokers)이 verification_info 에 남기는 표시로 처음/반려/취소를 가른다.
 * - 승인: admin_approved_at 기록, 반려: admin_reject_reason 기록(approved_at 은 지움)
 * - 취소: is_verified 만 false 로 바꾸고 admin_approved_at 은 남는다
 * 예전엔 is_verified=false 면 처음 등록한 사람에게도 '재승인 대기 — 뱃지가 복구돼요'가 나왔다.
 */
export function verificationState(b: { is_verified?: boolean | null; verification_info?: unknown }): VerificationState {
  if (b.is_verified) return { kind: 'verified' }
  const info = (b.verification_info && typeof b.verification_info === 'object' ? b.verification_info : {}) as Record<string, unknown>
  const reason = typeof info.admin_reject_reason === 'string' ? info.admin_reject_reason.trim() : ''
  if (reason) return { kind: 'rejected', reason }
  if (info.admin_approved_at) return { kind: 'revoked' }
  return { kind: 'pending' }
}

/**
 * 인증 상태 안내 문구 — 등록 완료 화면·대시보드·설정 > 사무소가 같은 말을 쓰게 한 곳에 둔다.
 * 미인증이어도 막히는 건 인증 뱃지(와 준비중인 구인 공고)뿐이라, 기다리는 동안 쓸 수 있는 것도 같이 알린다.
 * 검토에 며칠 걸리는지는 정해진 게 없어 적지 않는다.
 */
export function verificationCopy(s: VerificationState): { tone: 'ok' | 'wait' | 'warn'; title: string; body: string } {
  switch (s.kind) {
    case 'verified':
      return { tone: 'ok', title: '인증된 사무소', body: '인증 뱃지가 붙어 있어요.' }
    case 'pending':
      return { tone: 'wait', title: '승인 대기 중', body: '관리자 검토가 끝나면 인증 뱃지가 붙어요. 그동안에도 매물·고객·업무일지 등은 그대로 쓸 수 있어요.' }
    case 'rejected':
      return { tone: 'warn', title: '인증 반려', body: `사유: ${s.reason}. 자세한 내용은 고객센터로 문의해 주세요.` }
    case 'revoked':
      return { tone: 'warn', title: '재승인 대기 중', body: '관리자가 인증을 취소했어요. 다시 승인되면 인증 뱃지가 복구돼요. 자세한 사유는 고객센터로 문의해 주세요.' }
  }
}
