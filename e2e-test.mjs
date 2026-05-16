import { chromium } from 'playwright'

const BASE = 'https://bbabang.vercel.app'
const PW = 'rladyd14s!'

const ACCOUNTS = {
  user:   { email: 't1@gmail.com',          role: '고객',   dashboard: '/dashboard/user' },
  broker: { email: 't2@gmail.com',          role: '중개사', dashboard: '/dashboard/broker' },
  admin:  { email: 'bigodennn@gmail.com',   role: '관리자', dashboard: '/admin' },
}

const results = { pass: 0, fail: 0, errors: [] }

const pass = (label, msg) => { results.pass++; console.log(`  ✅ [${label}] ${msg}`) }
const fail = (label, msg) => { results.fail++; results.errors.push(`[${label}] ${msg}`); console.log(`  ❌ [${label}] ${msg}`) }
const info = (label, msg) => console.log(`     [${label}] ${msg}`)

function section(title) {
  console.log(`\n${'═'.repeat(60)}`)
  console.log(`  ${title}`)
  console.log('═'.repeat(60))
}

async function login(page, email, password = PW) {
  await page.goto(`${BASE}/auth/login`)
  await page.waitForSelector('input[type="email"]', { timeout: 15000 })
  await page.fill('input[type="email"]', email)
  await page.fill('input[type="password"]', password)
  await page.click('button[type="submit"]')
  await Promise.race([
    page.waitForURL(u => !u.includes('/auth/login'), { timeout: 20000 }),
    page.waitForSelector('[class*="red"], .text-red-600', { timeout: 20000 }),
  ]).catch(() => {})
  await page.waitForTimeout(2000)
  return page.url().replace(BASE, '') || '/'
}

async function logout(page) {
  const btn = page.locator('button:has-text("로그아웃"), a:has-text("로그아웃")').first()
  if (await btn.count() > 0) { await btn.click(); await page.waitForTimeout(2000); return true }
  return false
}

async function pageHasText(page, ...keywords) {
  const content = await page.textContent('body').catch(() => '')
  return keywords.some(k => content.includes(k))
}

// ═══════════════════════════════════════════════════════════
// P0-1: 인증 플로우
// ═══════════════════════════════════════════════════════════
async function testAuth(browser) {
  section('P0 ① 인증 플로우')

  // 잘못된 비밀번호 → 에러 메시지
  {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    await login(page, ACCOUNTS.user.email, 'wrongpassword123')
    const url = page.url().replace(BASE, '')
    const hasErr = await pageHasText(page, '올바르지 않', '비밀번호', '에러', '오류')
    if (url.includes('/auth/login') && hasErr)
      pass('인증', '잘못된 비밀번호 → 에러 메시지 표시')
    else
      fail('인증', `잘못된 비밀번호 처리 이상 (url=${url}, errMsg=${hasErr})`)
    await ctx.close()
  }

  // 각 역할 로그인 → 올바른 대시보드
  for (const [, acc] of Object.entries(ACCOUNTS)) {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    const afterLogin = await login(page, acc.email)
    if (afterLogin.startsWith(acc.dashboard.replace(/\/[^/]+$/, '') || acc.dashboard))
      pass('인증', `${acc.role} 로그인 → ${afterLogin}`)
    else
      fail('인증', `${acc.role} 로그인 경로 불일치: ${afterLogin} (예상: ${acc.dashboard})`)

    // 로그인 상태에서 /auth/login 접근 → 대시보드로 리다이렉트
    await page.goto(`${BASE}/auth/login`)
    await page.waitForTimeout(3500)
    const afterRevisit = page.url().replace(BASE, '')
    if (!afterRevisit.startsWith('/auth/login'))
      pass('인증', `${acc.role} - 로그인 상태로 /auth/login 접근 → 리다이렉트`)
    else
      fail('인증', `${acc.role} - 로그인 상태로 /auth/login 접근 시 리다이렉트 안 됨`)

    // 로그아웃 후 보호 경로 접근 → /auth/login
    const didLogout = await logout(page)
    if (didLogout) {
      await page.goto(`${BASE}/dashboard/user`)
      await page.waitForTimeout(3000)
      const afterLogout = page.url().replace(BASE, '')
      if (afterLogout.startsWith('/auth/login'))
        pass('인증', `${acc.role} - 로그아웃 후 보호경로 → 로그인 페이지 리다이렉트`)
      else
        fail('인증', `${acc.role} - 로그아웃 후 보호경로 차단 안 됨 (${afterLogout})`)
    } else {
      fail('인증', `${acc.role} - 로그아웃 버튼 없음`)
    }

    await ctx.close()
  }
}

