-- 첫 '사무실 공통 메모 한 칸' 시절 칼럼. 메모는 사람마다로 바뀌어(office_diary_ad_memos) 안 쓴다(2026-10-29).
-- 지울 때 남은 글은 없었다.
alter table public.office_diary_common
  drop column if exists ad_memo,
  drop column if exists memo_by,
  drop column if exists memo_at;
