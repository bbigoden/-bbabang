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
