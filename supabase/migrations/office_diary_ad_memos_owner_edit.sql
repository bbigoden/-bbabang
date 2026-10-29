-- 업무일지 광고현황 메모 — 대표는 모두의 메모를 고칠 수 있다 (2026-10-29 사장님).
-- 직원은 그대로 자기 메모만. 대표가 직원 메모를 고쳐도 author_id 는 그 직원으로 남는다
-- (그 사람 일지의 칸이므로). 사무소 밖 사람 이름으로는 못 쓴다.
drop policy if exists office_diary_ad_memos_write on public.office_diary_ad_memos;
create policy office_diary_ad_memos_write on public.office_diary_ad_memos
  for all to authenticated
  using (
    public.is_office_member(office_id)
    and (author_id in (select id from public.broker_profiles where user_id = auth.uid())
         or public.is_office_owner(office_id))
  )
  with check (
    public.is_office_member(office_id)
    and (author_id in (select id from public.broker_profiles where user_id = auth.uid())
         or (public.is_office_owner(office_id)
             and author_id in (select id from public.broker_profiles where id = office_id or parent_broker_id = office_id)))
  );