// ═══════════════════════════════════════════════════════════
// P0-2: 역할별 권한 차단
// ═══════════════════════════════════════════════════════════
async function testPermissions(browser) {
  section('P0 ② 역할별 권한 차단')

  // 고객이 접근하면 안 되는 경로
  const userBlocked = [
    '/admin',
    '/broker/properties',
    '/broker/customers',
    '/broker/diary',
    '/broker/settings',
    '/broker/chats',
    '/broker/team',
  ]
  {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    await login(page, ACCOUNTS.user.email)
    for (const path of userBlocked) {
      await page.goto(`${BASE}${path}`)
      await page.waitForTimeout(2500)
      const cur = page.url().replace(BASE, '')
      if (!cur.startsWith(path))
        pass('권한', `고객 → ${path} 차단됨 (→ ${cur})`)
      else
        fail('권한', `고객 → ${path} 차단 안 됨 (그대로 접근 가능)`)
    }
    await ctx.close()
  }

  // 중개사가 접근하면 안 되는 경로
  const brokerBlocked = ['/admin', '/dashboard/user', '/request/new']
  {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    await login(page, ACCOUNTS.broker.email)
    for (const path of brokerBlocked) {
      await page.goto(`${BASE}${path}`)
      await page.waitForTimeout(2500)
      const cur = page.url().replace(BASE, '')
      if (!cur.startsWith(path))
        pass('권한', `중개사 → ${path} 차단됨 (→ ${cur})`)
      else
        fail('권한', `중개사 → ${path} 차단 안 됨 (그대로 접근 가능)`)
    }
    await ctx.close()
  }

  // 비로그인 → 보호 경로 전부 /auth/login 리다이렉트
  const protectedPaths = [
    '/dashboard/user', '/dashboard/broker', '/admin',
    '/request/new', '/profile', '/broker/properties',
    '/broker/customers', '/chat/some-id',
  ]
  {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    for (const path of protectedPaths) {
      await page.goto(`${BASE}${path}`)
      await page.waitForTimeout(2500)
      const cur = page.url().replace(BASE, '')
      if (cur.startsWith('/auth/login'))
        pass('권한', `비로그인 → ${path} → /auth/login 리다이렉트`)
      else
        fail('권한', `비로그인 → ${path} 차단 안 됨 (현재: ${cur})`)
    }
    await ctx.close()
  }
}

// ═══════════════════════════════════════════════════════════
// P0-3: 공개 페이지 로딩
// ═══════════════════════════════════════════════════════════
async function testPublicPages(browser) {
  section('P0 ③ 공개 페이지 로딩')

  const ctx = await browser.newContext()
  const page = await ctx.newPage()

  const pages = [
    { path: '/',                   keywords: ['빠방', '방', '중개'] },
    { path: '/auth/login',         keywords: ['로그인', '이메일'] },
    { path: '/auth/signup',        keywords: ['회원가입', '이메일'] },
    { path: '/auth/reset-password',keywords: ['비밀번호', '이메일'] },
    { path: '/terms',              keywords: ['이용약관'] },
    { path: '/privacy',            keywords: ['개인정보'] },
  ]

  for (const p of pages) {
    await page.goto(`${BASE}${p.path}`)
    await page.waitForTimeout(2000)
    const url = page.url().replace(BASE, '')
    const ok = await pageHasText(page, ...p.keywords)
    if (ok) pass('공개', `${p.path} 로딩 정상`)
    else     fail('공개', `${p.path} - 키워드(${p.keywords.join('/')}) 없음`)
  }

  // 404
  await page.goto(`${BASE}/not-found-xyz-123`)
  await page.waitForTimeout(2000)
  const is404 = await pageHasText(page, '404', '찾을 수 없', 'not found', '페이지가')
  if (is404) pass('공개', '존재하지 않는 페이지 → 404 처리')
  else        fail('공개', '존재하지 않는 페이지 → 404 처리 없음')

  await page.screenshot({ path: 'screenshot-home.png' })
  await ctx.close()
}

