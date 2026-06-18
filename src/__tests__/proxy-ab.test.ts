import { describe, it, expect, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { EXPERIMENTS, AB_COOKIE_PREFIX } from '@/lib/ab-experiments'
import { proxy } from '@/proxy'

// A/B 실험 쿠키가 실제 반환 응답에 실리는지 검증.
// (예전엔 별도 abResponse에만 set 하고 반환하지 않아 active 실험이 켜져도 유실됐음.)
// /regions는 비보호·비루트·세션쿠키 없음 → 미들웨어가 auth 호출 없이 일찍 반환하는
// 경로라, Supabase 환경 없이도 applyAb 적용 여부만 깔끔히 확인할 수 있다.

const EXP_ID = 'unit_ab_probe'
const COOKIE = `${AB_COOKIE_PREFIX}${EXP_ID}`

function makeReq(path: string, cookies: Record<string, string> = {}) {
  const req = new NextRequest(`http://localhost:3000${path}`)
  for (const [k, v] of Object.entries(cookies)) req.cookies.set(k, v)
  return req
}

function addExperiment() {
  EXPERIMENTS.push({
    id: EXP_ID,
    active: true,
    variants: [
      { id: 'control', weight: 50 },
      { id: 'treatment', weight: 50 },
    ],
  })
}

afterEach(() => {
  const i = EXPERIMENTS.findIndex(e => e.id === EXP_ID)
  if (i >= 0) EXPERIMENTS.splice(i, 1)
})

describe('proxy A/B 쿠키 방출', () => {
  it('활성 실험이 있으면 응답에 ab_ 쿠키를 싣는다', async () => {
    addExperiment()
    const res = await proxy(makeReq('/regions'))
    const c = res.cookies.get(COOKIE)
    expect(c).toBeTruthy()
    expect(['control', 'treatment']).toContain(c?.value)
  })

  it('이미 유효한 배정 쿠키가 있으면 다시 set 하지 않는다', async () => {
    addExperiment()
    const res = await proxy(makeReq('/regions', { [COOKIE]: 'control' }))
    expect(res.cookies.get(COOKIE)).toBeUndefined()
  })

  it('활성 실험이 없으면 Set-Cookie 없음 (공개 페이지 CDN 캐시 보존)', async () => {
    const res = await proxy(makeReq('/regions'))
    expect(res.headers.get('set-cookie')).toBeFalsy()
  })
})
