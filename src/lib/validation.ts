/**
 * 폼 입력값 공통 검증 헬퍼.
 * 각 함수는 valid=true면 통과, false면 사용자 메시지 포함.
 */

export type ValidationResult = { valid: true } | { valid: false; error: string }

const MAX_PRICE_MAN = 9_999_999_999 // 100조원 (만원 단위) — 비현실적 값 차단

export function validatePrice(value: string | number | null | undefined, label = '가격'): ValidationResult {
  if (value == null || value === '') return { valid: false, error: `${label}을 입력해주세요` }
  const num = typeof value === 'number' ? value : Number(value)
  if (Number.isNaN(num)) return { valid: false, error: `${label}은 숫자로 입력해주세요` }
  if (num < 0) return { valid: false, error: `${label}은 0 이상이어야 합니다` }
  if (num > MAX_PRICE_MAN) return { valid: false, error: `${label}이 너무 큽니다` }
  return { valid: true }
}

export function validateArea(value: string | number | null | undefined, label = '면적'): ValidationResult {
  if (value == null || value === '') return { valid: true } // 면적은 선택 입력 가능
  const num = typeof value === 'number' ? value : Number(value)
  if (Number.isNaN(num)) return { valid: false, error: `${label}은 숫자로 입력해주세요` }
  if (num <= 0) return { valid: false, error: `${label}은 0보다 커야 합니다` }
  if (num > 100_000) return { valid: false, error: `${label}이 너무 큽니다` }
  return { valid: true }
}

export function validatePhoneKR(value: string): ValidationResult {
  if (!value) return { valid: false, error: '전화번호를 입력해주세요' }
  // 010-XXXX-XXXX 또는 010XXXXXXXX (대시 없이도 허용)
  if (!/^01[016789]-?\d{3,4}-?\d{4}$/.test(value.replace(/\s/g, ''))) {
    return { valid: false, error: '010-XXXX-XXXX 형식으로 입력해주세요' }
  }
  return { valid: true }
}

export function validateBudgetRange(min: string | number | null | undefined, max: string | number | null | undefined): ValidationResult {
  const minNum = min == null || min === '' ? null : Number(min)
  const maxNum = max == null || max === '' ? null : Number(max)
  if (minNum != null && (Number.isNaN(minNum) || minNum < 0)) return { valid: false, error: '최소 예산은 0 이상이어야 합니다' }
  if (maxNum != null && (Number.isNaN(maxNum) || maxNum < 0)) return { valid: false, error: '최대 예산은 0 이상이어야 합니다' }
  if (minNum != null && maxNum != null && minNum > maxNum) {
    return { valid: false, error: '최소 예산이 최대 예산보다 큽니다' }
  }
  return { valid: true }
}
