-- 입찰: 법인 둘(한결이엔씨 4992 · 아천환경개발 4989/4995/4996/5652)
-- 공고는 면허별 주력분야, 낙찰은 받아 온 면허를 적고, 대표 계정에 법인별 설정을 둔다.

-- 공고의 면허제한 줄: {"4989": ["토공사","포장공사"], "5652": []} — 빈 배열은 주력분야 지정 없음.
-- null 은 아직 안 받음(그 전 공고는 4992 하나, 주력분야는 mfrc_flds)
alter table public.bid_notices add column if not exists lic_flds jsonb;

-- 이 낙찰을 받아 온 면허(나라장터 낙찰 목록은 면허 코드로 조회한다)
alter table public.bid_results add column if not exists lic_cds text[];
update public.bid_results set lic_cds = '{4992}' where lic_cds is null;
create index if not exists bid_results_lic_cds_idx on public.bid_results using gin (lic_cds);

-- 법인별 설정: [{"name","lics":[],"fields":[],"region"}]
alter table public.broker_profiles add column if not exists bid_companies jsonb;
update public.broker_profiles
set bid_companies = jsonb_build_array(
  jsonb_build_object('name', '한결이엔씨', 'lics', jsonb_build_array('4992'),
    'fields', coalesce(to_jsonb(bid_fields), '[]'::jsonb), 'region', bid_region),
  jsonb_build_object('name', '아천환경개발', 'lics', jsonb_build_array('4989', '4995', '4996', '5652'),
    'fields', jsonb_build_array('토공사', '포장공사', '구조물해체·비계공사', '상하수도설비공사'), 'region', '충청남도 아산시')
)
where bid_enabled and bid_companies is null;
