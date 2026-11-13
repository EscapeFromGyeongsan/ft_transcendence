import type { PlaceAction, PlayerColor } from "@cafe/game-contracts";
import { GOMOKU_BOARD_SIZE } from "./initial-state.ts";
import type { GomokuFinish, GomokuMoveResult, GomokuState } from "./types.ts";

/**
 * 특정 좌표에 착수한 직후, 해당 위치를 포함하여 5목 이상이 완성되었는지 4대 축으로 검사합니다.
 *
 * 가로, 세로, 우하향 대각선, 우상향 대각선의 4개 축에 대해 양방향 연속 돌 개수를 합산합니다.
 *
 * @param board - 착수가 반영된 15×15 오목 보드
 * @param row - 방금 착수한 행 좌표 (0..14)
 * @param col - 방금 착수한 열 좌표 (0..14)
 * @param color - 방금 착수한 플레이어의 돌 색상 (`"black"` | `"white"`)
 * @returns 5개 이상 연속된 돌이 한 축이라도 존재하면 `true`, 없으면 `false`
 *
 * @remarks
 * ## 알고리즘 원리 (방향 벡터 기반 양방향 국소 탐색)
 * 1. 전체 보드(225칸)를 매번 순회하지 않고, **방금 착수한 좌표 `(row, col)`를 중심으로 4개 축만 국소 탐색(Local Search)**합니다.
 * 2. 4개 축의 단위 벡터:
 *    - `[0, 1]`: 가로 (좌 ↔ 우)
 *    - `[1, 0]`: 세로 (상 ↔ 하)
 *    - `[1, 1]`: 대각선 (좌상 ↔ 우하)
 *    - `[1, -1]`: 역대각선 (우상 ↔ 좌하)
 * 3. 각 축에 대해 `sign = -1`과 `sign = 1`의 양방향으로 전진하며, 보드 경계 내에서 동일한 색상의 돌이 연속하는 개수를 카운트합니다.
 * 4. 착수한 돌 1개 + 양방향 연속 돌 수의 총합이 5개 이상(`count >= 5`)이면 즉시 승리로 판정합니다.
 *
 * ## 자유룰 (Freestyle Gomoku) 적용
 * - 렌주룰과 같은 복잡한 금수(삼삼, 사사, 장목 금지)가 적용되지 않는 **자유룰**입니다.
 * - 따라서 정확히 5목뿐만 아니라 6목 이상의 장목(Overline)도 합법적인 승리로 판정합니다.
 *
 * ## 시간 복잡도
 * - 4개 축에 대해 양방향 최대 이동 거리는 14칸입니다.
 * - 최대 순회 횟수는 $4 \times 2 \times 14 = 112$회로 보드 전체 상태와 무관하게 엄격한 $O(1)$ 상수 시간에 완료됩니다.
 */
function hasFive(
  board: GomokuState["board"],
  row: number,
  col: number,
  color: PlayerColor,
): boolean {
  return [
    [0, 1], // 가로 축
    [1, 0], // 세로 축
    [1, 1], // 대각선 축 (좌상 -> 우하)
    [1, -1], // 역대각선 축 (우상 -> 좌하)
  ].some(([dr, dc]) => {
    let count = 1; // 방금 놓은 돌 1개부터 시작
    for (const sign of [-1, 1]) {
      let r = row + sign * dr;
      let c = col + sign * dc;
      while (
        r >= 0 &&
        r < GOMOKU_BOARD_SIZE &&
        c >= 0 &&
        c < GOMOKU_BOARD_SIZE &&
        board[r][c] === color
      ) {
        count++;
        r += sign * dr;
        c += sign * dc;
      }
    }
    return count >= 5;
  });
}