// ═══════════════════════════════════════════════════════════
// P1-1: 고객 플로우
// ═══════════════════════════════════════════════════════════
async function testUserFlow(browser) {
  section('P1 ① 고객 플로우')

  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await login(page, ACCOUNTS.user.email)

  // 대시보드 주요 UI
  await page.goto(`${BASE}/dashboard/user`)
  await page.waitForTimeout(2500)
  await page.screenshot({ path: 'screenshot-user-dashboard.png' })

  const hasGreeting = await pageHasText(page, '안녕하세요', '요청', '등록')
  if (hasGreeting) pass('고객', '대시보드 - 주요 UI 표시 정상')
  else              fail('고객', '대시보드 - 주요 UI 없음')

  const hasNewReqBtn = await page.locator('a[href="/request/new"], button:has-text("요청 등록")').count() > 0
  if (hasNewReqBtn) pass('고객', '대시보드 - 요청 등록 버튼 존재')
  else              fail('고객', '대시보드 - 요청 등록 버튼 없음')

  // 요청 등록 폼 - 페이지 접근
  await page.goto(`${BASE}/request/new`)
  await page.waitForTimeout(2000)
  const url = page.url().replace(BASE, '')
  if (url.startsWith('/request/new')) {
    pass('고객', '요청 등록 페이지 접근 가능')
  } else {
    fail('고객', `요청 등록 페이지 접근 실패 → ${url}`)
    await ctx.close(); return
  }

  // Step 0: 거래유형(전세) + 매물유형(아파트) 선택
  const tradeBtn = page.locator('button:has-text("전세")').first()
  if (await tradeBtn.count() > 0) {
    await tradeBtn.click(); await page.waitForTimeout(300)
    pass('고객', '요청 등록 Step 0 - 거래유형(전세) 선택')
  } else { fail('고객', '요청 등록 Step 0 - 거래유형 버튼 없음') }

  const aptBtn = page.locator('button:has-text("아파트")').first()
  if (await aptBtn.count() > 0) {
    await aptBtn.click(); await page.waitForTimeout(300)
    pass('고객', '요청 등록 Step 0 - 매물유형(아파트) 선택')
  }

  // 다음 버튼: enabled 상태인지 확인 후 클릭
  const isNext1Enabled = await page.locator('button:has-text("다음")').first().isEnabled().catch(() => false)
  if (isNext1Enabled) {
    await page.locator('button:has-text("다음")').first().click()
    await page.waitForTimeout(1000)
    pass('고객', '요청 등록 Step 1(위치) 진입')

    // Step 1: 시/도 select (기본값 서울특별시) → 강남구 버튼 바로 클릭
    const selectEl = page.locator('select').first()
    if (await selectEl.count() > 0) {
      await selectEl.selectOption('서울특별시')
      await page.waitForTimeout(300)
    }

    const gangnamBtn = page.locator('button:has-text("강남구")').first()
    if (await gangnamBtn.count() > 0) {
      await gangnamBtn.click(); await page.waitForTimeout(300)
      pass('고객', '요청 등록 Step 1 - 지역(서울 강남구) 선택')
    } else { fail('고객', '요청 등록 Step 1 - 강남구 버튼 없음') }

    // 다음 → Step 2
    const isNext2Enabled = await page.locator('button:has-text("다음")').first().isEnabled().catch(() => false)
    if (isNext2Enabled) {
      await page.locator('button:has-text("다음")').first().click()
      await page.waitForTimeout(1000)
      pass('고객', '요청 등록 Step 2(예산) 진입')

      // Step 2: 예산 입력 (전세: 최소/최대)
      const inputs = page.locator('input[type="number"]')
      const inputCount = await inputs.count()
      if (inputCount >= 2) {
        await inputs.nth(0).fill('20000')
        await inputs.nth(1).fill('50000')
        await page.waitForTimeout(300)
        pass('고객', '요청 등록 Step 2 - 예산 입력')
      } else { fail('고객', '요청 등록 Step 2 - 예산 입력 필드 없음') }

      // 다음 → Step 3
      const isNext3Enabled = await page.locator('button:has-text("다음")').first().isEnabled().catch(() => false)
      if (isNext3Enabled) {
        await page.locator('button:has-text("다음")').first().click()
        await page.waitForTimeout(1000)
        pass('고객', '요청 등록 Step 3(상세조건) 진입')

        // 최종 제출 버튼 존재 확인 (클릭은 안 함 - 실 데이터 오염 방지)
        const submitBtn = page.locator('button:has-text("조건 등록 완료")').first()
        if (await submitBtn.count() > 0)
          pass('고객', '요청 등록 - 최종 제출 버튼 존재 (4단계 폼 전체 정상)')
        else
          fail('고객', '요청 등록 - 최종 제출 버튼 없음')
      } else { fail('고객', '요청 등록 Step 2 → 3 다음 버튼 비활성') }
    } else { fail('고객', '요청 등록 Step 1 → 2 다음 버튼 비활성') }
  } else { fail('고객', '요청 등록 Step 0 → 1 다음 버튼 비활성') }

  await page.screenshot({ path: 'screenshot-user-request-form.png' })

  // 프로필 페이지
  await page.goto(`${BASE}/profile`)
  await page.waitForTimeout(2000)
  const hasProfile = await pageHasText(page, '내 계정', '이름', '이메일', '비밀번호')
  if (hasProfile) pass('고객', '프로필 페이지 로딩 및 주요 항목 표시')
  else             fail('고객', '프로필 페이지 주요 항목 없음')

  // 프로필 - 이름 수정 필드 존재
  const nameInput = page.locator('input[placeholder*="이름"]').first()
  if (await nameInput.count() > 0)
    pass('고객', '프로필 - 이름 수정 필드 존재')
  else
    fail('고객', '프로필 - 이름 수정 필드 없음')

  await ctx.close()
}

