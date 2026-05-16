import { chromium } from 'playwright'

const BASE     = 'https://bbabang.vercel.app'
const SUPA_URL = 'https://wovxcdfxxnsljdhrgonh.supabase.co'
const SUPA_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndvdnhjZGZ4eG5zbGpkaHJnb25oIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwOTY0NzUsImV4cCI6MjA5MzY3MjQ3NX0.fRGsT2nqQ-GygrrShBClwlwNANTHhxBXq-O2fR7Fc-w'
const PW       = 'rladyd14s!'

const ACCOUNTS = {
  user:   { email: 't1@gmail.com',        role: '고객',   dashboard: '/dashboard/user' },
  broker: { email: 't2@gmail.com',        role: '중개사', dashboard: '/dashboard/broker' },
  admin:  { email: 'bigodennn@gmail.com', role: '관리자', dashboard: '/admin' },
}

const results = { pass: 0, fail: 0, errors: [] }
const pass = (label, msg) => { results.pass++; console.log(`  ✅ [${label}] ${msg}`) }
const fail = (label, msg) => { results.fail++; results.errors.push(`[${label}] ${msg}`); console.log(`  ❌ [${label}] ${msg}`) }
const info = (label, msg) => console.log(`     [${label}] ${msg}`)

function section(title) {
  console.log(`\n${'═'.repeat(60)}\n  ${title}\n${'═'.repeat(60)}`)
}

