-- 자료실 개인폴더(사장님 지시 2026-11-01): 직원이 승인되면 '개인폴더' 안에 그 직원 이름 폴더를 자동으로 만든다.
-- 폴더 주인을 직원 본인으로 두므로 본인과 대표만 보인다(office_res_can_view 규칙).
-- 이미 있으면(지운 것 제외) 다시 만들지 않는다. '개인폴더'가 없으면 대표 소유로 맨 뒤에 만든다.
CREATE OR REPLACE FUNCTION office_res_personal_folder() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_parent UUID;
  v_name TEXT;
BEGIN
  IF NEW.parent_broker_id IS NULL OR NEW.is_approved IS DISTINCT FROM true THEN
    RETURN NEW;
  END IF;

  SELECT id INTO v_parent FROM office_resources
  WHERE office_broker_id = NEW.parent_broker_id AND parent_id IS NULL AND deleted_at IS NULL
    AND kind = 'folder' AND title = '개인폴더'
  ORDER BY created_at LIMIT 1;

  IF v_parent IS NULL THEN
    INSERT INTO office_resources (office_broker_id, uploader_broker_id, kind, parent_id, title, position)
    SELECT NEW.parent_broker_id, NEW.parent_broker_id, 'folder', NULL, '개인폴더', COALESCE(MAX(position), 0) + 1
    FROM office_resources
    WHERE office_broker_id = NEW.parent_broker_id AND parent_id IS NULL AND deleted_at IS NULL
    RETURNING id INTO v_parent;
  END IF;

  IF EXISTS (SELECT 1 FROM office_resources WHERE parent_id = v_parent AND uploader_broker_id = NEW.id
               AND kind = 'folder' AND deleted_at IS NULL) THEN
    RETURN NEW;
  END IF;

  SELECT NULLIF(TRIM(name), '') INTO v_name FROM profiles WHERE id = NEW.user_id;
  INSERT INTO office_resources (office_broker_id, uploader_broker_id, kind, parent_id, title)
  VALUES (NEW.parent_broker_id, NEW.id, 'folder', v_parent, COALESCE(v_name, '직원'));
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS broker_profiles_personal_folder ON broker_profiles;
CREATE TRIGGER broker_profiles_personal_folder
  AFTER INSERT OR UPDATE OF is_approved, parent_broker_id ON broker_profiles
  FOR EACH ROW EXECUTE FUNCTION office_res_personal_folder();
