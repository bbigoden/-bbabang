-- 대화방 나가기 — 본인 멤버 행 삭제 허용 (team/dm. group은 UI에서 막음)
DROP POLICY IF EXISTS "ocm_delete" ON office_chat_members;
CREATE POLICY "ocm_delete" ON office_chat_members FOR DELETE USING (
  EXISTS (SELECT 1 FROM broker_profiles me WHERE me.user_id = auth.uid() AND me.id = office_chat_members.broker_id)
);
