# 22단계 점검 기록 — 2026-10-15

## pg_stat_statements 기준선 (리셋 직전, 누적 2026-05-06 ~ 2026-10-15)

다음 점검은 이 리셋 이후 값만 본다(점검표 v4, 22-①). 실시간 WAL 폴링·통계 조회는 뺐다.

| calls | 평균 ms | 최대 ms | 쿼리 |
|---:|---:|---:|---|
| 198,501 | 9.7 | 578 | ad_agents upsert (PC 프로그램 하트비트, 20초마다) |
| 2,731 | 504.3 | 5,068 | `SELECT name FROM pg_timezone_names` (PostgREST 스키마 캐시 — 앱 아님) |
| 2,787 | 196.2 | 872 | search_office_properties (매물 목록 — 10/14 한 쪽만 JSON 으로: 16ms) |
| 1,431 | 217.3 | 1,040 | broker_properties count (매물 총 건수) |
| 101,085 | 2.7 | 248 | ad_agents last_seen_at 조회 (광고·수집 화면 15초 — 10/14 숨은 탭 정지) |
| 570 | 429.0 | 1,399 | broker_customers 전체 (고객관리 — 지금 사칭 측정 4.9ms) |
| 660 | 173.5 | 1,029 | broker_customers 칼럼 지정 조회 |
| 33,372 | 3.2 | 264 | ad_jobs kind 조회 |
| 5,926 | 14.8 | 544 | office_chat_unread_count (10/14 사이드바·하단탭 구독 하나로) |
| 1,688 | 49.9 | 151 | ad_listings + ad_posts (광고 목록 — 10/15 RLS 정리 뒤 직원 16ms) |
| 1,239 | 65.6 | 502 | broker_properties 칼럼 지정 조회 |
| 1,288,903 | 0.1 | 88 | ad_jobs 대기 작업 조회 (PC 프로그램 3초 폴링) |
| 100 | 797.2 | 935 | broker_customers broker_id = ANY (옛 방식) |
| 274 | 275.0 | 701 | search_office_properties (옛 시그니처) |
| 4,434 | 12.3 | 1,009 | broker_properties lat/lng 저장 (지도 지오코딩 — 10/15 한 번만 저장) |
| 902 | 54.2 | 561 | broker_properties 지도 조회 (10/15 map_office_properties 로 교체) |
| 10,009 | 4.7 | 250 | ad_jobs progress 갱신 (PC 프로그램) |
| 1,855 | 23.4 | 463 | refresh_broker_metrics (10/15 한 시간에 한 번으로) |

## 오늘 바꾼 것 (요약)

- 서버 함수 리전 iad1 → icn1, proxy·서버 컴포넌트 getUser → getClaims
- 매물수집 collect_listings 한 번 받기, 매물 목록 RPC 한 쪽만 JSON, 검색 translate
- 지도: 1,000건 잘림 → 전부(map_office_properties), 좌표 있는 매물부터 바로 표시
- 보안: broker_profiles 자기 승격·뷰 쓰기·admin 가입·연락처·메신저·정산·주소·휴지통·일지 등
- 버그: 회원 정보 수정 7/22부터 불가, 커스텀 칸 유실, 일지 저장 유실, 로그아웃 교착, 담당자 푸시 404

자세한 근거는 각 커밋 메시지와 `supabase/migrations/*20261015*`·같은 날 만든 마이그레이션 파일 머리말에 있다.
