import { describe, expect, it } from 'vitest'
import { bankOfferCode, parseBankAddress, planBankDraft, type BankDraftProperty } from '@/lib/bank-draft-plan'

describe('parseBankAddress', () => {
  it('도·시·구·동·지번·상세를 뱅크 선택지로 나눈다', () => {
    expect(parseBankAddress('충청남도 천안시 서북구 불당동 1479-2 404호')).toEqual({
      metro: '충남', gu: '천안시 서북구', dong: '불당동', ri: null, jibun1: '1479', jibun2: '2', detail: '404호',
    })
  })
  it('읍·면은 리까지 읽는다', () => {
    expect(parseBankAddress('아산시 신창면 오목리 221-1')).toMatchObject({ metro: '충남', gu: '아산시', dong: '신창면', ri: '오목리', jibun1: '221', jibun2: '1', detail: '' })
  })
  it('구가 빠진 천안 주소는 동으로 구를 찾는다', () => {
    expect(parseBankAddress('천안시 불당동 1530 정우프라자 115호')).toMatchObject({ gu: '천안시 서북구', dong: '불당동', jibun1: '1530', detail: '정우프라자 115호' })
    expect(parseBankAddress('천안시 신부동 456-8')).toMatchObject({ gu: '천안시 동남구' })
    expect(parseBankAddress('불당동 100 101호')).toMatchObject({ metro: '충남', gu: '천안시 서북구', dong: '불당동' })
    expect(parseBankAddress('신부동 456-8')).toBeNull()
  })
  it("'충남천안시' 처럼 붙은 것, 번지, 쉼표를 견딘다", () => {
    expect(parseBankAddress('충남천안시 서북구 직산읍 모시리 296 5동-1')).toMatchObject({ gu: '천안시 서북구', dong: '직산읍', ri: '모시리', jibun1: '296', detail: '5동-1' })
    expect(parseBankAddress('천안시 서북구 성정동 1390번지 2층')).toMatchObject({ dong: '성정동', jibun1: '1390', detail: '2층' })
    expect(parseBankAddress('충청남도 아산시 둔포면 석곡리 3-6, 2동')).toMatchObject({ ri: '석곡리', jibun1: '3', jibun2: '6', detail: '2동' })
  })
  it('행정동 숫자는 뗀다', () => {
    expect(parseBankAddress('천안시 동남구 성정1동 100')).toMatchObject({ dong: '성정동', gu: '천안시 동남구' })
  })
  it('앞에 붙은 표시는 건너뛴다', () => {
    expect(parseBankAddress('점검용-천안시 서북구 불당동 100 101호')).toMatchObject({ gu: '천안시 서북구', dong: '불당동', jibun1: '100', detail: '101호' })
    expect(parseBankAddress('(급) 충남 천안시 서북구 성정동 1286 1층')).toMatchObject({ dong: '성정동', jibun1: '1286' })
    expect(parseBankAddress('★불당동 1530 115호')).toMatchObject({ gu: '천안시 서북구', dong: '불당동', jibun1: '1530' })
  })
  it('지번이 없으면 null', () => {
    expect(parseBankAddress('천안 힐스테이트 퍼스트 (2)')).toBeNull()
    expect(parseBankAddress('아리스타 1343호')).toBeNull()
    expect(parseBankAddress('충청남도 아산시 680-125')).toBeNull()
    expect(parseBankAddress('')).toBeNull()
  })
})

describe('bankOfferCode', () => {
  it('매매·전세·월세 조합을 뱅크 코드로', () => {
    expect(bankOfferCode('매매')).toBe('A')
    expect(bankOfferCode('전세')).toBe('B')
    expect(bankOfferCode('월세')).toBe('C')
    expect(bankOfferCode('매매, 전세')).toBe('D')
    expect(bankOfferCode('매매, 월세')).toBe('E')
    expect(bankOfferCode('매매, 월세, 전세')).toBe('F')
    expect(bankOfferCode('분양')).toBeNull()
    expect(bankOfferCode(null)).toBeNull()
  })
})

const base: BankDraftProperty = {
  seq_no: 1607, address: '아산시 신창면 오목리 221-1', room_type: '공장/창고', deal_type: '월세',
  price: 15000, monthly_rent: 1500, size_pyeong: '719.19', area_type: '전용', area_unit: '평', area_supplied: null,
  floor: 1, total_floors: '1/1', management_fee: null, premium: null, move_in_date: null, approval_date: '2005-01-07',
  parking: '11', direction: null, rooms_bathrooms: null, description: null, memo: '사장님 010-0000-0000', images: ['https://x/a.jpg'],
}

describe('planBankDraft', () => {
  it('채울 수 있는 매물은 ok 와 값, 빈 필수칸은 warnings', () => {
    const plan = planBankDraft(base)
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.form.kind.gbn).toBe('WH')
    expect(plan.form.offer).toBe('C')
    expect(plan.form.deposit).toBe(15000)
    expect(plan.form.monthly).toBe(1500)
    expect(plan.form.sell).toBeNull()
    expect(plan.form.excPyeong).toBe(719.19)
    expect(plan.form.totalFloors).toBe(1)
    expect(plan.form.parkCount).toBe(11)
    expect(plan.form.parking).toBe('Y')
    expect(plan.form.approvalDate).toBe('2005-01-07')
    expect(plan.form.hiddenMemo).toBe('부소장 #1607\n사장님 010-0000-0000')
    expect(planBankDraft({ ...base, assignee: '박혜성' })).toMatchObject({ form: { hiddenMemo: '담당 박혜성\n부소장 #1607\n사장님 010-0000-0000' } })
    expect(plan.warnings.join(' ')).toMatch(/욕실/)
    expect(plan.warnings.join(' ')).toMatch(/방향/)
    expect(plan.fromRegister).toEqual([])
    const empty = planBankDraft({ ...base, size_pyeong: null, floor: null, total_floors: null, parking: null, approval_date: null })
    expect(empty.ok && empty.fromRegister).toEqual(['면적', '해당 층', '총층', '주차', '사용승인일'])
  })
  it('글에 공장이라고 적혀 있으면 공장(FA)으로', () => {
    const plan = planBankDraft({ ...base, description: '공장 임대' })
    expect(plan.ok && plan.form.kind.gbn).toBe('FA')
  })
  it('종류·주소·거래·가격이 안 되면 problems 로 막는다', () => {
    const plan = planBankDraft({ ...base, room_type: '아파트', address: '아리스타 1343호', deal_type: '분양', price: null })
    expect(plan.ok).toBe(false)
    if (plan.ok) return
    expect(plan.problems).toHaveLength(4)
    expect(plan.problems[0]).toMatch(/단지/)
  })
  it('월세인데 월세가 비면 막는다', () => {
    const plan = planBankDraft({ ...base, monthly_rent: null })
    expect(plan.ok).toBe(false)
  })
  it('㎡ 단위는 평으로 바꾼다', () => {
    const plan = planBankDraft({ ...base, size_pyeong: '33.06', area_unit: '㎡', area_type: '공급' })
    expect(plan.ok && plan.form.supPyeong).toBe(10)
    expect(plan.ok && plan.form.excPyeong).toBeNull()
  })
})

describe('주택으로 들어온 가게 호실', () => {
  it('상가로 바꾸라고 알려 준다', () => {
    const plan = planBankDraft({ ...base, room_type: '단독/다가구', address: '충청남도 천안시 동남구 신방동 1035 1층 101,102호' })
    expect(plan.ok).toBe(false)
    if (plan.ok) return
    expect(plan.problems[0]).toMatch(/1종\(상가\)·2종\(상가\)로 바꾸면/)
  })
})
