-- 업무일지 광고현황 메모를 일지의 다른 칸과 같은 규칙으로 (2026-10-30 사장님).
--
-- 10-29 에는 대표·이사 메모를 모든 직원이 보게 했는데(is_office_lead), 사장님 말은
-- "다른 것들과 같게" — 업무일지는 본인과 대표만 본다(can_access_diary, diary_access_own_or_owner.sql).
-- 그래서 메모도 쓴 사람 본인과 대표만. 이사도 이제 남의 메모를 못 보고, 직원은 이사·대표 메모를 못 본다.
-- 화면(diary-ad-common.tsx)은 이미 일지 주인 메모 한 칸만 그린다. 이건 API 로 직접 읽는 길을 닫는다.
-- 쓰기 정책(office_diary_ad_memos_owner_edit.sql — 자기 메모, 대표는 모두)은 그대로다.

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
      and (me.id = p_author or (me.id = p_office and me.is_owner is true))
  );
$$;

-- 되돌리기:
-- create or replace function public.can_see_ad_memo(p_office uuid, p_author uuid)
--  returns boolean language sql stable security definer set search_path = public, pg_temp
-- as $$
--   select exists (
--     select 1 from public.broker_profiles me
--     where me.user_id = auth.uid()
--       and (me.id = p_office or (me.parent_broker_id = p_office and me.is_approved is true))
--       and (me.id = p_author or public.is_office_lead(p_office, me.id) or public.is_office_lead(p_office, p_author))
--   );
-- $$;
