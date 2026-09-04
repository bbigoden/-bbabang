-- 네이버부동산 신규매물 감시. (원격 적용 완료 — Supabase MCP)
--
-- 네이버부동산 화면에는 '최신순'이 없어 새로 올라온 매물을 손으로 찾아다녀야 했다.
-- 내부 API에는 최신순(DATE_DESC)이 있어서, 그것으로 천안·아산 매물을 주기적으로
-- 받아 여기 쌓는다. 이 표가 곧 "네이버에 없는 최신순 목록"이다.
--
-- **링크를 고르는 데 필요한 것만 담는다.** 응답에는 가격·면적·사진도 들어 있지만
-- 저장하지 않는다 — 화면은 링크 목록이고, 값은 눌러 들어가서 직접 본다.
--
-- 매물번호(article_no)가 원본의 열쇠다. 같은 매물이 재등록되면 네이버의
-- exposure_start_date 는 오늘로 바뀌지만 first_seen_at 은 처음 본 날 그대로 남는다.
-- 그래서 '진짜 처음 보는 매물'과 '재등록된 매물'을 화면에서 구분할 수 있다.
create table if not exists public.naver_articles (
  article_no            text primary key,
  -- 네이버 코드 그대로 둔다(D02=상가, E02=공장/창고 …). 이름으로 바꿔 저장하면
  -- 네이버가 분류를 바꿨을 때 무엇이 원본이었는지 알 수 없게 된다.
  real_estate_type      text not null,
  trade_type            text not null,
  division              text,
  sector                text,
  -- 우리 사무소가 올린 매물을 빼는 데만 쓴다. 화면에는 안 적는다.
  brokerage_name        text,
  -- 네이버가 광고를 노출하기 시작한 날. 재등록하면 갱신된다.
  exposure_start_date   date,
  -- 우리가 이 매물을 처음 받은 시각. 네이버가 날짜를 갱신해도 바뀌지 않는다.
  first_seen_at         timestamptz not null default now(),
  last_seen_at          timestamptz not null default now(),
  -- 받아 뒀던 매물이 네이버에서 내려간 시각. 거래됐거나 광고를 접은 것이다.
  gone_at               timestamptz
);

create index if not exists naver_articles_exposure_idx on public.naver_articles (exposure_start_date desc);
create index if not exists naver_articles_first_seen_idx on public.naver_articles (first_seen_at desc);
create index if not exists naver_articles_division_idx on public.naver_articles (division);
create index if not exists naver_articles_type_idx on public.naver_articles (real_estate_type);
create index if not exists naver_articles_gone_idx on public.naver_articles (gone_at);

alter table public.naver_articles enable row level security;

-- 공개된 네이버 광고를 옮겨 적은 것이라 사무소별로 나눌 것이 없다. 다만 중개사
-- 업무 화면에서만 쓰므로 승인된 중개사에게만 열어 둔다.
--
-- 쓰기도 중개사에게 연다. 수집을 사장님 PC의 광고 프로그램이 하기 때문이다 —
-- 네이버가 데이터센터 IP를 막아 Vercel 에서는 부를 수 없다(다섯 번 다 60초 타임아웃).
drop policy if exists naver_articles_select on public.naver_articles;
create policy naver_articles_select on public.naver_articles
  for select to authenticated
  using (exists (select 1 from public.broker_profiles bp
                 where bp.user_id = auth.uid() and bp.is_approved));

drop policy if exists naver_articles_insert on public.naver_articles;
create policy naver_articles_insert on public.naver_articles
  for insert to authenticated
  with check (exists (select 1 from public.broker_profiles bp
                      where bp.user_id = auth.uid() and bp.is_approved));

drop policy if exists naver_articles_update on public.naver_articles;
create policy naver_articles_update on public.naver_articles
  for update to authenticated
  using (exists (select 1 from public.broker_profiles bp
                 where bp.user_id = auth.uid() and bp.is_approved));

-- 오래된 매물 정리도 그 프로그램이 한다. 지우기 정책이 없으면 RLS 가 조용히 막아
-- 0건이 지워진다(오류도 안 난다).
drop policy if exists naver_articles_delete on public.naver_articles;
create policy naver_articles_delete on public.naver_articles
  for delete to authenticated
  using (exists (select 1 from public.broker_profiles bp
                 where bp.user_id = auth.uid() and bp.is_approved));

-- 누가 무엇을 눌러 봤는가.
--
-- **사람마다 따로 센다.** 사무소 단위로 세면 한 사람이 훑고 나면 다른 사람 화면에서
-- 통째로 사라진다. 각자 아침에 자기 몫을 훑는 화면이라 그러면 못 쓴다.
create table if not exists public.naver_article_views (
  user_id    uuid not null references auth.users(id) on delete cascade,
  article_no text not null references public.naver_articles(article_no) on delete cascade,
  seen_at    timestamptz not null default now(),
  primary key (user_id, article_no)
);

alter table public.naver_article_views enable row level security;

drop policy if exists naver_views_own on public.naver_article_views;
create policy naver_views_own on public.naver_article_views
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- 켜고 끄는 것들. 사무소당 한 줄이다.
--
-- '사라진 매물 표시' 는 수집 쪽 일이라(광고 프로그램이 읽어 움직인다) 화면 혼자
-- 정할 수 없어 여기 둔다. '우리 사무소 매물 빼기' 는 화면에서만 쓰지만, 사무소
-- 사람 모두에게 같이 걸리는 것이 맞아 함께 둔다.
create table if not exists public.naver_settings (
  broker_id   uuid primary key references public.broker_profiles(id) on delete cascade,
  hide_own    boolean not null default false,
  track_gone  boolean not null default false,
  updated_at  timestamptz not null default now()
);

alter table public.naver_settings enable row level security;

drop policy if exists naver_settings_rw on public.naver_settings;
create policy naver_settings_rw on public.naver_settings
  for all to authenticated
  using (can_view_broker_property(broker_id))
  with check (can_edit_broker_property(broker_id));
