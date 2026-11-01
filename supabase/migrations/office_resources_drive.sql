-- 자료실을 구글드라이브처럼: 폴더 안 폴더, 맨 위에 두는 파일, 파일 이름 바꾸기·이동, 휴지통, 별표.
-- 권한(사장님 지시 2026-11-01): 대표=사무소 전부 보기 / 직원=본인 것 + 대표 것만 보기 /
-- 고치기·옮기기·지우기=올린 본인만. 올린 사람이 탈퇴해 칸이 빈 것만 대표가 정리한다.
-- 기존 자료는 지우지 않는다 — 칸을 더하고 채우기만 한다.

-- ── 1) 폴더·메모 구분, 상위 폴더, 휴지통 ─────────────────────────
ALTER TABLE office_resources ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'folder' CHECK (kind IN ('folder', 'memo'));
ALTER TABLE office_resources ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES office_resources(id) ON DELETE SET NULL;
ALTER TABLE office_resources ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS office_resources_parent_idx ON office_resources(parent_id);

-- 파일 없이 글만 있던 자료 = 메모
UPDATE office_resources r SET kind = 'memo'
WHERE COALESCE(BTRIM(r.description), '') <> ''
  AND NOT EXISTS (SELECT 1 FROM office_resource_files f WHERE f.resource_id = r.id);

-- ── 2) 파일: 사무소·올린 사람을 직접 들고, 폴더 없이(맨 위)도 둔다 ──
ALTER TABLE office_resource_files ADD COLUMN IF NOT EXISTS office_broker_id UUID REFERENCES broker_profiles(id) ON DELETE CASCADE;
ALTER TABLE office_resource_files ADD COLUMN IF NOT EXISTS uploader_broker_id UUID REFERENCES broker_profiles(id) ON DELETE SET NULL;
ALTER TABLE office_resource_files ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

UPDATE office_resource_files f SET office_broker_id = r.office_broker_id
FROM office_resources r WHERE r.id = f.resource_id AND f.office_broker_id IS NULL;
-- 저장 경로 두 번째 칸이 올린 사람이다(탈퇴한 사람이면 빈 채로)
UPDATE office_resource_files f SET uploader_broker_id = b.id
FROM broker_profiles b WHERE b.id::text = split_part(f.storage_path, '/', 2) AND f.uploader_broker_id IS NULL;

ALTER TABLE office_resource_files ALTER COLUMN office_broker_id SET NOT NULL;
ALTER TABLE office_resource_files ALTER COLUMN resource_id DROP NOT NULL;
-- 폴더를 영구삭제해도 남의 파일은 지워지지 않고 맨 위로 나온다
ALTER TABLE office_resource_files DROP CONSTRAINT IF EXISTS office_resource_files_resource_id_fkey;
ALTER TABLE office_resource_files ADD CONSTRAINT office_resource_files_resource_id_fkey
  FOREIGN KEY (resource_id) REFERENCES office_resources(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS office_resource_files_office_idx ON office_resource_files(office_broker_id);

-- 옛 화면(PWA 캐시)이 사무소·올린 사람 없이 넣어도 채워 준다
CREATE OR REPLACE FUNCTION office_resource_files_fill() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.office_broker_id IS NULL AND NEW.resource_id IS NOT NULL THEN
    SELECT office_broker_id INTO NEW.office_broker_id FROM office_resources WHERE id = NEW.resource_id;
  END IF;
  IF NEW.uploader_broker_id IS NULL THEN
    SELECT id INTO NEW.uploader_broker_id FROM broker_profiles WHERE id::text = split_part(NEW.storage_path, '/', 2);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS office_resource_files_fill ON office_resource_files;
CREATE TRIGGER office_resource_files_fill BEFORE INSERT ON office_resource_files
  FOR EACH ROW EXECUTE FUNCTION office_resource_files_fill();

-- ── 3) 권한 함수 ───────────────────────────────────────────
-- 보기: 대표는 전부, 직원은 본인 것 + 대표 것
CREATE OR REPLACE FUNCTION office_res_can_view(p_office UUID, p_uploader UUID) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM broker_profiles bp
    WHERE bp.user_id = auth.uid()
      AND (
        bp.id = p_office
        OR (bp.parent_broker_id = p_office AND bp.is_approved = true AND (p_uploader = bp.id OR p_uploader = p_office))
      )
  )
$$;

-- 고치기·지우기: 올린 본인만. 올린 사람이 비어 있으면(탈퇴) 대표가.
CREATE OR REPLACE FUNCTION office_res_can_manage(p_office UUID, p_uploader UUID) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM broker_profiles bp
    WHERE bp.user_id = auth.uid()
      AND (bp.id = p_office OR (bp.parent_broker_id = p_office AND bp.is_approved = true))
      AND (bp.id = p_uploader OR (p_uploader IS NULL AND bp.id = p_office))
  )
$$;

-- 올리기: 본인 이름으로, 내 사무소에
CREATE OR REPLACE FUNCTION office_res_can_insert(p_office UUID, p_uploader UUID) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM broker_profiles bp
    WHERE bp.user_id = auth.uid()
      AND bp.id = p_uploader
      AND (bp.id = p_office OR (bp.parent_broker_id = p_office AND bp.is_approved = true))
  )
$$;

-- ── 4) 자료(폴더·메모) 정책 ─────────────────────────────────
DROP POLICY IF EXISTS "office_resources_select" ON office_resources;
CREATE POLICY "office_resources_select" ON office_resources FOR SELECT
  USING (office_res_can_view(office_broker_id, uploader_broker_id));

