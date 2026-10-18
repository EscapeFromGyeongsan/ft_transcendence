# 오목 엔진 및 경기 저장 연결 검증

실행일: 2026-10-18 KST. 로컬 작업 변경분의 실행 결과이며 PR 게시·팀 승인 기록은 아니다.

## 범위와 연결 기준

- 기반: `codex/gomoku-initial-state`, `745d8dfbff56bc36cf2644d30a912734b69d77c4` 위의 로컬 변경.
- 규칙: SRS v0.3.1 DEC-02, 15×15·흑 선공·연속 5개 이상 승리·금수 없음. 승리 없이 보드가 차면 무승부.
- 연결 대상: [팀 PR #11](https://github.com/EscapeFromGyeongsan/ft_transcendence/pull/11), 고정 커밋 `f8efcc06cb7d66327af9f5c520c398c02834c28b`.
- GitHub 연결 도구로 위 커밋의 서비스·repository·DB client·관련 schema 및 migration `0000`~`0003`을 별도 `/tmp/ft-transcendence-gomoku-integration`에 복사했다. 팀 코드는 수정하지 않았다. 검증 폴더는 완전한 Git checkout은 아니다.
- 실제 `createGameCommandService(db, { gomoku: gomoku.rules })`를 호출했다. 임시 규칙 함수는 사용하지 않았다.

## 환경과 명령

WSL Ubuntu / Node.js 25.5.0 / npm 11.8.0 / PostgreSQL 17 Alpine 이미지. 실행 중인 다른 컨테이너가 없는 상태를 확인한 뒤, `cafe-gomoku-integration-20261018`라는 별도 컨테이너에 tmpfs 데이터 디렉터리와 loopback 임의 포트를 사용했다. DB는 `gomoku_engine_test`이며 개발용 데이터·volume은 사용하지 않았다.

```bash
npm test
npm run build
TEST_DATABASE_URL='<별도 테스트 DB 연결 URL>' \
  npm run test:gomoku:persistence -- /tmp/ft-transcendence-gomoku-integration
git diff --check
```

별도 타입 검사에서 팀 PR의 실제 `GameRules`에 `gomoku.rules`를 대입해 호환성을 확인했다. DB 초기 검증은 QA 닉네임이 32자 제한을 초과해 계정 준비 단계에서 실패했으며, 검증 스크립트의 닉네임 길이를 수정한 후 재실행했다.

## 결과

| 검사 | 결과 |
|---|---|
| 저장소 단위 테스트 | 파일 5개, 테스트 47개 통과 |
| 타입 검사 및 웹 빌드 | 통과 |
| 실제 팀 `GameRules` 타입 대입 | 통과 |
| 흑 승리·마지막 명령 재전송·종료 후 거절 | 9수 저장, 결과·승자·양측 승패·종료 시간·버전 확인, 중복 저장 없음 |
| 백 승리 | 10수 저장, 백 승자·흑 패배·보드 복원 확인 |
| 225수 무승부 | 전체 착수·최종 버전 225·양측 draw·승자 없음·차례 없음·종료 후 거절 확인 |
| 참가자·버전·차례·좌표·이미 찬 칸 오류 | 오류 후 추가 착수 저장 없음, 거절 명령 재전송 결과 유지 |
| 같은 버전의 동시 착수 | 1건만 반영, 나머지는 VERSION_CONFLICT |
| 같은 commandId의 동시 재전송 | 1회 반영·1회 재전송, 돌은 1개만 저장 |
| diff 공백 검사 | 통과 |

DB 통합 테스트 총 6개가 통과했다. 검증 후 이번 실행에서 만든 임시 DB 컨테이너만 제거했다.

## 남은 통합 범위

이 브랜치에는 팀 PR의 인증·DB 구현을 병합하지 않았다. 연결 함수와 재현 스크립트를 제공하며, 실제 서비스 조립 시 엔진 등록 및 지원 규칙 버전 검사를 연결한다. 사용자·경기 ID의 `number`/`string` 공통 계약 조율은 팀 검토가 필요하다. 엔진은 사용자 ID를 다루지 않는다.

기권·이탈·재시작 종료는 서버의 저장된 경기 결과를 사용해야 한다. 보드 기록의 재생은 해당 종료 사유를 복원하지 않는다. 인증·실제 WebSocket·UI·원격 두 기기 인수 검증은 이번 실행 범위에 포함하지 않았다.
