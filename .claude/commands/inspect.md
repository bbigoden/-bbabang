# 부소장 풀스택 점검 22단계 (v4, 2026-10-15)

사장님이 `/inspect` 또는 "점검실시"·"점검22단계" 등으로 지시하면 **권한 묻지 말고 0~22단계 자동 순차 진행**.
각 단계 시작/완료만 짧게 보고. 오래 걸리는 작업(빌드·테스트·시각검증)은 백그라운드 병렬로 돌리고 그 사이 DB·코드 점검 진행.

- Supabase 프로젝트: `wovxcdfxxnsljdhrgonh` / Vercel: `prj_rHifCkr5HkVIyOrRDcTniSxxOO1I`
- 꼼꼼함 원칙: "정상" 표시 전 실제 코드/DB/빌드 증거 확보. 페이지·API·DB 카운트는 Glob/SQL 실측.
- "보류"는 진짜 외부 의존(사용자 결정/별도 repo/대시보드 전용)만. 신규 발견 vs 이전 누락 구분 보고.

## 단계별 체크리스트

**0. 준비·크래시 스캔**
- `error_logs` 최근 7~14일 조회를 **가장 먼저** (라우트 크래시도 기록됨). 발견 시 git log 날짜 대조로 기수정 여부 판정.
- 페이지 수 `Glob src/app/**/page.tsx`(10/15 기준 80개), 라우트 수 `Glob src/app/**/route.{ts,tsx}`(10/15 기준 26개 = api 25 + auth/callback 1 — route.tsx 를 빼먹지 말 것) + 고아 API grep (cron은 vercel.json 대조, lib 경유 호출은 그 lib의 import까지 추적, DB 트리거(pg_net)가 부르는 라우트도 호출처로 친다 — 7/26에 지운 /api/internal/send-push 를 트리거가 계속 부르고 있었다)
- git status·최근 커밋 파악

