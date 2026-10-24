# Game Engine

게임별 규칙을 처리하는 npm workspace 패키지.

## 오목 초기 상태

```ts
import { gomoku } from "@cafe/game-engine";

const state = gomoku.createInitialState();
```

`state.board`는 15×15 크기의 독립된 배열이며 빈칸은 `null`이다. `state.currentPlayerColor`는 `"black"`, `state.result`는 `null`로 시작한다. 규칙상 종료 시 차례는 `null`이고 결과에 승자 색 또는 무승부를 기록한다.

`GomokuState`는 게임 규칙 상태이며, 전송용 `GomokuSnapshot`과 역할을 구분한다. 상위 경기 관리 계층에서 `currentPlayerColor`를 배정된 `players.black/white`의 사용자 ID에 연결하고 경기 ID·규칙 버전·상태 버전·진행 상태·결과를 붙여 snapshot을 구성한다.

## 오목 착수 처리

```ts
import { gomoku } from "@cafe/game-engine";

const state = gomoku.createInitialState();
const result = gomoku.applyMove(
  state,
  { type: "place", row: 4, col: 2 },
  "black",
);

if (result.ok) {
  const nextState = result.state;
  // nextState.board[4][2]는 "black", currentPlayerColor는 "white"이다.
} else {
  console.log(result.error.code, result.error.message);
}
```

`applyMove(state, action, playerColor)`는 `GomokuMoveResult`를 반환한다. `state`는 초기 상태 함수 또는 이전 정상 착수 결과로 만든 유효한 15×15 엔진 상태이고, `action`은 착수 전용 `PlaceAction`이다. `playerColor`는 서버가 인증된 경기 참가자에게 배정한 색을 전달한다. 위의 `"black"`은 예제 입력이며, 클라이언트의 색상 주장을 그대로 신뢰하면 안 된다.

PR #6의 `769f809`는 전송용 `GomokuAction`에 기권(`ResignAction`)을 추가한다. 서버 경기 관리 계층은 `action.type`으로 분기하여 기권을 직접 처리하고, `place`만 `applyMove` 또는 `gomoku.rules`에 전달한다. 두 엔진 입구는 `PlaceAction`을 받으므로 기권 전달은 타입 오류이며, 타입 검사를 우회해 기권을 전달해도 진행 중 상태를 변경하지 않고 `INVALID_ACTION`으로 거절한다.

함수는 아래 순서로 착수를 검사한다.

1. 종료된 상태이면 `GAME_FINISHED`로 거절한다.
2. 행동이 `place`이고 `row/col`이 정수이며 각각 `0..14` 범위인지 검사한다. `board[row][col]` 기준이다.
3. `playerColor`가 `state.currentPlayerColor`와 같은지 검사한다.
4. 지정한 칸이 `null`인지 검사한다.

성공은 `{ ok: true, state: GomokuState }`이다. 지정한 칸에 돌을 놓고 가로·세로·두 대각선의 연속 5개 이상을 검사한다. 장목도 승리이며 금수는 없다(SRS v0.3.1 DEC-02). 승리 결과는 `{ outcome: "win", winner: "black" | "white", reason: "five_in_row" }`이다. 승리 없이 보드가 꽉 차면 `{ outcome: "draw", reason: "draw" }`이다. 마지막 빈칸으로 이긴 경우에는 승리가 우선한다. 종료 시 `currentPlayerColor`는 `null`, 그 외에는 흑↔백 차례를 전환한다.

모든 행을 복사하므로 반환한 상태의 어느 칸을 바꿔도 입력 상태에 영향을 주지 않는다. 실패는 `{ ok: false, error: { code: "INVALID_ACTION" | "GAME_FINISHED", message: string } }`이며 기존 상태를 유지한다. 호출자는 `ok`와 오류 코드를 사용하고, 표시용 `message`로 오류 종류를 판별하지 않는다.

