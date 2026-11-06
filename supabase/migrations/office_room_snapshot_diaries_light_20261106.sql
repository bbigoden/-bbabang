-- 사무실 화면(20초마다)의 오늘 일지: 사무소 조건 없이 오늘 일지 전부의 원문(sections_content·content)을
-- 보내던 것을, 이 사무소 사람의 '썼는지'만 보내게 줄인다(2026-11-06). RLS 가 걸러도 원문 전체가 매번 실려 왔다.
-- 판정은 화면과 같다: 칸 값 중 공백 아닌 글자가 하나라도 있거나 content 가 비어 있지 않으면 썼다.
-- 화면(office/page.tsx)은 wrote 가 있으면 그걸 쓰고, 없으면(옛 함수) 원문으로 판정한다.
do $$
declare d text; n text;
begin
  d := pg_get_functiondef('public.office_room_snapshot(uuid,boolean)'::regprocedure);
  n := replace(d,
$a$    'diaries', (select coalesce(jsonb_agg(jsonb_build_object('broker_id', d.broker_id, 'sections_content', d.sections_content,
                  'content', d.content, 'updated_at', d.updated_at)), '[]')
                from broker_diary d where d.date = v_today),$a$,
$b$    'diaries', (select coalesce(jsonb_agg(jsonb_build_object('broker_id', d.broker_id, 'wrote', true, 'updated_at', d.updated_at)), '[]')
                from broker_diary d
                where d.date = v_today
                  and d.broker_id in (select b.id from broker_profiles b where b.id = p_office or b.parent_broker_id = p_office)
                  and (coalesce(d.content, '') ~ '\S'
                       or exists (select 1 from jsonb_each(case when jsonb_typeof(d.sections_content) = 'object' then d.sections_content else '{}'::jsonb end) e
                                  where jsonb_typeof(e.value) = 'string' and (e.value #>> '{}') ~ '\S'))),$b$);
  if n = d then raise exception 'office_room_snapshot: diaries pattern not found'; end if;
  execute n;
end $$;
