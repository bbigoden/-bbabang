import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { Input } from './input'

const meta: Meta<typeof Input> = {
  title: 'UI/Input',
  component: Input,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
  decorators: [
    (Story) => (
      <div style={{ width: 320 }}>
        <Story />
      </div>
    ),
  ],
  argTypes: {
    label:       { control: 'text' },
    placeholder: { control: 'text' },
    error:       { control: 'text' },
    hint:        { control: 'text' },
    disabled:    { control: 'boolean' },
  },
}
export default meta

type Story = StoryObj<typeof Input>

export const Default: Story = {
  args: { placeholder: '입력하세요' },
}

export const WithLabel: Story = {
  args: { label: '이메일', placeholder: 'example@email.com', type: 'email' },
}

export const WithHint: Story = {
  args: { label: '비밀번호', placeholder: '8자 이상 입력', type: 'password', hint: '영문·숫자·특수문자 조합 권장' },
}

export const WithError: Story = {
  args: { label: '이메일', placeholder: 'example@email.com', value: 'invalid-email', error: '올바른 이메일 형식이 아닙니다', readOnly: true },
}

export const Disabled: Story = {
  args: { label: '사용자명', value: 'bbigoden', disabled: true },
}
