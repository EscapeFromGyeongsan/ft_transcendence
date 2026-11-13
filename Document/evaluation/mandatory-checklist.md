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

평가표 문구: "Ask a team member to show examples of its usage in the code. ... Plain CSS alone is not sufficient." 검증 기록은 [styling-validation.md](../styling-validation.md)(#124)에 있다.

| 순서 | 보여 줄 코드 | 설명 |
|---|---|---|
| 1 | `apps/web/package.json`, `apps/web/vite.config.ts`의 `tailwindcss()` | Tailwind CSS `4.3.3`과 Vite plugin이 빌드에 연결됨 |
| 2 | `apps/web/src/index.css` | `@layer theme, base, components, utilities` 순서, Preflight 제외 이유, `@theme inline`으로 디자인 토큰을 Tailwind 색·글꼴로 연결 |
| 3 | `apps/web/src/App.tsx` 로그인·회원가입 폼 `className="flex flex-col gap-5"`, `profile/ProfileView.tsx`의 `grid grid-cols-1 ... lg:grid-cols-[340px_1fr]`, `friends/FriendsView.tsx` 검색 필드 | 컴포넌트에서 직접 쓰는 utility class (#119) |
| 4 | `apps/web/src/styles.css`의 `.cbc-input { @apply w-full rounded-lg py-3 pr-11 pl-4; … }`, `.cbc-btn-primary`, `.cbc-profile-card` | 여러 화면이 공유하는 버튼·입력·카드는 `@apply`로 Tailwind utility를 씀 (#124). 게임판 좌표·돌처럼 화면 고유 규칙은 CSS로 유지 |
| 5 | 브라우저 개발자 도구에서 로그인 폼과 프로필 레이아웃 요소 선택 | 위 class가 실제 요소에 적용되고, 화면 폭을 줄이면 `lg:` 규칙이 풀려 한 열이 되는 것 확인 |

