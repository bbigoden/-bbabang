import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { Badge } from './badge'

const meta: Meta<typeof Badge> = {
  title: 'UI/Badge',
  component: Badge,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
  argTypes: {
    variant: { control: 'select', options: ['default', 'success', 'warning', 'danger', 'info'] },
    children: { control: 'text' },
  },
}
export default meta

type Story = StoryObj<typeof Badge>

export const Default: Story = {
  args: { children: '일반', variant: 'default' },
}

export const Success: Story = {
  args: { children: '계약완료', variant: 'success' },
}

export const Warning: Story = {
  args: { children: '검토중', variant: 'warning' },
}

export const Danger: Story = {
  args: { children: '마감', variant: 'danger' },
}

export const Info: Story = {
  args: { children: '신규', variant: 'info' },
}

export const AllVariants: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant="default">일반</Badge>
      <Badge variant="success">계약완료</Badge>
      <Badge variant="warning">검토중</Badge>
      <Badge variant="danger">마감</Badge>
      <Badge variant="info">신규</Badge>
    </div>
  ),
}