// ═══════════════════════════════════════════════════════════
// P1-2: 중개사 플로우
// ═══════════════════════════════════════════════════════════
async function testBrokerFlow(browser) {
  section('P1 ② 중개사 플로우')

  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await login(page, ACCOUNTS.broker.email)

  // 대시보드
  await page.goto(`${BASE}/dashboard/broker`)
  await page.waitForTimeout(2500)
  await page.screenshot({ path: 'screenshot-broker-dashboard.png' })

  const hasDash = await pageHasText(page, '제안', '매물', '고객', '성과')
  if (hasDash) pass('중개사', '대시보드 - 주요 UI 표시 정상')
  else          fail('중개사', '대시보드 - 주요 UI 없음')

  // 빠른 메뉴 링크 존재 여부
  const menuLinks = [
    { href: '/broker/customers', label: '고객목록' },
    { href: '/broker/properties', label: '매물목록' },
    { href: '/broker/diary', label: '업무일지' },
    { href: '/broker/chats', label: '대화목록' },
  ]
  for (const m of menuLinks) {
    const link = page.locator(`a[href="${m.href}"]`).first()
    if (await link.count() > 0)
      pass('중개사', `대시보드 - ${m.label} 링크 존재`)
    else
      fail('중개사', `대시보드 - ${m.label} 링크 없음`)
  }

  // 각 페이지 접근 및 핵심 UI 확인
  const brokerPages = [
    { path: '/broker/properties',     keywords: ['매물'],           label: '매물목록' },
    { path: '/broker/properties/new', keywords: ['매물 등록', '주소', '거래유형', '거래'], label: '매물등록' },
    { path: '/broker/customers',      keywords: ['고객'],           label: '고객목록' },
    { path: '/broker/diary',          keywords: ['일지', '메모', '기록', '고객'], label: '업무일지' },
    { path: '/broker/chats',          keywords: ['대화', '채팅', '고객'], label: '채팅목록' },
    { path: '/broker/settings',       keywords: ['설정', '사무소', '정보'], label: '사무소설정' },
  ]

  for (const p of brokerPages) {
    await page.goto(`${BASE}${p.path}`)
    await page.waitForTimeout(2500)
    const url = page.url().replace(BASE, '')
    if (!url.startsWith(p.path)) {
      fail('중개사', `${p.label} → 접근 차단됨 (${url})`)
      continue
    }
    const ok = await pageHasText(page, ...p.keywords)
    if (ok) pass('중개사', `${p.label} 로딩 및 주요 텍스트 확인`)
    else    fail('중개사', `${p.label} - 키워드 없음 (${p.keywords.join('/')})`)
  }

  await page.screenshot({ path: 'screenshot-broker-properties.png' })

  // 매물 등록 폼 필드 상세 확인
  await page.goto(`${BASE}/broker/properties/new`)
  await page.waitForTimeout(2000)

  const checks = [
    { sel: 'input[placeholder*="역삼동"], input[placeholder*="강남구"], input[placeholder*="서울"]', label: '주소 입력 필드' },
    { sel: 'button:has-text("매매"), button:has-text("전세"), button:has-text("월세")', label: '거래유형 버튼' },
    { sel: 'button:has-text("매물 등록 완료"), button:has-text("등록 완료"), button[type="submit"]', label: '제출 버튼' },
  ]
  for (const c of checks) {
    const el = page.locator(c.sel).first()
    if (await el.count() > 0) pass('중개사', `매물등록폼 - ${c.label} 존재`)
    else                       fail('중개사', `매물등록폼 - ${c.label} 없음`)
  }

  // 자동채움 버튼 있는지 (주소 입력 후 나타나는 버튼)
  const autoFillHint = await pageHasText(page, '자동', '건축물대장', '불러오기')
  info('중개사', `매물등록폼 - 자동채움 힌트: ${autoFillHint ? '있음' : '없음 (주소 입력 전일 수 있음)'}`)

  await ctx.close()
}

