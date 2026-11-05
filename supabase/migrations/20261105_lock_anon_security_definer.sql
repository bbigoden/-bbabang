-- 2026-11-05 보안 경고 정리 (사장님 "보안 경고 나머지도 정리해")
--
-- 1) 로그인 안 한 사람(anon)이 SECURITY DEFINER 함수를 부를 수 있던 것 막기.
--    이 함수들은 RLS 정책 안에서 불리는데, 정책 대상이 'public'(=anon 포함)이라
--    EXECUTE 만 빼면 anon 조회가 '빈 결과' 대신 '권한 오류'가 된다.
--    정책 조건이 모두 로그인(auth.uid())을 전제로 하므로 대상만 authenticated 로 좁힌다
--    → 로그인한 사람에게는 변화 없음, anon 은 원래처럼 아무것도 못 본다.
-- 2) profiles_visible 뷰: anon SELECT 회수. (뷰 자체는 이메일·전화 가리는 장치라
--    SECURITY DEFINER 를 유지해야 한다 — profiles 의 email/phone/admin_note 는
--    authenticated 에 열 권한이 없다.)
-- 3) is_office_lead: search_path 고정.

-- 1-a) 정책 대상 public → authenticated
do $$
declare r record;
begin
  for r in
    select schemaname, tablename, policyname
    from pg_policies
    where roles && array['public','anon']::name[]
      and (coalesce(qual,'') || coalesce(with_check,'')) ~
          '(can_access_office_thread|can_manage_office_ads|is_admin_user|is_office_member|my_visible_broker_ids|office_res_can_)'
  loop
    execute format('alter policy %I on %I.%I to authenticated', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

-- 1-b) RLS·RPC 용 함수: anon/public 실행권 회수, 로그인 사용자는 유지
revoke execute on function public.can_access_office_thread(uuid)        from public, anon;
revoke execute on function public.can_manage_office_ads(uuid)           from public, anon;
revoke execute on function public.can_view_bids()                       from public, anon;
revoke execute on function public.can_view_broker_property(uuid)        from public, anon;
revoke execute on function public.is_admin_user()                       from public, anon;
revoke execute on function public.is_office_director(uuid)              from public, anon;
revoke execute on function public.is_office_member(uuid)                from public, anon;
revoke execute on function public.my_visible_broker_ids()               from public, anon;
revoke execute on function public.office_res_can_insert(uuid, uuid)     from public, anon;
revoke execute on function public.office_res_can_manage(uuid, uuid)     from public, anon;
revoke execute on function public.office_res_can_view(uuid, uuid)       from public, anon;
grant  execute on function public.can_access_office_thread(uuid)        to authenticated, service_role;
grant  execute on function public.can_manage_office_ads(uuid)           to authenticated, service_role;
grant  execute on function public.can_view_bids()                       to authenticated, service_role;
grant  execute on function public.can_view_broker_property(uuid)        to authenticated, service_role;
grant  execute on function public.is_admin_user()                       to authenticated, service_role;
grant  execute on function public.is_office_director(uuid)              to authenticated, service_role;
grant  execute on function public.is_office_member(uuid)                to authenticated, service_role;
grant  execute on function public.my_visible_broker_ids()               to authenticated, service_role;
grant  execute on function public.office_res_can_insert(uuid, uuid)     to authenticated, service_role;
grant  execute on function public.office_res_can_manage(uuid, uuid)     to authenticated, service_role;
grant  execute on function public.office_res_can_view(uuid, uuid)       to authenticated, service_role;

-- 1-c) 트리거 전용 함수: 직접 부를 일이 없다 (트리거 실행엔 EXECUTE 권한 불필요)
revoke execute on function public.log_property_text_change()   from public, anon, authenticated;
revoke execute on function public.office_res_personal_folder() from public, anon, authenticated;

-- 2) profiles_visible: anon 읽기 회수
revoke select on public.profiles_visible from anon;

-- 3) is_office_lead search_path 고정
alter function public.is_office_lead(uuid, uuid) set search_path = public;
