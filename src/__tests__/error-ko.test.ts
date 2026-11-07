import { describe, it, expect } from 'vitest'
import { isDevErrorUrl, describeErrorKo, errorLineKo } from '@/lib/error-ko'

describe('isDevErrorUrl', () => {
  it('시험 화면 주소는 걸러낸다', () => {
    expect(isDevErrorUrl('http://localhost:3000/broker/office')).toBe(true)
    expect(isDevErrorUrl('http://127.0.0.1:3000/')).toBe(true)
    expect(isDevErrorUrl('http://app.localhost:3000/')).toBe(true)
  })
  it('운영 주소·빈 값은 그대로 둔다', () => {
    expect(isDevErrorUrl('https://busojang.vercel.app/broker')).toBe(false)
    expect(isDevErrorUrl(null)).toBe(false)
    expect(isDevErrorUrl('엉터리')).toBe(false)
  })
})

describe('describeErrorKo', () => {
  it('자주 나는 에러에 한글 설명', () => {
    expect(describeErrorKo('showSubItem is not defined')).toBe("코드에서 'showSubItem'을(를) 못 찾음")
    expect(describeErrorKo("Cannot read properties of undefined (reading 'map')")).toBe("빈 값에서 'map'을(를) 읽으려 함")
    expect(describeErrorKo('a.b is not a function')).toBe("'a.b'이(가) 함수가 아님")
    expect(describeErrorKo('Failed to fetch')).toBe('서버 연결 실패(인터넷 끊김 등)')
    expect(describeErrorKo('ChunkLoadError: Loading chunk 12 failed.')).toBe('새 버전 배포 뒤 옛 화면 파일을 못 불러옴')
  })
  it('모르는 건 null, 줄은 원문 그대로', () => {
    expect(describeErrorKo('뭔가 이상함')).toBeNull()
    expect(errorLineKo('뭔가 이상함')).toBe('뭔가 이상함')
    expect(errorLineKo('x is not defined')).toBe("코드에서 'x'을(를) 못 찾음 (x is not defined)")
  })
})
