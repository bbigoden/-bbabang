-- 메신저 등록 봇(부소장등록 bot.py)의 답장 표시 — 보낸 사람은 봇 계정(대표)이지만 화면엔 이 이름으로 보인다
-- 2026-11-02 사장님 승인('이대로 만들어'), 운영 적용 완료
alter table public.office_chat_messages
  add column if not exists bot_name text check (char_length(bot_name) <= 20);
