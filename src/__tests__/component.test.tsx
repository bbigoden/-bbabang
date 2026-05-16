// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'

// ── Button ────────────────────────────────────────────────────────────────────

describe('Button', () => {
  it('텍스트 렌더', () => {
    render(<Button>확인</Button>)
    expect(screen.getByRole('button', { name: '확인' })).toBeInTheDocument()
  })

  it('loading 상태 → disabled + 스피너', () => {
    render(<Button loading>저장 중</Button>)
    const btn = screen.getByRole('button')
    expect(btn).toBeDisabled()
    expect(btn.querySelector('svg')).toBeInTheDocument()
  })

  it('disabled prop → 비활성', () => {
    render(<Button disabled>제출</Button>)
    expect(screen.getByRole('button')).toBeDisabled()
  })

  it('variant=danger → 빨간 배경 클래스', () => {
    render(<Button variant="danger">삭제</Button>)
    expect(screen.getByRole('button')).toHaveClass('bg-red-500')
  })

  it('variant=secondary → 회색 배경', () => {
    render(<Button variant="secondary">취소</Button>)
    expect(screen.getByRole('button')).toHaveClass('bg-gray-100')
  })

  it('size=lg → py-3.5 클래스', () => {
    render(<Button size="lg">크게</Button>)
    expect(screen.getByRole('button')).toHaveClass('py-3.5')
  })

  it('size=sm → py-1.5 클래스', () => {
    render(<Button size="sm">작게</Button>)
    expect(screen.getByRole('button')).toHaveClass('py-1.5')
  })

  it('onClick 호출', async () => {
    const user = userEvent.setup()
    let clicked = false
    render(<Button onClick={() => { clicked = true }}>클릭</Button>)
    await user.click(screen.getByRole('button'))
    expect(clicked).toBe(true)
  })

  it('disabled 상태에서 onClick 미호출', async () => {
    const user = userEvent.setup()
    let clicked = false
    render(<Button disabled onClick={() => { clicked = true }}>클릭</Button>)
    await user.click(screen.getByRole('button'))
    expect(clicked).toBe(false)
  })
})

// ── Badge ─────────────────────────────────────────────────────────────────────

describe('Badge', () => {
  it('텍스트 렌더', () => {
    render(<Badge>공개</Badge>)
    expect(screen.getByText('공개')).toBeInTheDocument()
  })

  it('variant=success → 초록', () => {
    render(<Badge variant="success">승인</Badge>)
    expect(screen.getByText('승인')).toHaveClass('bg-green-100', 'text-green-700')
  })

  it('variant=danger → 빨강', () => {
    render(<Badge variant="danger">거절</Badge>)
    expect(screen.getByText('거절')).toHaveClass('bg-red-100', 'text-red-700')
  })

  it('variant=warning → 노랑', () => {
    render(<Badge variant="warning">검토중</Badge>)
    expect(screen.getByText('검토중')).toHaveClass('bg-yellow-100')
  })

  it('variant=info → 파랑', () => {
    render(<Badge variant="info">안내</Badge>)
    expect(screen.getByText('안내')).toHaveClass('bg-blue-100')
  })

  it('기본 variant → 회색', () => {
    render(<Badge>기본</Badge>)
    expect(screen.getByText('기본')).toHaveClass('bg-gray-100')
  })

  it('className prop 적용', () => {
    render(<Badge className="font-black">테스트</Badge>)
    expect(screen.getByText('테스트')).toHaveClass('font-black')
  })
})

// ── Input ─────────────────────────────────────────────────────────────────────

describe('Input', () => {
  it('기본 렌더', () => {
    render(<Input placeholder="입력하세요" />)
    expect(screen.getByPlaceholderText('입력하세요')).toBeInTheDocument()
  })

  it('label 렌더', () => {
    render(<Input label="이메일" />)
    expect(screen.getByText('이메일')).toBeInTheDocument()
  })

  it('hint 렌더', () => {
    render(<Input hint="영문+숫자 8자 이상" />)
    expect(screen.getByText('영문+숫자 8자 이상')).toBeInTheDocument()
  })

  it('error 렌더 → 빨간 메시지', () => {
    render(<Input error="필수 입력입니다" />)
    const errEl = screen.getByText('필수 입력입니다')
    expect(errEl).toBeInTheDocument()
    expect(errEl).toHaveClass('text-red-500')
  })

  it('error 있으면 hint 숨김', () => {
    render(<Input hint="힌트" error="오류" />)
    expect(screen.queryByText('힌트')).not.toBeInTheDocument()
    expect(screen.getByText('오류')).toBeInTheDocument()
  })

  it('error → 입력창 빨간 테두리 클래스', () => {
    render(<Input error="오류" />)
    expect(screen.getByRole('textbox')).toHaveClass('border-red-400')
  })

  it('type=password → 비밀번호 필드', () => {
    render(<Input type="password" />)
    expect(screen.getByDisplayValue('')).toHaveAttribute('type', 'password')
  })

  it('텍스트 입력 반영', async () => {
    const user = userEvent.setup()
    render(<Input placeholder="이름" />)
    const input = screen.getByPlaceholderText('이름')
    await user.type(input, '홍길동')
    expect(input).toHaveValue('홍길동')
  })
})
