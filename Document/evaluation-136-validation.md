# #136 평가 시나리오 결함 수정과 검증

2026-11-13 KST. #143 위에 쌓은 `fix/web-eval-136`의 수정 기록이다. 이 문서의 구현·검증 완료는 master 병합이나 최종 제출 인수 승인을 뜻하지 않는다.

## 출처

- base: #143 `4e299f7910adf95f5a87c43e81331fa8eebb573b`.
- B의 #142 `cacfaa99bd54b7962f68b580f4a3da22107fb1ec`: 세션 만료, 오프라인 복원, 2FA 상태 실패, 수동 재접속 횟수, 42 미설정 문구.
- B의 #126 `23177d6aefc4cd4483c6a9ab861ea39f464130d2`: 닉네임·2FA 해제 검증 및 여러 구분자 처리.
- A 제품 수정: `4e9429af6131f79c518631a8f570c65f38b406b3`.
- 테스트 선택자 보완: `953b6f30bfb8d5bab4847c1fc86f0233e57433a4`. 제품 트리는 위 A 수정 커밋과 동일하다.

B의 원본 PR·#143 브랜치는 수정하지 않고 merge로 이력을 보존했다. 아래 번호는 #136이 인용한 평가 시나리오 문서의 결함 번호다.

## 항목별 처리

| 번호                 | 처리 및 근거                                                                                                                                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| #1 세션 종료         | #142의 인증 실패 handler를 통합. refresh 거절은 로그인 화면과 만료 안내, 저장 토큰 삭제로 이어짐                                                                                                                   |
| #40 42 미설정 503    | #142의 `getOAuthStartErrorMessage`를 로그인·프로필에서 사용                                                                                                                                                        |
| #2·#4 OAuth 안내     | App의 성공·안내를 공통 `role=status` 영역 한 곳에서 표시해 연결 성공·OAuth 다음 2FA 안내를 유지                                                                                                                    |
| #3 이미 연결된 계정  | 본인 조회에 `oauth42Linked` boolean 추가. 프로필은 조회 결과로 연결됨/비활성을 표시. 닉네임·아바타 변경 응답은 기존 본인 정보와 병합                                                                               |
| #5 수동 갱신 결과    | 프로필·친구·리더보드 등 어느 화면에서도 공통 성공/오류 안내를 표시                                                                                                                                                 |
| #6 콜백 실패 후 복귀 | 저장 세션이 있으면 실제 본인 정보를 복원해 프로필로 복귀. 일시 실패는 세션을 유지하고, 거절된 세션은 정리한 뒤 로그인으로 이동                                                                                     |
| #7 제어권 잠김       | 두 게임 모두 `session.replaced` 후 재인증만으로 잠금을 풀지 않음. 연결된 새 소켓의 재구독 `match.snapshot`을 받은 뒤 착수·기권 허용                                                                                |
| #8 잘못된 경기 재개  | 현재 구독의 `NOT_FOUND`/`NOT_PARTICIPANT`는 구독 ID·저장한 재개 ID·경기 상태를 정리하고 로비로 복귀. 다른 경기의 늦은 일반 오류는 무시                                                                             |
| #11 오프라인 복원    | #142의 일시 네트워크 오류 분류와 토큰 보존을 통합                                                                                                                                                                  |
| #12 로그아웃         | 요청 중 Escape·배경·취소로 닫을 수 없음. 서버 요청 실패 시 로컬 로그아웃 안내만 표시하며 성공 문구를 함께 표시하지 않음                                                                                            |
| #14 로비 오류        | 대기열 오류는 대기열 상태에만 반영. 오목/오델로 게임 오류는 로비의 공통 표시 한 곳에서 처리                                                                                                                        |
| #16 방문 기록        | 대기 중 다른 경로로 이동하면 `queue.leave`. 늦은 `queue.joined`는 종료/취소 상태를 되살리지 않음. 취소된 `/matching` 기록·새로고침은 로비로 정리. 완료한 콜백 기록은 재전송하지 않고 다시 시작할 수 있는 안내 표시 |
| #26 2FA 조회 실패    | #142의 확인 실패 상태와 설정 버튼 숨김 통합                                                                                                                                                                        |
| #30 수동 재접속      | #142의 재시도 횟수 초기화 통합                                                                                                                                                                                     |
| #32 종료 코드        | 4400·1008·1009는 자동 재접속 중단. 사용자가 명시적으로 연결하면 새 재시도 주기 시작                                                                                                                                |
| #36 2FA 구분자       | #126의 `AB CD-EFGH` 등 서버와 같은 정규화·형식 검사 통합                                                                                                                                                           |
| #34 접근성           | 로그아웃·두 게임 기권·2FA 해제 모달의 초기 포커스/Tab 순환/복귀. 계정 메뉴 화살표·Home·End·Escape·바깥 클릭. 화면 전환 시 제목 포커스. 턴의 polite live 안내. 매칭 타이머 live 알림 제외. reduced motion 지원      |

주요 코드: [App.tsx](../apps/web/src/App.tsx), [공통 모달 포커스](../apps/web/src/ui/use-dialog-focus.ts), [ProfileView](../apps/web/src/profile/ProfileView.tsx), [WS client](../apps/web/src/game/ws-client.ts), 두 게임의 상태·대국 화면, [MatchmakingView](../apps/web/src/game/MatchmakingView.tsx), [styles.css](../apps/web/src/styles.css).

## 계약 변경