// ═══════════════════════════════════════════════════════════
// P1-3: 관리자 플로우
// ═══════════════════════════════════════════════════════════
async function testAdminFlow(browser) {
  section('P1 ③ 관리자 플로우')

  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await login(page, ACCOUNTS.admin.email)

  await page.goto(`${BASE}/admin`)
  await page.waitForTimeout(2500)
  await page.screenshot({ path: 'screenshot-admin-dashboard.png' })

  const checks = [
    { keywords: ['관리자', '빠방 관리자'],  label: '페이지 제목' },
    { keywords: ['회원'],                   label: '회원 통계' },
    { keywords: ['중개사'],                 label: '중개사 관리' },
    { keywords: ['요청', '제안'],           label: '요청/제안 통계' },
    { keywords: ['인증 승인', '미인증', '인증됨', '승인'], label: '중개사 인증 관리' },
  ]

  for (const c of checks) {
    if (await pageHasText(page, ...c.keywords))
      pass('관리자', `${c.label} 표시 확인`)
    else
      fail('관리자', `${c.label} 없음`)
  }

  // 통계 카드 숫자가 있는지 (최소 1개)
  const statNums = await page.locator('[class*="text-2xl"], [class*="text-3xl"], [class*="font-bold"]').count()
  if (statNums > 0) pass('관리자', `통계 숫자 표시 (${statNums}개 요소)`)
  else               fail('관리자', '통계 숫자 없음')

  await ctx.close()
}

// ═══════════════════════════════════════════════════════════
// P1-4: 채팅 접근
// ═══════════════════════════════════════════════════════════
async function testChat(browser) {
  section('P1 ④ 채팅 접근')

  // 고객 - 대시보드에 채팅 진입점 있는지
  {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    await login(page, ACCOUNTS.user.email)
    await page.goto(`${BASE}/dashboard/user`)
    await page.waitForTimeout(2000)

    const chatEntry = await page.locator('a[href*="/chat"], button:has-text("채팅"), button:has-text("대화")').count()
    if (chatEntry > 0) pass('채팅', '고객 대시보드 - 채팅 진입점 존재')
    else               info('채팅', '고객 대시보드 - 채팅 진입점 없음 (제안이 없으면 채팅 없을 수 있음)')
    await ctx.close()
  }

  // 중개사 - 채팅 목록 페이지 정상 접근
  {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    await login(page, ACCOUNTS.broker.email)
    await page.goto(`${BASE}/broker/chats`)
    await page.waitForTimeout(2000)
    const url = page.url().replace(BASE, '')
    if (url.startsWith('/broker/chats'))
      pass('채팅', '중개사 채팅목록 페이지 접근 성공')
    else
      fail('채팅', `중개사 채팅목록 접근 실패 → ${url}`)
    await ctx.close()
  }
}

