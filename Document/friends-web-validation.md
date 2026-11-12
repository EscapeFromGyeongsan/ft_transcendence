# 친구 화면 검토 반영 및 연동 검증

실행일: 2026-11-12 JST. 추적: [#90](https://github.com/EscapeFromGyeongsan/ft_transcendence/pull/90), [#80](https://github.com/EscapeFromGyeongsan/ft_transcendence/issues/80).

제품 기준은 #90의 `0f111a2`와 이번 변경분이다. 서버 계약은 #95 `758459e197bf23ee48682166656548b192f9c1a5`, 온라인 집계·알림은 #98 `07a4989e307f0fe6b7b8ecf3c016a06b077c763d`의 소스·리뷰와 대조했다. 두 서버 PR은 검증 당시 미병합이다. #90에 서버 코드·migration·새 의존성을 추가하지 않는다.

## 반영 내용

- 목록·검색·변경 요청은 각각 15초로 제한한다. timeout이면 개별 fetch를 취소하고 처리 결과 미확정을 알린다. 공유 인증 refresh는 취소하지 않으며, 지연된 refresh가 끝나도 timeout된 변경 요청을 새로 전송하거나 재시도하지 않는다.
- 변경 성공과 후속 조회 실패를 구분한다. timeout·404·409 이후에는 목록을 다시 읽고, 최신 목록을 확인하기 전까지 오래된 목록의 변경 버튼을 막는다. 변경 요청 자체는 자동 재전송하지 않는다.
- 온라인 상태가 마지막 목록 조회 시점의 값임을 화면에 안내한다. 현재 #95의 `online`은 boolean이며 집계가 연결되지 않으면 503이다. B 검토안의 명시적 `null`도 확인 불가로 보존한다. 누락·잘못된 타입·503을 오프라인으로 바꾸지 않는다.
- 현재 인증된 WS의 `presence { userId, online }`, `friends.changed {}`는 목록 재조회 계기로만 사용한다. 알림 payload로 관계·온라인 값을 직접 덮지 않는다. 겹친 조회는 기존 controller로 병합하며 이전 계정·화면·소켓의 응답을 폐기한다. 연결 복구·화면 진입·수동 새로고침도 REST를 다시 읽는다.
- 요청·수락·거절·삭제, 상대 프로필 이동, URL 방문 기록, 확인 대화상자의 취소 포커스·Tab·Escape·포커스 복귀를 유지한다. 초대·채팅·회원 탈퇴는 범위 밖이다.

## 계약 대조

| 항목      | 검증한 계약                                                                                                                                                          |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 검색      | `GET /api/users?nickname=접두사` → `{ id, nickname, avatarUrl }[]`, 최대 20명, 본인 제외. 입력은 trim한 1~32자. 내부에서는 `userId`로 변환한다.                      |
| 목록      | `GET /api/friends` → `friends/incoming/outgoing`. 친구는 `userId/nickname/avatarUrl/online`, pending 요청은 `requestId/createdAt`도 포함한다.                        |
| 변경      | 요청 생성은 `userId`, 수락·거절은 `requestId`, 친구 삭제는 `userId`를 사용한다. 생성 201 또는 맞요청 수락 200, 수락 200, 거절·삭제 204.                              |
| 경합·권한 | 삭제된 친구·이전 요청 ID는 404, 본인이 보낸 요청의 수락은 403, 충돌은 409. #95의 거절 후 재요청은 409 `REQUEST_DECLINED`이며, B 검토안의 403도 같은 코드로 안내한다. |

## 검증의 구분과 결과

환경: macOS / Node.js 26 / PostgreSQL 17 / Playwright 1.63 / 설치된 Chrome 157. 검증은 HTTP·WS loopback에서 수행했다. Chromium 다운로드 캐시 대신 임시 Playwright config로 기존 두 project의 `channel: "chrome"`만 지정했다. 해당 config와 실행 산출물은 커밋하지 않는다.

| 실행              | 대상과 결과                                                                                                                                                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 전체 단위·DB      | 별도 `_test` PostgreSQL DB, 37개 파일·401개 통과, skip 없음. auth refresh·지연 취소·DTO·controller·WS 인증 경계 포함.                                                                                                           |
| 친구 UI           | `friends-ui.spec.ts`: REST·인증·프로필·WS를 대체한 합성 fixture. desktop/mobile 8개 통과. 실제 15초 timeout·재조회 복구·알림 병합·null 표시·키보드·계정 전환 포함. #95의 409로 fixture를 맞춘 뒤 해당 흐름 2개도 다시 통과했다. |
| 실제 두 계정 연동 | 아래 미공개 서버 후보와 실제 REST·WS·PostgreSQL을 사용한 `friends-integration.spec.ts`, desktop/mobile 2개 통과. 친구 응답을 대체하지 않았다.                                                                                   |
| 기존 화면 회귀    | 실제 API·WS·DB 및 기존 라우팅 fixture로 인증 8개, 홈·약관·OAuth·오목·오델로 32개, 프로필·전적 공개 2개 통과. 기존 모바일 전체 대국 2개는 의도적 skip.                                                                           |
| 정적 검증         | 타입 검사·Vite build, 변경 소스·검증 기록 Prettier와 전체 diff 공백 검사 통과. 독립 읽기 전용 검토에서 새 P1/P2 없음.                                                                                                           |

실제 두 계정 시나리오는 검색→요청→상대 자동 갱신→수락→양쪽 친구 표시, 한 탭 종료 시 온라인 유지·마지막 탭 종료 시 오프라인·재접속 시 온라인, 삭제와 두 번째 삭제의 404, 거절 후 재요청 차단, 역방향 새 요청 ID, 이전 요청 ID의 404·발신자 수락의 403, 상대 프로필 이동을 확인했다. 이는 두 PC나 운영 환경의 인수 검증 결과가 아니다.

2026-11-09 최초 합성 UI 검증 기록은 [변경 전 문서](https://github.com/EscapeFromGyeongsan/ft_transcendence/blob/0f111a28b498c3280bcf80b9b51410b89c6fd068/Document/friends-web-validation.md)에 보존돼 있다.

## 미공개 서버 후보의 범위

별도 worktree에서 #90 제품 코드에 다음 서버 소스를 연결했다. 이 후보를 #90에 병합하거나 push하지 않았다.

- #95: `db/schema/friendships.ts`, `services/friend-service.ts`, `api/friend-routes.ts` 원본.
- #98: `services/connection-registry.ts`, `services/presence.ts` 원본. WS에는 인증 완료 직전 사용자 집계 등록 단계만 적용했다.
- 임시 app 연결: 기존 경기 엔진·게임 서비스·세션 폐기를 유지하며 친구 서비스에 온라인 조회를 주입했다. presence 수신자는 accepted 친구에서 조회하고, 성공한 변경 트랜잭션이 반환된 뒤 양쪽 사용자에게 `friends.changed`를 보냈다. 알림 실패는 REST 성공을 취소하지 않는다.
- 기존 #90 migration을 적용한 새 전용 DB에 #95의 `0004_friendships.sql`만 한 번 bootstrap했다. migration·journal·snapshot은 변경하지 않았다. **정식 migration 통합 순서를 검증한 것이 아니다.**

DB는 `codex_friends90_20261112_test`와 `codex_friends90_20261112_e2e`, API/Vite는 전용 포트를 사용했다. #85 작업의 DB·포트·worktree를 변경하지 않았다. 단위 테스트의 테이블 초기화는 `_test` DB에서만 수행했다.

## 재현

```sh
npm ci
npx playwright install chromium
npm test -- apps/web/src
npm run build
npm run test:e2e -- tests/friends-ui.spec.ts --workers=1 --retries=0
```

전체 DB 테스트에는 별도 폐기 가능한 `_test` DB의 URL을 `TEST_DATABASE_URL`로 지정한다. 브라우저 DB는 별도로 만들고 제품 migration을 적용한다. 환경 설정은 [프로필 검증의 재현 절차](profile-records-privacy-validation.md#재현)를 따른다. 여러 브라우저 실행은 순서대로 진행하고 인증 rate limit을 바꾸지 않은 새 API 인스턴스로 실행했다. 프로필을 desktop/mobile 연속 실행했을 때 두 번째 project에서 refresh 429가 발생한 것을 trace로 확인했다. 새 API 인스턴스로 모바일만 분리한 실행은 통과했으며 제품 제한이나 테스트 재시도 횟수는 변경하지 않았다.

실제 친구 연동 테스트는 기본적으로 skip한다. 위 후보 또는 해당 계약과 app 연결이 통합된 서버·전용 DB를 준비한 뒤 실행한다. `E2E_BASE_URL`은 선택 사항이며, 지정하지 않으면 기존 Playwright 설정이 로컬 API·Vite를 시작한다.

```sh
E2E_FRIENDS_INTEGRATION=1 npm run test:e2e -- tests/friends-integration.spec.ts --workers=1 --retries=0
```

## 병합·출시 전 남은 조건

- [#98 변경 요청](https://github.com/EscapeFromGyeongsan/ft_transcendence/pull/98#pullrequestreview-5839536279): 지연된 친구 수신자 조회 뒤 관계가 삭제되면 이전 친구에게 presence가 갈 수 있다. 클라이언트의 REST 재조회는 서버의 정보 노출을 해결하지 않는다. #98에서 수정·검증해야 한다.
- [#95 후속 검토](https://github.com/EscapeFromGyeongsan/ft_transcendence/pull/95#pullrequestreview-5866981308): #89 탈퇴 계약에 맞춘 `deleted_at` 검색·요청 대상 필터, 사용자 잠금·관계 삭제 경합 처리가 필요하다. #89→#95→#79 migration 충돌도 정식 통합 시 해결·검증해야 한다. 적용된 migration을 단순 이름 변경하지 않는다.
- 온라인 registry 주입과 변경 후 `friends.changed` 발행은 서버 통합에 들어가야 한다. 미연결 #95의 503을 프런트에서 빈 목록·오프라인으로 숨기지 않는다.
- #85 병합 시 공용 `App.tsx`·`auth-client.ts` 변경을 함께 검토한다. 탈퇴·아바타 파일 삭제·HTTPS/WSS·두 PC·부하·비작성자 재현·#88 최종 인수는 이번 결과에 포함하지 않는다. #80 종료와 운영 배포 완료를 주장하지 않는다.