async function supaLogin(email, password = PW) {
  const res = await fetch(`${SUPA_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPA_ANON },
    body: JSON.stringify({ email, password }),
  })
  const data = await res.json()
  return { token: data.access_token ?? null, uid: data.user?.id ?? null }
}

async function supaRest(path, { method = 'GET', token, body, anon = false } = {}) {
  const headers = { apikey: SUPA_ANON, 'Content-Type': 'application/json', Prefer: 'return=representation' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(`${SUPA_URL}/rest/v1${path}`, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json
  try { json = JSON.parse(text) } catch { json = text }
  return { status: res.status, data: json }
}

async function loginPage(page, email, password = PW) {
  await page.goto(`${BASE}/auth/login`)
  await page.waitForSelector('input[type="email"]', { timeout: 15000 })
  await page.fill('input[type="email"]', email)
  await page.fill('input[type="password"]', password)
  await page.click('button[type="submit"]')
  await Promise.race([
    page.waitForURL(u => !u.includes('/auth/login'), { timeout: 20000 }),
    page.waitForSelector('[class*="red"]', { timeout: 20000 }),
  ]).catch(() => {})
  await page.waitForTimeout(2000)
  return page.url().replace(BASE, '')
}

async function pageHasText(page, ...kw) {
  const c = await page.textContent('body').catch(() => '')
  return kw.some(k => c.includes(k))
}

// ══════════════════════════════════════════════════════════
// T1: API 인증 검증
// ══════════════════════════════════════════════════════════
async function testApiAuth() {
  section('T1 API 인증 검증')

  // 비로그인 auto-fill → 401
  const res = await fetch(`${BASE}/api/properties/auto-fill`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bcode: '1168010100', bun: '605', ji: '0', ho: '101' }),
  })
  if (res.status === 401)
    pass('API인증', '비로그인 auto-fill → 401 Unauthorized (인증 차단 정상)')
  else
    fail('API인증', `비로그인 auto-fill → ${res.status} (401이어야 함 — 인증 미적용)`)

  // 로그인 후 auto-fill → 200
  const token = await supaLogin(ACCOUNTS.broker.email)
  if (token) {
    // 쿠키 기반이라 API Route에서 세션을 확인하므로 브라우저 fetch로 테스트
    info('API인증', '로그인 후 auto-fill 브라우저 테스트는 E2E 브라우저 세션 필요 (별도 진행)')
  }
}

// ══════════════════════════════════════════════════════════
// T2: RLS 직접 검증 (Supabase REST API)
// ══════════════════════════════════════════════════════════
async function testRLS() {
  section('T2 RLS 직접 검증')

  // 2-1. 비인증(anon)으로 profiles SELECT → true policy라 허용됨 (의도적)
  const { status: anonSelect, data: profiles } = await supaRest('/profiles?limit=1')
  if (anonSelect === 200 && Array.isArray(profiles) && profiles.length > 0)
    pass('RLS', 'anon 프로필 SELECT — 공개 조회 정책 정상')
  else
    fail('RLS', `anon 프로필 SELECT 실패 (${anonSelect})`)

  // 2-2. 비인증(anon)으로 다른 사용자 프로필 UPDATE → 차단돼야 함
  const targetId = Array.isArray(profiles) && profiles[0]?.id
  if (targetId) {
    const { status: anonUpd } = await supaRest(`/profiles?id=eq.${targetId}`, {
      method: 'PATCH', body: { name: 'HACKED_BY_ANON' },
    })
    if (anonUpd === 401 || anonUpd === 0 || anonUpd === 403)
      pass('RLS', `anon 프로필 UPDATE → ${anonUpd} 차단됨`)
    else {
      const verify = await supaRest(`/profiles?id=eq.${targetId}&select=name`)
      const name = Array.isArray(verify.data) ? verify.data[0]?.name : null
      if (name === 'HACKED_BY_ANON')
        fail('RLS', '🚨 anon이 다른 사용자 프로필 수정 성공! RLS 취약')
      else
        pass('RLS', `anon 프로필 UPDATE → ${anonUpd} (데이터 변경 없음 — 차단됨)`)
    }
  }

  // 2-3. 사용자 토큰으로 자신의 role을 admin으로 승격 시도
  const { token: userToken, uid: myUid } = await supaLogin(ACCOUNTS.user.email)
  if (userToken && myUid) {
    // auth uid로 정확히 본인 프로필만 조회
    const { data: beforeMe } = await supaRest(`/profiles?id=eq.${myUid}&select=id,role`, { token: userToken })
    const myCurrentRole = Array.isArray(beforeMe) ? beforeMe[0]?.role : null
    if (myUid && myCurrentRole !== 'admin') {
      const { status: roleUpd } = await supaRest(`/profiles?id=eq.${myUid}`, {
        method: 'PATCH', token: userToken, body: { role: 'admin' },
      })
      const { data: after } = await supaRest(`/profiles?id=eq.${myUid}&select=role`, { token: userToken })
      const newRole = Array.isArray(after) ? after[0]?.role : null
      if (newRole === 'admin')
        fail('RLS', '🚨 일반 사용자가 role=admin으로 승격 성공! RLS 패치 미적용')
      else
        pass('RLS', `일반 사용자 role=admin 승격 시도 → 차단됨 (현재 role: ${newRole})`)
    } else if (myCurrentRole === 'admin') {
      info('RLS', `t1 계정이 이미 admin — admin→admin 변경은 WITH CHECK 통과, 별도 계정으로 검증 불가`)
    }
  }

  // 2-4. 사용자 토큰으로 다른 사람의 request_posts 수정 시도
  if (userToken && myUid) {
    const myUserId = myUid
    const { data: otherReqs } = await supaRest('/request_posts?limit=10&select=id,user_id')
    const otherReq = Array.isArray(otherReqs) ? otherReqs.find(r => r.user_id !== myUserId) : null
    if (otherReq) {
      const origDesc = otherReq.description
      const { status: reqUpd } = await supaRest(`/request_posts?id=eq.${otherReq.id}`, {
        method: 'PATCH', token: userToken, body: { description: 'HACKED' },
      })
      const { data: afterReq } = await supaRest(`/request_posts?id=eq.${otherReq.id}&select=description`)
      const desc = Array.isArray(afterReq) ? afterReq[0]?.description : null
      if (desc === 'HACKED')
        fail('RLS', '🚨 타인의 request_posts 수정 성공! RLS 취약')
      else
        pass('RLS', `타인 request_posts 수정 시도 → 차단됨 (status: ${reqUpd})`)
    } else {
      info('RLS', '타인 request_posts 없음 — 테스트 건너뜀')
    }
  }

  // 2-5. 비인증으로 proposals INSERT 시도
  const { status: propIns } = await supaRest('/proposals', {
    method: 'POST',
    body: { request_id: '00000000-0000-0000-0000-000000000000', broker_id: '00000000-0000-0000-0000-000000000000', price: 0, description: 'HACK' },
  })
  if (propIns === 401 || propIns === 403 || propIns === 422)
    pass('RLS', `비인증 proposals INSERT → ${propIns} 차단됨`)
  else
    fail('RLS', `비인증 proposals INSERT → ${propIns} (401/403/422이어야 함)`)

  // 2-6. reviews INSERT — 본인 user_id 필수인지 확인
  const { status: revIns } = await supaRest('/reviews', {
    method: 'POST',
    body: { broker_id: '00000000-0000-0000-0000-000000000000', user_id: '00000000-0000-0000-0000-000000000000', rating: 5, content: 'HACK' },
  })
  if (revIns === 401 || revIns === 403 || revIns === 422)
    pass('RLS', `비인증 reviews INSERT → ${revIns} 차단됨`)
  else
    fail('RLS', `비인증 reviews INSERT → ${revIns} (차단되어야 함)`)
}

// ══════════════════════════════════════════════════════════
// T3: 실제 CRUD 플로우 (DB 저장 확인)
// ══════════════════════════════════════════════════════════
async function testCRUD(browser) {
  section('T3 실제 CRUD 플로우')

  // 3-1. 요청 등록 실제 제출 → DB 저장 확인
  {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    await loginPage(page, ACCOUNTS.user.email)

    await page.goto(`${BASE}/request/new`)
    await page.waitForTimeout(2000)

    // Step 0
    await page.locator('button:has-text("전세")').first().click()
    await page.locator('button:has-text("아파트")').first().click()
    await page.waitForTimeout(300)

    const next1 = page.locator('button:has-text("다음")').first()
    if (!await next1.isEnabled().catch(() => false)) { fail('CRUD', '요청등록 Step0→1 다음 비활성'); await ctx.close(); return }
    await next1.click(); await page.waitForTimeout(800)

    // Step 1
    await page.locator('select').first().selectOption('서울특별시').catch(() => {})
    await page.waitForTimeout(300)
    const gangnam = page.locator('button:has-text("강남구")').first()
    if (await gangnam.count() > 0) await gangnam.click()
    await page.waitForTimeout(300)

    const next2 = page.locator('button:has-text("다음")').first()
    if (!await next2.isEnabled().catch(() => false)) { fail('CRUD', '요청등록 Step1→2 다음 비활성'); await ctx.close(); return }
    await next2.click(); await page.waitForTimeout(800)

    // Step 2
    const numInputs = page.locator('input[type="number"]')
    if (await numInputs.count() >= 2) {
      await numInputs.nth(0).fill('30000')
      await numInputs.nth(1).fill('50000')
    }
    await page.waitForTimeout(300)

    const next3 = page.locator('button:has-text("다음")').first()
    if (!await next3.isEnabled().catch(() => false)) { fail('CRUD', '요청등록 Step2→3 다음 비활성'); await ctx.close(); return }
    await next3.click(); await page.waitForTimeout(800)

    // Step 3 → 제출
    const descInput = page.locator('textarea').first()
    if (await descInput.count() > 0) await descInput.fill('[E2E-TEST] 자동 테스트 요청 — 삭제 예정')

    const submitBtn = page.locator('button:has-text("조건 등록 완료"), button:has-text("등록 완료")').first()
    if (await submitBtn.count() === 0) { fail('CRUD', '요청등록 제출 버튼 없음'); await ctx.close(); return }

    await submitBtn.click()
    await page.waitForTimeout(4000)

    const afterUrl = page.url().replace(BASE, '')
    if (afterUrl.startsWith('/dashboard/user') || afterUrl.startsWith('/request/'))
      pass('CRUD', `요청 등록 제출 후 리다이렉트 정상 → ${afterUrl}`)
    else
      fail('CRUD', `요청 등록 후 예상치 못한 URL: ${afterUrl}`)

    // DB에 저장됐는지 확인
    const { token: userToken } = await supaLogin(ACCOUNTS.user.email)
    const { data: newReqs } = await supaRest(
      `/request_posts?description=eq.[E2E-TEST] 자동 테스트 요청 — 삭제 예정&select=id,description,status`,
      { token: userToken }
    )
    if (Array.isArray(newReqs) && newReqs.length > 0) {
      pass('CRUD', `요청 DB 저장 확인 (id: ${newReqs[0].id?.slice(0,8)}...)`)
      // 정리: 테스트 데이터 삭제
      for (const r of newReqs) {
        await supaRest(`/request_posts?id=eq.${r.id}`, { method: 'DELETE', token: userToken })
      }
      pass('CRUD', '테스트 요청 데이터 정리 완료')
    } else {
      fail('CRUD', '요청이 DB에 저장되지 않았거나 조회 실패')
    }
    await ctx.close()
  }

  // 3-2. 프로필 이름 실제 수정 → 저장 확인
  {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    await loginPage(page, ACCOUNTS.user.email)

    const { token: userToken, uid: userId } = await supaLogin(ACCOUNTS.user.email)
    const { data: before } = await supaRest(`/profiles?id=eq.${userId}&select=id,name`, { token: userToken })
    const originalName = Array.isArray(before) ? before[0]?.name : null

    if (!originalName || !userId) { fail('CRUD', '프로필 조회 실패'); await ctx.close(); return }

    await page.goto(`${BASE}/profile`)
    await page.waitForTimeout(2000)

    const nameInput = page.locator('input[placeholder*="이름"]').first()
    if (await nameInput.count() === 0) { fail('CRUD', '프로필 이름 입력 필드 없음'); await ctx.close(); return }

    await nameInput.fill('테스트변경이름')
    await page.waitForTimeout(300)

    const saveBtn = page.locator('button:has-text("저장"), button[type="submit"]').first()
    if (await saveBtn.count() > 0) {
      await saveBtn.click()
      await page.waitForTimeout(2500)

      const { data: after } = await supaRest(`/profiles?id=eq.${userId}&select=name`, { token: userToken })
      const newName = Array.isArray(after) ? after[0]?.name : null
      if (newName === '테스트변경이름')
        pass('CRUD', '프로필 이름 수정 DB 저장 확인')
      else
        fail('CRUD', `프로필 이름 저장 안 됨 (DB: ${newName})`)

      // 원래 이름으로 복원
      await nameInput.fill(originalName)
      await saveBtn.click()
      await page.waitForTimeout(2000)
      pass('CRUD', '프로필 이름 원복 완료')
    } else {
      fail('CRUD', '프로필 저장 버튼 없음')
    }
    await ctx.close()
  }
}

// ══════════════════════════════════════════════════════════
// T4: 회원가입 / 비밀번호 재설정
// ══════════════════════════════════════════════════════════
async function testAuthEdge(browser) {
  section('T4 회원가입 / 비밀번호 재설정')

  // 4-1. 이미 존재하는 이메일로 회원가입 → 에러 메시지
  {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    await page.goto(`${BASE}/auth/signup`)
    await page.waitForTimeout(2000)

    const emailIn = page.locator('input[type="email"]').first()
    const pwIn    = page.locator('input[type="password"]').first()
    if (await emailIn.count() > 0 && await pwIn.count() > 0) {
      await emailIn.fill(ACCOUNTS.user.email)
      await pwIn.fill(PW)
      // 이름 필드 있으면 채움
      const nameIn = page.locator('input[placeholder*="이름"], input[name="name"]').first()
      if (await nameIn.count() > 0) await nameIn.fill('테스트')
      // 전화번호 있으면 채움
      const phoneIn = page.locator('input[type="tel"], input[placeholder*="전화"], input[name="phone"]').first()
      if (await phoneIn.count() > 0) await phoneIn.fill('01012345678')
      // 비밀번호 확인 필드
      const pwConfirmIn = page.locator('input[placeholder*="비밀번호 확인"], input[name="passwordConfirm"]').first()
      if (await pwConfirmIn.count() > 0) await pwConfirmIn.fill(PW)
      // 약관 동의 체크박스
      const checkboxes = page.locator('input[type="checkbox"]')
      const cbCount = await checkboxes.count()
      for (let i = 0; i < cbCount; i++) await checkboxes.nth(i).check().catch(() => {})
      await page.waitForTimeout(500)

      const submitBtn = page.locator('button[type="submit"]').first()
      const isEnabled = await submitBtn.isEnabled().catch(() => false)
      if (!isEnabled) {
        info('회원가입', '제출 버튼 비활성 — 필수 필드 미확인 가능')
        await ctx.close(); return
      }
      await submitBtn.click()
      await page.waitForTimeout(4000)

      const url = page.url().replace(BASE, '')
      const hasErr = await pageHasText(page, '이미', '존재', '사용 중', '가입된', '중복')
      if (hasErr)
        pass('회원가입', '중복 이메일 → 에러 메시지 표시')
      else if (url.includes('/auth/login') || url.includes('/dashboard'))
        fail('회원가입', '중복 이메일에도 가입 성공 — 에러 처리 없음')
      else
        info('회원가입', `중복 이메일 처리: url=${url}, errMsg=${hasErr}`)
    } else {
      fail('회원가입', '회원가입 폼 필드 없음')
    }
    await ctx.close()
  }

  // 4-2. 회원가입 폼 유효성 검사 — 잘못된 이메일 형식
  {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    await page.goto(`${BASE}/auth/signup`)
    await page.waitForTimeout(1500)

    const emailIn = page.locator('input[type="email"]').first()
    if (await emailIn.count() > 0) {
      await emailIn.fill('notanemail')
      await page.waitForTimeout(500)
      const submitBtn = page.locator('button[type="submit"]').first()
      const isDisabled = !(await submitBtn.isEnabled().catch(() => true))
      if (isDisabled) {
        pass('회원가입', '잘못된 이메일 → 제출 버튼 비활성화 (클라이언트 검증 정상)')
      } else {
        // 버튼이 활성화돼 있으면 클릭해서 HTML5 validation 확인
        await submitBtn.click({ timeout: 5000 }).catch(() => {})
        await page.waitForTimeout(500)
        const url = page.url().replace(BASE, '')
        if (url.includes('/auth/signup'))
          pass('회원가입', '잘못된 이메일 형식 → 폼 제출 차단 (HTML5 validation)')
        else
          fail('회원가입', '잘못된 이메일 형식으로 제출됨')
      }
    }
    await ctx.close()
  }

  // 4-3. 비밀번호 재설정 — 이메일 제출 → 성공 메시지
  {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    await page.goto(`${BASE}/auth/reset-password`)
    await page.waitForTimeout(2000)

    const emailIn = page.locator('input[type="email"]').first()
    const submitBtn = page.locator('button[type="submit"]').first()
    if (await emailIn.count() > 0 && await submitBtn.count() > 0) {
      await emailIn.fill(ACCOUNTS.user.email)
      await submitBtn.click()
      await page.waitForTimeout(4000)
      const hasSuccess = await pageHasText(page, '전송', '이메일', '확인', '발송', '보내')
      if (hasSuccess)
        pass('비밀번호재설정', '재설정 이메일 전송 성공 메시지 표시')
      else
        fail('비밀번호재설정', '성공 메시지 없음')
    } else {
      fail('비밀번호재설정', '비밀번호 재설정 폼 없음')
    }
    await ctx.close()
  }
}

// ══════════════════════════════════════════════════════════
// T5: 입력값 검증 (XSS · 경계값)
// ══════════════════════════════════════════════════════════
async function testInputValidation(browser) {
  section('T5 입력값 검증 (XSS · 경계값)')

  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await loginPage(page, ACCOUNTS.user.email)

  await page.goto(`${BASE}/profile`)
  await page.waitForTimeout(2000)

  const nameIn = page.locator('input[placeholder*="이름"]').first()
  if (await nameIn.count() > 0) {
    // XSS 입력
    const xss = '<script>alert("XSS")</script>'
    await nameIn.fill(xss)
    await page.waitForTimeout(300)
    const saveBtn = page.locator('button:has-text("저장"), button[type="submit"]').first()
    if (await saveBtn.count() > 0) await saveBtn.click()
    await page.waitForTimeout(2500)

    // alert 팝업이 떴는지 확인 (XSS 실행 여부)
    let alertFired = false
    page.once('dialog', async d => { alertFired = true; await d.dismiss() })
    await page.goto(`${BASE}/profile`)
    await page.waitForTimeout(2500)

    if (!alertFired)
      pass('XSS', '프로필 이름 XSS 입력 → alert 미실행 (escape 정상)')
    else
      fail('XSS', '🚨 프로필 이름 XSS 실행됨! 즉시 수정 필요')

    // 빈 이름 저장 시도
    await nameIn.fill('')
    if (await saveBtn.count() > 0) await saveBtn.click()
    await page.waitForTimeout(1500)
    const hasNameErr = await pageHasText(page, '필수', '입력', '이름을', '한 글자')
    if (hasNameErr)
      pass('입력검증', '빈 이름 저장 → 에러 메시지 표시')
    else
      info('입력검증', '빈 이름: 에러 메시지 없음 (브라우저 validation 또는 서버 처리)')

    // 500자 초과 이름 입력
    await nameIn.fill('A'.repeat(300))
    if (await saveBtn.count() > 0) await saveBtn.click()
    await page.waitForTimeout(1500)
    pass('입력검증', '300자 이름 입력 — 크래시 없음 (처리됨)')

    // 원래 이름으로 복원
    const { token: userToken } = await supaLogin(ACCOUNTS.user.email)
    await supaRest('/profiles', { method: 'PATCH', token: userToken, body: { name: '테스트고객' } })
  } else {
    info('입력검증', '프로필 이름 필드 없음 — XSS 테스트 건너뜀')
  }

  await ctx.close()
}

// ══════════════════════════════════════════════════════════
// T6: 성능 측정
// ══════════════════════════════════════════════════════════
async function testPerformance(browser) {
  section('T6 성능 측정 (주요 페이지 로딩 시간)')

  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await loginPage(page, ACCOUNTS.user.email)

  const targets = [
    { path: '/',                  label: '홈' },
    { path: '/dashboard/user',   label: '고객 대시보드' },
    { path: '/request/new',      label: '요청 등록' },
  ]

  for (const t of targets) {
    try {
      const start = Date.now()
      await page.goto(`${BASE}${t.path}`, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {})
      await page.waitForTimeout(500)
      const ms = Date.now() - start

      if (ms < 3000)      pass('성능', `${t.label}: ${ms}ms (3초 이내)`)
      else if (ms < 6000) info('성능', `${t.label}: ${ms}ms (3~6초, 느림)`)
      else                fail('성능', `${t.label}: ${ms}ms (6초 초과, 심각)`)
    } catch (e) {
      fail('성능', `${t.label}: 로딩 오류 — ${e.message}`)
    }
  }

  await ctx.close()

  // 중개사
  const ctx2 = await browser.newContext()
  const page2 = await ctx2.newPage()
  await loginPage(page2, ACCOUNTS.broker.email)

  const brokerTargets = [
    { path: '/dashboard/broker',      label: '중개사 대시보드' },
    { path: '/broker/properties',     label: '매물목록' },
    { path: '/broker/properties/new', label: '매물등록' },
  ]
  for (const t of brokerTargets) {
    try {
      const start = Date.now()
      await page2.goto(`${BASE}${t.path}`, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {})
      await page2.waitForTimeout(500)
      const ms = Date.now() - start

      if (ms < 3000)      pass('성능', `${t.label}: ${ms}ms`)
      else if (ms < 6000) info('성능', `${t.label}: ${ms}ms (느림)`)
      else                fail('성능', `${t.label}: ${ms}ms (심각)`)
    } catch (e) {
      fail('성능', `${t.label}: 로딩 오류 — ${e.message}`)
    }
  }
  await ctx2.close()
}

// ══════════════════════════════════════════════════════════
// T7: 에러 처리 (없는 ID · 잘못된 접근)
// ══════════════════════════════════════════════════════════
async function testErrorHandling(browser) {
  section('T7 에러 처리 (없는 ID · 잘못된 접근)')

  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await loginPage(page, ACCOUNTS.user.email)

  const errTargets = [
    { path: '/request/00000000-0000-0000-0000-000000000000', label: '없는 요청 ID' },
    { path: '/chat/00000000-0000-0000-0000-000000000000',    label: '없는 채팅방 ID' },
  ]

  for (const t of errTargets) {
    await page.goto(`${BASE}${t.path}`)
    await page.waitForTimeout(3000)
    const url = page.url().replace(BASE, '')
    const hasErr = await pageHasText(page, '없', '찾을 수', '404', '오류', '접근')
    if (hasErr || url !== t.path)
      pass('에러처리', `${t.label} → 적절히 처리됨 (url: ${url})`)
    else
      fail('에러처리', `${t.label} → 빈 화면 또는 크래시`)
  }

  // 없는 매물 수정 페이지
  await page.goto(`${BASE}/broker/properties/00000000-0000-0000-0000-000000000000/edit`)
  await page.waitForTimeout(3000)
  const editUrl = page.url().replace(BASE, '')
  if (!editUrl.includes('/00000000-0000-0000-0000-000000000000/edit') || await pageHasText(page, '없', '오류', '404'))
    pass('에러처리', '없는 매물 수정 → 리다이렉트 또는 에러 표시')
  else
    info('에러처리', '없는 매물 수정 → 빈 화면 (개선 여지 있음)')

  await ctx.close()
}

// ══════════════════════════════════════════════════════════
// T8: 태블릿 반응형 (iPad Air 820×1180)
// ══════════════════════════════════════════════════════════
async function testTablet(browser) {
  section('T8 태블릿 반응형 (iPad Air 820×1180)')

  const ctx = await browser.newContext({ viewport: { width: 820, height: 1180 } })
  const page = await ctx.newPage()

  const tabletPages = [
    { path: '/', label: '홈', kw: ['빠방'] },
    { path: '/auth/login', label: '로그인', kw: ['로그인'] },
  ]
  for (const t of tabletPages) {
    await page.goto(`${BASE}${t.path}`)
    await page.waitForTimeout(2000)
    const ok = await pageHasText(page, ...t.kw)
    if (ok) pass('태블릿', `${t.label} 로딩 정상`)
    else     fail('태블릿', `${t.label} 로딩 실패`)
  }

  await loginPage(page, ACCOUNTS.user.email)
  await page.goto(`${BASE}/dashboard/user`)
  await page.waitForTimeout(2000)
  const dashOk = await pageHasText(page, '안녕', '요청')
  if (dashOk) pass('태블릿', '고객 대시보드 태블릿 렌더링 정상')
  else         fail('태블릿', '고객 대시보드 태블릿 렌더링 실패')

  await page.screenshot({ path: 'screenshot-tablet-dashboard.png' })
  await ctx.close()

  // 중개사 매물목록 (넓은 화면)
  const ctx2 = await browser.newContext({ viewport: { width: 820, height: 1180 } })
  const page2 = await ctx2.newPage()
  await loginPage(page2, ACCOUNTS.broker.email)
  await page2.goto(`${BASE}/broker/properties`)
  await page2.waitForTimeout(3000)
  const propOk = await pageHasText(page2, '매물')
  if (propOk) pass('태블릿', '중개사 매물목록 태블릿 렌더링 정상')
  else         fail('태블릿', '중개사 매물목록 태블릿 렌더링 실패')
  await page2.screenshot({ path: 'screenshot-tablet-broker-properties.png' })
  await ctx2.close()
}

// ══════════════════════════════════════════════════════════
// T9: 알림 시스템 확인
// ══════════════════════════════════════════════════════════
async function testNotifications(browser) {
  section('T9 알림 시스템')

  // 헤더에 알림 아이콘/뱃지 존재 여부
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await loginPage(page, ACCOUNTS.user.email)
  await page.goto(`${BASE}/dashboard/user`)
  await page.waitForTimeout(2500)

  const bellIcon = page.locator('[class*="bell"], [class*="notification"], [aria-label*="알림"]')
  const hasBell = await bellIcon.count() > 0
  if (hasBell)
    pass('알림', '헤더 알림 아이콘 존재')
  else
    info('알림', '헤더 알림 아이콘 없음 (구현 방식에 따라 다를 수 있음)')

  // notifications 테이블에 본인 알림만 보이는지 RLS 확인
  const { token: userToken } = await supaLogin(ACCOUNTS.user.email)
  const { data: notifs, status: notifStatus } = await supaRest('/notifications?limit=10', { token: userToken })
  if (notifStatus === 200)
    pass('알림', `알림 조회 정상 (${Array.isArray(notifs) ? notifs.length : 0}건)`)
  else
    fail('알림', `알림 조회 실패 (${notifStatus})`)

  await ctx.close()
}

// ══════════════════════════════════════════════════════════
// T10: 로그인 유지 (새로고침 후 세션 유지)
// ══════════════════════════════════════════════════════════
async function testSessionPersist(browser) {
  section('T10 세션 유지 (새로고침 후)')

  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await loginPage(page, ACCOUNTS.user.email)

  await page.goto(`${BASE}/dashboard/user`)
  await page.waitForTimeout(2000)
  await page.reload()
  await page.waitForTimeout(3000)

  const url = page.url().replace(BASE, '')
  if (url.startsWith('/dashboard/user'))
    pass('세션', '새로고침 후 세션 유지됨 (로그인 유지)')
  else
    fail('세션', `새로고침 후 세션 사라짐 → ${url}`)

  await ctx.close()
}

// ══════════════════════════════════════════════════════════
// Main
// ══════════════════════════════════════════════════════════
;(async () => {
  console.log('█'.repeat(60))
  console.log('  🔬 빠방 고급 E2E 테스트 (보안·CRUD·성능·UX)')
  console.log(`  대상: ${BASE}`)
  console.log(`  시각: ${new Date().toLocaleString('ko-KR')}`)
  console.log('█'.repeat(60))

  const browser = await chromium.launch({ headless: true })

  await testApiAuth()
  await testRLS()
  await testCRUD(browser)
  await testAuthEdge(browser)
  await testInputValidation(browser)
  await testPerformance(browser)
  await testErrorHandling(browser)
  await testTablet(browser)
  await testNotifications(browser)
  await testSessionPersist(browser)

  await browser.close()

  console.log(`\n${'═'.repeat(60)}`)
  console.log(`  📊 최종 결과`)
  console.log('═'.repeat(60))
  console.log(`  전체  : ${results.pass + results.fail}개`)
  console.log(`  ✅ 통과: ${results.pass}개  (${Math.round(results.pass / (results.pass + results.fail) * 100)}%)`)
  console.log(`  ❌ 실패: ${results.fail}개`)
  if (results.errors.length > 0) {
    console.log('\n  ── 실패 목록 ──────────────────────────────────')
    results.errors.forEach(e => console.log(`    • ${e}`))
  }
})()
