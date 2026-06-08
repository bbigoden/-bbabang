import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { BrokerChatsClient } from '@/components/broker-chats-client'

export default async function BrokerChatsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'broker') redirect('/dashboard/user')

  return (
    <>
      <h1 className="sr-only">중개사 채팅 목록</h1>
      <BrokerChatsClient user={user} />
    </>
  )
}
