-- ==============================
-- 빠방 (Ppabang) Supabase Schema
-- ==============================

-- 프로필 테이블
CREATE TABLE IF NOT EXISTS profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'broker')),
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 중개사 프로필 테이블
CREATE TABLE IF NOT EXISTS broker_profiles (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL UNIQUE,
  office_name TEXT NOT NULL,
  license_number TEXT NOT NULL,
  address TEXT NOT NULL,
  district TEXT NOT NULL,
  bio TEXT,
  rating DECIMAL(3,2) DEFAULT 0,
  review_count INTEGER DEFAULT 0,
  deal_count INTEGER DEFAULT 0,
  is_verified BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 매물 요청 테이블
CREATE TABLE IF NOT EXISTS request_posts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  deal_type TEXT NOT NULL,  -- 복수 선택 가능 (예: '매매, 전세')
  room_type TEXT NOT NULL,
  city TEXT NOT NULL,
  district TEXT NOT NULL,
  min_price INTEGER NOT NULL,
  max_price INTEGER NOT NULL,
  min_size INTEGER,
  max_size INTEGER,
  move_in_date DATE,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'matched', 'closed')),
  proposal_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 제안 테이블
CREATE TABLE IF NOT EXISTS proposals (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  request_id UUID REFERENCES request_posts(id) ON DELETE CASCADE NOT NULL,
  broker_id UUID REFERENCES broker_profiles(id) ON DELETE CASCADE NOT NULL,
  price INTEGER NOT NULL,
  description TEXT NOT NULL,
  property_address TEXT,
  property_images TEXT[] DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(request_id, broker_id)
);

-- 채팅방 테이블
CREATE TABLE IF NOT EXISTS chat_rooms (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  request_id UUID REFERENCES request_posts(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  broker_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  proposal_id UUID REFERENCES proposals(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 채팅 메시지 테이블
CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  room_id UUID REFERENCES chat_rooms(id) ON DELETE CASCADE NOT NULL,
  sender_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 리뷰 테이블
CREATE TABLE IF NOT EXISTS reviews (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  broker_id UUID REFERENCES broker_profiles(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(broker_id, user_id)
);

-- ==============================
-- RLS (Row Level Security) 정책
-- ==============================

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE broker_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE request_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;

-- profiles: 본인만 수정, 모두 조회
CREATE POLICY "profiles_select" ON profiles FOR SELECT USING (true);
CREATE POLICY "profiles_insert" ON profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "profiles_update" ON profiles FOR UPDATE USING (auth.uid() = id);

-- broker_profiles: 모두 조회, 본인만 수정
CREATE POLICY "broker_select" ON broker_profiles FOR SELECT USING (true);
CREATE POLICY "broker_insert" ON broker_profiles FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "broker_update" ON broker_profiles FOR UPDATE USING (auth.uid() = user_id);

-- request_posts: 모두 조회, 본인만 작성/수정
CREATE POLICY "request_select" ON request_posts FOR SELECT USING (true);
CREATE POLICY "request_insert" ON request_posts FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "request_update" ON request_posts FOR UPDATE USING (auth.uid() = user_id);

-- proposals: 요청자와 중개사만 조회
CREATE POLICY "proposal_select" ON proposals FOR SELECT USING (
  auth.uid() IN (
    SELECT user_id FROM request_posts WHERE id = request_id
  ) OR
  auth.uid() IN (
    SELECT user_id FROM broker_profiles WHERE id = broker_id
  )
);
CREATE POLICY "proposal_insert" ON proposals FOR INSERT WITH CHECK (
  auth.uid() IN (
    SELECT user_id FROM broker_profiles WHERE id = broker_id
  )
);

-- chat_rooms: 참여자만 조회
CREATE POLICY "chatroom_select" ON chat_rooms FOR SELECT USING (
  auth.uid() = user_id OR auth.uid() = broker_id
);
CREATE POLICY "chatroom_insert" ON chat_rooms FOR INSERT WITH CHECK (
  auth.uid() = user_id OR auth.uid() = broker_id
);

-- chat_messages: 채팅방 참여자만
CREATE POLICY "chatmsg_select" ON chat_messages FOR SELECT USING (
  auth.uid() IN (
    SELECT user_id FROM chat_rooms WHERE id = room_id
    UNION
    SELECT broker_id FROM chat_rooms WHERE id = room_id
  )
);
CREATE POLICY "chatmsg_insert" ON chat_messages FOR INSERT WITH CHECK (
  auth.uid() IN (
    SELECT user_id FROM chat_rooms WHERE id = room_id
    UNION
    SELECT broker_id FROM chat_rooms WHERE id = room_id
  )
);

-- reviews: 모두 조회, 본인만 작성
CREATE POLICY "review_select" ON reviews FOR SELECT USING (true);
CREATE POLICY "review_insert" ON reviews FOR INSERT WITH CHECK (auth.uid() = user_id);

-- ==============================
-- 유용한 함수
-- ==============================

-- 제안 수 증가
CREATE OR REPLACE FUNCTION increment_proposal_count(request_id UUID)
RETURNS VOID AS $$
  UPDATE request_posts
  SET proposal_count = proposal_count + 1
  WHERE id = request_id;
$$ LANGUAGE SQL SECURITY DEFINER;

-- Auth 사용자 생성 시 프로필 자동 생성
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, name, phone, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'name', ''),
    NEW.raw_user_meta_data->>'phone',
    COALESCE(NEW.raw_user_meta_data->>'role', 'user')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Realtime 활성화
ALTER PUBLICATION supabase_realtime ADD TABLE chat_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE proposals;

-- ==============================
-- 중개사 매물장
-- ==============================

CREATE TABLE IF NOT EXISTS broker_properties (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  broker_id UUID REFERENCES broker_profiles(id) ON DELETE CASCADE NOT NULL,
  deal_type TEXT NOT NULL,
  room_type TEXT NOT NULL,
  address TEXT NOT NULL,
  price INTEGER NOT NULL,          -- 전세/매매: 총액, 월세: 보증금 (만원)
  monthly_rent INTEGER,            -- 월세 금액 (만원)
  size_pyeong DECIMAL(5,1),        -- 평수
  floor INTEGER,                   -- 층수
  total_floors INTEGER,            -- 건물 전체 층수
  description TEXT,
  options TEXT[] DEFAULT '{}',     -- 옵션 (풀옵션, 주차 등)
  status TEXT NOT NULL DEFAULT 'available'
    CHECK (status IN ('available', 'contracted', 'hidden')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE broker_properties ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bprop_select" ON broker_properties FOR SELECT USING (true);
CREATE POLICY "bprop_insert" ON broker_properties FOR INSERT WITH CHECK (
  auth.uid() IN (SELECT user_id FROM broker_profiles WHERE id = broker_id)
);
CREATE POLICY "bprop_update" ON broker_properties FOR UPDATE USING (
  auth.uid() IN (SELECT user_id FROM broker_profiles WHERE id = broker_id)
);
CREATE POLICY "bprop_delete" ON broker_properties FOR DELETE USING (
  auth.uid() IN (SELECT user_id FROM broker_profiles WHERE id = broker_id)
);

-- chat_messages: 매물 카드 전송 지원
ALTER TABLE chat_messages
  ADD COLUMN IF NOT EXISTS message_type TEXT NOT NULL DEFAULT 'text'
    CHECK (message_type IN ('text', 'property')),
  ADD COLUMN IF NOT EXISTS property_id UUID
    REFERENCES broker_properties(id) ON DELETE SET NULL;
