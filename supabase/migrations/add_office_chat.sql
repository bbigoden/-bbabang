-- 사내 메신저 — 구글 챗 대체
-- threads: 사무소 전체 단톡(group, 사무소당 1개) + 1:1 DM(dm)
-- members: 안 읽음/마지막 읽은 시각 관리 (group도 lazy 등록)
-- 접근 판정은 RLS 재귀 회피 위해 SECURITY DEFINER 함수 사용

CREATE TABLE IF NOT EXISTS office_chat_threads (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  office_broker_id UUID REFERENCES broker_profiles(id) ON DELETE CASCADE NOT NULL,
  kind TEXT NOT NULL,                 -- 'group' | 'dm'
  dm_key TEXT,                        -- dm일 때 정렬된 'idA__idB' (중복 방지)
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS office_chat_group_uniq ON office_chat_threads(office_broker_id) WHERE kind = 'group';
CREATE UNIQUE INDEX IF NOT EXISTS office_chat_dm_uniq ON office_chat_threads(dm_key) WHERE kind = 'dm';

CREATE TABLE IF NOT EXISTS office_chat_members (
  thread_id UUID REFERENCES office_chat_threads(id) ON DELETE CASCADE NOT NULL,
  broker_id UUID REFERENCES broker_profiles(id) ON DELETE CASCADE NOT NULL,
  last_read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (thread_id, broker_id)
);

CREATE TABLE IF NOT EXISTS office_chat_messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  thread_id UUID REFERENCES office_chat_threads(id) ON DELETE CASCADE NOT NULL,
  sender_broker_id UUID REFERENCES broker_profiles(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS office_chat_messages_thread_idx ON office_chat_messages(thread_id, created_at);

-- ── 접근 판정 함수 (RLS 재귀 회피) ──────────────────────
CREATE OR REPLACE FUNCTION can_access_office_thread(p_thread UUID)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM office_chat_threads t
    WHERE t.id = p_thread AND (
      (t.kind = 'group' AND EXISTS (
        SELECT 1 FROM broker_profiles me
        WHERE me.user_id = auth.uid()
          AND (me.id = t.office_broker_id OR me.parent_broker_id = t.office_broker_id)
      ))
      OR EXISTS (
        SELECT 1 FROM office_chat_members m
        JOIN broker_profiles me ON me.id = m.broker_id
        WHERE m.thread_id = t.id AND me.user_id = auth.uid()
      )
    )
  );
$$;

CREATE OR REPLACE FUNCTION is_office_member(p_office UUID)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM broker_profiles me
    WHERE me.user_id = auth.uid()
      AND (me.id = p_office OR (me.parent_broker_id = p_office AND me.is_approved = true))
  );
$$;

-- ── RLS ───────────────────────────────────────────────
ALTER TABLE office_chat_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE office_chat_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE office_chat_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "oct_select" ON office_chat_threads;
CREATE POLICY "oct_select" ON office_chat_threads FOR SELECT USING (
  (kind = 'group' AND is_office_member(office_broker_id))
  OR EXISTS (
    SELECT 1 FROM office_chat_members m
    JOIN broker_profiles me ON me.id = m.broker_id
    WHERE m.thread_id = office_chat_threads.id AND me.user_id = auth.uid()
  )
);
DROP POLICY IF EXISTS "oct_insert" ON office_chat_threads;
CREATE POLICY "oct_insert" ON office_chat_threads FOR INSERT WITH CHECK (
  is_office_member(office_broker_id)
);

DROP POLICY IF EXISTS "ocm_select" ON office_chat_members;
CREATE POLICY "ocm_select" ON office_chat_members FOR SELECT USING (
  can_access_office_thread(thread_id)
);
DROP POLICY IF EXISTS "ocm_insert" ON office_chat_members;
CREATE POLICY "ocm_insert" ON office_chat_members FOR INSERT WITH CHECK (
  can_access_office_thread(thread_id)
);
DROP POLICY IF EXISTS "ocm_update" ON office_chat_members;
CREATE POLICY "ocm_update" ON office_chat_members FOR UPDATE USING (
  EXISTS (SELECT 1 FROM broker_profiles me WHERE me.user_id = auth.uid() AND me.id = office_chat_members.broker_id)
);

DROP POLICY IF EXISTS "ocmsg_select" ON office_chat_messages;
CREATE POLICY "ocmsg_select" ON office_chat_messages FOR SELECT USING (
  can_access_office_thread(thread_id)
);
DROP POLICY IF EXISTS "ocmsg_insert" ON office_chat_messages;
CREATE POLICY "ocmsg_insert" ON office_chat_messages FOR INSERT WITH CHECK (
  can_access_office_thread(thread_id)
  AND EXISTS (SELECT 1 FROM broker_profiles me WHERE me.user_id = auth.uid() AND me.id = office_chat_messages.sender_broker_id)
);

-- 실시간 구독
ALTER PUBLICATION supabase_realtime ADD TABLE office_chat_messages;
