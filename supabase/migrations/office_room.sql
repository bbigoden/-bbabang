-- 사무실 화면(/broker/office) — 사람 직원·PC 일꾼·Claude 를 한 화면에서 보고 부린다.
--
-- 새로 서는 표 셋:
--   claude_sessions  Claude Code 가 지금 무엇을 하는지. PC 의 hooks 가 파일에 적고, 사무실
--                    일꾼(부소장광고/src/cli/office-worker.js)이 대표 계정으로 여기에 옮긴다.
--   claude_orders    사무실 화면에서 Claude 에게 내린 지시. 같은 일꾼이 집어 PC 에서 Claude 를
--                    돌리고 결과를 적는다. 고친 것은 따로 가지(branch)에만 남기고 올리지 않는다.
--   office_tasks     대표가 직원에게 배정한 할 일. 직원은 자기 것만 보고 [완료] 만 누른다.
--
-- Claude 두 표는 **대표만** 본다. 지시 한 줄이 사장님 PC 에서 프로그램을 돌리는 일이라
-- 직원 권한(매물 편집)을 따라가면 안 된다.
set lock_timeout = '5s';

-- 사무소 대표인가. broker_profiles.is_owner 가 null 인 옛 행은 대표로 본다(화면들과 같은 규칙).
create or replace function public.is_office_owner(office_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.broker_profiles bp
    where bp.id = office_id
      and bp.user_id = auth.uid()
      and bp.is_owner is distinct from false
  )
$$;

-- 사무실 일꾼(office-worker)이 살아 있다고 찍는 칸. 광고 일꾼·뱅크 일꾼과 같은 줄에 칸만 따로 둔다
-- (bank_draft_seen_at 과 같은 생각 — last_seen_at 을 같이 쓰면 광고 일꾼이 켜진 것처럼 보인다).
alter table public.ad_agents
  add column if not exists office_seen_at timestamptz null;

comment on column public.ad_agents.office_seen_at is
  '사무실 일꾼(부소장광고/src/cli/office-worker.js)이 마지막으로 살아 있다고 찍은 시각. 60초 안이면 켜짐.';

