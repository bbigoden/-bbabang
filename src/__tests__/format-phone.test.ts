import { describe, it, expect } from 'vitest'
import { formatPhoneKR } from '@/lib/validation'

describe('formatPhoneKR', () => {
  it.each([
    ['01073320252', '010-7332-0252'],
    ['010 7332 0252', '010-7332-0252'],
    ['010.7332.0252', '010-7332-0252'],
    ['010-7332-0252', '010-7332-0252'],
    ['0101234567', '010-123-4567'],
    ['0412345678', '041-234-5678'],
    ['0212345678', '02-1234-5678'],
  ])('%s → %s', (a, b) => expect(formatPhoneKR(a)).toBe(b))

  it('메모가 섞였거나 자릿수가 안 맞으면 그대로 둔다', () => {
    expect(formatPhoneKR('010-7332-0252 부인')).toBe('010-7332-0252 부인')
    expect(formatPhoneKR('0107332')).toBe('0107332')
    expect(formatPhoneKR('')).toBe('')
  })
})
