-- 견적서·준비중 메뉴(메신저·일정·구인)·고객용 화면(요청·제안·채팅·리뷰·찜 등)을 코드에서 걷어낸 뒤(3aafb2a)
-- 남은 테이블·함수·트리거·저장소 권한을 정리한다. 2026-10-30 사장님 승인('전부 정리해').
--
-- 지우기 전에 데이터는 archive_20261030 스키마로 옮겨 둔다 — API(PostgREST)에 노출되지 않는 스키마라
-- 앱에서는 보이지 않고, 되살릴 땐 여기서 꺼낸다. 함수 정의는 git 의 이전 마이그레이션에 있다.

-- 1) 백업 ─────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS archive_20261030;
REVOKE ALL ON SCHEMA archive_20261030 FROM PUBLIC, anon, authenticated;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'estimate_attachments','estimate_clients','estimate_companies','estimate_invoices','estimate_item_catalog',
    'estimate_items','estimate_mail_settings','estimate_sends','estimate_shares','estimate_templates','estimates',
    'office_chat_members','office_chat_messages','office_chat_threads','chat_rooms','chat_messages','favorites',
    'view_history','saved_searches','site_curations','office_events','job_posts','property_price_history',
    'quick_replies','administrative_regions','request_posts','proposals','reviews'
  ] LOOP
    EXECUTE format('CREATE TABLE IF NOT EXISTS archive_20261030.%I AS TABLE public.%I', t, t);
  END LOOP;
END $$;

-- 2) 남기는 함수에서 고객 쪽 갈래를 뺀다 ────────────────────
-- 알림 보내기 권한(notifications_insert 정책이 쓴다): 같은 사무소 사람끼리만 남긴다
CREATE OR REPLACE FUNCTION public.can_notify_user(p_target_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from public.broker_profiles bp1
    join public.broker_profiles bp2
      on coalesce(bp1.parent_broker_id, bp1.id) = coalesce(bp2.parent_broker_id, bp2.id)
    where bp1.user_id = auth.uid()
      and bp2.user_id = p_target_user_id
      and (bp1.parent_broker_id is null or bp1.is_approved = true)
      and (bp2.parent_broker_id is null or bp2.is_approved = true or bp2.parent_broker_id = bp1.id)
  );
$function$;

-- 직원이 나갈 때 자료를 대표에게 넘긴다: 고객 채팅·제안·리뷰 넘기기만 뺐다
CREATE OR REPLACE FUNCTION public.transfer_broker_data(from_broker_id uuid, to_broker_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  departing_name text;
  owner_name text;
  caller_broker_id uuid;
  from_parent uuid;
  from_approved boolean;
begin
  if auth.uid() is null then raise exception 'unauthorized: not authenticated'; end if;
  select id into caller_broker_id from broker_profiles where user_id = auth.uid() limit 1;
  if caller_broker_id is null then raise exception 'unauthorized: no broker profile'; end if;

  select parent_broker_id, is_approved into from_parent, from_approved
  from broker_profiles where id = from_broker_id;
  if from_parent is null then raise exception 'invalid: from_broker_id is not an office employee'; end if;
  if caller_broker_id <> from_broker_id and caller_broker_id <> from_parent then
    raise exception 'unauthorized: caller is neither the broker nor their office owner';
  end if;
  if to_broker_id <> from_parent then raise exception 'unauthorized: target must be the office owner'; end if;
  if from_approved is not true then return; end if;

  set local session_replication_role = 'replica';

  select p.name into departing_name from broker_profiles b left join profiles p on p.id = b.user_id where b.id = from_broker_id;
  select p.name into owner_name from broker_profiles b left join profiles p on p.id = b.user_id where b.id = to_broker_id;

  insert into broker_diary_archive (
    office_broker_id, author_broker_id, author_name,
    date, title, content, work_summary, ad_status, suggestions, delivery_notes, sections_content,
    original_created_at, original_updated_at
  )
  select to_broker_id, from_broker_id, departing_name,
    date, title, content, work_summary, ad_status, suggestions, delivery_notes, sections_content,
    created_at, updated_at
  from broker_diary where broker_id = from_broker_id;
  delete from broker_diary where broker_id = from_broker_id;

  insert into broker_diary_customers_archive (
    office_broker_id, author_broker_id, author_name,
    diary_date, customer_id, customer_name, customer_contact, sort_order, proposed_property_ids
  )
  select to_broker_id, from_broker_id, departing_name,
    dc.diary_date, dc.customer_id, c.client_name, c.contact, dc.sort_order, dc.proposed_property_ids
  from broker_diary_customers dc
  left join broker_customers c on c.id = dc.customer_id
  where dc.broker_id = from_broker_id;
  delete from broker_diary_customers where broker_id = from_broker_id;

  update broker_customers  set broker_id = to_broker_id where broker_id = from_broker_id;
  update broker_properties set broker_id = to_broker_id where broker_id = from_broker_id;

  if departing_name is not null and owner_name is not null and departing_name <> owner_name then
    update broker_customers set assignee = departing_name || ', ' || owner_name
      where broker_id = to_broker_id and assignee = departing_name;
    update broker_properties set assignee = departing_name || ', ' || owner_name
      where broker_id = to_broker_id and assignee = departing_name;
  end if;
end;
$function$;

-- 3) 매물목록에 붙어 매번 돌던 고객 알림 트리거 ───────────────
DROP TRIGGER IF EXISTS trg_notify_matching_customers ON public.broker_properties;
DROP TRIGGER IF EXISTS trg_track_property_price ON public.broker_properties;

