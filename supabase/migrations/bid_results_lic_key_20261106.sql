-- 낙찰결과를 면허로 거르는 글자 칸. lic_cds 를 정렬해 쉼표로 이은 것('4989', '4989,4996').
-- 보안 규칙(RLS) 아래에선 배열 겹침(&&)이 색인을 못 써 2.6만 줄을 다 읽다 8초에 끊겼다.
-- 글자 같음(=, in)은 색인을 쓸 수 있다. 수집 코드가 lic_cds 와 같이 적는다.
alter table public.bid_results add column if not exists lic_key text;
update public.bid_results
set lic_key = (select string_agg(x, ',' order by x) from unnest(lic_cds) x)
where lic_cds is not null and lic_key is null;
create index if not exists bid_results_lic_key_idx
  on public.bid_results (lic_key, openg_at desc nulls last, bid_ntce_no, bid_ntce_ord, rbid_no);
