-- 2026-11-05 고객용 화면 잔재 정리 (사장님 승인)
-- 코드·봇·DB 어디서도 안 쓰는 뷰 1개·함수 2개. 정의는 archive_20261030.dropped_definitions 에 남긴다.

create table if not exists archive_20261030.dropped_definitions (
  name text primary key,
  kind text not null,
  definition text not null,
  dropped_at timestamptz not null default now()
);

insert into archive_20261030.dropped_definitions (name, kind, definition)
select 'public.public_properties', 'view',
       'create or replace view public.public_properties as ' || pg_get_viewdef('public.public_properties'::regclass, true)
union all
select 'public.' || p.proname, 'function', pg_get_functiondef(p.oid)
from pg_proc p join pg_namespace s on s.oid = p.pronamespace
where s.nspname = 'public' and p.proname in ('get_public_brokers', 'matched_users_for_property')
on conflict (name) do update set definition = excluded.definition, dropped_at = now();

drop view if exists public.public_properties;
drop function if exists public.get_public_brokers(text, text, boolean, integer, integer);
drop function if exists public.matched_users_for_property(uuid);
