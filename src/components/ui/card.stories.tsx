import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { Card, CardHeader, CardBody, CardFooter } from './card'
import { Button } from './button'
import { Badge } from './badge'

const meta: Meta<typeof Card> = {
  title: 'UI/Card',
  component: Card,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
  decorators: [
    (Story) => (
      <div style={{ width: 360 }}>
        <Story />
      </div>
    ),
  ],
  argTypes: {
    hover: { control: 'boolean' },
  },
}
export default meta

type Story = StoryObj<typeof Card>

export const Simple: Story = {
  render: () => (
    <Card>
      <CardBody>
        <p className="text-sm text-gray-700">기본 카드 내용입니다.</p>
      </CardBody>
    </Card>
  ),
}

export const WithHeader: Story = {
  render: () => (
    <Card>
      <CardHeader>
        <h3 className="text-base font-semibold text-gray-900">카드 제목</h3>
      </CardHeader>
      <CardBody>
        <p className="text-sm text-gray-600">카드 본문 내용이 여기에 들어갑니다.</p>
      </CardBody>
    </Card>
  ),
}

export const WithFooter: Story = {
  render: () => (
    <Card>
      <CardHeader>
        <h3 className="text-base font-semibold text-gray-900">카드 제목</h3>
      </CardHeader>
      <CardBody>
        <p className="text-sm text-gray-600">카드 본문 내용이 여기에 들어갑니다.</p>
      </CardBody>
      <CardFooter>
        <div className="flex gap-2">
          <Button size="sm" variant="primary">확인</Button>
          <Button size="sm" variant="outline">취소</Button>
        </div>
      </CardFooter>
    </Card>
  ),
}

export const Hoverable: Story = {
  render: () => (
    <Card hover>
      <CardHeader>
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-900">서울 강남구 사무실</h3>
          <Badge variant="info">신규</Badge>
        </div>
      </CardHeader>
      <CardBody>
        <p className="text-sm text-gray-600">보증금 3,000만원 / 월세 150만원</p>
        <p className="mt-1 text-xs text-gray-500">전용 33㎡ · 2층</p>
      </CardBody>
    </Card>
  ),
}