`GET /api/users/me`에 필수 boolean `oauth42Linked`를 추가했다. `oauth_accounts`의 현재 사용자·제공자 42 연결 존재 여부를 읽고 제공자 ID·토큰은 반환하지 않는다. 비밀번호 여부만으로 연결 상태를 추정하지 않는다. 다른 사용자 공개 프로필과 리더보드는 그대로다. DB migration은 없다. [계약 문서](contracts.md#본인-계정의-인증-수단-표시-136)와 서버 테스트를 함께 갱신했다.

## 검증

Windows / Node 26.13.0 / npm 11.20.0 / PostgreSQL 17.11 / 설치된 Google Chrome 158.0.8127.37. 별도 worktree와 새 임시 DB 두 개(단위·DB 통합용 `_test`, E2E용)를 사용했다. 기존 DB·환경 파일을 사용하지 않았다.

| 실행                                           | 결과                                                                                             |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `npm ci --prefer-offline --no-audit --no-fund` | lockfile대로 설치 성공                                                                           |
| `npm run build`                                | 타입 검사·production build 통과                                                                  |
| 새 E2E DB의 `npm run db:migrate`               | 기존 migration 7개 적용 성공. 새 migration 없음                                                  |
| 전용 `TEST_DATABASE_URL`로 `npm test`          | **46개 파일·529개 통과, skip 0**                                                                 |
| 수정 전 반증                                   | B 통합 직후 `ee97c7a`의 제품 코드로 새 상태/WS 테스트 5개 실행 시 **5개 실패**, 수정 코드로 통과 |
| Chrome UI 회귀                                 | **102개 모두 통과**, skip·retry 0                                                                |
| 실제 두 사용자·두 탭                           | 오목·오델로 **2개 통과**, skip·retry 0. 실제 API/DB·HTTPS/WSS 사용                               |
| 형식·공백                                      | 변경 코드 Prettier, `git diff --check` 통과                                                      |

UI 회귀는 1440×900·768×1024·360×800에서 [#136 시나리오](../tests/evaluation-136.spec.ts) 19개씩과 기존 약관 탐색·OAuth 콜백·친구 UI 테스트 15개씩을 실행한다. 합계 102개다. HTTP와 WebSocket 응답을 fixture로 대체해 오류·지연·콜백·접근성 조건을 제어한다. 실제 OAuth 제공자·DB 연동의 증거와 구분한다.

[실제 대국 테스트](../tests/evaluation-136-realtime.spec.ts)는 게임마다 두 사용자와 한 사용자의 탭 두 개로 실행했다. 새 탭이 제어권을 얻음 → 기존 탭 잠김 → 기존 탭의 명시적 재접속 → 착수 전파 → 반대 탭은 갱신을 받아도 계속 잠김 → 기권·양쪽 결과를 확인했다. 응답·게임 결과·WS 메시지를 mock하지 않았다. 로컬 신뢰 프록시를 쓰는 테스트에서는 API 요청에 테스트용 클라이언트 IP를 분리했고 외부 폰트 요청에는 헤더를 붙이지 않았다.

HTTPS는 실제 production build를 제공하는 Vite preview다. Node 요청은 테스트 CA, Chrome은 해당 인증서의 공개키 SPKI pin을 사용했다. `ignoreHTTPSErrors`를 사용하지 않았다. Docker/Nginx·서로 다른 실물 PC·OS 인증서 신뢰·실제 42 제공자 인증 검증은 이번 범위 밖이다. 42 계정 연결의 서버 테스트는 실제 PostgreSQL과 가짜 42 제공자를 사용한다.

1차 UI 실행에서 메뉴의 같은 키 이벤트가 두 번 처리되는 문제와 모달 종료 후 포커스 경합을 찾아 수정했다. 모바일에서 메뉴에 가려진 제목을 클릭하던 테스트와 같은 이름의 약관 복귀 버튼 두 개를 구분하지 못한 테스트도 실제 노출된 요소를 선택하도록 고쳤다. 실패 로그·trace를 남기고 기대값이나 서버 제한을 완화하지 않았다.

원본 로그와 실행 설정은 worktree의 로컬 `.validation/`에, 첫 실패 캡처·trace는 `C:/Users/Public/Documents/ESTsoft/CreatorTemp/ft-eval136-20261113/ui-first-run/`에 보관했다. [기계 판독 검증 요약](evaluation-136-evidence.json)에 소스·산출물 해시와 실행 결과를 기록한다. 인증서·키·DB·계정 자격증명은 커밋하지 않는다.

## 재현

1. 후보 브랜치에서 `npm ci`, `npm run build`를 실행한다.
2. 폐기 가능한 `_test` DB를 준비하고 `TEST_DATABASE_URL`을 지정해 `npm test`를 실행한다. DB 테스트는 테이블을 비운다.
3. [실행 안내](runtime.md)에 따라 HTTPS production build·API·별도 E2E DB를 기동한다. `E2E_BASE_URL`, `E2E_TLS_SPKI`를 설정한다.
4. 기존 HTTPS 인수 설정으로 UI 회귀를 실행한다.

```sh
npx playwright test --config=config/playwright.acceptance.config.ts \
  tests/evaluation-136.spec.ts tests/legal-routing-regression.spec.ts \
  tests/oauth-callback.spec.ts tests/friends-ui.spec.ts
npx playwright test --config=config/playwright.acceptance.config.ts \
  tests/evaluation-136-realtime.spec.ts --project=desktop
```

이 수정은 인증 rate limit을 바꾸지 않는다. #143에 기록한 전체 프로필 E2E의 빠른 반복 refresh 429 및 최종 제출 SHA의 Docker/Nginx·작성자 외 재현은 별도 인수 조건으로 남는다. 이 PR에서 #116/#88을 종료하지 않는다.
