// @vitest-environment jsdom
/**
 * 로그인 화면 — 온 까닭별 인사·가입 링크의 redirect, 로그인 실패 까닭별 안내.
 *
 * QA: 홈 [무료로 조건 등록하기]를 누른 처음 온 사람도 '다시 만나서 반가워요' 인사를 받고 가입 링크는
 * 작은 한 줄(redirect 도 버림)이었다(#10·#11). 인증 전 로그인·요청 과다도 '비밀번호가 올바르지
 * 않습니다'로 보였다(#46).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const m = vi.hoisted(() => ({
  replace: vi.fn(),
  signInWithPassword: vi.fn(),
  resend: vi.fn(),
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: m.replace, push: vi.fn() }) }))
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      getSession: async () => ({ data: { session: null } }),
      signInWithPassword: m.signInWithPassword,
      resend: m.resend,
    },
  }),
}))

import { LoginForm } from '@/app/auth/login/login-form'

const authError = (message: string, code: string | undefined, status: number) =>
  Object.assign(new Error(message), { code, status, __isAuthError: true })

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
})

async function login() {
  const user = userEvent.setup()
  await user.type(screen.getByLabelText('이메일'), 'name@example.com')
  await user.type(screen.getByLabelText('비밀번호'), 'abcd1234!')
  await user.click(screen.getByRole('button', { name: '로그인' }))
  return user
}

describe('LoginForm — 온 까닭별 인사', () => {
  it('그냥 들어오면 재방문 인사', () => {
    render(<LoginForm redirectTo={null} />)
    expect(screen.getByText('다시 만나서 반가워요 👋')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '무료로 시작하기' })).toHaveAttribute('href', '/auth/signup')
  })

  it('로그인 전용 화면이면 이어진다고만, 가입 링크가 redirect 를 싣는다', () => {
    render(<LoginForm redirectTo="/broker/properties?focus=1" />)
    expect(screen.getByText('로그인이 필요한 화면이에요')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '무료로 시작하기' }))
      .toHaveAttribute('href', '/auth/signup?redirect=%2Fbroker%2Fproperties%3Ffocus%3D1')
  })

  it('헤더 [로그인]이 실어 온 공개 화면은 재방문 인사 그대로', () => {
    render(<LoginForm redirectTo="/support" />)
    expect(screen.getByText('다시 만나서 반가워요 👋')).toBeInTheDocument()
  })
})

describe('LoginForm — 로그인 실패 까닭별 안내 (#46)', () => {
  it('이메일 인증 전이면 인증 안내 + 재발송 버튼', async () => {
    m.signInWithPassword.mockResolvedValue({ data: { user: null, session: null }, error: authError('Email not confirmed', 'email_not_confirmed', 400) })
    m.resend.mockResolvedValue({ data: {}, error: null })
    render(<LoginForm redirectTo="/broker/properties" />)
    const user = await login()
    expect(await screen.findByText(/이메일 인증이 아직 안 됐어요/)).toBeInTheDocument()
    expect(screen.queryByText('이메일 또는 비밀번호가 올바르지 않습니다.')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '인증 메일 다시 보내기' }))
    expect(m.resend).toHaveBeenCalledWith(expect.objectContaining({
      type: 'signup',
      email: 'name@example.com',
      options: { emailRedirectTo: expect.stringContaining('/auth/callback?next=%2Fbroker%2Fproperties') },
    }))
    expect(await screen.findByText(/인증 메일을 다시 보냈어요/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /인증 메일 다시 보내기 \(\d+초\)/ })).toBeDisabled()
  })

  it('요청이 몰려 막히면 잠시 후 다시', async () => {
    m.signInWithPassword.mockResolvedValue({ data: { user: null, session: null }, error: authError('Request rate limit reached', 'over_request_rate_limit', 429) })
    render(<LoginForm redirectTo={null} />)
    await login()
    expect(await screen.findByText(/잠시 후 다시 시도해주세요/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /인증 메일 다시 보내기/ })).not.toBeInTheDocument()
  })

  it('비밀번호가 틀리면 예전 문구', async () => {
    m.signInWithPassword.mockResolvedValue({ data: { user: null, session: null }, error: authError('Invalid login credentials', 'invalid_credentials', 400) })
    render(<LoginForm redirectTo={null} />)
    await login()
    expect(await screen.findByText('이메일 또는 비밀번호가 올바르지 않습니다.')).toBeInTheDocument()
  })
})
