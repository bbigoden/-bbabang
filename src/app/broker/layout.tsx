import { BrokerSidebar } from '@/components/broker/sidebar'

export default function BrokerLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex">
      <BrokerSidebar />
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  )
}
