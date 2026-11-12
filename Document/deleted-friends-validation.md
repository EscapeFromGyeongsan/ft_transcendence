# #110 탈퇴·친구 결합 수정 검증

## 결과와 출처

#88의 실패 B88-01을 수정했다. 제품 소스 `d591bf6ce2808afe09e726e5ec9ff647d5c0ed0c`, 기준 `test/acceptance-88`의 `108a570`. 원본 PR #89·#95·#98을 연결한 격리 후보 위의 후속 변경이다. 기존 후보의 실패 기록과 JSON은 당시 결과로 보존한다. 이번 변경을 master 인수 완료로 해석하지 않는다.

- 전용 PostgreSQL: **44파일 / 497 통과 / 실패 0 / skip 0**. 새 회귀 13개를 포함한다.
- 실제 Chrome HTTPS/WSS: **6 통과 / 실패 0 / skip 0 / retry 0**. desktop 1440×900에서 필요한 친구·탈퇴 흐름만 다시 실행했다.
- 타입 검사·production build·변경 파일 Prettier·`git diff --check` 통과.
- API 컨테이너의 서버·migration·공통 패키지 소스 **116개 SHA-256**이 제품 커밋과 일치했다. 웹 소스는 변경하지 않았다.
- 비밀값 없는 결과: [deleted-friends-evidence.json](./deleted-friends-evidence.json).

## 변경 계약

탈퇴 transaction에서 accepted·pending·declined 관계를 모두 삭제하고 상대 ID를 수집한다. 비식별화·세션 폐기와 함께 commit되며 실패하면 관계도 복원된다. commit 뒤 `friends.changed`로 양쪽 presence generation을 무효화한 다음 기존 세션 종료·아바타 정리를 실행한다. 알림 전송은 앱의 기존 오류 격리 경로를 이용한다.

친구 요청·수락·거절은 양쪽 **활성 사용자 ID 오름차순 `FOR SHARE` → 관계 `FOR UPDATE`** 순서를 지킨다. 탈퇴의 사용자 `FOR UPDATE`와 직렬화하여, 먼저 성공한 친구 변경도 뒤따른 탈퇴가 정리하고 탈퇴가 먼저 성공하면 요청/수락이 거절된다. 수락·거절은 비잠금 관계 조회로 참가자를 확인한 뒤 사용자 잠금과 관계 재조회로 권한·상태를 다시 확인한다. 기존 제3자 404·발신자 403·stale 요청 404/409 계약을 유지한다.

목록·받은/보낸 요청·닉네임 검색은 삭제 계정을 제외한다. presence 대상 조회는 양쪽 사용자 모두 활성인지 확인하여 과거 결함으로 남은 관계도 알림 대상이 되지 않는다. 별도 데이터 migration이나 경기 이력 삭제는 없다.

## 실제 재검증

| 실행              | 결과                                                                                                      |
| ----------------- | --------------------------------------------------------------------------------------------------------- |
| 원래 B88-01 재현  | 탈퇴 204, 상대 친구 목록 비어 있음, 새 요청 404 `USER_NOT_FOUND`, 이미 정리된 친구 삭제 404, 재요청도 404 |
| 두 계정 친구 화면 | 요청·수락·온라인/오프라인·다중 탭·삭제·거절·새 요청 ID·오래된 요청 거절 통과                              |
| 탈퇴 기본         | 키보드·포커스, 본인 확인 실패 세션 유지, 탈퇴 후 토큰·사용자 표시 정리 통과                               |
| 다른 기기         | 탈퇴 뒤 다른 기기의 세션 복원 거절 통과                                                                   |
| 응답 중 화면 이동 | 대기 중 뒤로 이동해도 204 뒤 로그인 상태 정리 통과                                                        |
| 활성 경기         | 409 `ACTIVE_MATCH`와 계정·세션 유지 통과                                                                  |

추가 PostgreSQL 회귀는 실제 `pg_blocking_pids` 대기를 관찰한다. 탈퇴 선행 5종(요청 대상·요청자·수락 발신자·수락 수신자·거절 발신자), 친구 변경 선행 3종(맞요청·수락·거절)을 검증했다. rollback은 비식별화 직전 DB 오류를 강제하여 관계·세션 유지와 알림 없음으로 확인했다. 인증 WebSocket의 accepted/pending 상대는 `friends.changed` 수신 직후 실제 GET 및 DB에서 정리된 목록을 확인했다. 잘못된 비밀번호·활성 경기 거절에서는 관계 유지와 알림 없음도 확인했다. 기존 presence의 오래된 조회 무효화 회귀도 통과했다.

초기 검증 도구 문제도 구분한다. 새 잠금 테스트의 첫 관측은 통계 snapshot에 새 backend가 잡히지 않아 2건 실패했고 관측 루프의 `pg_stat_clear_snapshot()`으로 수정했다. 새 테스트의 타입 추론 1건을 수정한 뒤 전체 타입 검사를 통과했다. HTTPS 탈퇴 첫 선택식은 테스트 0건으로 종료되어 성공으로 세지 않았고, 정확한 제목 선택식으로 4건을 실행했다. 제품 실패를 skip·retry로 숨기지 않았다.

## 재현 환경과 제한

프로젝트 `codex-acceptance88-20261112`, `https://localhost:54699`, 기존 전용 PostgreSQL17/Nginx/Chrome157 환경을 사용했다. 로컬 인증서의 CA·SPKI를 명시했고 `ignoreHTTPSErrors`는 false다. 런타임 환경 파일·키·원시 trace는 Git에 포함하지 않았다. 인증 rate limit은 그대로 두고 각 배치 전 자체 API를 재시작했다.

```sh
TEST_DATABASE_URL='<별도 *_test DB>' npm test
npm run build
E2E_BASE_URL='https://localhost:54699' E2E_TLS_SPKI='<로컬 인증서 SPKI>' \
  NODE_EXTRA_CA_CERTS='<로컬 CA 파일>' \
  npx playwright test --config=config/playwright.acceptance.config.ts \
  'tests/friends-deletion-acceptance-88\.spec\.ts$' --project=desktop
```

#111 문의 경로, #81/#83 초대, 실제 42 제공자·두 PC·남은 AT 변형 및 계약 승인은 여전히 남는다. 이번에는 세 가지 화면 크기 전체·300초 부하를 다시 실행하지 않았다. 원본 PR 병합 후 최종 통합 SHA에서 재검증해야 한다.
