-- 매물 글 칸(중개사메모·간단메모·설명) 수정 이력.
-- 메모를 실수로 지우면 복구할 길이 없었다 → 바뀔 때마다 '바뀌기 전 값'을 남겨 둔다.
-- 읽기: 그 매물을 고칠 수 있는 사람만. 쓰기: 트리거만(클라이언트 직접 쓰기 정책 없음).
CREATE TABLE IF NOT EXISTS public.property_text_history (
  id          bigserial PRIMARY KEY,
  property_id uuid        NOT NULL,
  field       text        NOT NULL,
  old_value   text,
  new_value   text,
  changed_by  uuid        DEFAULT auth.uid(),
  changed_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_property_text_history_prop
  ON public.property_text_history (property_id, changed_at DESC);

ALTER TABLE public.property_text_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pth_select ON public.property_text_history;
CREATE POLICY pth_select ON public.property_text_history FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.broker_properties p
  WHERE p.id = property_text_history.property_id AND public.can_edit_broker_property(p.broker_id)
));

REVOKE ALL ON public.property_text_history FROM anon, public;
GRANT SELECT ON public.property_text_history TO authenticated;

CREATE OR REPLACE FUNCTION public.log_property_text_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.memo IS DISTINCT FROM OLD.memo THEN
    INSERT INTO public.property_text_history(property_id, field, old_value, new_value)
    VALUES (NEW.id, 'memo', OLD.memo, NEW.memo);
  END IF;
  IF NEW.brief_memo IS DISTINCT FROM OLD.brief_memo THEN
    INSERT INTO public.property_text_history(property_id, field, old_value, new_value)
    VALUES (NEW.id, 'brief_memo', OLD.brief_memo, NEW.brief_memo);
  END IF;
  IF NEW.description IS DISTINCT FROM OLD.description THEN
    INSERT INTO public.property_text_history(property_id, field, old_value, new_value)
    VALUES (NEW.id, 'description', OLD.description, NEW.description);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_property_text_change ON public.broker_properties;
CREATE TRIGGER trg_log_property_text_change
AFTER UPDATE OF memo, brief_memo, description ON public.broker_properties
FOR EACH ROW EXECUTE FUNCTION public.log_property_text_change();
