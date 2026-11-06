-- 안 쓰는 DB 개체 정리 (2026-11-06 점검). 두 레포(부소장·부소장광고)·함수·정책·뷰·크론 어디서도 안 부른다.
-- 되살릴 때는 아래 [원래 정의] 를 그대로 다시 실행하면 된다.

-- 1) 함수 3개
--   is_my_broker: 걷어낸 견적서 기능의 잔재
--   is_office_lead: 정책·함수 어디서도 안 부름
--   mask_address_public: 이걸 쓰던 공개 뷰가 없어짐
drop function if exists public.is_my_broker(uuid);
drop function if exists public.is_office_lead(uuid, uuid);
drop function if exists public.mask_address_public(text, text);

-- 2) 한 번도 안 쓴 인덱스 (4월 말부터 idx_scan 0). 외래키를 받치는 인덱스는 지우지 않는다(부모 행 삭제가 느려짐).
drop index if exists public.bid_results_bids_todo_idx;      -- bids_at 로 거르는 조회 없음, 496kB
drop index if exists public.idx_broker_properties_latlng;   -- 좌표 범위 조회 없음
drop index if exists public.idx_broker_alert_regions;       -- alert_regions 로 거르는 조회 없음
drop index if exists public.profiles_account_status_idx;    -- 14행 표

-- 3) profiles.avatar_url — 전부 NULL, 코드 참조 0. profiles_visible 뷰가 이 열을 담고 있어
--    뷰를 다시 만든다(열만 빼고 정의·옵션·권한 그대로).
drop view public.profiles_visible;
alter table public.profiles drop column avatar_url;
create view public.profiles_visible with (security_invoker = false) as
 SELECT id,
    name,
    role,
    created_at,
    notification_preferences,
    account_status,
    suspended_until,
    referral_code,
    referred_by,
        CASE
            WHEN id = auth.uid() OR (EXISTS ( SELECT 1
               FROM profiles me
              WHERE me.id = auth.uid() AND me.role = 'admin'::text)) OR can_notify_user(id) THEN email
            ELSE NULL::text
        END AS email,
        CASE
            WHEN id = auth.uid() OR (EXISTS ( SELECT 1
               FROM profiles me
              WHERE me.id = auth.uid() AND me.role = 'admin'::text)) OR can_notify_user(id) THEN phone
            ELSE NULL::text
        END AS phone,
        CASE
            WHEN (EXISTS ( SELECT 1
               FROM profiles me
              WHERE me.id = auth.uid() AND me.role = 'admin'::text)) THEN admin_note
            ELSE NULL::text
        END AS admin_note
   FROM profiles p;
revoke all on public.profiles_visible from public, anon, authenticated;
grant select on public.profiles_visible to authenticated;
grant all on public.profiles_visible to service_role;

/* [원래 정의]
CREATE OR REPLACE FUNCTION public.is_my_broker(p_broker uuid) RETURNS boolean LANGUAGE sql STABLE
 SET search_path TO 'public', 'pg_temp' AS $f$
  SELECT EXISTS (SELECT 1 FROM broker_profiles bp WHERE bp.id = p_broker AND bp.user_id = auth.uid());
$f$;
CREATE OR REPLACE FUNCTION public.is_office_lead(p_office uuid, p_broker uuid) RETURNS boolean LANGUAGE sql IMMUTABLE
 SET search_path TO 'public' AS $f$
  select p_broker = p_office or p_broker = '6581efd5-6ec9-46ea-a391-7e6537cc6345'::uuid
$f$;
-- mask_address_public: supabase/migrations/p0_20261015_views_signup_settlements_address.sql 참고
CREATE INDEX bid_results_bids_todo_idx ON public.bid_results USING btree (openg_at DESC) WHERE (bids_at IS NULL);
CREATE INDEX idx_broker_properties_latlng ON public.broker_properties USING btree (lat, lng) WHERE ((lat IS NOT NULL) AND (lng IS NOT NULL));
CREATE INDEX idx_broker_alert_regions ON public.broker_profiles USING gin (alert_regions);
CREATE INDEX profiles_account_status_idx ON public.profiles USING btree (account_status);
ALTER TABLE public.profiles ADD COLUMN avatar_url text;  -- 그리고 뷰에 avatar_url 다시 넣기
*/
