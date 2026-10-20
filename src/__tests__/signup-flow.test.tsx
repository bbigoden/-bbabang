// @vitest-environment jsdom
/**
 * 회원가입 화면의 흐름 — Supabase·라우터를 흉내 내고 실제 폼을 눌러 본다.
 *
 * QA 에서 나온 것들:
 * - 약관을 안 누르면 버튼이 회색으로 꺼질 뿐 이유를 안 알려 줬다(#29)
 * - 오류가 버튼 위 한 곳에 하나씩만 나왔다(#32), 공백 이름이 그대로 저장됐다(#22)
 * - 가입 즉시 로그인(운영)인데도 '인증 메일을 보냈어요'를 띄우고, 원래 가려던 조건 등록으로
 *   이어지지 않았다(#11·#12). 인증을 켠 서버에선 보낸 주소·재발송이 없었다.
 * - 중개사 가입은 이동을 시작하자마자 버튼을 다시 켜, 느린 망에서 실패한 줄 알았다(#49)
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const m = vi.hoisted(() => ({
  replace: vi.fn(),
  signUp: vi.fn(),
  resend: vi.fn(),
  update: vi.fn(),
  isPasswordPwned: vi.fn(),
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: m.replace, push: vi.fn() }) }))
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { signUp: m.signUp, resend: m.resend },
    from: () => ({ update: (v: unknown) => { m.update(v); return { eq: async () => ({ error: null }) } } }),
  }),
}))
vi.mock('@/lib/password-check', () => ({
  isPasswordPwned: m.isPasswordPwned,
  pwnedMessage: () => '유출된 비밀번호예요',
}))

import { SignupForm } from '@/app/auth/signup/signup-form'

const fakeUser = { id: '3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b' }

beforeAll(() => {
  // jsdom 에는 없다 — 첫 오류 칸으로 끌어올릴 때 부른다
  Element.prototype.scrollIntoView = vi.fn()
})

beforeEach(() => {
  vi.clearAllMocks()
  m.isPasswordPwned.mockResolvedValue({ pwned: false })
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}')))
})

async function fill(opts: { name?: string; email?: string; phone?: string; terms?: boolean } = {}) {
  const user = userEvent.setup()
  await user.type(screen.getByLabelText(/^이름/), opts.name ?? '홍길동')
  await user.type(screen.getByLabelText(/^이메일/), opts.email ?? 'name@example.com')
  await user.type(screen.getByLabelText(/^비밀번호 \*$/), 'abcd1234!')
  await user.type(screen.getByLabelText(/^비밀번호 확인/), 'abcd1234!')
  if (opts.phone) await user.type(screen.getByLabelText(/^휴대폰 번호/), opts.phone)
  if (opts.terms ?? true) await user.click(screen.getByRole('checkbox', { name: /이용약관과 개인정보처리방침에 동의/ }))
  return user
}

describe('SignupForm', () => {
  it('약관을 안 눌러도 버튼은 켜져 있고, 누르면 이유를 동의 칸 아래에 띄운다 (#29)', async () => {
    render(<SignupForm />)
    const user = await fill({ terms: false })
    const submit = screen.getByRole('button', { name: '회원가입' })
    expect(submit).toBeEnabled()
    await user.click(submit)
    expect(await screen.findByText('이용약관에 동의해주세요')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /이용약관과 개인정보처리방침에 동의/ })).toHaveFocus()
    expect(m.signUp).not.toHaveBeenCalled()
  })

  it('틀린 칸을 한꺼번에 칸마다 띄운다 — 공백 이름·끝 없는 이메일·휴대폰 (#22·#32·#33)', async () => {
    render(<SignupForm />)
    const user = await fill({ name: '   ', email: 'p5@example', phone: 'abc-defg' })
    await user.click(screen.getByRole('button', { name: '회원가입' }))
    expect(await screen.findByText('이름을 입력해주세요')).toBeInTheDocument()
    expect(screen.getByText(/올바른 이메일 주소를 입력해주세요/)).toBeInTheDocument()
    expect(screen.getByText(/휴대폰 번호를 확인해주세요/)).toBeInTheDocument()
    expect(screen.getByLabelText(/^이름/)).toHaveFocus()
    expect(m.signUp).not.toHaveBeenCalled()
  })

  it('가입 즉시 로그인되면 인증 메일 안내 없이 원래 가려던 곳으로 간다 (#11·#12)', async () => {
    m.signUp.mockResolvedValue({ data: { user: fakeUser, session: { access_token: 't' } }, error: null })
    render(<SignupForm redirectTo="/request/new" />)
    const user = await fill({ name: '  홍길동 ', phone: '01012345678' })
    await user.click(screen.getByRole('button', { name: '회원가입' }))

    await waitFor(() => expect(m.replace).toHaveBeenCalledWith('/request/new'))
    const arg = m.signUp.mock.calls[0][0]
    expect(arg.options.data).toEqual({ name: '홍길동', phone: '010-1234-5678', role: 'user' })
    expect(arg.options.emailRedirectTo).toContain('/auth/callback?next=%2Frequest%2Fnew')
    expect(fetch).toHaveBeenCalledWith('/api/consent/signup', expect.anything())
    expect(screen.queryByText(/인증 메일/)).not.toBeInTheDocument()
    // 이동하는 동안 버튼을 다시 켜지 않는다 (#49)
    expect(screen.getByRole('button', { name: '회원가입' })).toBeDisabled()
  })

  it('redirect 가 없으면 고객 첫 화면, 중개사는 늘 사무소 등록 화면', async () => {
    m.signUp.mockResolvedValue({ data: { user: fakeUser, session: { access_token: 't' } }, error: null })
    const { unmount } = render(<SignupForm />)
    let user = await fill()
    await user.click(screen.getByRole('button', { name: '회원가입' }))
    await waitFor(() => expect(m.replace).toHaveBeenCalledWith('/dashboard/user'))
    unmount()

    m.replace.mockClear()
    render(<SignupForm defaultRole="broker" redirectTo="/request/new" />)
    user = await fill()
    await user.click(screen.getByRole('button', { name: '중개사·직원으로 가입하기' }))
    await waitFor(() => expect(m.replace).toHaveBeenCalledWith('/broker/register'))
  })

  it('세션 없이 끝나면(이메일 인증을 켠 서버) 보낸 주소와 재발송 버튼을 보여 준다', async () => {
    m.signUp.mockResolvedValue({ data: { user: fakeUser, session: null }, error: null })
    render(<SignupForm redirectTo="/request/new" />)
    const user = await fill({ email: ' name@example.com ' })
    await user.click(screen.getByRole('button', { name: '회원가입' }))

    expect(await screen.findByText('name@example.com')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '인증 메일을 보냈어요' })).toBeInTheDocument()
    // 방금 보냈으니 재발송은 잠시 쉰다
    expect(screen.getByRole('button', { name: /인증 메일 다시 보내기 \(\d+초\)/ })).toBeDisabled()
    // 로그인 링크도 원래 가려던 곳을 싣는다
    expect(screen.getByRole('link', { name: /로그인하기/ })).toHaveAttribute('href', '/auth/login?redirect=%2Frequest%2Fnew')
    expect(m.replace).not.toHaveBeenCalled()
    // 세션이 없으면 동의 기록·프로필 수정은 어차피 막혀 보내지 않는다
    expect(fetch).not.toHaveBeenCalled()
    expect(m.update).not.toHaveBeenCalled()
  })

  it('이미 가입된 이메일은 이메일 칸에 띄운다', async () => {
    m.signUp.mockResolvedValue({
      data: { user: null, session: null },
      error: Object.assign(new Error('User already registered'), { code: 'user_already_exists', status: 422 }),
    })
    render(<SignupForm />)
    const user = await fill()
    await user.click(screen.getByRole('button', { name: '회원가입' }))
    expect(await screen.findByText(/이미 가입된 이메일입니다/)).toBeInTheDocument()
    expect(screen.getByLabelText(/^이메일/)).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('button', { name: '회원가입' })).toBeEnabled()
  })
})
