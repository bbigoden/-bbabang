import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { Button } from './button'

const meta: Meta<typeof Button> = {
  title: 'UI/Button',
  component: Button,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
  argTypes: {
    variant: { control: 'select', options: ['primary', 'secondary', 'outline', 'ghost', 'danger'] },
    size:    { control: 'select', options: ['sm', 'md', 'lg'] },
    loading: { control: 'boolean' },
    disabled:{ control: 'boolean' },
  },
}
export default meta

type Story = StoryObj<typeof Button>

export const Primary: Story = {
  args: { children: '버튼', variant: 'primary', size: 'md' },
}

export const Secondary: Story = {
  args: { children: '취소', variant: 'secondary', size: 'md' },
}

export const Outline: Story = {
  args: { children: '더보기', variant: 'outline', size: 'md' },
}

export const Danger: Story = {
  args: { children: '삭제', variant: 'danger', size: 'md' },
}

export const Loading: Story = {
  args: { children: '저장 중...', variant: 'primary', size: 'md', loading: true },
}

export const Disabled: Story = {
  args: { children: '비활성', variant: 'primary', size: 'md', disabled: true },
}

export const AllSizes: Story = {
  render: () => (
    <div className="flex items-center gap-3">
      <Button size="sm">Small</Button>
      <Button size="md">Medium</Button>
      <Button size="lg">Large</Button>
    </div>
  ),
}

export const AllVariants: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="primary">Primary</Button>
      <Button variant="secondary">Secondary</Button>
      <Button variant="outline">Outline</Button>
      <Button variant="ghost">Ghost</Button>
      <Button variant="danger">Danger</Button>
    </div>
  ),
}
