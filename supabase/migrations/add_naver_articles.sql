-- 네이버부동산 신규매물 감시. (원격 적용 완료 — Supabase MCP)
--
-- 네이버부동산 화면에는 '최신순'이 없어 새로 올라온 매물을 손으로 찾아다녀야 했다.
-- 내부 API에는 최신순(DATE_DESC)이 있어서, 그것으로 천안·아산 매물을 주기적으로
-- 받아 여기 쌓는다. 이 표가 곧 "네이버에 없는 최신순 목록"이다.
--
-- **링크를 고르는 데 필요한 것만 담는다.** 응답에는 가격·면적·사진·중개사도 들어
-- 있지만 저장하지 않는다 — 화면은 링크 목록이고, 값은 눌러 들어가서 직접 본다.
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
  -- 네이버가 광고를 노출하기 시작한 날. 재등록하면 갱신된다.
  exposure_start_date   date,
  -- 우리가 이 매물을 처음 받은 시각. 네이버가 날짜를 갱신해도 바뀌지 않는다.
  first_seen_at         timestamptz not null default now(),
  last_seen_at          timestamptz not null default now()
);

create index if not exists naver_articles_exposure_idx on public.naver_articles (exposure_start_date desc);
create index if not exists naver_articles_first_seen_idx on public.naver_articles (first_seen_at desc);
create index if not exists naver_articles_division_idx on public.naver_articles (division);
create index if not exists naver_articles_type_idx on public.naver_articles (real_estate_type);

alter table public.naver_articles enable row level security;

-- 공개된 네이버 광고를 옮겨 적은 것이라 사무소별로 나눌 것이 없다. 다만 중개사
-- 업무 화면에서만 쓰므로 승인된 중개사에게만 열어 둔다.
-- 쓰기는 수집기(service_role)만 한다 — service_role 은 RLS를 우회하므로
-- 여기에 쓰기 정책을 두지 않는다. 그래야 브라우저에서 이 표를 건드릴 수 없다.
drop policy if exists naver_articles_select on public.naver_articles;
create policy naver_articles_select on public.naver_articles
  for select to authenticated
  using (exists (
    select 1 from public.broker_profiles bp
    where bp.user_id = auth.uid() and bp.is_approved
  ));
