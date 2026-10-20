import { describe, it, expect } from 'vitest'
import {
  formatBusinessNumber, isBusinessNumber, normalizeOfficeForm, validateOfficeForm,
  officeSaveError, bizVerifyMessage, verificationState, verificationCopy, type OfficeForm,
} from '@/lib/broker-office'
import { officeLockedLabel } from '@/components/broker/menu-items'

const OK: OfficeForm = {
  office_name: '행복공인중개사사무소',
  address: '충청남도 천안시 서북구 불당동 1',
  license_number: '제25-09302호',
  office_reg_number: '44133-2025-09302',
  business_reg_number: '509-47-12347',
}

describe('사업자등록번호', () => {
  it.each([
    ['5094712347', '509-47-12347'],
    ['509-47-12347', '509-47-12347'],
    [' 509 47 12347 ', '509-47-12347'],
  ])('%s → %s', (a, b) => expect(formatBusinessNumber(a)).toBe(b))

  it('10자리가 아니면 손대지 않는다', () => {
    expect(formatBusinessNumber('abc')).toBe('abc')
    expect(formatBusinessNumber('-1')).toBe('-1')
  })

  it('숫자 10자리만 통과', () => {
    expect(isBusinessNumber('509-47-12347')).toBe(true)
    expect(isBusinessNumber('5094712347')).toBe(true)
    expect(isBusinessNumber('abc')).toBe(false)
    expect(isBusinessNumber('509-47-1234')).toBe(false)
    expect(isBusinessNumber('509-47-12347-1')).toBe(false)
  })
})

describe('validateOfficeForm', () => {
  it('정상 값은 통과', () => {
    expect(validateOfficeForm(normalizeOfficeForm(OK))).toEqual({})
  })

  it('공백만 넣은 상호명은 빈칸으로 본다 (QA #27)', () => {
    const f = normalizeOfficeForm({ ...OK, office_name: '     ' })
    expect(f.office_name).toBe('')
    expect(validateOfficeForm(f).office_name).toBeTruthy()
  })

  it('QA 가 넣은 엉터리 값을 칸마다 막는다', () => {
    const e = validateOfficeForm(normalizeOfficeForm({
      office_name: '     ',
      address: '<script>alert(1)</script>',
      license_number: "' OR 1=1 --",
      office_reg_number: '-1',
      business_reg_number: 'abc',
    }))
    expect(Object.keys(e).sort()).toEqual(
      ['address', 'business_reg_number', 'license_number', 'office_name', 'office_reg_number'],
    )
  })

  it('번호 모양이 지역마다 달라도 받아 준다', () => {
    for (const license_number of ['제20-01234호', '제 2015-123 호', '25-09302']) {
      expect(validateOfficeForm(normalizeOfficeForm({ ...OK, license_number })).license_number).toBeUndefined()
    }
    for (const office_reg_number of ['11680-2024-00123', '가1234-567']) {
      expect(validateOfficeForm(normalizeOfficeForm({ ...OK, office_reg_number })).office_reg_number).toBeUndefined()
    }
  })

  it('앞뒤·겹친 공백을 정리하고 사업자번호는 하이픈 모양으로 저장한다', () => {
    const f = normalizeOfficeForm({ ...OK, office_name: '  행복   부동산 ', business_reg_number: '5094712347' })
    expect(f.office_name).toBe('행복 부동산')
    expect(f.business_reg_number).toBe('509-47-12347')
  })
})

describe('officeSaveError — 409 를 칸별 문구로', () => {
  it('계정당 사무소 1개', () => {
    const m = officeSaveError({ code: '23505', message: 'duplicate key value violates unique constraint "broker_profiles_user_id_key"' })
    expect(m.alreadyRegistered).toBe(true)
  })
  it('자격증 번호 중복', () => {
    const m = officeSaveError({ code: '23505', message: 'duplicate key value violates unique constraint "broker_profiles_license_unique_idx"', details: 'Key (license_number)=(제25-09302호) already exists.' })
    expect(m.field).toBe('license_number')
    expect(m.message).toContain('자격증 번호')
  })
  it('사업자번호 중복', () => {
    const m = officeSaveError({ code: '23505', message: 'duplicate key value violates unique constraint "broker_profiles_business_reg_unique_idx"' })
    expect(m.field).toBe('business_reg_number')
  })
  it('그 밖의 실패는 일반 문구', () => {
    expect(officeSaveError({ code: '08006', message: 'connection failure' }).field).toBeUndefined()
    expect(officeSaveError(null).message).toBeTruthy()
  })
})

describe('bizVerifyMessage', () => {
  it('개발용 코드를 화면에 내보내지 않는다 (QA #7)', () => {
    for (const code of ['config_missing_publicdata_key', 'upstream_error', 'upstream_fetch_failed', undefined, null]) {
      const msg = bizVerifyMessage(code)
      expect(msg).not.toMatch(/[a-z]+_[a-z]+/)
      expect(msg).toContain('관리자가 확인')
    }
  })
})

describe('verificationState', () => {
  it('처음 등록은 재승인이 아니라 승인 대기 (QA #6)', () => {
    const s = verificationState({ is_verified: false, verification_info: {} })
    expect(s.kind).toBe('pending')
    expect(verificationCopy(s).title).toBe('승인 대기 중')
    expect(verificationCopy(s).body).not.toContain('복구')
  })
  it('관리자가 반려하면 사유를 보여 준다', () => {
    const s = verificationState({ is_verified: false, verification_info: { admin_reject_reason: '등록번호 불일치', admin_approved_at: null } })
    expect(s).toEqual({ kind: 'rejected', reason: '등록번호 불일치' })
    expect(verificationCopy(s).body).toContain('등록번호 불일치')
  })
  it('승인됐다가 취소되면 재승인 대기', () => {
    const s = verificationState({ is_verified: false, verification_info: { admin_approved_at: '2026-10-01T00:00:00Z' } })
    expect(s.kind).toBe('revoked')
    expect(verificationCopy(s).title).toBe('재승인 대기 중')
  })
  it('인증됨', () => {
    expect(verificationState({ is_verified: true, verification_info: null }).kind).toBe('verified')
  })
})

describe('officeLockedLabel — 사무소 등록 전 잠김 메뉴 (QA #14)', () => {
  it.each([
    ['/broker/properties', '매물목록'],
    ['/broker/properties/new', '매물목록'],
    ['/broker/customers', '고객목록'],
    ['/broker/diary', '업무일지'],
    ['/broker/trash', '휴지통'],
    ['/broker/team', '직원'],
    ['/settings/office', '사무소'],
  ])('%s → %s', (path, label) => expect(officeLockedLabel(path)).toBe(label))

  it('사무소 없이도 여는 화면은 잠그지 않는다', () => {
    for (const path of ['/dashboard/broker', '/broker/register', '/broker/register/pending', '/settings/account', '/settings/notifications', '/request/new']) {
      expect(officeLockedLabel(path)).toBeNull()
    }
  })
})
