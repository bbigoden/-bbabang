-- 2026-11-05 업무일지 퇴사자 목록 — 이름만 한 번에 (폰 속도 점검)
-- 일지를 열 때마다 두 보관 표의 작성자 칸을 통째로(고객 보관 표는 1,000줄이 넘어 여러 번 나눠) 받아
-- 화면에서 겹친 것을 걸렀다. 겹치지 않는 사람만 돌려준다.
-- SECURITY INVOKER: 부르는 사람의 RLS 그대로.
create or replace function public.office_archive_authors(p_office uuid)
returns table (author_broker_id uuid, author_name text)
language sql
stable
security invoker
set search_path = public
as $$
  select distinct on (a.author_broker_id) a.author_broker_id, a.author_name
  from (
    select author_broker_id, author_name, 0 as src from broker_diary_archive where office_broker_id = p_office
    union all
    select author_broker_id, author_name, 1 from broker_diary_customers_archive where office_broker_id = p_office
  ) a
  where a.author_broker_id is not null
  order by a.author_broker_id, a.src;
$$;

revoke execute on function public.office_archive_authors(uuid) from public, anon;
grant  execute on function public.office_archive_authors(uuid) to authenticated, service_role;
