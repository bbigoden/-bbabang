-- 업무일지는 "그날 있었던 일"의 기록이므로, 고객을 나중에 휴지통으로 보내도
-- 과거 일지에서는 그대로 남아야 한다.
--
-- 문제: broker_customers의 SELECT RLS가 deleted_at IS NULL을 요구해서, 고객을
-- 삭제하는 순간 그 고객이 들어있던 모든 과거 일지에서 동시에 사라졌다.
--
-- RLS 정책을 완화하는 방식은 쓰지 않는다. 정책은 OR로 합쳐지므로 고객관리
-- 목록에까지 휴지통 고객이 되살아나 보이게 된다. 대신 일지 전용 조회 함수를
-- SECURITY DEFINER로 만들어, 이 경로에서만 삭제된 고객을 읽을 수 있게 한다.
-- 권한은 can_view_broker_data로 그대로 강제한다.

create or replace function public.diary_customers_for_date(
  p_broker_id uuid,
  p_date date
)
returns table (
  link_id uuid,
  sort_order integer,
  proposed_property_ids uuid[],
  id uuid,
  client_name text,
  contact text,
  received_date date,
  assignee text,
  category text,
  source text,
  status text,
  request text,
  interest text,
  consult_note text,
  custom_fields jsonb,
  is_deleted boolean
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select
    dc.id,
    dc.sort_order,
    coalesce(dc.proposed_property_ids, '{}'::uuid[]),
    c.id,
    c.client_name,
    c.contact,
    c.received_date,
    c.assignee,
    c.category,
    c.source,
    c.status,
    c.request,
    c.interest,
    c.consult_note,
    c.custom_fields,
    (c.deleted_at is not null)
  from broker_diary_customers dc
  join broker_customers c on c.id = dc.customer_id
  where dc.broker_id = p_broker_id
    and dc.diary_date = p_date
    and public.can_view_broker_data(p_broker_id)   -- 권한 확인은 그대로 유지
  order by dc.sort_order;
$$;

revoke all on function public.diary_customers_for_date(uuid, date) from public, anon;
grant execute on function public.diary_customers_for_date(uuid, date) to authenticated;

comment on function public.diary_customers_for_date(uuid, date) is
  '업무일지 한 날짜의 고객 행. 휴지통(soft delete)된 고객도 is_deleted=true로 함께 반환한다 — 과거 일지는 그날의 기록이므로 보존되어야 하기 때문. 권한은 can_view_broker_data로 강제.';
