-- 메신저 사진 전송 지원
ALTER TABLE office_chat_messages ADD COLUMN IF NOT EXISTS image_url TEXT;

-- 채팅 이미지 버킷 (public — 경로에 사무소·스레드 포함, URL 추측 어려움)
INSERT INTO storage.buckets (id, name, public)
  VALUES ('office-chat-images', 'office-chat-images', true)
  ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "office_chat_img_insert" ON storage.objects;
CREATE POLICY "office_chat_img_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'office-chat-images');

DROP POLICY IF EXISTS "office_chat_img_select" ON storage.objects;
CREATE POLICY "office_chat_img_select" ON storage.objects FOR SELECT
  USING (bucket_id = 'office-chat-images');

-- 읽음 표시 실시간 — 멤버 last_read_at 변경 구독
ALTER PUBLICATION supabase_realtime ADD TABLE office_chat_members;