-- 4) 저장소 권한(지울 함수를 부른다). 버킷·파일은 API 로만 지울 수 있어 남긴다 — 권한이 없으니 아무도 못 연다
DROP POLICY IF EXISTS office_chat_img_select ON storage.objects;
DROP POLICY IF EXISTS office_chat_img_insert ON storage.objects;
DROP POLICY IF EXISTS office_chat_img_delete ON storage.objects;
DROP POLICY IF EXISTS chat_images_select ON storage.objects;
DROP POLICY IF EXISTS chat_images_insert ON storage.objects;
DROP POLICY IF EXISTS chat_images_delete ON storage.objects;
DROP POLICY IF EXISTS estimate_stamps_read ON storage.objects;
DROP POLICY IF EXISTS estimate_stamps_write ON storage.objects;
DROP POLICY IF EXISTS estimate_stamps_update ON storage.objects;
DROP POLICY IF EXISTS estimate_stamps_delete ON storage.objects;
DROP POLICY IF EXISTS estimate_files_read ON storage.objects;
DROP POLICY IF EXISTS estimate_files_write ON storage.objects;
DROP POLICY IF EXISTS estimate_files_delete ON storage.objects;

-- 5) 테이블 ───────────────────────────────────────────
DROP TABLE IF EXISTS
  public.estimate_attachments, public.estimate_sends, public.estimate_shares, public.estimate_invoices,
  public.estimate_items, public.estimates, public.estimate_clients, public.estimate_companies,
  public.estimate_item_catalog, public.estimate_mail_settings, public.estimate_templates,
  public.office_chat_messages, public.office_chat_members, public.office_chat_threads,
  public.chat_messages, public.chat_rooms, public.reviews, public.proposals, public.request_posts,
  public.favorites, public.view_history, public.saved_searches, public.site_curations,
  public.office_events, public.job_posts, public.property_price_history, public.quick_replies,
  public.administrative_regions;

-- 6) 함수 ─────────────────────────────────────────────
DROP FUNCTION IF EXISTS
  public.can_access_chat_image(text),
  public.can_access_office_chat_object(text),
  public.can_access_office_thread(uuid),
  public.create_team_thread(uuid, text, uuid[]),
  public.get_or_create_dm(uuid, uuid),
  public.office_chat_unread_count(),
  public.get_public_request_feed(text, text, text, text, integer, integer),
  public.recommend_brokers_for_request(uuid, integer),
  public.recommend_requests_for_broker(uuid, integer),
  public.refresh_broker_metrics(uuid),
  public.get_shared_estimate(text),
  public.next_estimate_no(uuid),
  public.next_invoice_no(uuid),
  public.replace_estimate_items(uuid, jsonb),
  public.sync_estimate_catalog(jsonb),
  public.notify_matching_customers_on_property(),
  public.track_property_price_change(),
  public.estimates_touch_updated_at(),
  public.office_events_touch_updated_at(),
  public.fn_notify_new_proposal(),
  public.fn_notify_proposal_accepted(),
  public.handle_proposal_accepted(),
  public.handle_proposal_completed(),
  public.notify_matching_brokers_on_request(),
  public.sync_request_proposal_count(),
  public.touch_proposal_stage_updated_at();
