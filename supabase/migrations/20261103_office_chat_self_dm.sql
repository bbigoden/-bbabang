-- 나와의 채팅(카톡처럼) — 나 자신과의 1:1 방을 허용한다.
-- dm_key 는 '<내 id>__<내 id>', 멤버는 나 한 명. 그 밖에는 기존 get_or_create_dm 과 같다.
create or replace function public.get_or_create_dm(p_office uuid, p_other uuid)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_me uuid;
  v_key text;
  v_thread uuid;
begin
  select id into v_me from broker_profiles
   where user_id = auth.uid()
     and (id = p_office or (parent_broker_id = p_office and is_approved = true))
   limit 1;
  if v_me is null then raise exception 'caller not in office'; end if;

  perform 1 from broker_profiles
   where id = p_other
     and (id = p_office or (parent_broker_id = p_office and is_approved = true));
  if not found then raise exception 'other not in office'; end if;

  if v_me::text < p_other::text then
    v_key := v_me::text || '__' || p_other::text;
  else
    v_key := p_other::text || '__' || v_me::text;
  end if;

  select id into v_thread from office_chat_threads where dm_key = v_key;
  if v_thread is null then
    insert into office_chat_threads (office_broker_id, kind, dm_key)
      values (p_office, 'dm', v_key)
      on conflict (dm_key) where kind = 'dm' do nothing
      returning id into v_thread;
    if v_thread is null then
      select id into v_thread from office_chat_threads where dm_key = v_key;
    end if;
  end if;

  insert into office_chat_members (thread_id, broker_id)
    select v_thread, x from (select distinct unnest(array[v_me, p_other]) as x) s
    on conflict (thread_id, broker_id) do nothing;

  return v_thread;
end;
$function$;
