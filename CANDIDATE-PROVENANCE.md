# #88 인수 검증 후보 — 서버 출처와 한계

이 worktree는 탈퇴·친구·presence·실제 오목/오델로를 함께 확인할 **검증용 통합 후보**입니다. 테스트 통과를 원본 PR의 결함 해결이나 배포 승인으로 해석하지 않습니다. 서버 준비 담당자의 수정 범위는 `apps/server/**`와 이 문서뿐입니다. 프런트엔드·인프라·브라우저 테스트·인수 문서는 다른 담당자가 준비합니다.

## 기준과 가져온 출처

- 후보 경로: `/private/tmp/ft-transcendence-acceptance-88`
- 파일 복사 전 HEAD: `fcc5a7b9f909198c4c78fc749aa35f6bc2544f5d` (리더가 만든 웹 통합 기준)
- 탈퇴/실제 게임 서버 기준: `/private/tmp/ft-transcendence-withdrawal-integration`의 검증된 working tree. 최초 기준은 `4529497a76ecbff7c0d936914ca4356308659c3e`, #89 출처는 `10787f65e7c066f4ea3ef1823180c5f2c10f7a44`입니다. 해당 후보에서 서버의 `src/`와 `drizzle/`를 읽어 이 후보에 복사했습니다.
- 위 두 디렉터리의 정렬된 상대 경로, NUL, 내용, NUL을 차례로 해시한 SHA-256: `d0fe5333bc3e9e49603605d58d7464b38bb77c4f6a39fff9aa9f681d920c19ec`.
- 친구 API: #95 `758459e197bf23ee48682166656548b192f9c1a5`. schema/service/routes/tests를 `git show`로 복사했습니다. 별도 친구 repository 파일은 없으며 SQL·transaction이 `friend-service.ts` 안에 있습니다.
- presence: #98 최신 `33192539dbe70ac415bc29c4298f5da49a8e1fa8`. registry/presence/WS/matchmaking 구현과 테스트를 복사했습니다. 이전 친구 후보의 app glue만 참고했으며, 이전 #98 소스를 가져오지 않았습니다.
- `node_modules` 복제와 의존성 준비는 리더가 수행했습니다. 서버 담당자는 의존성이나 lockfile을 변경하지 않았습니다.
- 이 작업에서 `git merge/reset/checkout/add/commit/push` 및 외부 게시를 실행하지 않았습니다. 다른 후보·원본 migration·공유 DB를 수정하지 않았습니다.

아래 파일은 표시한 고정 커밋과 **바이트가 같습니다**. `friend-routes.test.ts`의 후보 전용 차이는 다음 절에서 별도로 설명합니다.

| 파일                                                   | 출처      | SHA-256                                                            |
| ------------------------------------------------------ | --------- | ------------------------------------------------------------------ |
| `apps/server/src/db/schema/friendships.ts`             | `758459e` | `bbae56a1dc497af40bec6bd76fa9247b043e21df5f0aba9dd8828297666d84dc` |
| `apps/server/src/services/friend-service.ts`           | `758459e` | `41f3e753036177f940c4f1a2d62508e8b84aaa56f9e4b462fcd89a9c6d345aaa` |
| `apps/server/src/api/friend-routes.ts`                 | `758459e` | `bd6f2c524e53e5c0ec7dae91a34a4befe3a04690ee12f194deb0e410241ca144` |
| `apps/server/src/services/connection-registry.ts`      | `3319253` | `9ae849be06ecf6d89bd292c03fc7bc4f963a8ce22b8b27c3cc3cd96f9c293487` |
| `apps/server/src/services/connection-registry.test.ts` | `3319253` | `99023be6ebde77777ae7beb3b63511f433d69f109d448c029054d663b7c6a697` |
| `apps/server/src/services/presence.ts`                 | `3319253` | `2da58a203fdbc38573fb4bff8394dbd96cb79272f9ff17061c5809b2825c64c1` |
| `apps/server/src/services/presence.test.ts`            | `3319253` | `8f70d6d89b37353541f70c67e3671f32cb5c43787f5c07f545c1cdb5e9e1716e` |
| `apps/server/src/api/ws-routes.ts`                     | `3319253` | `d8653b3ffa6b1cb875acffbc4a5f8551316e2b15734c6098f849e3cb14089a2a` |
| `apps/server/src/api/ws-routes.test.ts`                | `3319253` | `7ee95fc24ac8b637d97195da374a2ab04159313ca4b082b127c7a415a2d272b0` |
| `apps/server/src/services/matchmaking.ts`              | `3319253` | `02251e5c1df45d30e743a0af399260aa9005ba57057fa850688f74e4d4dde94a` |
| `apps/server/src/services/matchmaking.test.ts`         | `3319253` | `49d17a0e5655f7d97aaa8c3af3f5d102e6c3038088dd4ba5bc0a542b5160c739` |

