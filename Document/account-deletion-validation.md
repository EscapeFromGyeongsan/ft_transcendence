# 회원 탈퇴 화면 검증 (#85)

## 범위와 출처

중단된 `feat/web-account-withdrawal`의 `4529497` 구현과 미커밋 E2E를 이어서 검증했습니다. 작업 시작 시 13개 파일을 `.omx/handoffs/account-withdrawal-20261112T124536Z`에 원본·해시·패치로 보관했습니다.

기존 PR #106(`feat/web-account-deletion`, `aecf08c`)은 다른 작성자의 별도 구현입니다. 이 브랜치의 결과를 #106에 반영하거나 두 구현을 함께 병합한 상태로 간주하면 안 됩니다.

탈퇴 입력은 서버 #89의 `10787f65e7c066f4ea3ef1823180c5f2c10f7a44` 계약을 따릅니다.

- `hasPassword: true`: 2FA 활성화 여부와 무관하게 비밀번호만 전송합니다.
- `hasPassword: false`: 2FA 코드·복구 코드를 전송하거나, 2FA가 없으면 최근 10분 로그인으로 확인합니다.
- 비밀번호 보유 여부가 없는 이전 서버에서는 수동 선택을 유지합니다. 2FA 상태 조회가 실패해도 코드 입력 수단을 유지하며, 서버가 코드를 요구하면 입력란을 엽니다.
- 400 본인 확인 오류·409 활성 경기·429·5xx·네트워크 실패는 대화상자에서 처리합니다. 401은 로그인, 403은 재로그인 안내로 연결합니다.
- 성공한 DELETE의 204보다 WS 세션 폐기가 먼저 와도 성공으로 처리합니다. 요청 중 새 계정으로 로그인한 경우 새 토큰을 지우지 않습니다.

## 재현 방법

```sh
npm ci
npm test -- apps/web
npm run build
```

`tests/account-deletion.spec.ts`는 실제 서버 테스트와 부분 계약 테스트를 구분합니다. 실제 서버 그룹은 #89와 실제 게임·프로필 공개 설정을 결합한 서버, 적용된 migration, **폐기 가능한 전용 DB**가 필요합니다. 테스트는 가입한 계정을 실제로 삭제합니다.

로그인 제한은 IP당 분당 10회이므로 프로젝트와 그룹마다 별도 API 인스턴스를 시작합니다. `DATABASE_URL`, `JWT_SECRET`, `TWO_FACTOR_KEY`와 사용하지 않는 `PORT`·`E2E_PORT`를 설정한 통합 후보에서 실행합니다. `CI=1`은 이미 실행 중인 서버를 재사용하지 않도록 합니다.

```sh
for withdrawal_project in desktop mobile; do
  CI=1 E2E_ACCOUNT_DELETION_INTEGRATION=1 npm run test:e2e -- tests/account-deletion.spec.ts --project="$withdrawal_project" --grep 'DELETE /api/users/me'
  CI=1 npm run test:e2e -- tests/account-deletion.spec.ts --project="$withdrawal_project" --grep 'UI 계약'
done
```

이 플래그가 없으면 실제 서버 그룹 4개는 의도적으로 건너뜁니다. 나머지 6개는 가입·로그인·세션은 실제 서버를 쓰고, 계정 종류·2FA 상태와 DELETE 오류만 가로챕니다. OAuth/2FA 계정의 실제 탈퇴 성공을 이 6개로 증명하지 않습니다.

## 통합 후보

제품 브랜치에는 서버 병합을 넣지 않았습니다. 별도 worktree `/private/tmp/ft-transcendence-withdrawal-integration`에서 `4529497`과 고정 #89 커밋을 결합하고 최신 화면·테스트를 복사했습니다. 기존 실제 오목·오델로 엔진과 WS, 전적 접근 권한 검사를 유지했습니다.

두 브랜치의 migration 번호 0004가 겹치므로 기존 `0004_records_public`과 기존 이력을 보존하고 후보 전용 `0005_account_deletion`을 생성했습니다. 새 SQL은 #89의 닉네임 backfill과 삭제 표시 의미를 유지합니다. 새 테스트 DB 세 개에 migration이 통과했습니다. 이 후보를 원본 PR이나 기존 운영 DB에 적용한 것은 아닙니다.

상세 출처·충돌 해결 기록은 후보의 `CANDIDATE-PROVENANCE.md`와 저장소의 `.omx/plans/account-withdrawal-handoff-20261112.md`에 있습니다.

## 검증 결과와 남은 범위

2026-11-12, macOS / Node.js 22.23.2 / PostgreSQL 17 / Playwright 1.63.0 / Chrome 157.0.8103.52에서 확인했습니다. 기본 Chromium 설치 대신 후보에만 임시 `channel: "chrome"` 설정을 사용했습니다. 모바일은 Pixel 7 에뮬레이션이며 실제 기기 검증은 아닙니다.

| 검사                        | 최종 결과                                                 |
| --------------------------- | --------------------------------------------------------- |
| 제품 브랜치 웹 단위 테스트  | 11개 파일·139개 통과                                      |
| 통합 후보 전체 단위·실제 DB | `TEST_DATABASE_URL` 지정, 38개 파일·416개 통과, skip 없음 |
| 실제 서버 탈퇴              | desktop 4개 + mobile 4개 통과                             |
| 부분 계약·접근성            | desktop 6개 + mobile 6개 통과                             |
| 정적 검사                   | TypeScript·Vite build·대상 Prettier·diff 공백 검사 통과   |

실제 두 계정으로 오목을 끝낸 뒤 탈퇴, 400 잘못된 비밀번호 뒤 세션 유지, 성공 시 로그인/토큰 정리, 탈퇴 계정 로그인 거절·동일 자격 정보 재가입, 상대 전적의 과거 닉네임·삭제 표시와 링크 제거, 프로필 404·리더보드 제외를 확인했습니다. 다른 기기의 refresh 거절, 실제 경기 중 409, 실제 탈퇴 응답을 보류한 상태에서 뒤로가기를 눌러도 완료 후 글로벌 로그인 상태 정리까지 확인했습니다.

API 단위 회귀는 세션 폐기 refresh 401 → 늦은 DELETE 204의 성공과, 대기 중 다른 계정으로 로그인했을 때 새 토큰 보존을 함께 검사합니다. 부분 계약 검사는 요청 중 Tab·Shift+Tab·Escape·배경 클릭, 400 뒤 입력 포커스, 나중에 활성화된 2FA의 코드 입력 복구, 401·403·429·503·네트워크 단절을 확인합니다.

처음 E2E 실행에서 로그인 폼/계정 메뉴의 잘못된 테스트 선택자를 고쳤습니다. 연속 실행의 로그인 429는 trace로 확인한 뒤 서버 제한을 유지하고 위 네 실행으로 분리했습니다. 최종 네 실행은 재시도 없이 모두 통과했습니다. 실제 서버와 계약 응답을 합친 20개이며, 20개 모두를 무대체 서버 검증이라고 주장하지 않습니다.

이번 범위에서는 실제 42 제공자 로그인, 실제 OAuth/2FA 탈퇴 성공, HTTPS/WSS 배포 환경, #95 친구·#98 presence와 탈퇴의 통합을 검증하지 않습니다. 기존 PR #106과 이 구현 중 채택할 결과를 정한 뒤 통합 후보를 다시 구성해야 합니다.
