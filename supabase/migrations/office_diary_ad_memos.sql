-- 업무일지 3번 광고현황 메모를 사람마다 나눈다 (2026-10-29 사장님).
--
-- 처음엔 사무실에 한 칸(office_diary_common.ad_memo)이었는데, 사장님 규칙은
--   · 대표(김용유)·이사(권세현)는 모두의 메모를 본다
--   · 나머지 직원은 대표·이사 메모와 자기 메모만 본다
-- 그래서 사람·날짜마다 한 줄로 두고, 보이는 범위를 DB 에서 막는다.
-- 고치기는 자기 메모만.
--
-- 이사는 직급 칸이 따로 없어 화면(lib/office-board DIRECTOR_ID)과 같은 id 를 여기에도 적는다.
create or replace function public.is_office_lead(p_office uuid, p_broker uuid)
 returns boolean
 language sql
 immutable
as $$
  select p_broker = p_office or p_broker = '6581efd5-6ec9-46ea-a391-7e6537cc6345'::uuid
$$;

create or replace function public.can_see_ad_memo(p_office uuid, p_author uuid)
 returns boolean
 language sql
 stable security definer
 set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.broker_profiles me
    where me.user_id = auth.uid()
      and (me.id = p_office or (me.parent_broker_id = p_office and me.is_approved is true))
      and (me.id = p_author or public.is_office_lead(p_office, me.id) or public.is_office_lead(p_office, p_author))
  );
$$;
revoke all on function public.can_see_ad_memo(uuid, uuid) from public, anon;
grant execute on function public.can_see_ad_memo(uuid, uuid) to authenticated;

create table if not exists public.office_diary_ad_memos (
  office_id  uuid not null references public.broker_profiles(id) on delete cascade,
  date       date not null,
  author_id  uuid not null references public.broker_profiles(id) on delete cascade,
  memo       text not null,
  updated_at timestamptz not null default now(),
  primary key (office_id, date, author_id)
);
alter table public.office_diary_ad_memos enable row level security;

create policy office_diary_ad_memos_select on public.office_diary_ad_memos
  for select to authenticated using (public.can_see_ad_memo(office_id, author_id));

-- 쓰기는 자기 메모만, 자기 사무실에만
create policy office_diary_ad_memos_write on public.office_diary_ad_memos
  for all to authenticated
  using (public.is_office_member(office_id)
         and author_id in (select id from public.broker_profiles where user_id = auth.uid()))
  with check (public.is_office_member(office_id)
         and author_id in (select id from public.broker_profiles where user_id = auth.uid()));

-- 10/29 아침 공통 칸이 생기기 전 직원 일지에 따로 적은 광고현황을 그 사람 메모로 옮겨 둔다(원본은 그대로)
insert into public.office_diary_ad_memos (office_id, date, author_id, memo, updated_at)
select coalesce(bp.parent_broker_id, bp.id), d.date, d.broker_id, d.sections_content->>'s_ad', d.updated_at
from public.broker_diary d join public.broker_profiles bp on bp.id = d.broker_id
where d.date = '2026-10-29' and coalesce(d.sections_content->>'s_ad', '') <> ''
on conflict do nothing;
