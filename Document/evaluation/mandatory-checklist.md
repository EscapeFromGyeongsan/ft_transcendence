# Mandatory Checklist

v21.1 subject의 공통 필수 요건과 최소 구현/시연 기준.

| 항목 | v21.1 근거 | 구분 | 최소 구현/시연 | 학교 평가표 |
|---|---|---|---|---|
| 기본 이메일·비밀번호 가입/로그인 | III.3 p.9 | 공통 필수 | 해시·salt, 가입·로그인·권한 검증 | 미확인 |
| 약관·개인정보처리방침 | III.2 p.8 | 공통 필수 | 실제 수집·보관·이용과 맞는 내용, 앱에서 접근 가능 | 미확인 |
| 동시 사용자·충돌 방지 | III.2 p.8 | 공통 필수 | 두 경기 동시 진행, 중복·경합 요청 처리 | 미확인 |
| 외부에서 백엔드로의 HTTPS | III.3 p.9 | 공통 필수 | 브라우저·테스트 클라이언트 모두 HTTPS | 미확인 |
| WSS | III.3 p.9를 실시간 연결에 적용 | 외부 연결 암호화의 구현 방식 | WS transport는 WSS, polling 사용 시 HTTPS. 내부 서버↔DB는 비암호화 허용 | 미확인 |
| 최신 안정 Chrome·콘솔 경고/오류 없음 | III.2 p.8 | 공통 필수 | 브라우저 버전 기록, 주요 흐름 콘솔 검사 | 미확인 |
| 프런트·백·DB, 명확한 관계 | III.2–3 p.8–9 | 공통 필수 | 실제 DB 조회·저장·관계 설명 | 미확인 |
| 컨테이너·단일 명령 실행 | III.2 p.8 | 공통 필수 | 문서화한 환경 설정 이후 단일 명령 기동 | 미확인 |
| 반응형·접근 가능한 UI | III.3 p.9 | 공통 필수 | 작은 화면·키보드·라벨 검증; WCAG Major는 별도 미선택 | 미확인 |
| 스타일링 솔루션 (Plain CSS만으로는 불충분) | III.3 p.9 | 공통 필수 | Tailwind CSS 4.3.3(#119, #124). 빌드 설정과 서로 다른 화면 두 곳 이상의 사용 코드·렌더링 시연, 아래 절차 | 미확인 |
| 프런트/백 입력 검증, .env 제외·예시 | III.3 p.9 | 공통 필수 | 화면 우회 요청 거절, 비밀값 없이 실행 준비 가능 | 미확인 |
| 전원 Git 기여·역할 | II p.4–6, III.2 p.8 | 공통 필수 | 의미 있는 기여·역할·분담 설명 | 미확인 |
| 영어 README·AI 사용 공개·기여 설명 | VI p.27–29 | 공통 필수 | 필수 섹션과 지정 첫 줄, 담당별 설명 | 미확인 |

## 스타일링 솔루션 시연 (#116)

B의 #118(`69a2e29`) 시연 절차를 이 후보에도 반영했다. [기존 화면 비교](../styling-validation.md)는 #124 기준이며, 최종 제출 SHA의 배포·팀원 재현을 대신하지 않는다.

| 순서 | 보여 줄 코드 | 확인 |
|---|---|---|
| 1 | `apps/web/package.json`, `apps/web/vite.config.ts` | Tailwind CSS 4.3.3과 `tailwindcss()` Vite plugin |
| 2 | `apps/web/src/index.css`, `main.tsx` | CSS 진입점, layer 순서, Preflight 제외, `@theme inline` 토큰 연결 |
| 3 | `apps/web/src/App.tsx` 로그인 폼, `profile/ProfileView.tsx`, `friends/FriendsView.tsx` | `flex flex-col gap-5`, `lg:grid-cols-[340px_1fr]`, 친구 검색 필드의 직접 JSX utility |
| 4 | `apps/web/src/styles.css`의 `.cbc-input`, `.cbc-btn-primary`, `.cbc-profile-card` | 공통 `@apply`와 게임판 고유 CSS의 실제 사용 |
| 5 | Chrome에서 로그인·프로필 또는 친구 화면 두 곳 이상 | DevTools의 계산 스타일, 모바일에서 한 열 배치, 오류·비활성 버튼·Tab 포커스·콘솔 |

제출 기록에는 `git rev-parse HEAD`, production build 결과, Chrome 버전·화면 크기, HTTPS/WSS·실제 API/DB 여부, 확인한 팀원과 결과를 남긴다. 학교 평가표 판정은 별도다.

2026-11-13 [통합 후보 검증](../styling-116-integration-validation.md): 513개 단위·DB 테스트 통과, 3종 화면 크기의 실제 HTTPS/WSS 12개 화면에서 콘솔 오류·경고 0건. Docker/Nginx·최종 제출 SHA·팀원 재현과 프로필 E2E의 429 영향은 남아 있다.
