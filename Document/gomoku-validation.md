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

## 2026-10-24: PR #6 기권 계약과의 호환성

PR #6의 `769f8091174f478043420edce88440e7f4901c06`은 `GomokuAction`을 `PlaceAction | ResignAction`으로 넓힌다. 기존 엔진은 이 타입에서 행동 구분 전에 `row/col`을 꺼내므로 새 계약과 결합하면 타입 오류가 발생한다. `applyMove`와 `GomokuRulesInput.action`을 `PlaceAction`으로 좁혀 착수만 엔진에 전달하도록 수정했다. 기권은 경기 관리 계층이 처리한다.

### 대상과 환경

- 엔진 기준: PR #12의 `5e064f3c21fdbc633e7f878a68a22d2e8a318e84` 위의 이번 호환성 변경. 게시 커밋 SHA는 PR #12의 검증 항목에 기록한다.
- 새 계약 기준: PR #6의 `769f8091174f478043420edce88440e7f4901c06`.
- WSL Ubuntu / Node.js 25.5.0 / npm 11.8.0. 기존 설치된 의존성을 사용했으며 잠금 파일을 변경하지 않았다.
- 원래 브랜치는 선행 #6/#9의 병합 전 구조를 유지한다. 새 계약 검증은 `/tmp/ft-pr12-compat-rkt8ni7n`의 별도 소스 사본에서 수행했다.

### 재현 방법

1. `git archive 5e064f3c21fdbc633e7f878a68a22d2e8a318e84`로 별도 디렉터리에 기존 엔진 소스를 추출한다.
2. `git archive 769f8091174f478043420edce88440e7f4901c06 packages/game-contracts`를 같은 디렉터리에 추출해 공통 계약 패키지만 교체한다.
3. 외부 의존성은 원래 checkout의 `node_modules` 항목을 연결한다. `@cafe/game-contracts`, `@cafe/game-engine`, `@cafe/web`은 반드시 **사본 내부 패키지**에 연결하여 원래 checkout의 이전 계약을 참조하지 않도록 한다.
4. 수정 전 `node_modules/.bin/tsc --noEmit`으로 좌표 접근 오류를 확인한 뒤 이번 엔진·테스트 변경을 사본에 적용한다. 게시 후 재현할 때는 1단계에 PR #12의 해당 게시 커밋을 사용하면 수정 후 상태를 바로 확인할 수 있다.
5. 원래 브랜치와 새 계약 사본에서 각각 아래 명령을 실행한다.

```bash
npm test
npm run build
```

새 계약 사본에는 임시 소비자 `tests/contracts-compatibility.typecheck.ts`도 두었다. 공개 패키지의 `GomokuCommand.action`을 `place`로 좁힌 뒤 두 엔진 입구에 전달하면 컴파일되고, 기권 분기에서는 `ResignAction`으로 처리됨을 확인했다. 분기하지 않은 전송 행동을 엔진에 전달하는 두 호출은 `@ts-expect-error`로 검사했다.

### 결과

| 검사 | 결과 |
|---|---|
| 수정 전 엔진 + 새 계약 타입 검사 | 예상대로 실패: `apply-move.ts`의 `row`, `col`에서 TS2339 두 건 |
| 수정 후 원래 브랜치 `npm test` | 5개 파일·49개 통과 |
| 수정 후 원래 브랜치 `npm run build` | 타입 검사·웹 빌드 통과 |
| 수정 후 새 계약 사본 `npm test` | 5개 파일·49개 통과 |
| 수정 후 새 계약 사본 `npm run build` | 소비자 타입 검사 포함 타입 검사·웹 빌드 통과 |
| 엔진에 잘못 전달된 기권 | 두 공개 입구에서 타입 오류, 실행 시 `INVALID_ACTION` 및 상태/이력 보존 확인 |

추가한 회귀 테스트 2개는 기권이 착수 엔진으로 들어오는 실수를 검사한다. 이번 변경은 입력 타입과 문서·테스트를 조정하며 착수 규칙을 변경하지 않는다. DB 통합 테스트 6개는 위의 **2026-10-18 실행 기록**이며 이번에 재실행하지 않았다. 인증·WebSocket·UI·원격 경기 인수와 실제 선행 PR 병합은 이번 검증 범위에 포함하지 않는다.
