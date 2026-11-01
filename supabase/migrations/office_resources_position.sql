-- 자료실 폴더·메모를 정해 둔 순서로(사장님 지시 2026-11-01). 사무소 모두에게 같은 순서로 보인다.
-- 비어 있으면 순서 지정 안 한 것 — 지정한 것 뒤에 최근 것부터.
ALTER TABLE office_resources ADD COLUMN IF NOT EXISTS position INTEGER;

-- 플러스불당(김용유 대표) 맨 위 폴더: 회사정보 → 대표정보 → 계약양식 → 기타자료 → 교육자료 → 채용정보
UPDATE office_resources r SET position = o.pos
FROM (VALUES ('회사정보', 1), ('대표정보', 2), ('계약양식', 3), ('기타자료', 4), ('교육자료', 5), ('채용정보', 6)) AS o(title, pos)
WHERE r.office_broker_id = '7edde640-a6ea-4657-ab52-0403e9fdd39e'
  AND r.parent_id IS NULL AND r.deleted_at IS NULL AND r.kind = 'folder' AND r.title = o.title;
