-- 팀 단위 단체방(kind='team') 지원
-- 사무소 전체(group)와 달리 임의 멤버만 골라 만드는 그룹 채팅방. 방 이름(title) 보유.
ALTER TABLE office_chat_threads ADD COLUMN IF NOT EXISTS title TEXT;

-- 단체방 생성 (RLS 닭-달걀 회피). 생성자 + 선택 멤버(같은 사무소만) 등록.
CREATE OR REPLACE FUNCTION create_team_thread(p_office UUID, p_title TEXT, p_members UUID[])
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_me UUID;
  v_thread UUID;
  v_m UUID;
BEGIN
  SELECT id INTO v_me FROM broker_profiles
   WHERE user_id = auth.uid()
     AND (id = p_office OR (parent_broker_id = p_office AND is_approved = true))
   LIMIT 1;
  IF v_me IS NULL THEN RAISE EXCEPTION 'caller not in office'; END IF;

  INSERT INTO office_chat_threads (office_broker_id, kind, title)
    VALUES (p_office, 'team', NULLIF(btrim(coalesce(p_title, '')), ''))
    RETURNING id INTO v_thread;

  INSERT INTO office_chat_members (thread_id, broker_id) VALUES (v_thread, v_me)
    ON CONFLICT (thread_id, broker_id) DO NOTHING;

  IF p_members IS NOT NULL THEN
    FOREACH v_m IN ARRAY p_members LOOP
      IF v_m <> v_me AND EXISTS (
        SELECT 1 FROM broker_profiles
        WHERE id = v_m AND (id = p_office OR (parent_broker_id = p_office AND is_approved = true))
      ) THEN
        INSERT INTO office_chat_members (thread_id, broker_id) VALUES (v_thread, v_m)
          ON CONFLICT (thread_id, broker_id) DO NOTHING;
      END IF;
    END LOOP;
  END IF;

  RETURN v_thread;
END;
$$;
