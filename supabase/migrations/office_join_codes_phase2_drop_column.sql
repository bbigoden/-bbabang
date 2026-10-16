-- ─────────────────────────────────────────────────────────────────────────────
-- 사무소 합류 코드 옮기기 (2단계): 옛 칸 broker_profiles.office_code 삭제
-- ─────────────────────────────────────────────────────────────────────────────
-- 언제: office_join_codes_phase1.sql 적용 → 새 앱(rpc 로 코드 조회·재발급) 배포가 끝난 뒤.
--    옛 앱이 아직 떠 있으면 가입 화면 미리보기·코드 카드가 없는 칸을 찾다 실패한다.
--
-- 왜: 1단계 뒤로 이 칸은 늘 NULL 이고(트리거가 비운다), 코드는 office_join_codes 에만 있다.
--    남겨 두면 누군가 다시 이 칸에 의미를 붙이거나, 트리거를 지우는 순간 코드가 다시
--    모두에게 읽히는 칸으로 돌아간다 → 칸 자체를 없앤다.
--
-- 이 칸에 걸린 것(2026-10-16 확인)
--   - 유니크 제약 broker_profiles_office_code_key (+ 같은 이름의 유니크 인덱스)
--       → 칸과 함께 자동으로 사라진다. pg_depend 상 이 칸에 걸린 건 이 제약 하나뿐.
--   - 컬럼 권한(anon INSERT/UPDATE/REFERENCES, authenticated SELECT/INSERT/UPDATE/REFERENCES)
--       → 칸과 함께 사라진다.
--   - 뷰·구체화 뷰·RLS 정책: 이 칸을 쓰는 것 없음.
--   - 함수: join_office_by_code(1단계에서 office_join_codes 로 바꿈),
--           office_code_legacy_redirect(1단계 임시 트리거 함수 — 아래에서 지운다).
--       plpgsql 본문은 의존성으로 안 잡혀서 칸을 먼저 지우면 트리거가 런타임에 깨진다
--       → 트리거·함수를 먼저 지운다.
--   - 앱: broker_profiles 를 select('*') 로 읽는 곳은 칸이 없어져도 그대로 동작한다.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1단계 없이 이 파일만 돌면 코드가 통째로 사라진다 → 먼저 확인하고 아니면 멈춘다.
set local lock_timeout = '5s';
do $$
declare
  v_left boolean;
begin
  if to_regclass('public.office_join_codes') is null then
    raise exception '1단계(office_join_codes_phase1.sql)가 아직 적용되지 않았다';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'broker_profiles' and column_name = 'office_code'
  ) then
    execute 'select exists (select 1 from public.broker_profiles where office_code is not null)' into v_left;
    if v_left then
      raise exception 'broker_profiles.office_code 에 아직 값이 남아 있다 — 1단계 트리거를 확인할 것';
    end if;
  end if;
end $$;

drop trigger if exists trg_office_code_legacy_redirect on public.broker_profiles;
drop function if exists public.office_code_legacy_redirect();

-- 트리거 함수까지 지운 뒤에도 이 칸 이름을 본문에 가진 함수가 있으면 칸 삭제 뒤 런타임에 깨진다.
do $$
declare
  v_names text;
begin
  select string_agg(n.nspname || '.' || p.proname, ', ') into v_names
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname not in ('pg_catalog', 'information_schema')
    and p.prosrc ilike '%office_code%';
  if v_names is not null then
    raise exception '아직 office_code 를 쓰는 함수가 있다: %', v_names;
  end if;
end $$;

alter table public.broker_profiles drop column if exists office_code;

notify pgrst, 'reload schema';
