-- 당근부동산 매물수집. (원격 적용 완료 — Supabase MCP)
--
-- 당근도 네이버와 같다 — 최신순 정렬이 없어 새로 올라온 것을 손으로 찾아야 했다.
-- 다만 성격이 달라(네이버는 중개사 광고, 당근은 직거래가 섞인다) 따로 쌓고 따로 본다.
--
-- **당근은 날짜를 안 준다.** 응답에 등록일·수정일이 아예 없다. 대신 목록이 '최근
-- 활동순' 이라 새 매물이 위에 온다. 그래서 언제 올라왔는지는 우리가 처음 본 날
-- (first_seen_at)로만 안다 — 네이버에서도 결국 그게 진짜 기준이었다.
create table if not exists public.daangn_articles (
  -- 당근 매물번호. 링크가 realty.daangn.com/articles/{이 번호} 다.
  article_no      text primary key,
  -- 당근 코드 그대로 둔다 (STORE=상가, OFFICE=사무실, BUILDING=건물,
  -- FACTORY=공장/창고, LAND=토지).
  sales_type      text not null,
  -- MONTH(월세) · YEAR(전세) · BUY(매매) · SHORT(단기)
  trade_type      text,
  division        text,
  sector          text,
  writer_name     text,
  first_seen_at   timestamptz not null default now(),
  last_seen_at    timestamptz not null default now(),
  gone_at         timestamptz
);

create index if not exists daangn_articles_first_seen_idx on public.daangn_articles (first_seen_at desc);
create index if not exists daangn_articles_division_idx on public.daangn_articles (division);
create index if not exists daangn_articles_type_idx on public.daangn_articles (sales_type);
create index if not exists daangn_articles_gone_idx on public.daangn_articles (gone_at);

alter table public.daangn_articles enable row level security;

-- naver_articles 와 같다 — 승인된 중개사에게 읽기·쓰기를 연다.
-- 받아오는 일은 사장님 PC의 광고 프로그램이 한다.
do $$ declare op text; begin
  foreach op in array array['select','insert','update','delete'] loop
    execute format('drop policy if exists daangn_articles_%s on public.daangn_articles', op);
  end loop;
end $$;
create policy daangn_articles_select on public.daangn_articles for select to authenticated
  using (exists (select 1 from public.broker_profiles bp where bp.user_id = auth.uid() and bp.is_approved));
create policy daangn_articles_insert on public.daangn_articles for insert to authenticated
  with check (exists (select 1 from public.broker_profiles bp where bp.user_id = auth.uid() and bp.is_approved));
create policy daangn_articles_update on public.daangn_articles for update to authenticated
  using (exists (select 1 from public.broker_profiles bp where bp.user_id = auth.uid() and bp.is_approved));
create policy daangn_articles_delete on public.daangn_articles for delete to authenticated
  using (exists (select 1 from public.broker_profiles bp where bp.user_id = auth.uid() and bp.is_approved));

-- 본 것은 사람마다 따로 센다. naver_article_views 와 같은 이유다.
create table if not exists public.daangn_article_views (
  user_id    uuid not null references auth.users(id) on delete cascade,
  article_no text not null references public.daangn_articles(article_no) on delete cascade,
  seen_at    timestamptz not null default now(),
  primary key (user_id, article_no)
);
alter table public.daangn_article_views enable row level security;
drop policy if exists daangn_views_own on public.daangn_article_views;
create policy daangn_views_own on public.daangn_article_views for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 켜고 끄는 것들을 곳(source)별로 둔다. naver_settings 를 여기로 옮기고 그 표는 지웠다.
create table if not exists public.collect_settings (
  broker_id   uuid not null references public.broker_profiles(id) on delete cascade,
  source      text not null,          -- 'naver' | 'daangn'
  hide_own    boolean not null default false,
  track_gone  boolean not null default false,
  updated_at  timestamptz not null default now(),
  primary key (broker_id, source)
);
alter table public.collect_settings enable row level security;
drop policy if exists collect_settings_rw on public.collect_settings;
create policy collect_settings_rw on public.collect_settings for all to authenticated
  using (can_view_broker_property(broker_id)) with check (can_edit_broker_property(broker_id));

-- 매물수집 화면의 [가져오기] 가 곳마다 따로 작업을 넣는다.
alter table public.ad_jobs drop constraint if exists ad_jobs_kind_check;
alter table public.ad_jobs add constraint ad_jobs_kind_check
  check (kind = any (array['sync', 'publish', 'takedown', 'renew', 'check', 'naver', 'daangn']));
