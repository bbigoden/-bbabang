-- 답장(인용) + 메시지 삭제
ALTER TABLE office_chat_messages ADD COLUMN IF NOT EXISTS reply_to_id UUID REFERENCES office_chat_messages(id) ON DELETE SET NULL;

-- 삭제: 본인이 보낸 메시지만
DROP POLICY IF EXISTS "ocmsg_delete" ON office_chat_messages;
CREATE POLICY "ocmsg_delete" ON office_chat_messages FOR DELETE USING (
  EXISTS (SELECT 1 FROM broker_profiles me WHERE me.user_id = auth.uid() AND me.id = office_chat_messages.sender_broker_id)
);
