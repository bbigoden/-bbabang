import { describe, expect, it } from 'vitest'
import { checkPropertyField } from '@/lib/property-field-check'

describe('checkPropertyField', () => {
  it('점검에서 그대로 저장됐던 이상값을 막는다', () => {
    expect(checkPropertyField('price', -500)).toMatch(/0보다 작을/)
    expect(checkPropertyField('price', 1e9)).toMatch(/너무 커요/)
    expect(checkPropertyField('price', 0.5)).toMatch(/정수/)
    expect(checkPropertyField('total_floors', '0.5')).toMatch(/총층은/)
    expect(checkPropertyField('size_pyeong', '-10')).toMatch(/0보다 커야/)
    expect(checkPropertyField('approval_date', '내일')).toMatch(/날짜로/)
    expect(checkPropertyField('address', 'x'.repeat(501))).toMatch(/너무 길어요/)
    expect(checkPropertyField('floor', 0.5)).toMatch(/정수/)
    expect(checkPropertyField('total_floors', '7/5')).toMatch(/총층보다/)
  })
  it('정상값은 통과한다', () => {
    expect(checkPropertyField('price', 3000)).toBeNull()
    expect(checkPropertyField('price', 0)).toBeNull()
    expect(checkPropertyField('monthly_rent', null)).toBeNull()
    expect(checkPropertyField('floor', -1)).toBeNull()
    expect(checkPropertyField('total_floors', '5')).toBeNull()
    expect(checkPropertyField('total_floors', '2/5')).toBeNull()
    expect(checkPropertyField('total_floors', '-1/5')).toBeNull()
    expect(checkPropertyField('size_pyeong', '33.06')).toBeNull()
    expect(checkPropertyField('approval_date', '2017-01-04')).toBeNull()
    expect(checkPropertyField('approval_date', '2017-02-30')).not.toBeNull()
    expect(checkPropertyField('move_in_date', '즉시입주')).toBeNull()
    expect(checkPropertyField('move_in_date', '2026-11-01')).toBeNull()
    expect(checkPropertyField('address', '충남 천안시 서북구 불당동 100 101호')).toBeNull()
    expect(checkPropertyField('memo', 'a'.repeat(2000))).toBeNull()
    expect(checkPropertyField('memo', 'a'.repeat(2001))).toMatch(/2000자/)
    expect(checkPropertyField('images', ['x'])).toBeNull()
  })
})
