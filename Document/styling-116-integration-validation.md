# #116 통합 후보와 A 검증 기록

2026-11-13 KST. 이 문서는 **로컬 검증 후보**의 결과다. master 병합, 최종 제출 SHA 승인, 작성자 외 재현을 완료했다는 뜻은 아니다.

## 진행 상황과 이번 처리

| 담당 | 확인한 진행 상황                                                                                                                              | 남은 것                                        |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| A    | 공통 버튼·입력·카드 19개 규칙의 `@apply`는 #124에서 구현되어 #119에 병합됨. 이번에 최신 master와 #119를 통합하고 빌드·DB·Chrome 검증을 수행함 | 팀 리뷰, 제출 후보 확정, E 재현 결과 취합      |
| B    | Tailwind 도입 #119, README·SDS·평가 시연 문서 #118이 열려 있음                                                                                | 각 PR의 통합·최종 후보와 문서 대조             |
| C    | #116의 조회한 댓글 7개에는 별도 게임판·결과 화면 보고가 없음                                                                                  | 게임판·결과 색상·가독성 확인                   |
| D    | 최신 서버 반영과 매칭·재접속 상태 보고 완료. 제출 SHA가 나오면 두 브라우저로 확인하겠다고 기록함                                              | 확정 SHA에서 실시간 흐름 재현                  |
| E    | #119 원본 `45a6351`의 실제 API/DB·HTTPS/WSS 친구 화면 검증 기록 있음                                                                          | 최종 후보의 Docker/Nginx 재현과 작성자 외 기록 |

#124는 #119의 브랜치에 병합된 상태이며 master에 들어간 상태는 아니다. #119는 조회 시 리뷰가 없었다. 이번 작업은 원격 PR 승인·병합·댓글 게시를 수행하지 않았다.

## 후보 출처와 충돌 처리

- 브랜치: `integrate/styling-116`, 별도 worktree `.worktrees/styling-116`.
- master 기준: `742ba64`.
- #119 기준: `c51bf27cc84d0cbcf0abc34ab96feb29358082bb` (#124 포함).
- 제품 소스 고정: `aa7fd57be440c15479e111c2797c1cfa55fbced5`. 이후 이 기록·체크리스트 등 문서만 추가한다.
- #118의 스타일링 설명·시연 절차(`a727ade`, `69a2e29`)를 현재 README/SDS 구조에 맞춰 반영했다. #118 전체 문서 재작성·DB 스키마 설명을 병합한 것은 아니다.

master와 #119를 합치며 `README.md`, `Document/contracts.md`, `app.ts`, `connection-registry.ts`의 충돌을 해결했다. 최신 master의 WS 메시지 상한 32개, 종료 경기의 중복 ack/`GAME_FINISHED`, 연결 제거 시 경기 ID 반환, refresh 재사용 폐기 연결을 보존했다. 후보의 실제 친구 서비스·presence 연결과 탈퇴/전적 공개 기능도 유지했다. `ws-routes.test.ts`의 자동 병합 중복 import를 제거했다.

이후 전체 테스트로 드러난 친구 목록 응답의 Swagger 설명 누락을 보완하고, 토큰 저장소 테스트가 Node 26의 기본 `navigator.locks`에 의존하지 않도록 브라우저 mock을 명시했다. Chrome의 기본 `/favicon.ico` 404 요청을 막기 위해 빈 data favicon을 지정했다. 웹 제품 코드에서 #119와 다른 파일은 `apps/web/index.html`뿐이다. 파일별 보존 결과와 산출물 해시는 [기계 판독 기록](styling-116-integration-evidence.json)에 있다.

후보의 migration 순서는 #115의 `0004_records_public → 0005_account_deletion → 0006_friendships`다. 새 임시 DB에 적용했으며, 기존·공유 DB의 migration 순서를 바꾸지 않았다. PR별 병합 시 #96의 별도 순서와 혼용하면 안 된다.

## 검증 결과

환경: Windows, Node 26.13.0, npm 11.20.0, PostgreSQL 17.11, 설치된 Google Chrome **158.0.8127.37**. Chrome 최신 안정판 여부를 별도로 확인한 결과는 아니다.