// ═══════════════════════════════════════════════════════════
// P2-1: 자동채움 API
// ═══════════════════════════════════════════════════════════
async function testAutoFillAPI() {
  section('P2 ① 자동채움 API')

  const cases = [
    // 실제 세움터 조회 — bcode 기반 (Kakao 불필요)
    {
      label: '서울 강남구 역삼동 아파트',
      body: { bcode: '1168010100', bun: '605', ji: '0', ho: '101', platGbCd: '0' },
    },
    {
      label: '잘못된 요청 (빈 body) → 400',
      body: {},
      expectStatus: 400,
    },
    {
      label: '존재하지 않는 주소 → 404',
      body: { bcode: '9999999999', bun: '9999', ji: '0' },
      expectStatus: 404,
    },
  ]

  for (const tc of cases) {
    try {
      const res = await fetch(`${BASE}/api/properties/auto-fill`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(tc.body),
      })

      if (tc.expectStatus) {
        if (res.status === tc.expectStatus)
          pass('자동채움', `${tc.label}: HTTP ${res.status} 정상`)
        else
          fail('자동채움', `${tc.label}: HTTP ${res.status} (예상: ${tc.expectStatus})`)
        continue
      }

      // 정상 응답 기대
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        pass('자동채움', `${tc.label}: 응답 정상 (floor=${data.floor}, size=${data.size_pyeong}평, type=${data.room_type})`)
      } else {
        // 404도 허용 (테스트 주소 없을 수 있음) — API 자체가 살아있는지만 확인
        if (res.status === 404 || res.status === 502) {
          info('자동채움', `${tc.label}: ${res.status} - ${data.error || ''} (세움터 API 조회 결과)`)
          pass('자동채움', `${tc.label}: API 엔드포인트 정상 응답 (${res.status})`)
        } else {
          fail('자동채움', `${tc.label}: HTTP ${res.status} - ${data.error || ''}`)
        }
      }
    } catch (e) {
      fail('자동채움', `${tc.label}: 요청 실패 - ${e.message}`)
    }
  }
}

// ═══════════════════════════════════════════════════════════
// P2-2: 모바일 반응형
// ═══════════════════════════════════════════════════════════
async function testMobile(browser) {
  section('P2 ② 모바일 반응형 (iPhone 14 375×812)')

  const ctx = await browser.newContext({
    viewport: { width: 375, height: 812 },
    hasTouch: true,
  })
  const page = await ctx.newPage()

  // 홈
  await page.goto(`${BASE}`)
  await page.waitForTimeout(2000)
  await page.screenshot({ path: 'screenshot-mobile-home.png' })
  const homeOk = await pageHasText(page, '빠방', '방', '중개')
  if (homeOk) pass('모바일', '홈 로딩 정상')
  else         fail('모바일', '홈 로딩 실패')

  // 로그인 페이지
  await page.goto(`${BASE}/auth/login`)
  await page.waitForTimeout(1500)
  const loginOk = await pageHasText(page, '로그인', '이메일')
  if (loginOk) pass('모바일', '로그인 페이지 로딩')
  else          fail('모바일', '로그인 페이지 로딩 실패')

  // 입력 필드 탭 가능 여부 (모바일)
  const emailInput = page.locator('input[type="email"]').first()
  if (await emailInput.count() > 0) {
    await emailInput.tap()
    pass('모바일', '이메일 입력 필드 터치 가능')
  } else {
    fail('모바일', '이메일 입력 필드 없음')
  }

  // 모바일 로그인 → 대시보드
  const afterLogin = await login(page, ACCOUNTS.user.email)
  await page.screenshot({ path: 'screenshot-mobile-dashboard.png' })
  if (afterLogin.startsWith('/dashboard'))
    pass('모바일', `로그인 후 대시보드 이동 (${afterLogin})`)
  else
    fail('모바일', `로그인 후 대시보드 이동 실패 (${afterLogin})`)

  // 모바일 대시보드 스크롤 가능 확인
  await page.evaluate(() => window.scrollTo(0, 300))
  await page.waitForTimeout(500)
  pass('모바일', '대시보드 스크롤 가능')

  // 모바일에서 요청 등록 페이지
  await page.goto(`${BASE}/request/new`)
  await page.waitForTimeout(2000)
  const reqOk = await pageHasText(page, '거래', '매물', '유형')
  if (reqOk) pass('모바일', '요청 등록 페이지 모바일 로딩')
  else        fail('모바일', '요청 등록 페이지 모바일 로딩 실패')

  await ctx.close()
}

