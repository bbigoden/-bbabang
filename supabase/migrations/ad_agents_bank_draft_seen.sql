-- 뱅크 임시저장 일꾼의 심장박동 칸.
--
-- 광고 일꾼은 ad_agents.last_seen_at 을 20초마다 찍어 화면이 'PC 프로그램 켜짐/꺼짐' 을 안다.
-- 뱅크 임시저장 일꾼은 따로 도는 프로그램이라 같은 칸을 찍으면 광고관리가 광고 일꾼이 켜진
-- 줄 안다. 칸을 하나 더 둔다 — 매물목록이 '뱅크 임시저장 일꾼 꺼짐' 을 이걸로 보인다.
set lock_timeout = '5s';

alter table public.ad_agents
  add column if not exists bank_draft_seen_at timestamptz null;

comment on column public.ad_agents.bank_draft_seen_at is
  '뱅크 임시저장 일꾼(부소장광고/src/cli/bank-draft-worker.js)이 마지막으로 살아 있다고 찍은 시각. 60초 안이면 켜짐.';

reset lock_timeout;
notify pgrst, 'reload schema';