-- 상위 폴더는 같은 사무소의, 내가 볼 수 있는 폴더여야 한다
DROP POLICY IF EXISTS "office_resources_insert" ON office_resources;
CREATE POLICY "office_resources_insert" ON office_resources FOR INSERT WITH CHECK (
  office_res_can_insert(office_broker_id, uploader_broker_id)
  AND (parent_id IS NULL OR EXISTS (
    SELECT 1 FROM office_resources p WHERE p.id = office_resources.parent_id AND p.office_broker_id = office_resources.office_broker_id AND p.kind = 'folder'))
);

DROP POLICY IF EXISTS "office_resources_update" ON office_resources;
CREATE POLICY "office_resources_update" ON office_resources FOR UPDATE
  USING (office_res_can_manage(office_broker_id, uploader_broker_id))
  WITH CHECK (
    office_res_can_manage(office_broker_id, uploader_broker_id)
    AND (parent_id IS NULL OR EXISTS (
      SELECT 1 FROM office_resources p WHERE p.id = office_resources.parent_id AND p.office_broker_id = office_resources.office_broker_id AND p.kind = 'folder'))
  );

DROP POLICY IF EXISTS "office_resources_delete" ON office_resources;
CREATE POLICY "office_resources_delete" ON office_resources FOR DELETE
  USING (office_res_can_manage(office_broker_id, uploader_broker_id));

-- ── 5) 파일 정책 ───────────────────────────────────────────
DROP POLICY IF EXISTS "office_resource_files_select" ON office_resource_files;
CREATE POLICY "office_resource_files_select" ON office_resource_files FOR SELECT
  USING (office_res_can_view(office_broker_id, uploader_broker_id));

DROP POLICY IF EXISTS "office_resource_files_insert" ON office_resource_files;
CREATE POLICY "office_resource_files_insert" ON office_resource_files FOR INSERT WITH CHECK (
  office_res_can_insert(office_broker_id, uploader_broker_id)
  AND (resource_id IS NULL OR EXISTS (
    SELECT 1 FROM office_resources p WHERE p.id = office_resource_files.resource_id AND p.office_broker_id = office_resource_files.office_broker_id AND p.kind = 'folder'))
);

DROP POLICY IF EXISTS "office_resource_files_update" ON office_resource_files;
CREATE POLICY "office_resource_files_update" ON office_resource_files FOR UPDATE
  USING (office_res_can_manage(office_broker_id, uploader_broker_id))
  WITH CHECK (
    office_res_can_manage(office_broker_id, uploader_broker_id)
    AND (resource_id IS NULL OR EXISTS (
      SELECT 1 FROM office_resources p WHERE p.id = office_resource_files.resource_id AND p.office_broker_id = office_resource_files.office_broker_id AND p.kind = 'folder'))
  );

DROP POLICY IF EXISTS "office_resource_files_delete" ON office_resource_files;
CREATE POLICY "office_resource_files_delete" ON office_resource_files FOR DELETE
  USING (office_res_can_manage(office_broker_id, uploader_broker_id));

-- ── 6) 저장소(실제 파일) 정책 — 경로: 사무소/올린사람/파일 ─────────
DROP POLICY IF EXISTS "office_resources_storage_select" ON storage.objects;
CREATE POLICY "office_resources_storage_select" ON storage.objects FOR SELECT USING (
  bucket_id = 'office-resources'
  AND office_res_can_view(((storage.foldername(name))[1])::uuid, ((storage.foldername(name))[2])::uuid)
);

DROP POLICY IF EXISTS "office_resources_storage_insert" ON storage.objects;
CREATE POLICY "office_resources_storage_insert" ON storage.objects FOR INSERT WITH CHECK (
  bucket_id = 'office-resources'
  AND office_res_can_insert(((storage.foldername(name))[1])::uuid, ((storage.foldername(name))[2])::uuid)
);

-- 지우기: 올린 본인. 올린 사람이 탈퇴해 없으면 대표.
DROP POLICY IF EXISTS "office_resources_storage_delete" ON storage.objects;
CREATE POLICY "office_resources_storage_delete" ON storage.objects FOR DELETE USING (
  bucket_id = 'office-resources'
  AND office_res_can_manage(
    ((storage.foldername(name))[1])::uuid,
    (SELECT b.id FROM broker_profiles b WHERE b.id::text = (storage.foldername(name))[2])
  )
);

-- ── 7) 별표(사람마다 따로) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS office_resource_stars (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  broker_id UUID NOT NULL REFERENCES broker_profiles(id) ON DELETE CASCADE,
  resource_id UUID REFERENCES office_resources(id) ON DELETE CASCADE,
  file_id UUID REFERENCES office_resource_files(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CHECK ((resource_id IS NULL) <> (file_id IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS office_resource_stars_res_uq ON office_resource_stars(broker_id, resource_id) WHERE resource_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS office_resource_stars_file_uq ON office_resource_stars(broker_id, file_id) WHERE file_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS office_resource_stars_resource_idx ON office_resource_stars(resource_id);
CREATE INDEX IF NOT EXISTS office_resource_stars_file_idx ON office_resource_stars(file_id);
ALTER TABLE office_resource_stars ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "office_resource_stars_own" ON office_resource_stars;
CREATE POLICY "office_resource_stars_own" ON office_resource_stars FOR ALL
  USING (EXISTS (SELECT 1 FROM broker_profiles bp WHERE bp.user_id = auth.uid() AND bp.id = office_resource_stars.broker_id))
  WITH CHECK (EXISTS (SELECT 1 FROM broker_profiles bp WHERE bp.user_id = auth.uid() AND bp.id = office_resource_stars.broker_id));
