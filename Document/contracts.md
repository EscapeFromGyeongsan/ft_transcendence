# 게임 공통 계약

- 문서 버전: 0.1 / 작성일: 2026-10-08 (KST)
- 상태: 요청자 초안 검토 및 좌표 기준 확인(2026-10-08) — 팀 검토 대기
- 관련 이슈: [#5 공통 계약 초안](https://github.com/EscapeFromGyeongsan/ft_transcendence/issues/5)
- 작성 책임: dong-hki / 문서 작성 지원: Codex
- 타입 정의: [types.ts](../packages/game-contracts/src/types.ts)
- 공개 입구: [index.ts](../packages/game-contracts/src/index.ts)
- 코드 예제: [examples.ts](../packages/game-contracts/src/examples.ts)

## 1. 목적과 범위

서버와 프론트가 공유할 게임 명령, 현재 경기 상태, 종료 결과, 오류 형식을 설명한다. 현재 타입 정의를 문서화하고 오목의 초기 상태 → 착수 요청 → 갱신 상태 예제를 제공한다.

오목과 오델로를 `gameType`으로 구분하지만, 현재 타입은 공통 보드와 `place` 행동을 사용한다. 게임별 행동·상태를 분리하는 구조와 오델로 예제는 후속 검토 대상이다. 아래 JSON은 코드의 예제 데이터이며 실제 게임 엔진의 처리 결과나 구현 완료 증빙을 뜻하지 않는다.

## 2. 타입의 역할

| 타입 | 현재 정의 | 역할 |
|---|---|---|
| `GameType` | `"gomoku" \| "othello"` | 게임 종류 |
| `PlayerId` | `string` | 플레이어 식별자 |
| `Cell` | `"black" \| "white" \| null` | 보드 한 칸의 돌 색 또는 빈칸 |
| `GameCommand` | 명령 객체 | 클라이언트가 서버에 보내는 행동 요청 |
| `GameSnapshot` | 상태 객체 | 서버가 참가자에게 전달하는 현재 경기 상태 |
| `GameResult` | 결과 객체의 유니언 | 승리·무승부·무효 결과 |
| `GameError` | 오류 객체 | 요청 실패 이유 |

`@cafe/game-contracts`에서 필요한 타입을 가져온다.

```ts
import type { GameCommand, GameSnapshot } from "@cafe/game-contracts";
```

## 3. 공통 식별자와 버전

| 필드 | 타입 | 의미 |
|---|---|---|
| `gameType` | `GameType` | 데이터가 속하는 게임 종류 |
| `matchId` | `string` | 경기 식별자. 같은 경기의 명령과 snapshot은 같은 값을 사용 |
| `commandId` | `string` | 요청 식별자. 같은 요청을 재전송할 때 같은 값을 사용 |
| `expectedVersion` | `number` | 클라이언트가 요청을 만들 때 보고 있던 상태 버전 |
| `stateVersion` | `number` | 서버가 확정한 현재 상태 버전 |
| `rulesVersion` | `string` | 해당 경기에서 사용하는 규칙 버전 |

현재 예제는 `expectedVersion: 0`으로 첫 착수를 요청하고, 갱신 상태를 `stateVersion: 1`로 표현한다. 전체 상태 전이의 버전 증가 규칙, 요청 중복 판정 범위·보관 기간·응답 재사용 방식은 검토 필요하다.

`rulesVersion: "gomoku-temp-ver"`는 예제용 임시 값이다. 실제 규칙 버전의 명명과 관리 방식은 아직 정하지 않았다.

## 4. GameCommand

현재 행동 요청은 `place` 한 종류이다. 위 공통 필드 중 `gameType`, `matchId`, `commandId`, `expectedVersion`과 아래 `action`을 포함하며 모두 필수이다.

| 필드 | 타입 | 의미 |
|---|---|---|
| `action.type` | `"place"` | 지정한 위치에 돌을 놓는 요청 |
| `action.row` | `number` | 행 좌표 |
| `action.col` | `number` | 열 좌표 |

플레이어 ID나 돌 색을 요청에 직접 넣지 않는다. 서버는 인증 정보로 행위자를 식별하고 경기 참가자·차례와 연결하여 검사한다. 이러한 서버 검증은 현재 공통 타입과 예제만으로 구현된 것이 아니다.

### 4.1 좌표 기준

엔진·API·DB 좌표는 0부터 시작하는 `row/col`을 사용한다. `(0, 0)`은 좌상단이며 `board[row][col]`로 접근한다. `row`, `col`은 정수이고, 오목은 `0..14`, 오델로는 `0..7` 범위이다. 화면에서 행·열을 1부터 표시할 경우 입력과 표시 경계에서 변환한다.

2026-10-08 요청자가 `row/col` 기준을 확인하고 SRS 표기도 맞추도록 요청했다. [SRS v0.3.1 초안](https://github.com/EscapeFromGyeongsan/ft_transcendence/blob/codex/srs-draft/Document/SRS.md)에 같은 기준을 반영한다. 요청자의 초안 확인과 팀의 최종 계약 승인은 구분한다.

## 5. GameSnapshot

위 공통 필드 중 `gameType`, `matchId`, `rulesVersion`, `stateVersion`과 아래 필드를 포함한다. 모든 필드는 필수이며, `currentPlayerId`와 `result`는 값으로 `null`을 허용한다.

| 필드 | 타입 | 의미 |
|---|---|---|
| `status` | `"waiting" \| "playing" \| "paused" \| "finished"` | 대기·진행·일시정지·종료 상태 |
| `players.black` | `PlayerId` | 흑을 맡은 플레이어 ID |
| `players.white` | `PlayerId` | 백을 맡은 플레이어 ID |
| `board` | `Cell[][]` | 행 우선의 2차원 보드. 오목 예제는 15×15 |
| `currentPlayerId` | `PlayerId \| null` | 현재 차례인 플레이어. 현재 예제에서는 흑 또는 백의 ID |
| `result` | `GameResult \| null` | 경기 종료 결과. 현재 진행 중인 예제에서는 `null` |

현재 `Cell[][]` 타입만으로 보드 크기를 고정하지 않는다. 상태별 필드 조합도 타입이 완전히 제한하지 않는다. 대기 중 참가자 미배정 표현, 일시정지·종료 시 차례 값, 종료 상태와 결과의 관계를 구체화해야 한다.

## 6. GameResult

| `outcome` | `winnerId` | 허용되는 `reason` |
|---|---|---|
| `"win"` | `PlayerId` | `"five_in_row"`, `"disc_count"`, `"resign"`, `"disconnect_timeout"` |
| `"draw"` | `null` | `"draw"` |
| `"void"` | `null` | `"server_restart"`, `"disconnect_timeout"` |

`five_in_row`는 오목의 연속 돌 승리, `disc_count`는 오델로의 돌 개수 판정, `resign`은 기권, `disconnect_timeout`은 연결 복귀 유예 만료, `server_restart`는 서버 재시작으로 인한 무효를 표현하는 초안 값이다. 승리 결과의 `winnerId`는 승리한 참가자의 ID이다.

현재 타입은 결과에 `gameType`을 포함하지 않으므로 게임별 승리 사유를 제한하지 않는다. `GAME_RULES.md`의 `resultType`·`winnerUserId` 제안과 현재 `outcome`·`reason`·`winnerId` 형식의 통일도 검토 필요하다.

다음은 별도의 경기 종료 결과 예시이다. 7장의 첫 착수 후 상태에 대한 결과가 아니다.

```json
{
  "outcome": "win",
  "winnerId": "ex-player-1",
  "reason": "five_in_row"
}
```

## 7. 오목 착수 JSON 예제

### 7.1 초기 상태

경기가 시작된 직후의 예제이다. 15×15 빈 보드, 흑 선공, 상태 버전 0을 표현한다.

```json
{
  "gameType": "gomoku",
  "matchId": "ex-match-1",
  "rulesVersion": "gomoku-temp-ver",
  "stateVersion": 0,
  "status": "playing",
  "players": {
    "black": "ex-player-1",
    "white": "ex-player-2"
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
  "currentPlayerId": "ex-player-1",
  "result": null
}
```

### 7.2 첫 착수 요청

흑 플레이어가 상태 버전 0을 보고 `(row: 4, col: 2)`에 착수를 요청한 예제이다. 요청자의 신원은 인증 정보로 식별한다.

```json
{
  "gameType": "gomoku",
  "matchId": "ex-match-1",
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
  "matchId": "ex-match-1",
  "rulesVersion": "gomoku-temp-ver",
  "stateVersion": 1,
  "status": "playing",
  "players": {
    "black": "ex-player-1",
    "white": "ex-player-2"
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
  "currentPlayerId": "ex-player-2",
  "result": null
}
```

| 항목 | 초기 상태 | 착수 후 상태 |
|---|---|---|
| `matchId` | `"ex-match-1"` | `"ex-match-1"` |
| `stateVersion` | `0` | `1` |
| `board[4][2]` | `null` | `"black"` |
| `currentPlayerId` | `"ex-player-1"` | `"ex-player-2"` |
| `status` | `"playing"` | `"playing"` |
| `result` | `null` | `null` |

## 8. GameError

| 필드 | 타입 | 의미 |
|---|---|---|
| `code` | 아래 네 오류 코드 중 하나 | 호출자가 구분할 오류 종류 |
| `message` | `string` | 오류 설명 |

| `code` | 의미 |
|---|---|
| `"INVALID_ACTION"` | 범위 밖 좌표, 이미 돌이 있는 칸, 차례 위반 등 허용되지 않는 행동 |
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

현재 오류 객체에는 `matchId`, `commandId`나 최신 snapshot이 없다. 요청과 오류를 연결하는 방법, 재동기화 방식, 오류가 여러 조건에 해당할 때의 우선순위는 후속 검토 대상이다.

## 9. 서버 검증과 전송 경계

TypeScript 타입은 데이터의 형태를 설명한다. 외부 JSON 입력은 서버에서 별도로 검증해야 한다. 인증 사용자와 경기 참가자의 연결, 현재 차례, 좌표의 정수·범위·빈칸 여부, 버전 충돌 및 중복 요청 처리는 서버·게임 엔진에서 검증할 책임이다.

이 문서는 공통 데이터 객체를 정의하는 초안이다. REST endpoint·HTTP 상태 코드, WebSocket 이벤트 이름·메시지 포장 형식·요청 응답 연결 방식은 해당 구현과 함께 추가한다. `GameError.code`만으로 HTTP 상태 코드나 WebSocket 이벤트를 확정하지 않는다.

## 10. 요청자 및 팀 검토 항목

- [x] 요청자가 필드 설명과 초기 상태 → 착수 → 갱신 예제 흐름을 검토했다(2026-10-08).
- [x] 요청자가 0부터 시작하는 `row/col` 기준과 같은 기준의 SRS 반영을 확인했다(2026-10-08).
- [ ] 오목·오델로별 명령과 상태를 분리하고 `gameType`으로 구분하는 구조를 어떻게 적용할 것인가?
- [ ] `rulesVersion`의 실제 값과 관리 방식을 어떻게 정할 것인가?
- [ ] 명령 중복 판정 범위·보관 기간·응답 재사용 및 버전 처리 순서를 어떻게 정할 것인가?
- [ ] 대기 중 참가자 미배정, 일시정지·종료 시 차례, 종료 결과의 필드 조합을 어떻게 제한할 것인가?
- [ ] 종료 결과 명칭과 게임별 사유를 `GAME_RULES.md` 및 SRS와 어떻게 통일할 것인가?
- [ ] 오류의 요청 연결, 재동기화 방식, REST·WebSocket 전달 형식을 어떻게 정할 것인가?

요청자는 필드 설명과 예제 흐름을 검토하고 좌표 기준을 확인했다. 나머지 미결정 항목은 승인된 것으로 보지 않으며, B/C/D의 서버·게임·UI 연결 관점 검토 대상으로 유지한다.
