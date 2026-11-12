# 게임 공통 계약

- 문서 버전: 0.4.0 / 작성일: 2026-10-08 / 수정일: 2026-10-28 (KST)
- 상태: PR #6 B의 계약 구조 승인 및 후속 문서 보완 — 미결정 항목은 10절 참조
- 관련 이슈: [#5 공통 계약 초안](https://github.com/EscapeFromGyeongsan/ft_transcendence/issues/5)
- 작성 책임: dong-hki / 문서 작성 지원: Codex
- 공통 기반: [common.ts](../packages/game-contracts/src/common.ts)
- 공개 유니언: [types.ts](../packages/game-contracts/src/types.ts)
- 공개 입구: [index.ts](../packages/game-contracts/src/index.ts)
- 오목 계약: [gomoku/types.ts](../packages/game-contracts/src/gomoku/types.ts)
- 오델로 계약: [othello/types.ts](../packages/game-contracts/src/othello/types.ts)
- 코드 예제: [gomoku/examples.ts](../packages/game-contracts/src/gomoku/examples.ts)

## 1. 목적과 범위

서버와 프론트가 공유할 게임 명령, 현재 경기 상태, 종료 결과, 오류 형식을 설명한다. 현재 지원 대상으로 정한 오목·오델로의 명령·상태·결과를 게임별로 정의하고, 오목의 초기 상태 → 착수 요청 → 갱신 상태 예제를 제공한다.

2026-10-12 요청자는 향후 부루마블·윷놀이·할리갈리처럼 행동, 플레이어 구성, 차례 및 결과가 다른 게임도 추가할 수 있는 구조를 요청했다. 공통 기본 타입은 경기 식별·버전·생명주기에 한정하고, 게임별 필드를 각 게임 타입에서 정의한다. 이 추가 게임들은 현재 `GameType`과 공개 유니언에 등록하거나 구현한 대상이 아니다.

아래 JSON은 코드의 예제 데이터이며 실제 게임 엔진의 처리 결과나 구현 완료 증빙을 뜻하지 않는다. 오델로 JSON 예제와 실제 엔진은 후속 작업이다.

## 2. 타입의 역할과 파일 구조

| 타입 | 현재 정의 | 역할 |
|---|---|---|
| `GameType` | `"gomoku" 또는 "othello"` | 현재 등록한 게임 종류 |
| `PlayerId` | `number` | 서버가 발급한 양의 안전한 정수 플레이어 ID |
| `GameStatus` | `waiting`, `playing`, `paused`, `finished` | 공통 경기 생명주기 |
| `GameCommandBase` | 경기 ID·명령 ID·기대 버전 | 모든 명령의 공통 기반 |
| `GameSnapshotBase` | 경기 ID·규칙 버전·상태 버전·진행 상태 | 모든 snapshot의 공통 기반 |
| `PlaceAction` | `place`, `row`, `col` | 돌 놓기 게임이 선택해서 공유하는 행동 |
| `ResignAction` | `resign` | 경기 참가자의 기권 요청 |
| `Cell`, `TwoColorPlayers` | 흑·백 보드 칸과 두 플레이어 | 현재 두 게임이 선택해서 공유하는 보드 모델 |
| `TwoPlayerResult<WinReason>` | 게임별 정상 승리 사유를 받는 1:1 결과 | 현재 두 게임이 선택해서 공유하는 결과 모델 |
| `GameCommand` | `GomokuCommand` 또는 `OthelloCommand` | 현재 등록한 게임 명령 유니언 |
| `GameSnapshot` | `GomokuSnapshot` 또는 `OthelloSnapshot` | 현재 등록한 게임 상태 유니언 |
| `GameResult` | `GomokuResult` 또는 `OthelloResult` | 현재 등록한 게임 결과 유니언 |
| `GameError` | 오류 객체 | 요청 실패 이유 |

```text
packages/game-contracts/src/
├── common.ts
├── types.ts
├── index.ts
├── actions/
│   ├── place.ts
│   └── resign.ts
├── shared/
│   ├── two-color-board.ts
│   └── two-player-result.ts
├── gomoku/
│   ├── types.ts
│   └── examples.ts
└── othello/
    └── types.ts
```

`@cafe/game-contracts`에서 공통 유니언이나 게임별 타입을 가져온다.

```ts
import type {
  GameCommand,
  GameSnapshot,
  GomokuCommand,
  OthelloSnapshot,
} from "@cafe/game-contracts";
```

### 2.1 새 게임 추가 방법

1. 해당 게임 폴더에서 행동, 명령, 상태, 결과를 정의한다. 명령은 `GameCommandBase`, 상태는 `GameSnapshotBase`를 확장하고, `gameType`은 해당 게임의 문자열 리터럴로 고정한다.
2. 필요한 게임만 `PlaceAction`, `ResignAction`, 흑·백 보드, 1:1 결과 같은 공유 모델을 선택해서 사용한다. 다른 행동·플레이어 수·점수·승자 표현을 가진 게임은 자기 모델을 정의한다.
3. `GameType`에 게임 종류를 추가하고, 루트 `types.ts`의 명령·상태·결과 유니언과 `index.ts`의 공개 타입을 함께 확장한다.
4. JSON 입력의 런타임 검증, 게임 규칙과 테스트, 필드 설명 및 예제를 추가한다.

공통 기본 타입에는 `action`, `board`, `players`, `currentPlayerId`, `result`를 포함하지 않는다. 해당 필드의 존재와 형태는 각 게임이 결정한다. 현재 두 게임의 명령·snapshot에서는 `gameType`을 확인하면 TypeScript가 해당 게임 타입으로 좁혀준다.

## 3. 공통 식별자와 버전

`matchId`와 `PlayerId`는 서버 DB의 BIGINT identity와 REST 응답에 맞춘 JSON number이다. REST와 WebSocket에서 같은 숫자 값을 사용하며 문자열로 바꾸지 않는다. 외부 입력은 `Number.isSafeInteger(id) && id > 0`으로 `1..Number.MAX_SAFE_INTEGER` 범위를 검증해야 한다. `number` 타입만으로 정수·양수·안전한 범위가 보장되지는 않는다. `players.black/white`, `currentPlayerId`, `winnerId`도 같은 `PlayerId`를 사용한다.

`commandId`는 숫자 DB ID와 역할이 다른 클라이언트 요청 식별자이며 계속 `string`이다.

### 3.1 GameCommandBase

| 필드 | 타입 | 의미 |
|---|---|---|
| `matchId` | `number` | 경기 식별자. 같은 경기의 명령과 snapshot은 같은 값을 사용 |
| `commandId` | `string` | 요청 식별자. 같은 요청을 재전송할 때 같은 값을 사용 |
| `expectedVersion` | `number` | 클라이언트가 요청을 만들 때 보고 있던 상태 버전 |

### 3.2 GameSnapshotBase

| 필드 | 타입 | 의미 |
|---|---|---|
| `matchId` | `number` | 경기 식별자 |
| `rulesVersion` | `string` | 해당 경기에서 사용하는 규칙 버전 |
| `stateVersion` | `number` | 서버가 확정한 현재 상태 버전 |
| `status` | `GameStatus` | 대기·진행·일시정지·종료 상태 |

`gameType`은 공통 기본 인터페이스의 필드가 아니라 각 게임 명령·상태에 추가하는 고정된 구분 값이다.

현재 오목 예제는 `expectedVersion: 0`으로 첫 착수를 요청하고, 갱신 상태를 `stateVersion: 1`로 표현한다. PR #11의 착수·기권 성공은 상태 버전을 1 증가시키며 거절·중복 재전송은 증가시키지 않는다. 중복 처리와 검사 순서는 9.1절에 기록한다. 대기·일시정지·복귀 등 나머지 생명주기의 버전 증가는 추가 합의 대상이다. 현재 서버는 명령 기록을 경기 기록과 함께 보관하며 자동 삭제·만료를 구현하지 않는다.

현재 서버(PR #11)는 게임별 엔진을 `{ version, rules, board }`로 등록한다. `board(moves)`는 저장된 착수로 현재 보드를 만들어 `getSnapshot()`에 쓴다. `createMatch()`는 호출자에게 규칙 버전을 받지 않고 등록 버전으로 저장한다. 착수 시 저장 버전과 등록 버전이 다르면 적용하지 않고 트랜잭션을 롤백한다. 오목 예제는 PR #12 엔진의 `gomoku-freestyle-v1`을 사용한다. 현재 서버는 게임별 한 버전을 지원하며, 공통 `rulesVersion: string` 타입은 향후 다른 게임이나 버전 등록을 허용한다. 여러 규칙 버전의 동시 운영은 이번 범위에 포함하지 않는다.

```ts
createGameCommandService(db, {
  gomoku: { version: "gomoku-freestyle-v1", rules: gomoku.rules, board: gomoku.board },
});
```

## 4. 게임별 명령과 행동

| 명령 | `gameType` | 행동 타입 |
|---|---|---|
| `GomokuCommand` | `"gomoku"` | `PlaceAction` 또는 `ResignAction` |
| `OthelloCommand` | `"othello"` | `PlaceAction` 또는 `ResignAction` |

현재 두 게임 명령은 `GameCommandBase`를 확장하고 `gameType`과 `action`을 추가한다. 현재 필드는 모두 필수이다. 각 게임의 행동 타입은 독립적으로 확장할 수 있다.

[PlaceAction](../packages/game-contracts/src/actions/place.ts)은 현재 오목·오델로가 재사용하는 행동이다. 공통 기본 명령은 이 행동을 요구하지 않으므로 좌표를 사용하지 않는 게임도 자기 행동 타입을 정의할 수 있다.

| 필드 | 타입 | 의미 |
|---|---|---|
| `action.type` | `"place"` | 지정한 위치에 돌을 놓는 요청 |
| `action.row` | `number` | 행 좌표 |
| `action.col` | `number` | 열 좌표 |

플레이어 ID나 돌 색을 착수·기권 요청에 직접 넣지 않는다. 서버는 인증 정보로 행위자를 식별하고 경기 참가자·차례와 연결하여 검사한다. 이러한 서버 검증은 현재 공통 타입과 예제만으로 구현된 것이 아니다.

### 4.1 오목·오델로 좌표 기준

두 게임의 엔진·API·DB 좌표는 0부터 시작하는 `row/col`을 사용한다. `(0, 0)`은 좌상단이며 `board[row][col]`로 접근한다. `row`, `col`은 정수이고, 오목은 `0..14`, 오델로는 `0..7` 범위이다. 화면에서 행·열을 1부터 표시할 경우 입력과 표시 경계에서 변환한다.

2026-10-08 요청자가 `row/col` 기준을 확인하고 SRS 표기도 맞추도록 요청했다. [SRS v0.3.1 초안](https://github.com/EscapeFromGyeongsan/ft_transcendence/blob/codex/srs-draft/Document/SRS.md)에 같은 기준을 반영했다. 요청자의 초안 확인과 팀의 최종 계약 승인은 구분한다.

### 4.2 기권 행동과 서버·엔진 경계

[ResignAction](../packages/game-contracts/src/actions/resign.ts)은 `{ type: "resign" }`이며 좌표가 없다. 오목·오델로가 이 행동을 선택해서 공유한다. 서버는 인증된 사용자와 경기 참가자를 확인한 뒤, 진행 중인 경기에서 기대 버전이 일치하면 현재 차례와 무관하게 기권을 처리한다. 상대가 승리하고 결과 사유는 `resign`, 상태는 `finished`, 차례는 `null`이며 상태 버전은 1 증가한다.

서버 경기 관리 계층은 `action.type`으로 분기하여 기권을 처리하고 `place`만 규칙 엔진에 전달한다. PR #11의 `GameRules`도 `PlaceAction`을 받는다. 클라이언트 계약에 기권을 추가했다고 순수 착수 엔진이 기권·인증·저장을 맡는 것은 아니다. 기권 시 보드는 유지되며, 종료 결과는 착수 기록만 재생하지 않고 저장된 경기 결과에서 복원한다.

PR #12의 `4971d30`에서 `applyMove`와 `GomokuRulesInput.action`을 착수 전용 `PlaceAction`으로 좁혔다. 전송 행동은 서버에서 분기하고 착수만 엔진으로 전달한다. 최신 서버의 `{ version, rules }` 등록과 실제 DB 통합 검증은 #25에서 인수한다.

## 5. 게임별 snapshot

`GomokuSnapshot`, `OthelloSnapshot`은 공통 `GameSnapshotBase`를 확장한다. 다음 필드는 각 게임 타입에서 추가한다. 현재 두 게임에서는 모든 필드가 필수이며, `currentPlayerId`와 `result`는 값으로 `null`을 허용한다.

| 필드 | 오목 | 오델로 | 의미 |
|---|---|---|---|
| `gameType` | `"gomoku"` | `"othello"` | 게임 종류를 고정하는 구분 값 |
| `players` | `TwoColorPlayers` | `TwoColorPlayers` | 흑·백을 맡은 플레이어 ID |
| `board` | `Cell[][]` | `Cell[][]` | 행 우선 보드. 각각 15×15·8×8 |
| `currentPlayerId` | `PlayerId 또는 null` | `PlayerId 또는 null` | 현재 차례인 플레이어 |
| `result` | `GomokuResult 또는 null` | `OthelloResult 또는 null` | 해당 게임의 종료 결과 |

[흑·백 공유 모델](../packages/game-contracts/src/shared/two-color-board.ts)은 현재 두 게임이 선택해서 재사용한다. 공통 기본 상태가 흑·백 플레이어, 보드, 현재 차례나 종료 결과 형식을 강제하지 않는다. 다른 게임은 플레이어 목록, 동시 행동 상태, 자기 점수·승자 표현 등을 별도로 정의할 수 있다.

현재 `Cell[][]` 타입만으로 보드 크기를 고정하지 않는다. 상태별 필드 조합도 타입이 완전히 제한하지 않는다. 대기 중 참가자 미배정 표현, 일시정지·종료 시 차례 값, 종료 상태와 결과의 관계는 구체화해야 한다.

## 6. 게임별 결과와 GameResult

`GomokuResult`, `OthelloResult`는 [TwoPlayerResult](../packages/game-contracts/src/shared/two-player-result.ts)의 1:1 결과 형식을 재사용한다. 정상 승리 사유는 오목 `five_in_row`, 오델로 `disc_count`로 구분한다.

| `outcome` | `winnerId` | 오목의 `reason` | 오델로의 `reason` |
|---|---|---|---|
| `"win"` | `PlayerId` | `five_in_row`, `resign`, `disconnect_timeout` | `disc_count`, `resign`, `disconnect_timeout` |
| `"draw"` | `null` | `draw` | `draw` |
| `"void"` | `null` | `server_restart`, `disconnect_timeout` | `server_restart`, `disconnect_timeout` |

`five_in_row`는 오목의 연속 돌 승리, `disc_count`는 오델로의 돌 개수 판정, `resign`은 기권, `disconnect_timeout`은 연결 복귀 유예 만료, `server_restart`는 서버 재시작으로 인한 무효를 표현하는 초안 값이다. 승리 결과의 `winnerId`는 승리한 참가자의 ID이다.

각 snapshot의 `result`는 해당 게임의 결과 타입을 사용하므로, 오목 상태에 `disc_count` 승리를 넣거나 오델로 상태에 `five_in_row` 승리를 넣으면 타입 오류가 발생한다. 공개 `GameResult` 유니언을 단독으로 사용할 때는 경기의 게임 종류와 함께 해석해야 한다.

`TwoPlayerResult`는 현재 1:1 게임의 선택형 공유 모델이다. 다른 승자·점수 형식이 필요한 게임은 자기 결과 타입을 만들고 공개 `GameResult` 유니언에 추가할 수 있다. `GAME_RULES.md`의 `resultType`·`winnerUserId` 제안과 현재 결과 명칭의 최종 통일은 팀 검토 필요하다.

다음은 별도의 오목 경기 종료 결과 예시이다. 7장의 첫 착수 후 상태에 대한 결과가 아니다.

```json
{
  "outcome": "win",
  "winnerId": 101,
  "reason": "five_in_row"
}
```

## 7. 오목 착수 JSON 예제

### 7.1 초기 상태

경기가 시작된 직후의 예제이다. 15×15 빈 보드, 흑 선공, 상태 버전 0을 표현한다.

```json
{
  "gameType": "gomoku",
  "matchId": 1,
  "rulesVersion": "gomoku-freestyle-v1",
  "stateVersion": 0,
  "status": "playing",
  "players": {
    "black": 101,
    "white": 102
  },
  "board": [
    [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null]
  ],
  "currentPlayerId": 101,
  "result": null
}
```

### 7.2 첫 착수 요청

흑 플레이어가 상태 버전 0을 보고 `(row: 4, col: 2)`에 착수를 요청한 예제이다. 요청자의 신원은 인증 정보로 식별한다.

```json
{
  "gameType": "gomoku",
  "matchId": 1,
  "commandId": "ex-command-1",
  "expectedVersion": 0,
  "action": {
    "type": "place",
    "row": 4,
    "col": 2
  }
}
```

### 7.3 착수 후 상태

첫 요청이 정상 처리되었다고 가정한 예제 데이터이다. 같은 경기의 `board[4][2]`에 흑돌을 배치하고, 상태 버전을 1로 바꾸고, 다음 차례를 백으로 넘긴다.

```json
{
  "gameType": "gomoku",
  "matchId": 1,
  "rulesVersion": "gomoku-freestyle-v1",
  "stateVersion": 1,
  "status": "playing",
  "players": {
    "black": 101,
    "white": 102
  },
  "board": [
    [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
    [null, null, "black", null, null, null, null, null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null]
  ],
  "currentPlayerId": 102,
  "result": null
}
```

| 항목 | 초기 상태 | 착수 후 상태 |
|---|---|---|
| `matchId` | `1` | `1` |
| `stateVersion` | `0` | `1` |
| `board[4][2]` | `null` | `"black"` |
| `currentPlayerId` | `101` | `102` |
| `status` | `"playing"` | `"playing"` |
| `result` | `null` | `null` |

### 7.4 기권 요청과 종료 상태

7.3의 상태에서 흑 사용자 `101`이 기권하는 예제이다. 현재 차례는 백이지만 기권은 허용된다. 서버는 흑 사용자의 인증 정보로 행위자를 확인한다. 요청과 종료 상태는 코드의 `resignCommand`, `resignedSnapshot`에 대응한다.

```json
{
  "gameType": "gomoku",
  "matchId": 1,
  "commandId": "ex-command-2",
  "expectedVersion": 1,
  "action": { "type": "resign" }
}
```

보드는 유지되고 백 사용자 `102`의 승리로 종료된다.

```json
{
  "gameType": "gomoku",
  "matchId": 1,
  "rulesVersion": "gomoku-freestyle-v1",
  "stateVersion": 2,
  "status": "finished",
  "players": {
    "black": 101,
    "white": 102
  },
  "board": [
    [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
    [null, null, "black", null, null, null, null, null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null]
  ],
  "currentPlayerId": null,
  "result": {
    "outcome": "win",
    "winnerId": 102,
    "reason": "resign"
  }
}
```

## 8. GameError

| 필드 | 타입 | 의미 |
|---|---|---|
| `code` | 아래 여덟 오류 코드 중 하나 | 호출자가 구분할 오류 종류 |
| `message` | `string` | 오류 설명 |

| `code` | 의미 |
|---|---|
| `"NOT_FOUND"` | 경기가 존재하지 않음 |
| `"COMMAND_ID_CONFLICT"` | 같은 경기에서 다른 참가자가 이미 사용한 commandId |
| `"GAME_NOT_ACTIVE"` | 경기가 waiting 또는 paused 상태임 |
| `"NOT_YOUR_TURN"` | 착수한 참가자의 차례가 아님. 기권에는 적용하지 않음 |
| `"INVALID_ACTION"` | 범위 밖 좌표, 이미 돌이 있는 칸 등 규칙상 허용되지 않는 행동 |
| `"VERSION_CONFLICT"` | 요청 처리 기준상 기대 상태 버전과 현재 상태 버전의 충돌 |
| `"NOT_PARTICIPANT"` | 경기 참가자가 아닌 사용자의 요청 |
| `"GAME_FINISHED"` | 이미 종료된 경기에 대한 행동 요청 |

오류 응답 예시:

```json
{
  "code": "VERSION_CONFLICT",
  "message": "현재 경기 상태와 요청의 기대 버전이 일치하지 않습니다."
}
```

현재 오류 객체에는 `matchId`, `commandId`나 최신 snapshot이 없다. 요청 연결·재동기화·전송 envelope는 후속 검토 대상이며, 현재 서버 서비스의 검사 우선순위는 9.1절을 따른다. 서버는 차례 위반을 엔진 호출 전에 `NOT_YOUR_TURN`으로 거절한다. 현재 오목 엔진은 공개 코드 중 `INVALID_ACTION`, `GAME_FINISHED`만 반환한다. B는 엔진 오류를 공개 코드의 부분집합으로 제한하고 미등록 코드는 서버 오류로 처리하도록 제안했다. 서버의 `RuleDecision.code`는 `INVALID_ACTION | GAME_FINISHED`로 제한했고, 실행 중 엔진이 다른 코드를 돌려주면 거절 기록 없이 서버 오류로 롤백한다. #29·#31에서 소비자 확인을 추적한다.

PR #11의 내부 `CommandResult`는 `status`, `duplicate`와 성공 시 `stateVersion`, 실패 시 `code`를 반환한다. 이것을 전송용 `GameError`로 변환하는 계층에서 `message`와 요청 연결 정보를 구성해야 한다. 클라이언트는 표시용 `message`가 아니라 `code`로 분기한다.

## 9. 서버 검증과 전송 경계

TypeScript 타입은 데이터의 형태를 설명한다. 외부 JSON 입력은 서버에서 별도로 검증해야 한다. 인증 사용자와 경기 참가자의 연결, 현재 차례, 좌표의 정수·범위·빈칸 여부, 버전 충돌 및 중복 요청 처리는 서버·게임 엔진에서 검증할 책임이다.

이 문서는 공통 데이터 객체를 정의하는 초안이다. REST endpoint별 HTTP 상태 코드는 11절에 기록한다. WebSocket 이벤트 이름·메시지 포장 형식·요청 응답 연결 방식은 해당 구현과 함께 추가한다. `GameError.code`만으로 HTTP 상태 코드나 WebSocket 이벤트를 확정하지 않는다.

### 9.1 서버 명령 처리 순서와 중복 재전송

[PR #6의 서버 리뷰](https://github.com/EscapeFromGyeongsan/ft_transcendence/pull/6#issuecomment-6215364436)와 [PR #11 서비스의 고정 커밋](https://github.com/EscapeFromGyeongsan/ft_transcendence/blob/c6f202a9bb534fe74363f28e1498d9a6634ff38d/apps/server/src/services/game-command-service.ts)을 기준으로 연결한다. 인증·외부 JSON 검증을 마친 호출자가 서버에서 확인한 `userId`와 명령을 서비스에 전달한다. 클라이언트의 사용자 ID 주장을 신뢰하지 않는다.

1. 트랜잭션에서 경기 행을 잠근다. 경기가 없으면 `NOT_FOUND`이다.
2. 인증된 사용자가 참가자인지 확인한다. 아니면 `NOT_PARTICIPANT`이다.
3. 같은 경기의 `commandId` 기록을 조회한다. 다른 사용자의 기록이면 `COMMAND_ID_CONFLICT`, 같은 사용자의 기록이면 최초 성공/거절 결과를 `duplicate: true`로 재전송한다.
4. 새 명령에 대해 종료 여부(`GAME_FINISHED`), 그 외 비활성 상태(`GAME_NOT_ACTIVE`)를 검사한다.
5. `expectedVersion`을 현재 버전과 비교한다. 다르면 `VERSION_CONFLICT`이다.
6. 기권이면 경기 관리 계층에서 상대 승리를 확정한다. 착수이면 차례(`NOT_YOUR_TURN`)를 검사한 뒤 등록 엔진과 저장된 규칙 버전의 일치를 확인하고 게임 규칙에 전달한다. 엔진 미등록·버전 불일치는 예외로 롤백하며 명령 거절 기록을 남기지 않는다.
7. 착수 기록(기권에는 없음), 경기 상태·버전, 명령 처리 기록 및 종료 결과를 같은 트랜잭션에 저장하고 commit한다. 4~6단계의 거절도 명령 결과로 저장하되 착수·상태 버전은 변경하지 않는다.
8. 서비스가 성공적으로 반환된 뒤 응답·snapshot을 전송한다. commit 전에 방송하지 않는다.

중복 판정은 상태·기대 버전 검사보다 먼저다. 따라서 종료를 만든 명령을 재전송해도 최초 성공을 돌려주며, 이후 다른 착수가 진행됐어도 중복 응답의 `stateVersion`은 **최초 적용 버전**이다. 이를 최신 snapshot 버전으로 해석하지 않는다. 거절된 명령도 같은 ID로 다시 보내면 최초 거절이 재전송되므로, 상태를 갱신하고 새 행동을 할 때는 새로운 `commandId`를 사용한다.

현재 서버는 같은 참가자가 같은 경기·`commandId`로 **다른 payload를 보내도 최초 결과를 재전송**한다. `COMMAND_ID_CONFLICT`는 현재 다른 사용자의 ID 재사용에만 해당한다. 새 행동에는 항상 새 `commandId`를 만들고 동일 요청 재전송에만 기존 값을 사용해야 한다. B는 최초 결과 재전송 유지와 해시 비교 미도입을 제안했다. #29에서 다른 소비자의 확인을 추적하며, 이번 문서 보완은 서버 동작을 변경하지 않는다.

### 9.2 엔진 규칙 상태와 전송 snapshot

`@cafe/game-engine`의 `gomoku.createInitialState()`는 `GomokuState`를 반환한다. 엔진 상태는 다음 필드로 구성한다.

| 필드 | 타입 | 의미 |
|---|---|---|
| `board` | `Cell[][]` | 15×15 오목 보드. 초기에는 모든 칸이 `null` |
| `currentPlayerColor` | `PlayerColor \| null` | 현재 차례의 돌 색. 초기에는 `"black"`, 규칙상 종료 후에는 `null` |
| `result` | `GomokuFinish \| null` | 진행 중에는 `null`. 승리 시 `{ outcome: "win", winner: PlayerColor, reason: "five_in_row" }`, 무승부 시 `{ outcome: "draw", reason: "draw" }` |

엔진은 규칙 데이터로 작업한다. 경기 관리 계층이 `currentPlayerColor`를 배정된 흑·백 사용자 ID와 연결해 `currentPlayerId`를 구성하고, 경기 ID·규칙 버전·상태 버전·진행 상태·결과를 붙여 전송용 `GomokuSnapshot`을 만든다. 인증·명령 중복 처리·버전 관리·저장·전송은 경기 관리 계층의 책임이다.

초기 상태 생성과 `gomoku.applyMove(state, action, playerColor)`를 구현했으며 팀 검토 대상이다. `action`은 착수 전용 `PlaceAction`이고 `playerColor`는 서버가 인증된 참가자에게 배정한 색이다. 엔진은 종료 여부, 정수·범위 좌표, 현재 차례, 빈칸을 검사한다. 정상 착수는 모든 행을 복사한 새 보드의 `{ ok: true, state }`를 반환한다. 가로·세로·두 대각선의 연속 5개 이상이면 승리하고, 승리 없이 보드가 차면 무승부이다. 금수는 없다. 종료 후에는 차례가 `null`이며 추가 착수를 `GAME_FINISHED`로 거절한다. 그 외 불법 착수는 `INVALID_ACTION`이다. 실패는 `{ ok: false, error: { code, message } }`이며 성공·실패 모두 입력 상태를 수정하지 않는다. 이 반환 형식은 엔진 호출 결과이며 REST·WebSocket의 응답 형식을 확정하지 않는다.

엔진 입력은 유효한 15×15 규칙 상태와 구조가 검증된 행동이다. `gomoku.restoreState(moves)`는 저장 순서의 착수 기록으로 규칙 상태를 복원하고, 잘못된 이력에는 예외를 던진다. `gomoku.rules`는 팀 PR #11의 `GameRules`에 맞는 연결 함수이며 착수 기록을 재생한 뒤 다음 차례·종료 결과 또는 오류 코드를 반환한다. 제안 규칙 버전은 `gomoku.GOMOKU_RULES_VERSION`(`gomoku-freestyle-v1`)이다. 등록·버전 선택은 호출 계층에서 담당한다.

실제 참가자·경기 진행 상태 검사, 기권·이탈·재시작에 따른 종료, 명령 중복·버전 관리, snapshot 구성·전송은 경기 관리 계층에서 연결해야 한다. 보드 재생만으로 기권·이탈 등의 결과를 복원할 수 없으므로 저장된 경기 상태·결과도 함께 사용한다. PR #6의 `769f809`는 숫자 ID와 기권을 포함하는 전송 계약을 추가한다. 이 문서에는 해당 전송 계약을 통합했다. 서버는 기권을 직접 처리하고 `PlaceAction`만 엔진에 전달한다. `GomokuRulesInput.action`도 착수 전용이며 엔진 연결 함수는 ID를 사용하지 않는다. 상세 공개 함수와 검증 방법은 [game-engine/README.md](../packages/game-engine/README.md)를 참조한다.


## 10. 요청자 및 팀 검토 항목

- [x] 요청자가 필드 설명과 초기 상태 → 착수 → 갱신 예제 흐름을 검토했다(2026-10-08).
- [x] 요청자가 0부터 시작하는 `row/col` 기준과 같은 기준의 SRS 반영을 확인했다(2026-10-08).
- [x] 오목·오델로 명령·상태·결과를 게임별로 분리하고 공개 유니언을 구성했다(2026-10-12). 구현 초안은 팀 검토 대상이다.
- [x] 현재 서버의 등록 버전 저장·착수 시 일치 검사와 오목 `gomoku-freestyle-v1`을 반영했다(2026-10-28).
- [x] 서버 리뷰의 숫자 ID·기권 행동·오류 코드와 실제 명령 처리 순서를 코드·예제·문서에 반영했다(2026-10-24). B가 계약 구조를 승인했다(2026-10-28).
- [ ] #29: 현재 최초 결과 재전송·명령 기록 자동 만료 없음과 B의 유지 제안을 소비자가 확인한다.
- [x] B가 서버 타입을 공개 코드 부분집합으로 제한하고 미등록 코드를 서버 오류로 처리했다(2026-10-28).
- [ ] #29·#31: 공개 코드 부분집합 정책을 소비자가 확인한다.
- [ ] 대기 중 참가자 미배정, 일시정지·종료 시 차례, 종료 결과의 필드 조합을 어떻게 제한할 것인가?
- [ ] 종료 결과 명칭과 게임별 사유를 `GAME_RULES.md` 및 SRS와 어떻게 통일할 것인가?
- [ ] 오류의 요청 연결, 재동기화 방식, REST·WebSocket 전달 형식을 어떻게 정할 것인가?

요청자는 필드 설명·예제 흐름·좌표 기준을 검토하고, 2026-10-12 게임별 행동·상태·결과를 분리하는 확장 구조의 반영을 요청했다. 2026-10-24에는 B의 서버 리뷰를 반영했다. 나머지 미결정 항목과 구현 초안의 최종 승인은 B/C/D의 서버·게임·UI 연결 관점 검토 대상으로 유지한다.

## 11. REST API 상태 코드

서버 REST API가 반환할 수 있는 상태 코드를 엔드포인트별로 기록한다. 모든 코드는 각 route의 `schema.response`에도 선언돼 Swagger(`/docs`)에 표시된다. 2026-10-28 Swagger 출력을 기준으로, 2026-11-09 [#78](https://github.com/EscapeFromGyeongsan/ft_transcendence/issues/78)의 전적 공개 설정과 조회 권한을 반영했다. 엔드포인트를 추가·변경하면 이 표도 함께 고친다.

IF-02 토큰 보관 합의(#30): access token은 페이지 메모리에만 두고 브라우저 저장소에 기록하지 않는다. refresh token은 `cbc.auth.refreshToken` 키에 보관하며, 로그인 상태 유지를 선택하면 `localStorage`, 해제하면 `sessionStorage`를 쓴다. 새로고침 뒤 보호 API를 호출하기 전에 refresh로 access token을 복원한다. 동시 갱신은 같은 Promise를 공유하고, 이전 access token의 401이 늦게 도착하면 이미 교체된 토큰으로 한 번 재시도한다. 갱신 실패·갱신 후 401·로그아웃 시 보관 토큰을 지운다. 기존 `cyber_board_cafe.auth.tokens` 값은 refresh token만 이전한 뒤 삭제하고 access token은 복원하지 않는다. 저장소 접근·쓰기가 차단되면 현재 페이지 메모리만 사용하므로 다음 페이지 로드의 로그인 유지가 보장되지 않는다.

`localStorage`를 공유하는 여러 탭의 갱신은 [Web Locks](https://w3c.github.io/web-locks/)의 origin 단위 배타 잠금(`cbc.auth.refresh`)으로 직렬화한다. 잠금 획득 후 최신 refresh token을 다시 읽고, 새 토큰 저장까지 잠금을 유지한다. 비밀이 아닌 로그인 표식 `cbc.auth.sessionId`를 같은 저장소에 두어 토큰 회전과 다른 로그인·로그아웃을 구별한다. 표식이 바뀐 이전 요청·갱신 응답은 폐기하며 새 로그인을 덮어쓰거나 지우지 않는다. 로그인 유지 해제 시 토큰과 표식은 탭별 `sessionStorage`에만 있다. Web Locks를 제공하는 Chrome의 HTTPS·localhost 환경에서 탭 간 갱신을 지원한다. Web Locks 미지원 환경은 같은 탭의 중복 요청만 합치므로 공유 토큰의 여러 탭 동시 갱신은 지원하지 않는다.

### 11.1 오류 응답 형식

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "...", "details": {} } }
```

- 화면·클라이언트는 `code`로 분기한다. `message`는 표시·디버깅용이다.
- `details`는 선택 필드다.
- 8절의 `GameError`는 게임 명령 결과이며, REST 오류 응답과 같은 객체가 아니다.

### 11.2 공통 코드

| 상태 | `code` | 언제 |
|---|---|---|
| 400 | `BAD_REQUEST` | 본문을 해석할 수 없음 (깨진 JSON, multipart) |
| 401 | `UNAUTHENTICATED` | token 없음·만료·위조, 폐기·만료된 세션 |
| 403 | `RECORDS_PRIVATE` | 본인 외 사용자가 비공개 전적·통계 조회 |
| 413 | `PAYLOAD_TOO_LARGE` | 본문 크기 제한 초과 (JSON 1 MiB, 아바타 2 MiB) |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | 허용하지 않는 Content-Type |
| 422 | `VALIDATION_ERROR` | 필드 형식·범위 검증 실패 |
| 429 | `RATE_LIMITED` | 요청 횟수 제한 초과 |
| 500 | `INTERNAL_ERROR` | 예상하지 못한 서버 오류 |
| 503 | `SERVICE_UNAVAILABLE` | DB 미설정·연결 실패 등 의존 서비스 장애 |

본문을 받는 POST·PATCH는 본문이 없어도 보내면 해석하므로 400·413·415가 붙는다.

### 11.3 엔드포인트별 상태 코드

괄호 안은 그 상태에서 나오는 `code`다. 11.2의 공통 의미와 같은 코드는 상태만 적는다.

| 메서드·경로 | 성공 | 오류 |
|---|---|---|
| `GET /api/health` | 200 | 없음 |
| `GET /api/health/db` | 200 | 503 |
| `POST /api/auth/register` | 201 | 400, 409 (`EMAIL_TAKEN`, `NICKNAME_TAKEN`), 413, 415, 422, 429, 500, 503 |
| `POST /api/auth/login` | 200 (2FA 계정은 `challengeToken`) | 400, 401 (`INVALID_CREDENTIALS`), 413, 415, 422, 429, 500, 503 |
| `POST /api/auth/refresh` | 200 | 400, 401, 413, 415, 422, 429, 500, 503 |
| `POST /api/auth/logout` | 204 | 400, 401, 413, 415, 500, 503 |
| `POST /api/auth/2fa/verify` | 200 | 400, 401 (`UNAUTHENTICATED`, `INVALID_TWO_FACTOR_CODE`), 413, 415, 422, 429, 500, 503 |
| `GET /api/auth/2fa` | 200 | 401, 500, 503 |
| `POST /api/auth/2fa/setup` | 200 | 400, 401, 409 (`TWO_FACTOR_ALREADY_ENABLED`), 413, 415, 500, 503 |
| `POST /api/auth/2fa/enable` | 200 | 400 (`BAD_REQUEST`, `INVALID_TWO_FACTOR_CODE`), 401, 409 (`TWO_FACTOR_NOT_SET_UP`, `TWO_FACTOR_ALREADY_ENABLED`), 413, 415, 422, 429, 500, 503 |
| `POST /api/auth/2fa/disable` | 204 | 400 (`BAD_REQUEST`, `INVALID_TWO_FACTOR_CODE`), 401, 409 (`TWO_FACTOR_NOT_ENABLED`), 413, 415, 422, 429, 500, 503 |
| `POST /api/auth/oauth/42/login` | 200 | 400, 413, 415, 429, 500, 503 |
| `POST /api/auth/oauth/42/link` | 200 | 400, 401, 413, 415, 500, 503 |
| `POST /api/auth/oauth/42/callback` | 200 | 400, 401 (`OAUTH_STATE_INVALID`, `OAUTH_FAILED`, `UNAUTHENTICATED`), 409 (`EMAIL_TAKEN`, `OAUTH_ACCOUNT_LINKED`, `OAUTH_ALREADY_LINKED`), 413, 415, 422 (`VALIDATION_ERROR`, `OAUTH_EMAIL_MISSING`), 429, 500, 502 (`OAUTH_PROVIDER_ERROR`), 503 |
| `GET /api/users/me` | 200 | 401, 500, 503 |
| `PATCH /api/users/me` | 200 | 400, 401, 409 (`NICKNAME_TAKEN`), 413, 415, 422, 500, 503 |
| `GET /api/users/{userId}` | 200 | 401, 404 (`NOT_FOUND`), 422, 500, 503 |
| `GET /api/users/{userId}/stats` | 200 | 401, 403 (`RECORDS_PRIVATE`), 404 (`NOT_FOUND`), 422, 500, 503 |
| `GET /api/users/{userId}/matches` | 200 | 401, 403 (`RECORDS_PRIVATE`), 404 (`NOT_FOUND`), 422, 500, 503 |
| `GET /api/leaderboard` | 200 | 401, 422, 500, 503 |
| `PUT /api/users/me/avatar` (PR #15) | 200 | 400, 401, 413, 415, 422 (`VALIDATION_ERROR`, `IMAGE_TOO_BIG`), 429, 500, 503 |
| `DELETE /api/users/me/avatar` (PR #15) | 204 | 401, 500, 503 |
| `GET /api/media/avatars/{name}` (PR #15) | 200 | 404 (`NOT_FOUND`), 500, 503 |

- `me` 경로는 인증된 사용자 자신만 다룬다. 전적 공개 권한은 대상 사용자와 인증된 조회자를 비교한다(11.4절).
- 경기 조회·명령 API는 REST에 없다. 경기는 WebSocket(IF-03, D)으로 다루고, 그 오류는 8절 `GameError`를 쓴다.

### 11.4 전적 공개 설정과 조회 권한 (FR-PRO-04, DEC-05)

`users.records_public`은 `boolean NOT NULL DEFAULT true`다. 새 migration `0004_records_public.sql`이 기존 사용자도 공개 상태로 유지한다. 본인 계정 DTO(`id`, `email`, `nickname`, `avatarUrl`, `createdAt`)에 필수 boolean `recordsPublic`을 추가한다. 가입 응답의 `user`, `GET /api/users/me`, 프로필 변경 및 아바타 업로드 응답이 같은 DTO를 사용한다. 로그인·refresh 응답은 기존 토큰 형식을 유지한다.

`PATCH /api/users/me`는 `nickname`과 `recordsPublic` 중 하나 이상을 받으며 두 필드를 함께 보낼 수 있다.

```json
{ "recordsPublic": false }
```

- `nickname`은 기존 2~32자 검증을 유지한다. `recordsPublic`은 JSON boolean만 허용하며 문자열·숫자·null은 422 `VALIDATION_ERROR`다. 빈 객체와 알 수 없는 필드도 422다. 인증은 본문 검증보다 먼저 수행한다.
- 요청에 없는 필드는 유지한다. 두 필드는 하나의 UPDATE로 저장하므로 닉네임 충돌(409 `NICKNAME_TAKEN`) 시 공개 설정도 바뀌지 않는다. 성공 응답은 저장된 본인 계정 DTO다.
- `/stats`와 `/matches`는 인증된 조회자의 ID를 서비스에 전달한다. 대상이 없으면 404, 본인이면 공개 설정과 관계없이 조회할 수 있다. 다른 사용자가 비공개 대상을 조회하면 통계·경기 데이터 없이 403 `RECORDS_PRIVATE`를 반환한다. 게임 필터·페이지 조건과 관계없이 같은 권한 검사를 적용한다.
- 권한 확인과 전적 읽기는 한 트랜잭션에서 대상 사용자 행의 공유 잠금을 유지한다. 공개 설정 변경과 경합하면 DB에서 순서를 정하며, 변경이 먼저 완료된 조회는 변경된 설정으로 판단한다. 두 조회 API의 응답에는 `Cache-Control: no-store`를 붙인다.
- 기본 프로필(`id`, `nickname`, `avatarUrl`), 리더보드, 상대방이 본인 `/matches`에서 보는 상대 이름은 공개 설정의 영향을 받지 않는다. 다른 사용자에게 이메일이나 `recordsPublic`을 추가 공개하지 않는다.
- 내 프로필 토글은 저장 응답을 확인한 뒤 반영한다. 실패 시 기존 값을 유지하며 오류를 표시한다. 타인 프로필에서 `RECORDS_PRIVATE`를 받으면 통계·업적·최근 대국 대신 비공개 안내를 표시하고 이전 조회 데이터를 비운다.

SDS 2.10.26의 제안을 구현한 상태이며 B의 스키마·API 검토는 별도다. 실제 PostgreSQL·두 세션 브라우저 검증은 [검증 기록](profile-records-privacy-validation.md)을 따른다.

### 11.5 친구 웹 클라이언트 검토안 (#80, 실제 API 통합 대기)

친구 REST·스키마 구현은 [#69](https://github.com/EscapeFromGyeongsan/ft_transcendence/issues/69)에서 E가 담당한다. `feat/web-friends`의 클라이언트는 [PR #68 `a14ba86`](https://github.com/EscapeFromGyeongsan/ft_transcendence/pull/68) SDS 2.10.29의 검토안을 소비한다. 이 절은 구현된 서버 API의 상태 코드 표(11.3)에 친구 endpoint를 추가하는 것이 아니며, B·E의 최종 계약 확인이 필요하다.

| 클라이언트 동작 | 소비하는 초안 |
|---|---|
| 목록 | `GET /api/friends` → `{ friends: [{ userId, nickname, avatarUrl, online }], incoming: [...], outgoing: [...] }`. 두 요청 목록에는 `requestId`, `createdAt`이 필요하다. |
| 검색 | `GET /api/users?nickname=접두사` → 최대 20명. JSON 구조는 미확정이다. **프런트 임시 읽기 형식은 `{ id, nickname, avatarUrl }[]`**이며 `userId`로 정규화한다. 서버 계약을 확정한 것으로 취급하지 않는다. |
| 요청 | `POST /api/friends/requests { userId }` → 공통 사용자 정보와 `requestId`, `status: pending 또는 accepted` |
| 수락 | `POST /api/friends/requests/{requestId}/accept` → 해당 요청 ID의 `accepted` 결과 |
| 거절 | `POST /api/friends/requests/{requestId}/decline` → 204 |
| 친구 삭제 | `DELETE /api/friends/{userId}` → 204 |

목록·검색·성공 응답은 클라이언트에서 형태를 확인하며 누락된 `online`을 false로 채우지 않는다. 부적합한 성공 응답은 로컬 `FRIENDS_INVALID_RESPONSE`로 표시한다. 이 코드는 서버가 반환하는 HTTP 오류 계약이 아니다. `REQUEST_DECLINED` 등 SDS 초안 코드는 사용자 안내에 연결하며, 404·409가 나면 목록을 다시 확인하고 변경 요청을 자동 재전송하지 않는다.

서버 성공 이후 재조회가 실패하면 성공 안내를 유지하면서 목록 실패를 별도로 표시한다. 새 조회가 확인될 때까지 이전 목록의 변경 동작과 온라인 표시를 확정하지 않는다. WS 인증 연결 복구는 재조회를 유발한다. `presence` 및 친구 관계 변경 알림의 최종 이벤트·집계·전송 순서는 D·E 확인 후 연결한다.

실제 서버가 없는 상태의 응답 대체 검증과 실제 API·WS·DB 통합 결과는 [친구 화면 검증 기록](friends-web-validation.md)에서 구분한다.

## 12. WebSocket `/api/ws` (IF-03)

REST 상태 코드는 11장(B, #33)에 둔다. 이 장은 실시간 연결의 연결 거절·close code·메시지를 기록한다. 이 경로는 HTTP 응답 본문이 없는 upgrade라 Swagger(`/docs`)에서 숨긴다(`schema.hide`). 여기 적힌 내용은 #41 기준이며, 경기 구독·명령·매칭·재접속 메시지는 #42·#43·#49·#50이 이 장에 이어서 추가한다.

### 12.1 연결과 인증

1. 클라이언트는 `GET /api/ws`로 연결한다. access token은 URL·헤더에 넣지 않는다(프록시·접근 로그에 남지 않게 하기 위함).
2. 연결 후 5초 안에 첫 메시지로 `auth`를 보낸다. 서버는 JWT와 서버 세션을 함께 확인하고 `auth.ok`로 답한다.
3. `auth.ok`를 받기 전에는 다른 메시지를 보내지 않는다. 인증 처리 중 들어온 메시지는 4401로 닫는다.
4. 인증은 연결 시점에만 한다. 연결 중 access token이 만료돼도 연결은 유지되고, 세션 폐기(로그아웃)만 연결을 닫는다.

### 12.2 메시지 형식

모든 메시지는 텍스트 프레임의 JSON `{ type, requestId?, payload }`이다. `payload`는 객체, `requestId`는 1~64자 문자열이다. 요청에 `requestId`가 있으면 그 요청의 응답·오류에 같은 값을 돌려준다.

| 방향 | `type` | `payload` | 설명 |
|---|---|---|---|
| C → S | `auth` | `{ accessToken }` | 연결 후 첫 메시지 |
| S → C | `auth.ok` | `{ userId }` | 인증 성공 |
| C → S | `ping` | `{}` | 앱 레벨 연결 확인 |
| S → C | `pong` | `{}` | `ping` 응답 |
| S → C | `error` | `{ code, message }` | 연결을 유지하는 오류. 지원하지 않는 `type`이면 `UNSUPPORTED_MESSAGE` |

### 12.3 연결 거절과 close code

| 상황 | 결과 |
|---|---|
| 같은 IP에서 1분에 30번을 넘는 연결 요청 | upgrade 없이 HTTP 429 `RATE_LIMITED` |
| 5초 안에 `auth`가 오지 않음 | 4401 `Authentication timed out.` |
| 첫 메시지가 `auth`가 아니거나 `accessToken`이 없음, 인증 중 다른 메시지 | 4401 `Authenticate first.` |
| 토큰 무효·만료, 폐기된 세션 | 4401 `Invalid or expired token.` |
| 로그아웃으로 세션 폐기 | 그 세션의 모든 연결을 4401 `Session ended.` |
| JSON이 아니거나 envelope 형식이 틀림, binary 프레임 | 4400 `Malformed message.` |
| 16 KiB를 넘는 메시지 | 1009 (`ws`의 `maxPayload`) |
| 인증 중 DB·인증 서비스 장애 | 1011 `Service unavailable.` |

4401을 받은 클라이언트는 `POST /api/auth/refresh`로 토큰을 갱신한 뒤 다시 연결한다. 갱신도 실패하면 로그인 화면으로 보낸다. 4400·1009는 클라이언트 버그이므로 같은 메시지로 재시도하지 않는다.
