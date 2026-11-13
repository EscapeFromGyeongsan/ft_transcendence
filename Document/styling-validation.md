# Styling solution 후속 검증 — #116 / #119

요구사항: `NFR-UX-04`, subject III.3 p.9. 관련 작업: [#116](https://github.com/EscapeFromGyeongsan/ft_transcendence/issues/116), [B의 Tailwind PR #119](https://github.com/EscapeFromGyeongsan/ft_transcendence/pull/119), [인수 검증 #88](https://github.com/EscapeFromGyeongsan/ft_transcendence/issues/88).

## 통합 기준과 변경 범위

이 변경은 #119의 `45a6351bb94d1c4fcc8c9031a5cfd3858cfe4042` 위에 쌓는 후속 작업이다. PR base는 `feat/web-tailwind`다. #119는 #115 `35c1f96`을 기반으로 하므로, 전체 서버·웹 스택을 master에 반영하는 순서는 [#96](https://github.com/EscapeFromGyeongsan/ft_transcendence/issues/96)을 따른다.

B의 원본 커밋과 다음 구현을 그대로 사용한다.

- [웹 의존성](../apps/web/package.json): Tailwind CSS와 `@tailwindcss/vite` **4.3.3 exact**, 기존 lockfile.
- [Vite 플러그인](../apps/web/vite.config.ts), [main.tsx](../apps/web/src/main.tsx) → [index.css](../apps/web/src/index.css) 진입점.
- `theme → styles.css(components layer) → utilities` 순서와 Preflight 제외, `@theme inline`의 기존 색상·폰트 토큰 연결.
- 폼·라벨·부제·프로필 레이아웃·친구 화면의 직접 JSX 유틸리티와 `sr-only` 전환.

후속 제품 변경은 [styles.css](../apps/web/src/styles.css)의 **19개 공통 규칙**에 한정한다. 버튼·입력·카드·모달·앱 레이아웃의 동일한 배치·간격·모서리 선언을 `@apply`로 옮겼다. 기존 클래스명, 색상, 테두리, 상태별 효과, 반응형 규칙과 게임판 규칙은 유지한다.

## 겹치는 작업의 처리

| 겹친 영역 | 확인 및 처리 |
|---|---|
| `styles.css` | 이전 단독 시도와 #119의 3-way 비교에서 텍스트 충돌 1구간 확인. B가 JSX로 옮긴 `.cbc-form`, `.cbc-field`, `.cbc-label-row`는 다시 만들지 않았다. 남은 19개 규칙은 기존 선언이 #119에서도 동일한지 확인한 뒤 전환했다. |
| 의존성·lockfile | 이전 시도의 루트 4.3.5와 B의 웹 workspace 4.3.3이 중복되고 lockfile 7구간이 충돌했다. B의 manifest·lockfile을 그대로 채택하고 `npm ci`로 재설치했다. |
| Vite·CSS 진입점 | 플러그인 추가는 동일하지만 CSS import를 중복하면 layer 순서가 달라진다. B의 `index.css`만 진입점으로 유지하고 `styles.css`에 별도 theme·utilities import를 추가하지 않았다. |
| README·SDS·평가 체크리스트 | #116에서 B가 갱신을 맡았고 #59의 문서 재작성과 겹친다. 이번 변경에는 포함하지 않고 이 검증 기록을 인계 자료로 제공한다. |

이전 `d927a11`/Tailwind 4.3.5 단독 시도의 테스트·화면 비교는 과거 기록이다. 아래 #119 기준 검증과 구분한다. 로컬 원안은 별도 stash와 `.omx/validation/issue-116/integration-backup/`에 보존했다.

## 평가 시연 위치

| 화면 | 직접 JSX 유틸리티 (#119) | 공통 `@apply` (이 후속) |
|---|---|---|
| 로그인·회원가입 | [App.tsx](../apps/web/src/App.tsx)의 `flex flex-col gap-5` 폼 등 | `.cbc-login-card`, `.cbc-input`, `.cbc-btn-primary`, `.cbc-btn-42` |
| 내 프로필 `/me` | [ProfileView.tsx](../apps/web/src/profile/ProfileView.tsx)의 grid·폼·제목 | `.cbc-profile-card`, `.cbc-input`, 공통 버튼 |
| 로비 `/` | [App.tsx](../apps/web/src/App.tsx)의 부제·안내 | `.cbc-game-card`, 매칭 버튼 |
| 친구 `/friends` | [FriendsView.tsx](../apps/web/src/friends/FriendsView.tsx)의 검색 필드·섹션 제목 | `.cbc-profile-card`, `.cbc-input`, 공통 버튼·확인 모달 |
| 오목·오델로 대국·결과 | [GomokuMatchView.tsx](../apps/web/src/game/GomokuMatchView.tsx), [OthelloMatchView.tsx](../apps/web/src/game/OthelloMatchView.tsx)의 안내 문구 | `.cbc-player-card`, `.cbc-match-info-card`, 결과 버튼·확인 모달 |

예: `.cbc-input { @apply w-full rounded-lg py-3 pr-11 pl-4; … }`, `.cbc-profile-card { @apply rounded-xl p-6; … }`. 게임판의 좌표·돌·배경은 기존 CSS를 함께 사용한다.

시연 순서는 Vite 설정 → `index.css`의 Preflight 제외·토큰 연결 → 로그인/프로필/친구의 JSX 유틸리티 → 공통 버튼·입력의 `@apply` → 브라우저 렌더링이다. 서로 다른 화면 두 곳 이상에서 코드와 실제 요소를 연결해 설명한다.

## 재현과 로컬 검증

저장소 루트에서 실행한다.

```sh
npm ci
git rev-parse HEAD
npm run build
npm test -- apps/web packages/game-engine
npm run preview
```

실제 로그인·프로필·친구·대국 시연에는 [실행 안내](runtime.md)에 따라 API와 DB도 준비한다. 제출 환경은 HTTPS 경로를 사용한다. 로그인 입력의 오류·비활성, Tab 포커스, 친구 검색·목록·확인창, 대국·결과 버튼을 데스크톱과 모바일에서 확인한다.

2026-11-13, macOS / Node 22.23.2 / npm 10.9.8. 아래는 #119 원본과 이 후속 변경의 로컬 검증이다.

| 검증 | 결과 |
|---|---|
| #119 lockfile로 `npm ci` | 통과, Tailwind·Vite 플러그인 4.3.3 단일 버전 확인 |
| 변경 전후 `npm run build` | TypeScript 검사 및 production build 통과 |
| `npm test -- apps/web packages/game-engine` | 21개 파일, 255개 테스트 통과 |
| 변경 CSS Prettier / `git diff --check` | 통과 |
| 팀원 변경 보존 | 설정·의존성·JSX·공통 문서 12개 파일이 #119와 바이트 단위로 동일 |
| Chrome 157.0.8103.52 브라우저 회귀 | 기존 인증·약관·라우팅·친구 합성 UI 테스트 36/36 통과, skip·retry 없음 |
| 화면 전후 비교 | 1440×900·768×1024·360×800, 총 63개 화면/상태에서 공통 요소 972건 × 65개 계산 속성과 위치·크기가 동일. 캡처 해시도 63/63 동일 |
| 화면·콘솔 검사 | 가로 넘침·JS 실행 오류·Console warning·예상 밖 API 요청 없음. 로그인 거절 fixture의 의도된 HTTP 401 로그는 양쪽에서 각 화면 크기마다 1회 발생 |

화면 비교는 로그인 입력의 포커스·Tab·오류·비활성, 버튼 hover, 회원가입, 로비, 프로필, 로그아웃·탈퇴 확인창, 두 게임의 대국·결과·최소화, 친구 목록·검색·확인창의 키보드·로딩/비활성을 포함한다. 친구 검색·요청·수락·거절·삭제·실패 복구의 합성 UI 테스트 8개(데스크톱/모바일)가 36개 브라우저 테스트에 포함된다.

비교는 GPU를 끈 headless Chrome에서 동일한 로컬 대체 폰트를 사용했고 HTTP·WebSocket을 fixture로 대체했다. 실제 인증·DB·서버 연동·HTTPS·외부 웹폰트 검증은 아니다. 사용자 요청대로 미세한 픽셀 차이를 추적하는 추가 반복은 하지 않았다.

CSS는 #119의 52.39 kB → 53.35 kB, gzip 9.19 kB → 9.35 kB다. 원본 검증 자료는 `.omx/validation/issue-116/integration/`의 `comparison.json`, `playwright-report.json`, `preservation-check.json`, `source-manifest.json`과 전후 캡처에 보관하며 배포 소스에는 포함하지 않는다.

## 문서 인계와 제출 전 확인

B의 #116 문서 후속에서 이 기록을 다음 위치에 연결한다. 위치는 #59 `791ac3e` 기준이며 다른 내용은 해당 작성자가 최신 제출 후보에 맞춘다.

- SDS §2.2.2: `index.css` 진입점, Tailwind 4.3.3, JSX + 공통 `@apply`, 실제 café 색상·폰트.
- SDS 기술 선택 표와 `NFR-UX-04` 추적 행: 단순 CSS 파일 존재 대신 빌드 설정·실제 사용 코드·검증 근거.
- README 기술 스택 및 시연 안내, `Document/evaluation/mandatory-checklist.md`의 스타일링 항목.

남은 제출 조건:

- [ ] 최종 통합 SHA에서 `npm ci`와 production build를 재실행한다.
- [ ] HTTPS 배포와 실제 API·DB에서 인증·친구·두 게임 흐름을 검증한다.
- [ ] 외부 웹폰트와 실제 Chrome Console 경고·오류를 확인한다.
- [ ] 작성자 외 팀원이 두 화면 이상의 코드·렌더링 시연을 재현한다.
- [ ] B 문서 갱신 및 #88/#116 증빙 연결을 완료한다. 이 후속 PR만으로 #116 전체를 종료하지 않는다.
