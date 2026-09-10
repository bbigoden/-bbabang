-- 사장님이 보고 "이건 괜찮다" 고 접어 둔 점검·특이사항.
--
-- 지우지 않고 **접어 둔다.** 점검 보고는 발행할 때마다, 특이사항은 수집할 때마다
-- 다시 만들어진다. 지워 봐야 다음 번에 그대로 되살아난다.
-- 그래서 접어 둔 문구를 여기 모아 두고 화면에서 뺀다.
--
-- 문구 그대로를 담는다 — 내용이 달라지면(예: 중복 상대 매물이 바뀌면) 다른
-- 문구가 되어 다시 뜬다. 그게 맞다. 접어 둔 것은 '그때 본 그 말' 이다.
alter table public.ad_listings
  add column if not exists dismissed_notes text[] not null default '{}';

comment on column public.ad_listings.dismissed_notes is
  '사장님이 확인하고 접어 둔 점검·특이사항 문구. 화면에서만 뺀다.';