| 확인                                                | 결과                                                                                                     |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `npm ci --prefer-offline --no-audit --no-fund`      | #119 lockfile 그대로 성공                                                                                |
| `npm run build`                                     | 타입 검사·production build 성공. CSS 53.35 kB / gzip 9.35 kB                                             |
| `npm run db:migrate`                                | 새 E2E DB에 migration 7개 적용 성공                                                                      |
| `TEST_DATABASE_URL=…/styling116_unit_test npm test` | **45개 파일, 513개 모두 통과, skip 0**                                                                   |
| 코드 형식·공백                                      | 변경 코드의 Prettier 검사와 `git diff --check` 통과                                                      |
| Chrome 전체 기존 E2E                                | 74개 중 57 통과, 5 실패, 기존 조건에 따른 12 제외, 자동 retry 0                                          |
| 실패한 5개만 재확인                                 | 3 통과, **프로필 2개는 반복 refresh 중 HTTP 429로 실패**. 전체 E2E 통과로 표시하지 않음                  |
| 스타일링 화면 측정                                  | 1440×900·768×1024·360×800 각각 로그인·로비·프로필·친구, 총 **12개 화면** 확인                            |
| 실제 연결·리소스                                    | 실제 API/별도 PostgreSQL, HTTPS, `wss://…/api/ws`의 `auth.ok`, Epilogue·Plus Jakarta Sans 실제 로드 확인 |
| 화면·키보드·콘솔                                    | 가로 넘침 없음, 이메일→비밀번호 Tab, 빈 친구 검색 비활성, 콘솔 경고·오류·JS 예외 **0건**                 |

화면 측정에서 로그인 폼의 `display:flex`, 세로 배치·간격 **20px**, 친구 검색 필드의 최소 폭 **192px**·간격 **6px**을 확인했다. 로그인과 친구 검색의 JSX utility 및 공통 `.cbc-input`/버튼의 `@apply`가 production CSS에서 실제 사용된다. 캡처: [360px 로그인](styling-116-evidence/login-360.png), [1440px 친구](styling-116-evidence/friends-1440.png).

HTTPS는 자체 테스트 인증서를 지정한 Vite **production preview**다. Node 요청에는 해당 CA를, Chrome에는 해당 인증서 공개키 SPKI pin만 지정했으며 `ignoreHTTPSErrors`는 사용하지 않았다. Docker/Nginx Compose나 OS 인증서 신뢰 설정의 증거는 아니다.

초기 화면 측정은 테스트용 `X-Forwarded-For`가 외부 폰트에도 붙어 CORS 오류를 만들었다. 그 헤더를 제거하고 API를 고정 소스로 다시 시작한 뒤 12개 화면을 측정한 것이 위 최종 결과다. 정상 흐름의 외부 폰트를 mock하거나 차단하지 않았다.

전체 E2E와 실패 항목 재실행은 HTTP/WS fixture를 사용하는 친구 UI·약관 탐색·일부 오류 시나리오와 실제 API/DB를 사용하는 가입·인증·친구·게임·프로필 시나리오를 함께 포함한다. 특히 프로필 E2E의 최종 실패 화면에는 요청 제한 안내가 남는다. 한 IP의 빠른 인증 요청이 인수 흐름을 막는 문제를 별도 조사·조절해야 하며 서버 제한이나 기대값을 완화해 통과시키지 않았다. 첫 실패 캡처·trace도 로컬에 보존했다.

## 재현과 인계

저장소 루트에서 `git rev-parse HEAD`, `npm ci`, `npm run build`를 기록한다. PostgreSQL 테스트는 **새 전용 DB**의 이름이 `_test`로 끝나도록 준비한 뒤 `TEST_DATABASE_URL`을 설정하고 `npm test`를 실행한다.

제출 환경에서는 [runtime.md](runtime.md)에 따라 `make local` 또는 `make HOST=<주소>`로 기동하고, 실제 제출 SHA에서 같은 과정을 반복한다. 기존 [HTTPS 인수 설정](../config/playwright.acceptance.config.ts)은 `E2E_BASE_URL`, `E2E_TLS_SPKI`를 받아 Chrome을 실행한다. 가입·로그인·새로고침을 한 IP에서 연속 실행할 때 인증 rate limit을 지켜 시나리오를 분리한다.

[체크리스트의 시연 절차](evaluation/mandatory-checklist.md#스타일링-솔루션-시연-116)에 따라 로그인과 프로필/친구 화면 두 곳 이상의 사용 코드·렌더링을 보여 준다. 정확한 이번 실행용 설정·로그·12개 원본 캡처는 worktree의 로컬 `.validation/`에 있으며, 첫 E2E 실패 자료는 `C:/Users/Public/Documents/ESTsoft/CreatorTemp/ft-styling116-20261113/browser-first-run/`에 보존했다. 인증서·키·DB·테스트 계정 자격증명은 커밋하지 않는다.

## 제출 전 남은 조건

- [ ] #96에 따라 팀 리뷰·migration 순서를 합의하고 최종 제출 SHA를 확정한다.
- [ ] 같은 SHA에서 Docker/Nginx production build와 HTTPS/WSS를 검증한다. 이 PC에는 Docker가 없어 미실행이다.
- [ ] 프로필 E2E의 인증 rate limit 영향을 해소하고 전체 실행 결과를 남긴다.
- [ ] C의 게임판·결과 화면, D의 매칭·재접속, E의 배포 재현 결과를 연결한다.
- [ ] 작성자 외 팀원이 두 화면 이상의 코드·렌더링 시연을 따라 하고 #116/#88에 기록한다.

위 조건이 남아 있으므로 #116과 #88을 종료하지 않는다.