입력 상태는 성공·실패 모두 수정하지 않는다. 함수는 `matchId`, `commandId`, `expectedVersion`을 처리하거나 snapshot을 직접 만들지 않는다. 외부 JSON의 구조 검증, 인증·참가자 확인, 경기의 대기/일시정지 및 기권·이탈·재시작 종료, 명령 중복 처리·버전 관리·저장·전송은 상위 경기 관리 계층의 책임이다.

## 팀 서버 저장 서비스 연결

[PR #11](https://github.com/EscapeFromGyeongsan/ft_transcendence/pull/11)의 서비스가 있는 checkout에서 다음과 같이 등록한다.

```ts
import { gomoku } from "@cafe/game-engine";
import { createGameCommandService } from "./game-command-service.ts";

const service = createGameCommandService(db, { gomoku: gomoku.rules });
// createMatch의 rulesVersion에는 gomoku.GOMOKU_RULES_VERSION을 전달한다.
```

`gomoku.rules({ moves, seat, action })`는 저장된 `{ row, col, stone }` 이력을 순서대로 재생하고 현재 착수를 처리한다. `GomokuRulesInput.action`도 `PlaceAction`이며 PR #11의 `GameRules` 입력과 호환된다. 성공 시 `{ ok: true, nextTurn, finish? }`, 실패 시 `{ ok: false, code }`를 반환한다. 호출자가 기록 순서와 인증된 참가자의 `seat`를 제공한다. 규칙 버전은 `gomoku-freestyle-v1`이며 호출 계층에서 지원 버전 여부를 확인한다.

`gomoku.restoreState(moves)`는 보드·차례·규칙상 종료 결과를 복원한다. 색·순서·좌표·중복 칸·종료 후 추가 착수가 잘못된 이력에는 예외를 던진다. 손상된 저장 이력을 현재 사용자의 불법 착수로 저장하지 않고 트랜잭션을 중단하기 위한 동작이다. 두 함수 모두 입력 이력을 수정하지 않는다.

기권·이탈·재시작 종료는 착수 기록만으로 복원할 수 없으므로 snapshot 구성 시 저장된 경기 상태·결과와 함께 사용해야 한다. 엔진 승자 색은 서버가 사용자 ID로 연결한다. PR #6의 `769f809`에서 전송 계약도 숫자 ID로 맞췄으며, 선행 PR 병합 후 해당 계약을 이 브랜치에 반영해야 한다. 엔진은 사용자·경기 ID를 다루지 않는다. 실제 WebSocket·UI 연결은 별도 통합 작업이다.

## 검증

저장소 루트에서 실행한다.

```bash
npm test
npm run build
```

초기 보드·선공·행/경기 독립성, 흑·백 착수, 좌표·차례·빈칸 검사, 입력 보존, 네 방향의 양쪽 색 승리·장목·금수 없음, 225수 무승부, 종료 차단과 기록 복원을 단위 테스트한다.

기권이 엔진에 잘못 전달되었을 때 상태를 보존하며 거절하는지도 두 입구에서 검사한다. 해당 테스트의 `@ts-expect-error`는 `npm run build`에서 기권 전달이 타입 오류인지 확인한다. 새 계약과의 호환성 실행 방법·결과는 [검증 기록](../../Document/gomoku-validation.md)의 2026-10-24 항목을 참조한다.

PR #11의 저장 서비스·migration이 있는 checkout과 별도 `*_test` PostgreSQL DB를 준비한 뒤 실행한다. 현재 연결된 DB 이름도 검사하며, 기존 테이블을 비우지 않고 고유 QA 계정과 경기를 추가한다. `.env`는 자동으로 읽지 않는다.

```bash
TEST_DATABASE_URL='postgres://<user>:<password>@127.0.0.1:<port>/gomoku_engine_test' \
  npm run test:gomoku:persistence -- /absolute/path/to/server-checkout
```

실제 엔진을 등록해 흑·백 승리/결과 저장, 전체 무승부, 종료·불법 착수 거절, 중복 명령 재전송과 동시 착수를 확인한다. [실행 기록](../../Document/gomoku-validation.md)은 PR #11의 고정 커밋을 사용한 결과이며, 인증·실시간·화면 인수 검증을 포함하지 않는다.