## 후보에서 추가한 연결

`apps/server/src/app.ts`는 탈퇴 후보의 게임 엔진 주입·개인정보 접근 제어·탈퇴·로그아웃·refresh 재사용에 따른 세션/WS 폐기를 유지하면서 다음 연결만 추가했습니다.

- 친구 서비스에 같은 API 인스턴스의 실제 인증 연결 registry `isUserOnline`을 주입합니다. REST 목록의 `online`과 presence 이벤트가 같은 기준을 읽습니다.
- registry의 0↔1 인증 연결 수 변화는 최신 presence 서비스로 전달합니다. 기본 presence 수신자 조회는 실제 `listAcceptedFriendIds`입니다. 일곱 번째 선택 인자는 #98 원본 테스트의 수신자 주입 호환성을 위해 유지했습니다.
- request/accept/decline/remove가 DB transaction 성공을 반환한 **뒤** 양쪽 사용자에게 `friends.changed`를 보냅니다. decline은 원본 public 반환값의 `result.userId`, remove는 요청 대상 ID를 사용합니다.
- 사용자별 `sendToUser` 예외를 기록하고 삼켜 상대 사용자 알림과 이미 commit된 REST 성공을 유지합니다. 전송 보장/재생은 없으며 재연결/화면 진입 시 REST 재조회가 필요합니다.
- 최신 #98의 generation 기반 수신자 재조회와 최대 5회 제한을 그대로 유지합니다. 이전 #98의 오래된 비동기 수신자 목록으로 삭제한 친구에게 presence가 가는 문제를 이 후보가 그대로 보존한다고 주장하지 않습니다. 이 수정은 모든 관계 변경이 동일 presence 객체의 `notifyFriendsChanged`를 거친다는 전제입니다.
- 최신 WS의 인증 단계 분리(세션 임시 등록→재검증→`auth.ok` 직전 사용자 집계), 30회/분 upgrade 제한, 실제 command/subscribe/queue/reconnect/heartbeat를 유지합니다. 함께 가져온 matchmaking은 다른 탭의 leave가 조회 중 join을 취소하는 계약을 유지합니다.

`index.ts`, `engines.ts`, `game-command-service.ts`, account repository/service, stats repository/service는 탈퇴 후보와 바이트가 같습니다. 실제 오목·오델로 엔진 등록, #79 권한 확인/조회 transaction과 `FOR SHARE`, #89 `hasPassword`·과거 닉네임·삭제 여부가 남아 있습니다.

#95의 `friend-routes.test.ts`는 게임 엔진 인자와 충돌하는 여섯 번째 `() => false` 주입을 제거했습니다. 앱이 실제 registry를 기본 연결하므로 기존 'unbound app은 503' 기대는 '직접 만든 unbound service는 계속 거절하며, 연결된 후보 앱은 200/online:false'로 변경했습니다. 원본 서비스의 unbound 실패 검증을 지우지 않았습니다. 다른 제품 동작을 조용히 바꿔 원본 결함을 통과시키지 않았습니다.

