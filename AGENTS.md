# 날짜·시간은 언제나 한국(Asia/Seoul) 기준

서버(Vercel)도 Supabase 도 **UTC 로 돈다**. 그래서 아래를 그대로 쓰면
**한국시간 0~9시 사이에 하루가 밀린다.** 사장님은 아침 일찍 일하므로 이건
이론이 아니라 매일 아침 나는 일이다.

```
new Date().toISOString().slice(0, 10)   // UTC 날짜 — 아침에 어제가 나온다
new Date().toISOString().split('T')[0]  // 같은 문제
CURRENT_DATE                            // DB 시간대가 UTC 라 같은 문제
d.getDate() / d.setDate()               // 로컬 시간 — 보는 곳에 따라 달라진다
```

**대신 `src/lib/date-kst.ts` 를 쓴다.**

| 필요한 것 | 쓸 것 |
|---|---|
| 오늘 날짜 | `todayKST()` |
| 저장된 시각 → 한국 날짜 | `ymdKST(value)` |
| 저장된 시각 → 한국 시:분 | `hmKST(value)` |
| 날짜에 일수 더하기 | `addDays(ymd, n)` |

SQL 에서는 `CURRENT_DATE` 대신 `(NOW() AT TIME ZONE 'Asia/Seoul')::date`,
날짜를 만들 때도 `NOW() AT TIME ZONE 'Asia/Seoul'`.

**예외 — `timestamptz` 에 넣는 시각은 `toISOString()` 이 맞다.** 순간을 그대로
담는 컬럼이라 시간대가 따라붙는다. 문제가 되는 건 거기서 **날짜만 뽑을 때**다.

실제로 났던 것들:
- 견적번호는 Asia/Seoul 로 매기는데 발행일만 UTC 라, 아침 8시에 만든 견적서가
  번호는 `2026-0905-01` 인데 발행일은 `2026-09-04` 로 찍혔다. 유효기간도 하루 짧아졌다.
- 업무일지를 아침에 쓰면 어제 칸에 적혔다.
- 채팅에서 일정을 만들면 기본 시각이 아홉 시간 어긋났다(오후 4시 → `07:00`).

`src/__tests__/date-kst.test.ts` 가 지킨다.

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# 점검 워크플로우

사용자가 "점검실시"·"점검22단계" 등 점검을 지시하면 [.claude/commands/inspect.md](.claude/commands/inspect.md)의
22단계 체크리스트 v3를 그대로 따를 것 (`/inspect` 슬래시 명령과 동일). 권한 묻지 말고 자동 순차 진행.

# PWA 아이콘·브랜드 자산 변경 시 필수 체크리스트

부소장은 안드로이드/iOS PWA로 운영 중. 아이콘·로고·브랜드 컬러를 변경할 때
**iOS는 안드로이드와 완전히 다른 채널**을 쓰므로 반드시 둘 다 챙길 것.
한쪽만 처리하면 사용자가 "안 바뀌었는데?" 보고하게 됨.

## 안드로이드/Chrome 채널
- `public/icon.svg` (원본)
- `public/icon-192.png` / `icon-512.png` (sharp로 재생성)
- `public/favicon.ico` (32px PNG를 ICO 컨테이너로 감싸기)
- `src/app/manifest.ts`의 `icons[]` + `theme_color`
- `src/app/layout.tsx`의 `viewport.themeColor`
- `public/sw.js`의 `VERSION` 올리기 (기존 PWA 캐시 무효화)

## iOS Safari 채널 (별도 — 매번 빠뜨리지 말 것)
iOS Safari는 manifest의 icons를 **무시**하고 `<link rel="apple-touch-icon">`과
`apple-mobile-web-app-*` 메타만 신뢰함. SVG도 잘 못 읽어서 PNG 강제.

