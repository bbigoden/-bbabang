-- 업무일지 옛 형식 칸 4개 삭제 (2026-11-06 운영 적용). 182줄 전부 NULL 이었다.
-- 이 칸을 부르던 함수 두 개에서 이름만 뺀 뒤 지운다:
--   office_room_snapshot — 사무실 화면 '일지 썼나' 판정에 work_summary 를 같이 실어 보냈다
--   transfer_broker_data — 퇴사 직원 일지를 broker_diary_archive 로 옮길 때 네 칸을 같이 복사했다
--     (보관본 표 broker_diary_archive 의 같은 칸은 그대로 둔다 — 옛 보관본에 값이 있을 수 있다)
do $$
declare d text; n text;
begin
  d := pg_get_functiondef('public.office_room_snapshot(uuid,boolean)'::regprocedure);
  n := replace(d, '''work_summary'', d.work_summary, ', '');
  if n = d then raise exception 'office_room_snapshot: pattern not found'; end if;
  execute n;
  d := pg_get_functiondef('public.transfer_broker_data(uuid,uuid)'::regprocedure);
  n := replace(replace(d,
    'date, title, content, work_summary, ad_status, suggestions, delivery_notes, sections_content,
    original_created_at',
    'date, title, content, sections_content,
    original_created_at'),
    'date, title, content, work_summary, ad_status, suggestions, delivery_notes, sections_content,
    created_at',
    'date, title, content, sections_content,
    created_at');
  if n = d or n ~ 'work_summary' then raise exception 'transfer_broker_data: pattern not replaced'; end if;
  execute n;
end $$;
alter table public.broker_diary drop column work_summary, drop column ad_status, drop column suggestions, drop column delivery_notes;
