import { describe, it, expect } from 'vitest'
import { checkYmdField } from '@/lib/property-field-check'

describe('checkYmdField', () => {
  it('정상 날짜는 통과', () => {
    expect(checkYmdField('접수일자', '2026-10-27')).toBeNull()
    expect(checkYmdField('접수일자', ' 2024-02-29 ')).toBeNull()
  })
  it.each(['2026-02-31', '0000-00-00', '20261301', '<script>', '😀', '99999-01-01', '1800-01-01', '2026-1-5', ''])(
    '%s → 한국어 안내',
    v => expect(checkYmdField('접수일자', v)).toMatch(/접수일자는 2024-03-15 처럼/)
  )
})
