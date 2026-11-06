-- 입찰 낙찰결과 목록(bid/page.tsx resultPage·검색)의 정렬 순서와 똑같은 인덱스.
-- 기존 bid_results_openg_idx(openg_at DESC = NULLS FIRST)는 NULLS LAST 정렬에 못 써서
-- 2.4만 행을 매번 디스크 정렬했다(한 묶음 4초 → 0.09초). 2026-11-06 운영 적용.
create index if not exists bid_results_list_order_idx
  on public.bid_results (openg_at desc nulls last, bid_ntce_no, bid_ntce_ord, rbid_no);