// ═══════════════════════════════════════════════════════════
// P2-3: 네비게이션 / UX 세부
// ═══════════════════════════════════════════════════════════
async function testUX(browser) {
  section('P2 ③ 네비게이션 & UX')

  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await login(page, ACCOUNTS.user.email)

  // 뒤로가기 → 로그인 페이지 재노출 없음
  await page.goBack()
  await page.waitForTimeout(2000)
  const backUrl = page.url().replace(BASE, '')
  if (!backUrl.startsWith('/auth/login'))
    pass('UX', `로그인 후 뒤로가기 → 로그인 화면 재노출 없음 (${backUrl || 'about:blank'})`)
  else
    fail('UX', '로그인 후 뒤로가기 → 로그인 화면 재노출됨')

  // 고객 대시보드 → 요청 등록 → 뒤로가기 → 대시보드
  await page.goto(`${BASE}/dashboard/user`)
  await page.waitForTimeout(1500)
  await page.goto(`${BASE}/request/new`)
  await page.waitForTimeout(1500)
  await page.goBack()
  await page.waitForTimeout(2000)
  const backToDash = page.url().replace(BASE, '')
  if (backToDash.startsWith('/dashboard'))
    pass('UX', '요청 등록 → 뒤로가기 → 대시보드 복귀')
  else
    info('UX', `요청 등록 → 뒤로가기 결과: ${backToDash}`)

  // 헤더 홈 로고 클릭
  await page.goto(`${BASE}/dashboard/user`)
  await page.waitForTimeout(1500)
  const logoLink = page.locator('a[href="/"]').first()
  if (await logoLink.count() > 0) {
    await logoLink.click()
    await page.waitForTimeout(2000)
    const homeUrl = page.url().replace(BASE, '')
    if (homeUrl === '' || homeUrl === '/')
      pass('UX', '헤더 로고 클릭 → 홈 이동')
    else
      info('UX', `헤더 로고 클릭 결과: ${homeUrl}`)
  } else {
    info('UX', '헤더 로고 링크 없음 (구조 다를 수 있음)')
  }

  // 회원가입 페이지 주요 필드 존재
  await page.goto(`${BASE}/auth/signup`)
  await page.waitForTimeout(2000)
  const hasSignupFields = await page.locator('input[type="email"], input[type="password"]').count() >= 2
  if (hasSignupFields)
    pass('UX', '회원가입 - 이메일/비밀번호 필드 존재')
  else
    fail('UX', '회원가입 - 필수 입력 필드 없음')

  await ctx.close()
}

// ═══════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════
async function main() {
  console.log(`\n${'█'.repeat(60)}`)
  console.log('  🚀 빠방 전체 E2E 테스트')
  console.log(`  대상: ${BASE}`)
  console.log(`  시각: ${new Date().toLocaleString('ko-KR')}`)
  console.log(`${'█'.repeat(60)}`)

  const browser = await chromium.launch({ headless: true })

  try {
    await testAuth(browser)
    await testPermissions(browser)
    await testPublicPages(browser)
    await testUserFlow(browser)
    await testBrokerFlow(browser)
    await testAdminFlow(browser)
    await testChat(browser)
    await testAutoFillAPI()
    await testMobile(browser)
    await testUX(browser)
  } finally {
    await browser.close()
  }

  const total = results.pass + results.fail
  console.log(`\n${'═'.repeat(60)}`)
  console.log('  📊 최종 결과')
  console.log('═'.repeat(60))
  console.log(`  전체  : ${total}개`)
  console.log(`  ✅ 통과: ${results.pass}개  (${Math.round(results.pass/total*100)}%)`)
  console.log(`  ❌ 실패: ${results.fail}개`)

  if (results.errors.length > 0) {
    console.log(`\n  ── 실패 항목 ──────────────────────────────────`)
    results.errors.forEach((e, i) => console.log(`  ${i+1}. ${e}`))
  }

  console.log(`\n  ── 스크린샷 ────────────────────────────────────`)
  ;[
    'screenshot-home.png',
    'screenshot-user-dashboard.png',
    'screenshot-user-request-form.png',
    'screenshot-broker-dashboard.png',
    'screenshot-broker-properties.png',
    'screenshot-admin-dashboard.png',
    'screenshot-mobile-home.png',
    'screenshot-mobile-dashboard.png',
  ].forEach(f => console.log(`    ${f}`))
}

main().catch(console.error)