/**
 * 오목 게임 상태에 플레이어의 착수를 검증하고 새로운 상태로 전이합니다.
 *
 * 착수 좌표의 유효성과 차례를 검증한 뒤, 5목 달성(승리), 판 가득 참(무승부),
 * 또는 흑/백 차례 교대 상태로 전이합니다.
 *
 * @param state - 현재 오목 게임 상태
 * @param action - 클라이언트의 착수 액션 (`{ type: "place", row, col }`)
 * @param playerColor - 착수를 시도하는 플레이어의 돌 색상 (`"black"` | `"white"`)
 * @returns 착수 성공 시 `{ ok: true, state }`, 실패 시 `{ ok: false, error }`
 *
 * @remarks
 * ## 착수 검증 순서 (Fail-Fast Validation)
 * 1. **게임 종료 여부**: `state.result !== null`이면 `GAME_FINISHED` 오류 반환.
 * 2. **액션 및 좌표 유효성**: `action.type !== "place"`이거나, 좌표가 정수가 아니거나,
 *    보드 범위(`0..14`)를 벗어난 경우 `INVALID_ACTION` 반환.
 * 3. **차례 일치 여부**: `playerColor !== state.currentPlayerColor`이면 `INVALID_ACTION` 반환.
 * 4. **빈칸 확인**: 이미 돌이 놓인 칸(`board[row][col] !== null`)이면 `INVALID_ACTION` 반환.
 *
 * ## 승패 및 무승부 판정 우선순위 (WHY: 225번째 수 엣지 케이스)
 * - 보드의 마지막 225번째 빈칸에 착수하여 5목이 완성된 경우, 보드가 가득 찼더라도
 *   무승부가 아닌 **승리(`outcome: "win"`)**가 우선합니다.
 * - 따라서 3항 연산자 순서에서 `hasFive(...)` 승리 검사를 `board.every(...)` 빈칸 검사보다
 *   항상 먼저 수행합니다.
 *
 * ## 불변성(Immutability) 보장
 * - 전달받은 원본 상태 `state`의 보드를 직접 변경하지 않고, 각 행을 얕은 복사(`[...boardRow]`)하여
 *   독립된 새로운 보드 2차원 배열을 생성합니다.
 */
export function applyMove(
  state: GomokuState,
  action: PlaceAction,
  playerColor: PlayerColor,
): GomokuMoveResult {
  // 1. 이미 종료된 게임인지 검사
  if (state.result !== null) {
    return {
      ok: false,
      error: { code: "GAME_FINISHED", message: "이미 종료된 경기입니다." },
    };
  }

  const { row, col } = action;

  // 2. 착수 액션 및 좌표 유효성 검사
  if (
    action.type !== "place" ||
    !Number.isInteger(row) ||
    !Number.isInteger(col) ||
    row < 0 ||
    row >= GOMOKU_BOARD_SIZE ||
    col < 0 ||
    col >= GOMOKU_BOARD_SIZE
  ) {
    return {
      ok: false,
      error: {
        code: "INVALID_ACTION",
        message: "착수 좌표는 0부터 14까지의 정수여야 합니다.",
      },
    };
  }

  // 3. 현재 차례인 플레이어인지 검사
  if (playerColor !== state.currentPlayerColor) {
    return {
      ok: false,
      error: {
        code: "INVALID_ACTION",
        message: "현재 차례인 플레이어만 착수할 수 있습니다.",
      },
    };
  }

  // 4. 빈 칸 여부 검사
  if (state.board[row][col] !== null) {
    return {
      ok: false,
      error: {
        code: "INVALID_ACTION",
        message: "이미 돌이 있는 칸에는 착수할 수 없습니다.",
      },
    };
  }

  // 5. 보드 복제 및 착수 적용 (불변성 보장)
  const board = state.board.map((boardRow) => [...boardRow]);
  board[row][col] = playerColor;

  // 6. 승리 판정 우선 검사 (마지막 225번째 빈칸 착수 승리 우선순위 보장)
  const result: GomokuFinish | null = hasFive(board, row, col, playerColor)
    ? { outcome: "win", winner: playerColor, reason: "five_in_row" }
    : board.every((line) => line.every((cell) => cell !== null))
      ? { outcome: "draw", reason: "draw" }
      : null;

  // 7. 상태 전이 반환 (종료 시 currentPlayerColor는 null)
  return {
    ok: true,
    state: result
      ? { board, currentPlayerColor: null, result }
      : {
          board,
          currentPlayerColor: playerColor === "black" ? "white" : "black",
          result: null,
        },
  };
}