## 기존 이력을 유지한 후보 전용 migration

순서는 기존 `0000`~`0004_records_public`, 탈퇴 후보의 `0005_account_deletion`, 새 `0006_friendships`입니다. 탈퇴 후보의 기존 SQL/snapshot 12개는 바이트가 같고 journal 0~5 항목은 그대로입니다. 새 snapshot의 `prevId`는 0005 ID이며 전적 공개·삭제 시각·닉네임 snapshot·friendships를 함께 포함합니다.

```sh
DATABASE_URL=postgresql://candidate:unused@127.0.0.1:1/acceptance_generation \
  npx drizzle-kit generate --config=config/drizzle.config.ts --name=friendships
```

생성은 DB에 접속하지 않습니다. 새 `0006_friendships.sql`은 #95의 원래 `0004_friendships.sql`과 공백을 제외하면 같습니다. 원본 SQL·이미 적용된 migration을 덮어쓰지 않았습니다. 이 일련의 migration은 리더가 만든 **새 폐기 가능한 후보 DB**에만 적용합니다. 공유/기존 적용 DB 업그레이드 절차의 증거가 아닙니다.

## 원본에 남아 있는 탈퇴·친구 결합 결함

다음은 의도적으로 고치지 않은 **#95/#89 결합 한계**입니다. 기본 기능 성공과 별개로 전체 인수 완료의 제한입니다.

1. `friend-service.ts:66`의 `findUser`와 `:106` 대상 조회에는 `deleted_at IS NULL`과 사용자 `FOR SHARE`가 없습니다. 탈퇴된 ID로 새 요청을 만들거나 요청/탈퇴가 경합할 수 있습니다. 원본 서비스는 그대로이므로 수정되지 않았습니다.
2. `friend-service.ts:247` 관계 조회와 `:264` 상대 프로필 조회, `:291` 검색, `:313` 수락된 친구 ID 조회는 삭제 사용자를 제외하지 않습니다. 남은 관계에서 `deleted:<id>`가 보이거나 삭제된 사용자에 대한 친구 ID가 계속 나올 수 있습니다.
3. `account-repository.ts:14`는 탈퇴 대상 사용자에 `FOR UPDATE`를 잡지만, `:58`의 `anonymizeUser`는 friendship을 지우지 않습니다. soft delete이므로 FK의 `ON DELETE CASCADE`도 실행되지 않습니다. 탈퇴에 따른 관계 삭제/양쪽 `friends.changed`도 없습니다.
4. 따라서 대상 조회의 활성 사용자 조건과 잠금, 탈퇴 transaction 내 관계 정리 및 commit 뒤 관계 알림을 원본 담당자와 합의해 보완해야 합니다. 이 후보는 그 변경을 대신 구현하지 않았고 이 경합을 client 수정으로 해결했다고 주장하지 않습니다. 최신 #98 fix도 알림을 거치지 않는 관계 변경을 자동으로 감지하지 않습니다.

리더가 전용 DB에서 위 동작을 재현할 수 있습니다. 이미 삭제된 사용자 ID에 친구 요청, 친구 유지 상태에서 탈퇴 후 상대 목록/검색, 사용자 행을 잠근 탈퇴와 친구 요청의 동시 실행이 해당 사례입니다. 서버 준비 담당자는 DB 검증을 중복 실행하지 않았습니다.

## 서버 준비 단계 검증

```sh
npx tsc --noEmit
TEST_DATABASE_URL= npx vitest run --config=config/vitest.config.ts \
  apps/server/src/api/account-deletion.test.ts \
  apps/server/src/api/friend-routes.test.ts \
  apps/server/src/api/ws-routes.test.ts \
  apps/server/src/services/presence.test.ts \
  apps/server/src/services/connection-registry.test.ts \
  apps/server/src/services/matchmaking.test.ts \
  apps/server/src/api/stats-routes.test.ts \
  apps/server/src/app.test.ts \
  apps/server/src/engines.test.ts
```

