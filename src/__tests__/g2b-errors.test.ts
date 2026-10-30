/** 나라장터 오류 응답 — 한도 초과(22)를 알아봐야 수집이 '한 건 실패'로 여기고 줄줄이 건너뛰지 않는다 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { g2bGet, G2bError } from '@/lib/g2b'

const respond = (body: string) => vi.stubGlobal('fetch', vi.fn(async () => new Response(body)))

describe('g2bGet 오류', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

  it('JSON 한도 초과(2026-10-29 실제 응답) → 코드 22', async () => {
    vi.stubEnv('SEUM_API_KEY', 'k')
    respond(JSON.stringify({ OpenAPI_ServiceResponse: { cmmMsgHeader: {
      errMsg: 'LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR', returnAuthMsg: '일일 서비스 요청제한 횟수 초과 에러', returnReasonCode: '22',
    } } }))
    const e = await g2bGet('notice', 'getBidPblancListInfoCnstwkBsisAmount', {}).catch(x => x)
    expect(e).toBeInstanceOf(G2bError)
    expect(e.code).toBe('22')
  })

  it('XML 한도 초과 → 코드 22', async () => {
    vi.stubEnv('SEUM_API_KEY', 'k')
    respond('<OpenAPI_ServiceResponse><cmmMsgHeader><returnAuthMsg>LIMITED</returnAuthMsg><returnReasonCode>22</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>')
    const e = await g2bGet('result', 'x', {}).catch(x => x)
    expect(e.code).toBe('22')
  })

  it('03 은 빈 목록', async () => {
    vi.stubEnv('SEUM_API_KEY', 'k')
    respond(JSON.stringify({ response: { header: { resultCode: '03', resultMsg: 'NO_DATA' } } }))
    expect(await g2bGet('result', 'x', {})).toEqual({ items: [], total: 0 })
  })
})

describe('isTransient — 다시 보내 볼 오류', () => {
  it('20초 시간 초과(10/30 실제)·연결 끊김·5xx 는 다시, 한도·키 오류는 아니다', async () => {
    const { isTransient } = await import('@/lib/bid-collect')
    const timeout = await fetch('http://127.0.0.1:9', { signal: AbortSignal.timeout(1) }).catch(e => e)
    expect(isTransient(new DOMException('The operation was aborted due to timeout', 'TimeoutError'))).toBe(true)
    expect(isTransient(timeout)).toBe(true)
    expect(isTransient(new TypeError('fetch failed'))).toBe(true)
    expect(isTransient(new G2bError('응답을 읽지 못했습니다 (502)', 'bad_response'))).toBe(true)
    expect(isTransient(new G2bError('응답을 읽지 못했습니다 (200)', 'bad_response'))).toBe(false)
    expect(isTransient(new G2bError('일일 한도', '22'))).toBe(false)
  })
})
