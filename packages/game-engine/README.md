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

## 오델로 규칙 및 처리

```ts
import { othello } from "@cafe/game-engine";

const state = othello.createInitialState();
const result = othello.applyMove(
  state,
  { type: "place", row: 2, col: 3 },
  "black",
);

if (result.ok) {
  const nextState = result.state;
  // (3,3) 백돌이 뒤집혀 흑돌이 되고 차례는 "white"로 전이된다.
}
```

- **초기 상태**: 8×8 보드, (3,3)·(4,4) 백, (3,4)·(4,3) 흑, 흑 선공.
- **합법 착수**: 빈 칸 + 8방향 중 1개 이상의 상대 돌을 자신의 돌로 끼워 뒤집을 수 있는 위치만 착수 가능. 조건을 만족하지 못하면 `INVALID_ACTION`으로 거절.
- **자동 패스**: 착수 후 상대방이 둘 수 있는 합법 착수 칸이 없으면 별도의 패스 명령 없이 `nextTurn`을 현재 착수자의 색으로 유지.
- **게임 종료**: 양쪽 모두 둘 수 없거나 판이 가득 차면 게임이 종료(`currentPlayerColor: null`)되며, 돌 수를 비교하여 `{ outcome: "win", winner, reason: "disc_count" }` 또는 `{ outcome: "draw", reason: "draw" }`를 반환.
- **버전**: `othello-standard-v1`

## 팀 서버 저장 서비스 연결

[PR #33](https://github.com/EscapeFromGyeongsan/ft_transcendence/pull/33)의 서비스(`RegisteredRules = { version, rules, board }`)가 있는 checkout에서 다음과 같이 등록한다.

```ts
import { gomoku, othello } from "@cafe/game-engine";
import { createGameCommandService } from "./game-command-service.ts";

const service = createGameCommandService(db, {
  gomoku: {
    version: gomoku.GOMOKU_RULES_VERSION,
    rules: gomoku.rules,
    board: gomoku.board,
  },
  othello: {
    version: othello.OTHELLO_RULES_VERSION,
    rules: othello.rules,
    board: othello.board,
  },
});
// createMatch에는 rulesVersion을 넘기지 않는다. 서버가 등록된 version을 저장한다.
```

`rules({ moves, seat, action })`는 저장된 `{ row, col, stone }` 이력을 순서대로 재생하고 현재 착수를 처리한다. 성공 시 `{ ok: true, nextTurn, finish? }`, 실패 시 `{ ok: false, code }`를 반환한다. 호출자가 기록 순서와 인증된 참가자의 `seat`를 제공한다.

`restoreState(moves)`는 보드·차례·규칙상 종료 결과를 복원한다. 색·순서·좌표·중복 칸·종료 후 추가 착수가 잘못된 이력에는 예외를 던진다. 오델로의 경우 자동 패스로 인해 동일 플레이어가 연속 착수할 수 있으므로, 단순 교대 착수를 가정하지 않고 저장된 `stone` 값을 기준으로 복원한다. `board(moves)`는 같은 재생 결과의 판만 돌려주며 서버 `getSnapshot`의 `board`로 쓰인다.

## 검증

저장소 루트에서 실행한다.

```bash
npm test
npm run build
```

초기 보드·선공·행/경기 독립성, 흑·백 착수, 좌표·차례·빈칸 검사, 입력 보존, 오목 5목/장목/금수 없음 및 오델로 8방향 뒤집기/자동 패스/돌 수 판정, 종료 차단과 기록 복원을 단위 테스트한다.
