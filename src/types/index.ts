export type UserRole = 'user' | 'broker' | 'admin'

export type DealType = '전세' | '월세' | '매매'

export type RoomType = '원룸' | '투룸' | '쓰리룸 이상' | '아파트' | '오피스텔' | '빌라'

export interface Profile {
  id: string
  email: string
  name: string
  phone: string | null
  role: UserRole
  avatar_url: string | null
  created_at: string
}

export interface BrokerProfile {
  id: string
  user_id: string
  office_name: string
  license_number: string
  address: string
  district: string  // 활동 지역 (예: 강남구)
  rating: number
  review_count: number
  deal_count: number
  is_verified: boolean
  profile?: Profile
}

export interface RequestPost {
  id: string
  user_id: string
  deal_type: DealType
  room_type: RoomType
  district: string       // 희망 지역 (예: 강남구)
  city: string           // 시/도 (예: 서울특별시)
  min_price: number      // 만원 단위
  max_price: number
  min_size: number | null  // 평 단위
  max_size: number | null
  move_in_date: string | null
  description: string | null
  status: 'active' | 'matched' | 'closed'
  proposal_count: number
  created_at: string
  profile?: Profile
}

export interface Proposal {
  id: string
  request_id: string
  broker_id: string
  price: number
  description: string
  property_address: string | null
  property_images: string[]
  status: 'pending' | 'accepted' | 'rejected'
  created_at: string
  broker?: BrokerProfile
  request?: RequestPost
}

export interface ChatRoom {
  id: string
  request_id: string
  user_id: string
  broker_id: string
  proposal_id: string | null
  created_at: string
  user?: Profile
  broker_profile?: BrokerProfile
  request?: RequestPost
  last_message?: ChatMessage
}

export interface ChatMessage {
  id: string
  room_id: string
  sender_id: string
  content: string
  created_at: string
  sender?: Profile
}

export interface Review {
  id: string
  broker_id: string
  user_id: string
  rating: number
  content: string
  created_at: string
  profile?: Profile
}
