# #88 후속: 실제 통계 경계와 혼합 게임 격리

2026-11-13 JST, #114의 `b31ac3f` 위에서 제품 변경 없이 AT-08/T08과 AT-09의 미실행 조건을 추가 검증했다. 실행 제품은 `0c1892b47718f4cdedaf51f065999ed97b7bd378`, 테스트 소스는 `b0e3c05`다. 이전 후보의 실패·통과 기록과 별개인 실행이며 전체 인수 상태는 계속 보류다.

## 결과

실제 HTTPS/WSS 배치 **2개 통과, 실패·skip·retry 0**. AT-08은 실제 오목 21경기, AT-09는 오목·오델로 동시 2경기를 진행하고 모두 종료했다. DB fixture·가짜 게임 규칙·HTTP/WS 응답 대체는 사용하지 않았다.

- **AT-08/T08:** 새 계정 두 명이 정상 오목 승리와 기권을 포함한 10경기를 완료했다. 첫 승 직후 업적, 4/10·10/10 진행도, 6승4패/4승6패와 60%/40% 승률이 일치했다. 별도 두 계정의 실제 10경기로 동일 승수의 승률 우선과 동일 승수·승률의 사용자 ID 우선 순위를 확인했다. 닉네임은 ID의 반대 순서다. 11번째 경기 후 진행도는 10/10을 유지했다.
- **전적·분리:** 실제 전적의 4개씩 cursor 페이지를 모아 최신순·누락·중복, 상대와 당시 닉네임, 색상, 결과와 종료 사유를 검증했다. 오델로 통계는 네 계정 모두 0을 유지했다. 실제 PostgreSQL 21경기·참가자 결과 42건과 API 전적의 상대·결과·종료 시간을 대조했다.
- **화면:** Chrome에서 실제 로그인 후 11전7승4패와 첫 승·10경기 참여 달성 표시를 확인했다. 새로고침 뒤에도 표시와 집계가 유지됐다. 화면은 desktop 1440×900만 실행했다.
- **AT-09:** 오목·오델로 대기열을 동시에 신청하고 서로 다른 경기로 매칭됨을 확인했다. 다른 경기 구독은 `NOT_PARTICIPANT`, 잘못된 `gameType` 명령은 `INVALID_MESSAGE`였다. 두 경기 동시 착수 후 각 참가자는 자기 경기 갱신만 받았다. 오목 15×15 착수와 오델로 8×8 실제 뒤집기(흑4/백1), 양쪽 기권 종료를 확인했다. DB에도 각 1수·버전2·종료 결과가 일치했다. 이 배치는 실제 Node WSS/API 클라이언트를 사용했다.

타입 검사·production build·코드 Prettier·`git diff --check`가 통과했다. 서버·migration·공통 패키지 117개 파일의 실행 SHA-256은 기존 제품과 일치했다. [JSON 증거](acceptance-88-stats-evidence.json)와 [제품 소스 manifest](deleted-profile-evidence.json)를 기준으로 한다. 제품 코드 변경이 없어 기존 505개 단위 테스트 전체는 재실행하지 않았다.

## 재현

기존 [격리 후보 준비 방법](acceptance-88-validation.md)의 CA·SPKI·HTTPS 서버를 사용한다. 기존 WSS 연결과 다른 인증 배치가 없는 자신의 후보에서 **각 명령을 별도 배치로** 실행한다. IP당 분당 10회 인증 제한을 바꾸지 않는다. 이번 실행은 각 배치 전 자체 격리 API/web만 재시작했으며, 다른 서버나 DB 볼륨은 변경하지 않았다.

```sh
E2E_BASE_URL=https://localhost:54699 E2E_TLS_SPKI=<후보_SPKI> \
  NODE_EXTRA_CA_CERTS=<후보_CA.crt> \
  npx playwright test --config=config/playwright.acceptance.config.ts \
  'tests/realtime-acceptance-88\.spec\.ts$' --project=desktop --grep AT-08

E2E_BASE_URL=https://localhost:54699 E2E_TLS_SPKI=<후보_SPKI> \
  NODE_EXTRA_CA_CERTS=<후보_CA.crt> \
  npx playwright test --config=config/playwright.acceptance.config.ts \
  'tests/realtime-acceptance-88\.spec\.ts$' --project=desktop \
  --grep 'simultaneous Gomoku'
```

반복 매칭은 직전 메시지 이후의 `queue.matched`만 읽는다. 실행 요약에는 가짜 계정 ID·경기·집계만 첨부하며 비밀번호와 토큰을 포함하지 않는다. 원시 로그는 기존 private 디렉터리에 보관한다. 통계 배치는 실제 완료 기록을 남기므로, 전용 후보를 사용하고 누적 상위 100위에 이번 계정이 포함되지 않으면 새 격리 DB로 실행한다.

## 남은 조건

AT-08 무승부·서버 재시작 무효 결과는 이번 범위에 포함하지 않았다. 다른 화면 크기·두 물리 PC·부하를 다시 실행하지 않았으며, 원본 PR 병합 뒤 최종 SHA에서 인수가 필요하다. #111 실제 문의 경로는 사용자가 미정이라고 답하여 보류한다. #81/#83 초대, 실제 42 제공자, 팀 인수·계약 승인도 별도다.
