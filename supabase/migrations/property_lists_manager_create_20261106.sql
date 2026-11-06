-- 대표·이사가 직원(이사) 이름으로 리스트를 만든다 (2026-11-06)
-- 대표 아이디로 드롭다운에서 이사·직원을 고르고 [만들기] 를 눌렀는데 대표 리스트로 만들어졌다.
-- 본인 이름은 누구나, 다른 재직자 이름은 대표·이사만. 이름 바꾸기 때 주인을 사무소 밖 사람으로 바꾸는 것도 막는다.

create or replace function public.property_list_owner_ok(p_office uuid, p_owner uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select public.office_res_can_insert(p_office, p_owner)
      or (public.office_res_can_manage(p_office, p_owner)
          and exists (select 1 from broker_profiles bp
                      where bp.id = p_owner
                        and (bp.id = p_office or (bp.parent_broker_id = p_office and bp.is_approved = true))))
$$;

drop policy if exists property_lists_insert on public.property_lists;
create policy property_lists_insert on public.property_lists for insert
  with check (public.property_list_owner_ok(office_broker_id, created_by));

drop policy if exists property_lists_update on public.property_lists;
create policy property_lists_update on public.property_lists for update
  using (public.office_res_can_manage(office_broker_id, created_by))
  with check (public.property_list_owner_ok(office_broker_id, created_by));