**1. 환경/시크릿** — `process.env.*` ↔ `.env.local.example` 양방향 대조, 시크릿 스캔(`sk-|eyJhbGciOi|AIza`), `npm audit --omit=dev` (high 이상 즉시 패치. 프레임워크 자체 CVE 주의)
**2. DB 스키마** — `get_advisors` security+performance **매번**: 새 SECURITY DEFINER, RLS initplan(`auth.uid()` → `(select auth.uid())`), 중복 permissive 정책. **SECURITY DEFINER 함수 전수 감사(v4)**: anon·authenticated 가 EXECUTE 할 수 있는 함수마다 '아무 인자나 넣어 남의 데이터를 읽거나 바꿀 수 있나'를 본다(PostgREST 로 직접 부를 수 있다). 함수가 믿는 칸(parent_broker_id·is_approved·permissions·이름 문자열 등)을 사용자가 스스로 고칠 수 없는지도 본다 — 10/15 broker_profiles 자기 승격·담당자 이름 사칭이 이 경로였다. **뷰 쓰기 권한(v4)**: `security_invoker=false` 뷰에 anon·authenticated INSERT/UPDATE/DELETE 가 남아 있으면 RLS 를 건너뛴 쓰기가 된다(10/15 profiles_visible·public_properties). 가입 트리거가 메타데이터 role 을 화이트리스트로 거르는지. 스키마 드리프트 생존 확인: `profiles.referral_code/referred_by` 컬럼(가입 트리거 의존, 누락 시 전체 가입 42703), `user_term_consents`의 SELECT/INSERT/**UPDATE** 정책(upsert라 UPDATE 필수). FK·인덱스.
**3. 인증/세션** — 유휴 세션 만료 cron, leaked password protection(대시보드 전용·보류), MFA 흐름
**4. 권한/역할** — 대표/직원/고객/관리자 분리, anon 컬럼 GRANT 감사(RLS 행 정책은 컬럼을 못 가림), profiles_visible 패턴 준수(연락처는 뷰로만, 본체 `select('*')`는 403이 정상)
**5. 핵심 도메인** — 매물·고객·매칭·일지 데이터 흐름, PostgREST 1000행 무음 절단(전건 조회는 fetchAllPaged 필수) 여부
**6. API/서버** — 라우트 입력 검증, rate_limit_check 적용처, 에러 응답 일관성
**7. 클라이언트 상태** — 폼·캐시·낙관 업데이트, auth 캐시(localStorage) 동작
**8. 외부 연동** — Telegram bot(별도 폴더 `코드\부소장등록`, 웹앱 레포 아님 — 보류 가능), `SELECT jobname, schedule, active FROM cron.job` 중복·비활성 확인 + **실행 결과(v4)**: `select j.jobname, d.status, count(*) from cron.job_run_details d join cron.job j using(jobid) where d.start_time > now()-'7 days' group by 1,2` — active 만 보면 매일 실패해도 모른다(purge-old-trash 가 7/22부터 85일 연속 실패했다). pg_net `_http_response` 상태코드 분포도 본다(404 = 지운 라우트를 트리거가 부름)
**9. 파일/이미지** — `storage.buckets` public 여부 + `storage.objects` 정책을 **INSERT with_check까지**(bucket_id만 체크하는 열린 INSERT 함정). 비공개 버킷 3종 검증: 멤버 서명 URL→200, 비멤버→Object not found, 비로그인 public URL→400. office-chat-images는 비공개 유지(DB엔 경로만, public URL 재저장 금지).
**10. 로깅/모니터링** — error_logs 수집 동작, `/api/cron/error-alert` + **실제 발송 여부(v4)**: error_logs 중 alerted_at 이 채워진 비율. 0%면 알림이 한 번도 안 나간 것이다(10/15 기준 251건 전부 NULL — 메일 키 미등록이었다. 10/16 웹 푸시로 바꿈: 받는 사람 internal_config.error_alert_user_ids + 관리자, 그 사람들의 push_subscriptions 건수도 같이 본다). 홈 #418 hydration은 2026-07-28 원인 규명·수정 완료(헤더 뒤로가기 분기가 ISR 재생성 시 usePathname 오염으로 어긋남 — e7a2f16). 재발 시 서버 HTML vs 클라이언트 DOM 문자 diff로 지점 특정할 것(환경성 노이즈로 단정 금지).
**11. 결제/정산** — 분배 행 구조(매도=수익·매수=−경비·정산비=동업자비율), 사무실수익 집계에서 분배 행 제외, 정산비 0~1 클램프
**12. 배포 파이프라인** — push 후 Vercel `list_deployments`로 **commit SHA·READY 직접 확인** (매 push마다). **함수 리전(v4)**: 동적 라우트 응답의 `x-vercel-id` 가 `icn1::icn1` 인지(10/14까지 `icn1::iad1` — 서버가 미국에서 서울 DB 를 불러 화면마다 태평양 왕복). vercel.json `regions: ["icn1"]`
**13. 모바일/PWA** — sw.js VERSION, 안드로이드+iOS 아이콘 자산(AGENTS.md 체크리스트), 오프라인 fallback. **푸시 도달**: `npm run push:test` (기본 대상 t2=김용유 대표 실계정 — 다른 직원에게 보내지 말 것, PUSH_TEST_PASSWORD env 필요) → 410/404=만료 구독 정리. 퇴사자 구독 잔존 SQL 확인. 수신 확인은 사장님 육안.
**14. 데이터 정합성** — null 필드 감사(문자열 메서드 크래시 후보 — TS가 못 잡음), 마이그레이션 파일 ↔ 원격 적용 대조
**15. 자동 테스트** — `npm test` exit code 실측(vitest 96개) + **핵심 흐름 E2E** `npm run inspect:e2e` (요청 등록→제안→확인→채팅, 테스트 계정 전용·자동 정리, tests/e2e/)
**16. 빌드 품질** — `npm run build` + `npx tsc --noEmit` + `npx eslint src/` 전부 exit code 실측, 데드코드·고아 lib
**17. UI/UX** — `npm run inspect:visual` 98캡처(백그라운드 ~17분), report.json의 findingsWith* 카운트로 집계. textTruncation은 의도적 truncate 위주라 참고만. **주의: /admin/**은 layout이 항상 다크(bg-gray-950)지만 html.dark가 없어 dark: variant 미작동 — inspect:visual은 라이트 전용.**
**18. 보안 침투/운영** — RLS 양성·음성 테스트(멤버/비멤버/anon 3종), XSS 가드(JSON-LD는 `.replace(/</g,'\\u003c')` 확인), CSP·X-Frame 헤더, anon SELECT 컬럼 감사
**19. 법적/SEO/콘텐츠** — robots/sitemap 빌드 출력 확인, OG 이미지 PNG(SVG만 있으면 카톡 깨짐), 약관·개인정보 링크
**20. 비즈/DX/인프라/접근성** — a11y 위반(시각 검증에 포함), 번들 크기, KPI
**21. 백업/복구 (v3)** — `npm run backup:db` 논리 스냅샷(backups/, gitignore). SUPABASE_DB_URL(.env.local) 필요 — 미등록 시 보류 보고(사장님 결정 대기, 재촉 금지). Free 플랜이라 이게 유일한 백업. 최근 스냅샷 나이 확인(manifest.json). 분기 1회 복구 리허설.
**22. 성능/쿼터 (v3)** — ① pg_stat_statements mean_exec_time 상위(앱 쿼리 중 calls 많고 느린 것). 누적값이라 `select stats_reset from pg_stat_statements_info` 를 같이 적고, 점검 끝에 상위 30개를 기록한 뒤 `pg_stat_statements_reset()` 한다 — 안 그러면 고친 뒤에도 옛 평균이 남아 판정이 흐려진다 ② DB 크기 vs 500MB·스토리지 vs 1GB — 50% 초과 경고 ③ `npm run perf:web` 공개 5페이지 Web Vitals(LCP<2.5s 좋음) ④ 로그인 페이지는 report.json loadTimeMs 추세 비교. 기준선(7/26): DB 21MB(4%)·스토리지 74MB(7%)·병목 0·공개 페이지 전부 좋음.

## 판정·작업 원칙

- 크래시: error_logs 발생 시각 vs 수정 커밋 시각 대조 → 재발 없으면 해결 처리
- 취약점: 프로덕션 의존성 high 이상 즉시 패치, 상류 미패치(sharp 등)는 잔존 기록
- P0(보안 누수·데이터 노출) 발견 시 즉시 별도 알림
- 버그 수정·보안 패치·lint 해소는 발견 즉시 자동 수행 + 커밋·푸시. 단 **기능성 코드 삭제**(스캐폴드·미래 기능 후보)는 자동 삭제 금지 — 보고 후 사용자 결정
- 버킷 비공개 전환 순서: 정책 먼저 → 코드 배포 READY → public=false
- UI 검증이 headless 로그인 실패하면 supabase-js `signInWithPassword` 직접 검증이 더 확실
- 시각 검증 기준선: consoleErrors/pageErrors/networkFailures/a11y 전부 0 (2026-07-26 달성)
- 사장님 보류 항목(재촉 금지, 상태 한 줄만): SUPABASE_DB_URL 등록, leaked password protection 토글, PUBLICDATA_API_KEY(사업자 자동 인증 — 사무소 내부 사용 중이라 미룸) 미등록, 점검 계정(t1/t2/admin) 비밀번호 교체(공개 레포 이력에 노출 — 10/15 확인)
- 점검 도중 멈추라고 하면 즉시 중단
