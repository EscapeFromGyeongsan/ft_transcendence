# 프로필 전적 공개 설정 검증

추적 이슈: [#78](https://github.com/EscapeFromGyeongsan/ft_transcendence/issues/78). 실행일: 2026-11-09 KST.

`feat/profile-records-privacy`는 [PR #77](https://github.com/EscapeFromGyeongsan/ft_transcendence/pull/77)의 `05eaede`를 기준으로 한다. SDS 2.10.26의 DEC-05 제안(기본 공개, 비공개 시 본인만 전적 조회)을 API·DB·웹에 구현했다. 이 기록은 B의 설계·스키마·API 승인이나 다른 브랜치 병합 완료를 의미하지 않는다.

## 동작 및 범위

- 새 migration `0004_records_public.sql`은 `users.records_public boolean NOT NULL DEFAULT true`를 추가한다. 기존 `0000`~`0003` migration은 수정하지 않았다.
- `PATCH /api/users/me`는 `nickname` 또는 `recordsPublic` 중 하나 이상을 받아 하나의 UPDATE로 저장한다. 빈 객체·미등록 필드·boolean 이외의 공개 설정은 422이며, 닉네임 충돌은 409로 전체 변경을 취소한다. 가입·내 정보·프로필 변경·아바타 업로드의 본인 DTO에 설정을 포함한다.
- 통계·전적 API는 인증된 조회자와 대상을 비교한다. 본인은 항상 조회할 수 있고, 타인은 대상이 비공개이면 데이터 없이 403 `RECORDS_PRIVATE`를 받는다. 대상 없음은 404다. 권한 확인과 조회는 사용자 행의 공유 잠금을 유지하는 트랜잭션에서 실행하며 응답에는 `Cache-Control: no-store`를 붙인다.
- 기본 프로필의 닉네임·아바타, 리더보드, 상대방 자신의 전적에 표시되는 상대 정보는 유지한다. 타인의 기본 프로필 응답에 이메일·공개 설정을 추가하지 않는다.
- 본인 토글은 저장 중 비활성화하고 저장 응답 이후 반영한다. 실패하면 이전 값을 유지한다. 타인 프로필의 비공개 응답은 기본 프로필과 안내를 표시하며 통계·업적·대국 및 이전 사용자 데이터가 남지 않게 한다.
- API 계약·Swagger 응답과 SDS, 개인정보처리방침의 전적 공개 안내를 함께 갱신했다. 회원 탈퇴와 친구·초대는 범위 밖이다.

## 검증 시나리오

| 검증                        | 확인 내용                                                                                                                                                                                                                            |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 기존 DB migration           | 직전 E2E에서 생성한 사용자 40명의 ID·닉네임과 경기 8건 유지, 기존 사용자 전원 `records_public = true`                                                                                                                                |
| `api/user-routes.test.ts`   | 기본값·저장·재조회·닉네임 변경 시 유지, 두 필드 동시 변경, 충돌 시 원자성, 잘못된 설정·빈 객체·추가 필드 거절, 인증 우선                                                                                                             |
| `api/avatar-routes.test.ts` | 비공개 설정 후 아바타 업로드·교체 응답 및 삭제 후 내 정보의 설정 유지                                                                                                                                                                |
| `api/stats-routes.test.ts`  | 두 게임·필터·페이지별 비공개 차단, 본인 허용, 기본 정보·리더보드·상대 자신의 기록 유지, 재공개 후 실제 기록 복구, Swagger 403 선언                                                                                                   |
| PostgreSQL 경합             | 공개 설정 UPDATE를 열어 둔 뒤 통계 조회를 시작하고 실제 잠금 대기(`pg_blocking_pids`)를 확인, UPDATE commit 후 403 반환                                                                                                              |
| `api/profile-api.test.ts`   | boolean PATCH와 인증 헤더, 누락·불일치 응답을 저장 성공으로 처리하지 않음, `RECORDS_PRIVATE` 오류 안내                                                                                                                               |
| `tests/profile.spec.ts`     | 두 실제 계정으로 9수 오목 완료 후 설정 저장·새로고침, 본인 기록 유지, 실제 네트워크 단절 시 저장 실패·기존 설정 유지, 타인 통계·전적의 403, 비공개 UI, 리더보드·상대 자신의 기록 유지, 재공개 후 기록 복구, 아바타 삭제 후 설정 유지 |

프로필 브라우저 시나리오는 데스크톱·모바일에서 모두 실행한다. HTTP·WebSocket 응답이나 경기 결과를 mock하지 않는다. 모바일의 기존 독립 오목·오델로 대국 시나리오 2개는 기존 정책대로 skip하지만, 이번 프로필 시나리오는 모바일에서도 실제 대국을 완료한다. 공유 매칭 대기열에서 서로 다른 테스트의 두 참가자가 섞이지 않도록 Playwright 기본 worker를 1개로 고정했다.

## 재현

Node.js/npm, Chromium 및 별도 PostgreSQL 17 검증 DB가 필요하다. 테스트는 계정·경기·아바타를 생성한다. 개발 DB 대신 분리된 검증 DB를 사용한다.

```powershell
npm.cmd ci
npx.cmd playwright install chromium
$env:DATABASE_URL = '<별도 E2E DB 연결 문자열>'
$env:JWT_SECRET = '<32자 이상의 검증용 임의 값>'
$env:TWO_FACTOR_KEY = '<별도로 생성한 32자 이상의 검증용 임의 값>'
$env:AVATAR_DIR = '<검증용 아바타 경로>'
$env:PORT = '3101'
$env:E2E_PORT = '5183'
$env:CI = '1'
npm.cmd run db:migrate
npm.cmd run test:e2e -- --workers=1 --retries=0 --reporter=line
```

브라우저 실행이 끝난 뒤 **다른** 일회용 DB에서 단위·DB 통합 테스트를 실행한다. 실제 DB 이름이 `_test`로 끝나야 하며 테스트 도우미가 migration 적용과 테이블 초기화를 수행한다.

```powershell
$env:TEST_DATABASE_URL = '<별도 단위/DB 통합 DB 연결 문자열>'
npm.cmd test
npm.cmd run build
git diff --check
```

Playwright가 로컬 API·Vite를 기동하고 종료한다. `E2E_BASE_URL`을 지정하면 기존 검증 서버를 사용한다. 해당 서버에도 migration `0004`와 이 브랜치의 API·웹이 함께 배포돼 있어야 한다.

## 실행 결과

환경: Windows, Node.js 26.13.0, Playwright 1.63.0, Chromium 153, 실제 PostgreSQL 17.11. 기존 `.env`와 개발 DB를 사용하지 않았다. 임시 loopback PostgreSQL 클러스터의 `cafe_e2e_test`와 `cafe_privacy_test`, 임시 아바타 경로를 사용했다. 검증 대상은 기준 `05eaede` 이후 이 브랜치의 작업 변경분이다.

| 실행                                           | 결과                                                        |
| ---------------------------------------------- | ----------------------------------------------------------- |
| 프로필 브라우저 시나리오 단독                  | 데스크톱·모바일 2개 통과 (24.5초)                           |
| 전체 E2E                                       | 14개 중 12개 통과·기존 모바일 대국 2개 의도적 skip (50.0초) |
| 변경한 서버 3파일                              | 25개 통과 (12.45초)                                         |
| 전체 단위·DB 통합                              | 32개 파일·315개 모두 통과, skip 없음 (62.34초)              |
| TypeScript·Vite 빌드                           | 통과                                                        |
| 변경한 TS/TSX·CSS·설정·신규 검증 문서 Prettier | 통과                                                        |
| `git diff --check`                             | 통과                                                        |

첫 전체 단위·DB 통합 실행은 314개 통과와 기존 heartbeat 테스트 1개의 5초 시간 초과로 끝났다. 해당 테스트의 단독 실행은 통과했고, 코드·시간 제한을 변경하지 않은 전체 재실행에서 위의 315개가 통과했다. 두 전체 실행 모두 브라우저 실행과 분리했다. 이 결과만으로 기존 테스트의 시간 민감성이 해결됐다고 판단하지 않는다.

브라우저·API·Vite는 Playwright 종료와 함께 정리했고 검증용 PostgreSQL도 마지막 검사 후 중지했다. 임시 바이너리·브라우저·DB·아바타는 저장소에 포함하지 않는다. HTTPS/WSS·Docker·실제 42 OAuth·서로 다른 두 PC·성능 부하는 이번 검증 범위에 포함하지 않는다. B의 DEC-05 및 스키마·API 검토와 비작성자 재현은 남아 있다.
