# 탈퇴 후 프로필·아바타 변경 경합 검증

## 재현과 수정

#88/#85 탈퇴 후속 검토에서 기존 쓰기 경합을 발견했다. 기준은 #113의 `2e597f8`, 수정 제품은 `0c1892b47718f4cdedaf51f065999ed97b7bd378`이다. 인증은 요청 시작 시 실행되므로, 인증 뒤 탈퇴가 commit되면 이후 쓰기에도 활성 계정 조건이 필요하다.

수정 전 실제 HTTP·PostgreSQL 회귀 **6개가 실패**했다. 탈퇴 후 실행된 프로필 PATCH가 200을 반환하며 비식별 닉네임을 `mustNotReturn`으로 바꾸고 공개 설정도 덮어썼다. 아바타 PUT도 200과 함께 새 URL·파일을 남겼다. 아바타 DELETE는 탈퇴 계정에 204를 반환했다. 잠금 없이 탈퇴 commit 뒤 요청을 재개한 경우와, 요청이 실제 사용자 행 잠금에서 기다리다 탈퇴 commit 후 재개한 경우 모두 재현했다.

`user-repository.ts`의 프로필 UPDATE·아바타 `SELECT FOR UPDATE`·아바타 UPDATE 세 곳에 `deleted_at IS NULL`을 추가했다. 기존 사용자 서비스와 아바타 서비스의 `NOT_FOUND` 처리가 401과 새 파일 정리를 수행하므로 caller·응답 스키마·migration·의존성을 추가하지 않았다. TSDoc도 탈퇴 계정 반환 조건과 잠금 계약에 맞췄다.

## 검증 결과

- 전용 PostgreSQL 전체 **45파일 / 505 통과 / 실패 0 / skip 0**.
- 새 경합 회귀 6개 모두 통과. 같은 파일의 기존 PNG/JPEG 검사 2개도 통과했다. 추가된 `preHandler` gate는 테스트 전용이며 인증 완료를 확인한 뒤에만 대기한다. 실제 행 잠금은 `pg_blocking_pids`로 관찰한다.
- 401뿐 아니라 DB의 비식별 값·원래 공개 설정 유지, 디렉터리에 아바타 파일이 남지 않는 것을 확인했다. 기존 프로필·아바타·탈퇴·친구 회귀도 전체 실행에 포함했다.
- 실제 Chrome HTTPS/WSS **3 통과 / 실패·skip·retry 0**: 프로필·PNG 업로드·공개 설정·실제 경기 전적, 탈퇴 기본 흐름, #110 친구·탈퇴 회귀.
- 타입 검사·production build·코드 Prettier·`git diff --check` 통과.
- 실행 API 컨테이너와 제품 커밋의 서버·migration·공통 패키지 소스 **117개 SHA-256** 일치. 웹 소스는 변경하지 않았다.
- [비밀값 없는 JSON 증거](deleted-profile-evidence.json).

## 재현

```sh
TEST_DATABASE_URL='<별도 *_test DB>' npm test -- apps/server/src/api/account-profile-race.test.ts
TEST_DATABASE_URL='<별도 *_test DB>' npm test
npm run build
```

기존 `codex-acceptance88-20261112` 격리 프로젝트의 API만 교체했다. `https://localhost:54699`, PostgreSQL17, Nginx, Chrome157, 명시적 CA·SPKI, desktop 1440×900 환경이다. API·DB는 외부 공개하지 않았고 키·환경 파일·원시 trace는 Git에서 제외했다. 정상 HTTPS 배치는 자체 API 재시작으로 인증 제한을 격리하며 제한 자체와 retry 값은 바꾸지 않았다.

이 PR은 #113 위에 쌓인 최소 후속 수정이다. 원본 기능 PR 병합 후 최종 통합 SHA 검증이 필요하다. #111 문의 경로·#81/#83 초대·실제 42 제공자·두 PC·계약 승인 등 #88의 나머지 인수 조건은 별도이며, 전체 화면 크기·부하를 이번에 재실행하지 않았다.
