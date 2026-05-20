-- 자료 한 개에 파일 여러 개 첨부할 수 있게 별도 테이블로 분리

CREATE TABLE IF NOT EXISTS office_resource_files (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  resource_id UUID REFERENCES office_resources(id) ON DELETE CASCADE NOT NULL,
  storage_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_size INTEGER,
  file_type TEXT,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS office_resource_files_resource_idx
  ON office_resource_files(resource_id, sort_order);

ALTER TABLE office_resource_files ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "office_resource_files_select" ON office_resource_files;
CREATE POLICY "office_resource_files_select" ON office_resource_files FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM office_resources r
    JOIN broker_profiles bp ON bp.user_id = auth.uid()
    WHERE r.id = office_resource_files.resource_id
      AND (
        bp.id = r.office_broker_id
        OR (bp.parent_broker_id = r.office_broker_id AND bp.is_approved = true)
      )
  )
);

DROP POLICY IF EXISTS "office_resource_files_insert" ON office_resource_files;
CREATE POLICY "office_resource_files_insert" ON office_resource_files FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM office_resources r
    JOIN broker_profiles bp ON bp.user_id = auth.uid()
    WHERE r.id = office_resource_files.resource_id
      AND (
        bp.id = r.office_broker_id
        OR (bp.parent_broker_id = r.office_broker_id AND bp.is_approved = true)
      )
  )
);

DROP POLICY IF EXISTS "office_resource_files_delete" ON office_resource_files;
CREATE POLICY "office_resource_files_delete" ON office_resource_files FOR DELETE USING (
  EXISTS (
    SELECT 1 FROM office_resources r
    JOIN broker_profiles bp ON bp.user_id = auth.uid()
    WHERE r.id = office_resource_files.resource_id
      AND (
        bp.id = r.uploader_broker_id
        OR bp.id = r.office_broker_id
      )
  )
);
