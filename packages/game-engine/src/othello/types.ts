import type {
  Cell,
  GameError,
  PlaceAction,
  PlayerColor,
} from "@cafe/game-contracts";

/**
 * 오델로 게임의 정상 종료 결과 타입.
 *
 * 승패가 갈린 경우(`win`) 또는 돌 수가 같아 비긴 경우(`draw`)를 표현합니다.
 *
 * @remarks
 * - 승자는 순수 돌 색상(`PlayerColor`: `"black"` | `"white"`)으로만 표현합니다.
 * - 특정 사용자 ID(`userId`)로의 매핑이나 기권(`resign`), 시간 초과(`disconnect_timeout`),
 *   서버 재시작 무효(`server_restart`) 등의 외부 종료 사유는 서버의 경기 관리 계층(`GameCommandService`)에서 처리합니다.
 * - 정상 종료 시 오델로 규칙상 사유는 항상 `"disc_count"`(돌 수 판정) 또는 `"draw"`(무승부)입니다.
 */
export type OthelloFinish =
  | { outcome: "win"; winner: PlayerColor; reason: "disc_count" }
  | { outcome: "draw"; reason: "draw" };

/**
 * 오델로 게임 엔진의 내부 상태 타입.
 *
 * 판 위의 8×8 말 배치(`board`), 현재 착수 차례인 색상(`currentPlayerColor`),
 * 그리고 게임 정상 종료 정보(`result`)를 가집니다.
 *
 * @remarks
 * - **상태 불변식 (State Invariant)**:
 *   - 진행 중인 상태(`result === null`): `currentPlayerColor`는 반드시 `"black"` 또는 `"white"`입니다.
 *   - 종료된 상태(`result !== null`): `currentPlayerColor`는 반드시 `null`이며, `result`에 {@link OthelloFinish} 객체가 담깁니다.
 *   - 이 불변식은 TypeScript의 Discriminated Union(식별 가능한 유니온)으로 컴파일 타임에 강제됩니다.
 */
export type OthelloState = { board: Cell[][] } & (
  | { currentPlayerColor: PlayerColor; result: null }
  | { currentPlayerColor: null; result: OthelloFinish }
);

/**
 * 엔진 내부 착수 적용 함수(`applyMove`)의 실행 결과 타입.
 *
 * 성공 시 갱신된 새로운 게임 상태(`state`)를 반환하고, 실패 시 표준 게임 오류(`error`)를 반환합니다.
 *
 * @remarks
 * - 엔진이 반환하는 오류 코드는 `IF-01` 계약에 따라 오직 `INVALID_ACTION`과 `GAME_FINISHED`로 한정됩니다.
 * - `INVALID_ACTION`: 좌표 범위 초과, 비정수 좌표, 빈칸이 아님, 차례 위반, 상대 돌을 뒤집을 수 없는 착수 등.
 * - `GAME_FINISHED`: 이미 승패 또는 무승부로 종료된 상태에서 착수를 시도한 경우.
 */
export type OthelloMoveResult =
  | { ok: true; state: OthelloState }
  | {
      ok: false;
      error: GameError & { code: "INVALID_ACTION" | "GAME_FINISHED" };
    };

/**
 * 서버 `GameRules` 규격과 호환되는 오델로 규칙 판정 입력 인터페이스.
 *
 * 서버의 `GameCommandService.apply()`가 DB 트랜잭션 내에서 엔진으로 착수 검증을 위임할 때 전달합니다.
 *
 * @remarks
 * - `moves`: 대국 시작부터 현재까지 DB에 영속화된 착수 이력 배열입니다. 오델로는 자동 패스로 인해
 *   동일 색상이 연속으로 착수할 수 있으므로, 각 착수의 `stone` 색상이 함께 보존되어야 합니다.
 * - `seat`: 착수를 요청한 플레이어의 배정 색상(`"black"` | `"white"`)입니다.
 * - `action`: 클라이언트가 전송한 착수 액션(`{ type: "place", row, col }`)입니다.
 */
export interface OthelloRulesInput {
  moves: readonly { row: number; col: number; stone: string }[];
  seat: PlayerColor;
  action: PlaceAction;
}

/**
 * 서버 `GameRules` 반환 규격과 호환되는 오델로 규칙 판정 결과 타입.
 *
 * 착수 거절 시 거절 코드(`code`)를 반환하고, 착수 성공 시 다음 차례(`nextTurn`) 및 종료 여부(`finish`)를 반환합니다.
 *
 * @remarks
 * - 착수가 성공하면 서버는 이 반환값을 기반으로 새 착수를 DB에 커밋하고,
 *   대국 참가자들에게 `game.updated` 또는 `game.finished` WebSocket 이벤트를 브로드캐스트합니다.
 * - 상대방이 둘 곳이 없어 자동 패스된 경우 `nextTurn`은 현재 착수자의 색상 그대로 유지됩니다.
 * - 게임이 종료된 경우 `nextTurn`은 `null`이 되며 `finish` 속성에 승자 및 사유가 포함됩니다.
 */
export type OthelloRuleDecision =
  | { ok: false; code: "INVALID_ACTION" | "GAME_FINISHED" }
  | { ok: true; nextTurn: PlayerColor | null; finish?: OthelloFinish };