-- ── Claude 활동 ─────────────────────────────────────────────
create table if not exists public.claude_sessions (
  session_id text primary key,
  office_broker_id uuid not null references public.broker_profiles(id) on delete cascade,
  project text,
  title text,
  status text not null default 'working'
    check (status in ('working', 'waiting', 'idle', 'ended')),
  last_action text,
  order_id uuid,
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.claude_sessions is
  'Claude Code 세션 하나 = 사무실의 Claude 한 명. hooks → data/claude-events.jsonl → office-worker 가 옮긴다.';
comment on column public.claude_sessions.title is '첫 지시의 앞부분(80자). 비밀번호 같은 것이 섞일 수 있어 길게 담지 않는다.';
comment on column public.claude_sessions.order_id is '사무실 화면의 지시(claude_orders)로 시작된 세션이면 그 지시.';

create index if not exists claude_sessions_office_idx
  on public.claude_sessions (office_broker_id, updated_at desc);

alter table public.claude_sessions enable row level security;

drop policy if exists claude_sessions_owner on public.claude_sessions;
create policy claude_sessions_owner on public.claude_sessions
  for all to authenticated
  using (public.is_office_owner(office_broker_id))
  with check (public.is_office_owner(office_broker_id));

grant select, insert, update, delete on public.claude_sessions to authenticated;

-- ── Claude 에게 지시 ─────────────────────────────────────────
create table if not exists public.claude_orders (
  id uuid primary key default gen_random_uuid(),
  office_broker_id uuid not null references public.broker_profiles(id) on delete cascade,
  prompt text not null check (char_length(prompt) between 2 and 4000),
  status text not null default 'queued'
    check (status in ('queued', 'running', 'done', 'failed', 'canceled')),
  progress text,
  result text,
  branch text,
  error text,
  requested_by uuid default auth.uid() references auth.users(id) on delete set null,
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz not null default now()
);

comment on table public.claude_orders is
  '사무실 화면 → Claude 지시. office-worker 가 queued 를 집어 PC 에서 claude -p 로 돌린다. 고친 것은 branch 에만 남는다(올리지 않음).';

create index if not exists claude_orders_office_idx
  on public.claude_orders (office_broker_id, status, requested_at);

alter table public.claude_orders enable row level security;

drop policy if exists claude_orders_owner on public.claude_orders;
create policy claude_orders_owner on public.claude_orders
  for all to authenticated
  using (public.is_office_owner(office_broker_id))
  with check (public.is_office_owner(office_broker_id));

grant select, insert, update, delete on public.claude_orders to authenticated;

-- ── 직원 할 일 ───────────────────────────────────────────────
create table if not exists public.office_tasks (
  id uuid primary key default gen_random_uuid(),
  office_broker_id uuid not null references public.broker_profiles(id) on delete cascade,
  assignee_broker_id uuid not null references public.broker_profiles(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  note text check (note is null or char_length(note) <= 2000),
  due_date date,
  status text not null default 'open' check (status in ('open', 'done')),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  done_at timestamptz
);

comment on table public.office_tasks is '대표가 직원에게 배정한 할 일. 직원은 자기 것만 보고 완료만 누를 수 있다.';

create index if not exists office_tasks_office_idx on public.office_tasks (office_broker_id, status, created_at desc);
create index if not exists office_tasks_assignee_idx on public.office_tasks (assignee_broker_id, status);

alter table public.office_tasks enable row level security;

-- 담당 직원인가 — 그 사무소에 승인된 직원 본인.
create or replace function public.is_task_assignee(assignee uuid, office_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.broker_profiles bp
    where bp.id = assignee
      and bp.user_id = auth.uid()
      and (bp.id = office_id or (bp.parent_broker_id = office_id and bp.is_approved = true))
  )
$$;

drop policy if exists office_tasks_select on public.office_tasks;
create policy office_tasks_select on public.office_tasks
  for select to authenticated
  using (public.is_office_owner(office_broker_id) or public.is_task_assignee(assignee_broker_id, office_broker_id));

-- 배정할 사람은 그 사무소 사람이어야 한다.
drop policy if exists office_tasks_insert on public.office_tasks;
create policy office_tasks_insert on public.office_tasks
  for insert to authenticated
  with check (
    public.is_office_owner(office_broker_id)
    and exists (
      select 1 from public.broker_profiles bp
      where bp.id = assignee_broker_id
        and (bp.id = office_broker_id or bp.parent_broker_id = office_broker_id)
    )
  );

drop policy if exists office_tasks_update on public.office_tasks;
create policy office_tasks_update on public.office_tasks
  for update to authenticated
  using (public.is_office_owner(office_broker_id) or public.is_task_assignee(assignee_broker_id, office_broker_id))
  with check (public.is_office_owner(office_broker_id) or public.is_task_assignee(assignee_broker_id, office_broker_id));

drop policy if exists office_tasks_delete on public.office_tasks;
create policy office_tasks_delete on public.office_tasks
  for delete to authenticated
  using (public.is_office_owner(office_broker_id));

-- 직원은 완료/되돌리기만 — 제목·담당자를 바꾸지 못하게 한다. RLS 는 줄 단위라 칸을 못 가린다.
create or replace function public.office_tasks_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if public.is_office_owner(old.office_broker_id) then
    return new;
  end if;
  if new.office_broker_id is distinct from old.office_broker_id
    or new.assignee_broker_id is distinct from old.assignee_broker_id
    or new.title is distinct from old.title
    or new.note is distinct from old.note
    or new.due_date is distinct from old.due_date
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at then
    raise exception '직원은 할 일의 완료 여부만 바꿀 수 있습니다' using errcode = '42501';
  end if;
  return new;
end
$$;

drop trigger if exists office_tasks_guard on public.office_tasks;
create trigger office_tasks_guard before update on public.office_tasks
  for each row execute function public.office_tasks_guard();

grant select, insert, update, delete on public.office_tasks to authenticated;

-- 로그인 안 한 사람이 /rpc 로 부를 일이 없다. 정책이 쓰는 두 판별 함수는 로그인한 사람에게만 열고,
-- 방아쇠 함수는 아무도 직접 부르지 못하게 한다.
revoke execute on function public.is_office_owner(uuid) from public, anon;
revoke execute on function public.is_task_assignee(uuid, uuid) from public, anon;
revoke execute on function public.office_tasks_guard() from public, anon, authenticated;

reset lock_timeout;
notify pgrst, 'reload schema';
