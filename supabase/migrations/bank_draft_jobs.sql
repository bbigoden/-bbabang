-- 뱅크 임시저장 작업 줄(bank_draft_jobs).
--
-- 매물목록의 [뱅크 임시저장] 을 누르면 여기 한 줄이 생기고, PC 에서 도는 전용 일꾼
-- (부소장광고/src/cli/bank-draft-worker.js)이 집어 가 부동산뱅크 등록 화면을 채운 뒤
-- [임시 저장] 까지만 누른다. 돈이 나가는 최종 [등록] 은 사람이 뱅크에서 누른다(2026-10-21 결정).
--
-- ad_jobs 를 안 쓰는 이유: 기존 일꾼(agent-worker)은 kind 를 가리지 않고 대기 중인 줄을
-- 집어 모르는 kind 는 실패로 적는다. 그 파일을 고치지 않고 새 일꾼을 따로 두려면 줄도
-- 따로 서야 한다.
--
-- 권한: 사무소 광고를 관리할 수 있는 사람(can_manage_office_ads)이 보고, 넣을 때는 그 매물을
-- 고칠 수 있어야 한다(can_edit_broker_property) — 대표는 사무소 매물 전부, 직원은 자기 매물만.
set lock_timeout = '5s';

create table if not exists public.bank_draft_jobs (
  id uuid primary key default gen_random_uuid(),
  office_broker_id uuid not null references public.broker_profiles(id) on delete cascade,
  property_id uuid not null references public.broker_properties(id) on delete cascade,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'done', 'failed', 'canceled')),
  requested_by uuid references auth.users(id) on delete set null,
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  progress text,
  result jsonb,
  error text,
  updated_at timestamptz not null default now()
);

comment on table public.bank_draft_jobs is
  '매물목록 → 부동산뱅크 임시저장 작업 줄. PC 일꾼이 queued 를 집어 running → done/failed 로 적는다.';
comment on column public.bank_draft_jobs.result is
  '{ bankNo?: 뱅크 임시매물번호, tempListUrl, photos: 올린 사진 수, skipped: [채우지 못한 칸] }';

create index if not exists bank_draft_jobs_office_status_idx
  on public.bank_draft_jobs (office_broker_id, status, requested_at);
create index if not exists bank_draft_jobs_property_idx
  on public.bank_draft_jobs (property_id, requested_at desc);

alter table public.bank_draft_jobs enable row level security;

drop policy if exists bank_draft_jobs_select on public.bank_draft_jobs;
create policy bank_draft_jobs_select on public.bank_draft_jobs
  for select to authenticated
  using (public.can_manage_office_ads(office_broker_id));

-- 넣는 사람 = 요청자. 매물은 그 사무소 것이고 휴지통에 없고, 내가 고칠 수 있는 것이어야 한다.
drop policy if exists bank_draft_jobs_insert on public.bank_draft_jobs;
create policy bank_draft_jobs_insert on public.bank_draft_jobs
  for insert to authenticated
  with check (
    requested_by = auth.uid()
    and public.can_manage_office_ads(office_broker_id)
    and exists (
      select 1 from public.broker_properties p
      where p.id = property_id
        and p.office_broker_id = office_broker_id
        and p.deleted_at is null
        and public.can_edit_broker_property(p.broker_id)
    )
  );

-- PC 일꾼(대표 계정)이 상태를 적고, 화면에서 대기 중인 것을 취소한다.
drop policy if exists bank_draft_jobs_update on public.bank_draft_jobs;
create policy bank_draft_jobs_update on public.bank_draft_jobs
  for update to authenticated
  using (public.can_manage_office_ads(office_broker_id))
  with check (public.can_manage_office_ads(office_broker_id));

grant select, insert, update on public.bank_draft_jobs to authenticated;

reset lock_timeout;
notify pgrst, 'reload schema';
