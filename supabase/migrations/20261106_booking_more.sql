-- 예약 기능 더하기(11-06 사장님: "123456 진행")
--  2. 특정 날짜 막기        → office_booking_pages.closed_dates
--  3. 같은 시간 겹침 막기    → office_booking_pages.slot_capacity (NULL = 제한 없음)
--  5. 손님 참고 사진        → office_events.photos + 비공개 버킷 booking-photos
--  6. 예약금 안내           → office_booking_pages.deposit_text ([확정] 복사 문구에 붙는다)
-- 1(아침 알림)·4(단골 표시)는 DB 변경 없음.

ALTER TABLE office_booking_pages
  ADD COLUMN IF NOT EXISTS closed_dates DATE[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS slot_capacity INTEGER CHECK (slot_capacity BETWEEN 1 AND 50),
  ADD COLUMN IF NOT EXISTS deposit_text TEXT CHECK (char_length(deposit_text) <= 300);

ALTER TABLE office_events
  ADD COLUMN IF NOT EXISTS photos TEXT[] NOT NULL DEFAULT '{}';   -- booking-photos 안 경로: <office>/<owner>/<파일>

-- 손님 사진: 올리기는 서버(service_role)만, 보기는 그 일정을 볼 수 있는 사람만
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('booking-photos', 'booking-photos', false, 5242880, ARRAY['image/jpeg','image/png','image/webp'])
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS booking_photos_select ON storage.objects;
CREATE POLICY booking_photos_select ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'booking-photos'
    AND office_event_can_view(((storage.foldername(name))[1])::uuid, ((storage.foldername(name))[2])::uuid)
  );
