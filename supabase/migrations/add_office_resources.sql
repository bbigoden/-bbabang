-- 사무소 내부 공유 자료실
-- 대표 broker_id를 office_broker_id로 사용. 직원이 올린 자료도 같은 office로 묶임.

CREATE TABLE IF NOT EXISTS office_resources (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  office_broker_id UUID REFERENCES broker_profiles(id) ON DELETE CASCADE NOT NULL,
  uploader_broker_id UUID REFERENCES broker_profiles(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  file_url TEXT,
  file_name TEXT,
  file_size INTEGER,
  file_type TEXT,
  storage_path TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS office_resources_office_idx ON office_resources(office_broker_id, created_at DESC);

ALTER TABLE office_resources ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "office_resources_select" ON office_resources;
CREATE POLICY "office_resources_select" ON office_resources FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM broker_profiles bp
    WHERE bp.user_id = auth.uid()
      AND (
        bp.id = office_resources.office_broker_id
        OR (bp.parent_broker_id = office_resources.office_broker_id AND bp.is_approved = true)
      )
  )
);

DROP POLICY IF EXISTS "office_resources_insert" ON office_resources;
CREATE POLICY "office_resources_insert" ON office_resources FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM broker_profiles bp
    WHERE bp.user_id = auth.uid()
      AND bp.id = office_resources.uploader_broker_id
      AND (
        bp.id = office_resources.office_broker_id
        OR (bp.parent_broker_id = office_resources.office_broker_id AND bp.is_approved = true)
      )
  )
);

DROP POLICY IF EXISTS "office_resources_delete" ON office_resources;
CREATE POLICY "office_resources_delete" ON office_resources FOR DELETE USING (
  EXISTS (
    SELECT 1 FROM broker_profiles bp
    WHERE bp.user_id = auth.uid()
      AND (
        bp.id = office_resources.uploader_broker_id
        OR (bp.id = office_resources.office_broker_id)
      )
  )
);

DROP POLICY IF EXISTS "office_resources_update" ON office_resources;
CREATE POLICY "office_resources_update" ON office_resources FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM broker_profiles bp
    WHERE bp.user_id = auth.uid()
      AND bp.id = office_resources.uploader_broker_id
  )
);

INSERT INTO storage.buckets (id, name, public)
VALUES ('office-resources', 'office-resources', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "office_resources_storage_select" ON storage.objects;
CREATE POLICY "office_resources_storage_select" ON storage.objects FOR SELECT
  USING (
    bucket_id = 'office-resources'
    AND EXISTS (
      SELECT 1 FROM broker_profiles bp
      WHERE bp.user_id = auth.uid()
        AND (
          bp.id::text = (storage.foldername(name))[1]
          OR (bp.parent_broker_id::text = (storage.foldername(name))[1] AND bp.is_approved = true)
        )
    )
  );

DROP POLICY IF EXISTS "office_resources_storage_insert" ON storage.objects;
CREATE POLICY "office_resources_storage_insert" ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'office-resources'
    AND EXISTS (
      SELECT 1 FROM broker_profiles bp
      WHERE bp.user_id = auth.uid()
        AND (
          bp.id::text = (storage.foldername(name))[1]
          OR (bp.parent_broker_id::text = (storage.foldername(name))[1] AND bp.is_approved = true)
        )
    )
  );

DROP POLICY IF EXISTS "office_resources_storage_delete" ON storage.objects;
CREATE POLICY "office_resources_storage_delete" ON storage.objects FOR DELETE
  USING (
    bucket_id = 'office-resources'
    AND EXISTS (
      SELECT 1 FROM broker_profiles bp
      WHERE bp.user_id = auth.uid()
        AND (
          bp.id::text = (storage.foldername(name))[1]
          OR (bp.parent_broker_id::text = (storage.foldername(name))[1] AND bp.is_approved = true)
        )
    )
  );