- `public/apple-touch-icon.png` (180x180, 표준)
- `public/apple-touch-icon-167.png` (iPad Pro)
- `public/apple-touch-icon-152.png` (iPad)
- `src/app/layout.tsx`의 `metadata.icons.apple` = PNG 배열
- `src/app/layout.tsx`의 `metadata.appleWebApp` = `{ capable, title, statusBarStyle }`
  - `capable: true` 없으면 standalone 풀스크린 안 됨
  - `statusBarStyle: 'black-translucent'` 같은 짙은 헤더와 어울림

## OG/SNS 공유 썸네일
- `public/og-image.svg` + **PNG도 같이 생성** (카톡 등 SVG 호환성 약함)
- `src/app/layout.tsx`의 `openGraph.images` + `twitter.images` 경로를 PNG로

## 사용자가 캐시 때문에 안 바뀐다고 보고할 때
- 안드로이드: SW VERSION 올렸으면 자동 무효화. 강력 새로고침으로 충분
- **iOS는 `?v=2` 캐시버스터 무시**. 반드시 PWA 삭제 → Safari 데이터 지우기
  → 사이트 재방문 → "홈 화면에 추가" 재설치 안내해야 함

## 부소장 브랜드 색
- 메인 네이비: `#14274e` (페트롤 네이비)
- hover: `#0f1d3a`
- Tailwind `blue-600` 등은 globals.css `@theme`에서 페트롤 팔레트로 override됨
  → `bg-blue-600` 그대로 써도 자동으로 네이비로 렌더됨

# /broker/* 리다이렉트 — 예외 목록은 자동 생성됨

`next.config.ts`의 redirects()에 구 공개 프로필(`/broker/[id]`) 제거용 리다이렉트가 있고,
예외 목록(BROKER_ROUTES)은 **`src/app/broker` 폴더를 읽어 빌드 시 자동 생성**된다.
새 `/broker/xxx` 페이지는 폴더만 만들면 자동으로 예외에 포함되므로 별도 등록이 필요 없다.

과거 손으로 목록을 관리하다 두 번 사고 남(jobs 01dace0, cafe-post edd9114) → 자동화(현재 방식)로 전환.
새 페이지 배포 전 `curl -I localhost:3000/broker/xxx`가 308이 아닌지 한 번 확인하면 더 안전.

# cafe-post.ts · naver-land.ts 는 삭제 금지 — 옆 레포가 파일 경로로 직접 읽는다

`src/lib/cafe-post.ts`는 이 웹앱 안에서는 아무도 import 하지 않는다.
대신 광고 자동화 PC 프로그램(`코드/부소장광고`)이 **상대 경로로 직접 import** 한다:

```js
pathToFileURL(path.join(ROOT, '..', '빠방', 'src', 'lib', 'cafe-post.ts'))
```

(`src/cli/batch.js`, `prepare.js`, `verify.js`)

그래서 knip·미사용 파일 스캔은 이 파일을 항상 "고아 파일"로 잡는다. **지우면 카페
자동 발행이 통째로 죽는다.** 파일 위치·이름을 바꿀 때도 옆 레포의 경로를 같이 고칠 것.

`src/lib/naver-land.ts` 도 같다. 이쪽은 `/broker/naver` 화면이 매물종류·구역 표를
import 하지만, **실제로 네이버를 부르는 쪽은 옆 레포**다 (`부소장광고/src/naver.js`):

```js
pathToFileURL(path.join(ROOT, '..', '빠방', 'src', 'lib', 'naver-land.ts'))
```

네이버가 데이터센터 IP를 막아 Vercel 에서는 부를 수 없다(다섯 번 다 60초 타임아웃).
그래서 수집 코드를 서버 라우트로 되돌리지 말 것 — 한 번 만들었다가 걷어냈다.

블로그(`blog-post.ts`)는 2026-09-03 걷어냈다 — 만들어는 뒀지만 한 건도 발행하지
않았고 쓸 계획도 없었다. 되살릴 일이 생기면 그날 커밋에서 꺼내면 된다.
