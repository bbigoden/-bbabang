-- 메신저 일반 파일 전송 (이미지 외 PDF·문서 등)
ALTER TABLE office_chat_messages ADD COLUMN IF NOT EXISTS file_url TEXT;
ALTER TABLE office_chat_messages ADD COLUMN IF NOT EXISTS file_name TEXT;