- 대상 Vitest: **9개 파일, 47개 통과·63개 DB 의존 테스트 건너뜀(전체 110개)**. `TEST_DATABASE_URL`을 비워 DB에 접속하지 않았습니다.
- 첫 전체 typecheck는 서버 오류 없이 `apps/web/src/App.tsx:2327`의 `FriendsViewProps`에 없는 `onAccountDeleted` 전달 때문에 실패했습니다. 소유 범위 밖이므로 리더에게 전달했고 변경하지 않았습니다.
- 서버/패키지만 포함하는 임시 tsconfig로 별도 검사해 **통과**했습니다. `apps/server/.acceptance-typecheck.tmp.json`의 내용은 `{"extends":"../../tsconfig.json","include":["./src","../../packages"],"exclude":[]}`였고, 실행 명령은 `npx tsc --noEmit -p apps/server/.acceptance-typecheck.tmp.json`입니다. 검사 후 임시 파일을 제거했습니다.
- 바이트 대조로 원본 복사·탈퇴 후보 보존과 migration chain을 확인했습니다. 문서/추가 glue의 형식 검사와 diff 공백 검사를 수행합니다.

DB migration·전체 DB 테스트·실제 두 계정/양 종목 브라우저·HTTPS/WSS·다중 화면 크기 인수 검증은 리더와 해당 담당자의 별도 결과가 필요합니다. 기존 account/WS 테스트 일부는 stub 엔진이나 수신자 주입을 사용하므로 해당 통과만으로 실제 두 종목 경기를 검증했다고 주장하지 않습니다.

## 변경 파일

서버 준비 시 HEAD에 대해 변경/추가한 경로입니다. 이 문서 외 frontend/infra/tests/docs는 다른 담당자의 소유입니다.

- `apps/server/drizzle/0005_account_deletion.sql`
- `apps/server/drizzle/0006_friendships.sql`
- `apps/server/drizzle/meta/0005_snapshot.json`
- `apps/server/drizzle/meta/0006_snapshot.json`
- `apps/server/drizzle/meta/_journal.json`
- `apps/server/src/api/account-deletion.test.ts`
- `apps/server/src/api/auth-routes.test.ts`
- `apps/server/src/api/friend-routes.test.ts`
- `apps/server/src/api/friend-routes.ts`
- `apps/server/src/api/oauth-routes.test.ts`
- `apps/server/src/api/stats-routes.test.ts`
- `apps/server/src/api/stats-routes.ts`
- `apps/server/src/api/user-routes.ts`
- `apps/server/src/api/ws-routes.test.ts`
- `apps/server/src/api/ws-routes.ts`
- `apps/server/src/app.ts`
- `apps/server/src/db/schema/friendships.ts`
- `apps/server/src/db/schema/games.ts`
- `apps/server/src/db/schema/users.ts`
- `apps/server/src/repositories/account-repository.ts`
- `apps/server/src/repositories/auth-repository.ts`
- `apps/server/src/repositories/game-repository.ts`
- `apps/server/src/repositories/stats-repository.ts`
- `apps/server/src/repositories/user-repository.ts`
- `apps/server/src/services/account-service.ts`
- `apps/server/src/services/avatar-service.ts`
- `apps/server/src/services/connection-registry.test.ts`
- `apps/server/src/services/connection-registry.ts`
- `apps/server/src/services/friend-service.ts`
- `apps/server/src/services/matchmaking.test.ts`
- `apps/server/src/services/matchmaking.ts`
- `apps/server/src/services/presence.test.ts`
- `apps/server/src/services/presence.ts`
- `apps/server/src/services/stats-service.ts`

## #88 측정 도구

- `scripts/measure-perf.mjs`: PR #105, `8fd513ebdbdb91c165996ff60b2f1a891b2897ce` 원본. `package.json`에 같은 실행 명령만 추가.
- 부하 결과는 DEC-10 승인 전 측정값으로만 기록하며 합격 판정을 내리지 않습니다.
