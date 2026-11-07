-- 11-07 사장님: 사무소 정보(대표 행)는 이사에게서 뺀다. 직원 관리는 그대로 이사도 한다.
-- director_manage_team_20261107 에서 넣은 is_office_director(broker_profiles.id) 한 줄만 걷어낸다.
drop policy if exists broker_profiles_update on public.broker_profiles;
create policy broker_profiles_update on public.broker_profiles for update using (
  (select auth.uid()) = user_id
  or exists (select 1 from public.broker_profiles owner
             where owner.user_id = (select auth.uid()) and owner.is_owner = true
               and owner.id = broker_profiles.parent_broker_id)
  or public.is_office_director(broker_profiles.parent_broker_id)
  or exists (select 1 from public.profiles where profiles.id = (select auth.uid()) and profiles.role = 'admin')
);
