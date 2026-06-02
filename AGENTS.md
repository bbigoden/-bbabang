<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# PWA 아이콘·브랜드 자산 변경 시 필수 체크리스트

빠방은 안드로이드/iOS PWA로 운영 중. 아이콘·로고·브랜드 컬러를 변경할 때
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

## 빠방 브랜드 색
- 메인 네이비: `#14274e` (페트롤 네이비)
- hover: `#0f1d3a`
- Tailwind `blue-600` 등은 globals.css `@theme`에서 페트롤 팔레트로 override됨
  → `bg-blue-600` 그대로 써도 자동으로 네이비로 렌더됨
