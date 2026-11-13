import type { Cell, PlayerColor } from "@cafe/game-contracts";
import { OTHELLO_BOARD_SIZE } from "./initial-state.ts";
import type {
  OthelloFinish,
  OthelloMoveResult,
  OthelloState,
} from "./types.ts";

/**
 * 오델로 뒤집기 탐색에 사용하는 8방향 단위 벡터.
 *
 * 상, 하, 좌, 우 및 4개 대각선 방향을 [dr, dc] 튜플로 정의합니다.
 */
const DIRECTIONS = [
  [-1, -1], // 좌상
  [-1, 0], // 상
  [-1, 1], // 우상
  [0, -1], // 좌
  [0, 1], // 우
  [1, -1], // 좌하
  [1, 0], // 하
  [1, 1], // 우하
] as const;

/**
 * 특정 칸에 돌을 놓았을 때 8방향에서 뒤집을 수 있는 상대 돌의 좌표 목록을 계산합니다.
 *
 * @param board - 현재 8×8 오델로 보드 상태
 * @param row - 착수하려는 행 좌표 (0..7)
 * @param col - 착수하려는 열 좌표 (0..7)
 * @param color - 착수하는 플레이어의 돌 색상 (`"black"` | `"white"`)
 * @returns 뒤집힐 상대 돌들의 보드 좌표 `{ r, c }` 배열 (뒤집을 돌이 없으면 빈 배열)
 *
 * @remarks
 * ## 알고리즘 원리 (Ray-casting / 레이캐스팅 탐색)
 * 1. 착수 지점 `(row, col)`을 기준으로 8방향 단위 벡터 `(dr, dc)`로 한 칸씩 전진합니다.
 * 2. 전진 경로에 상대방 돌(`opponentColor`)이 연속으로 나타나는 동안 임시 배열(`directionDiscs`)에 좌표를 수집합니다.
 * 3. 상대 돌의 연속이 끝난 바로 다음 칸이:
 *    - **자신의 돌(`color`)**로 닫혀 있다면: 그 사이에 끼워진 상대 돌들은 합법적으로 뒤집히므로 최종 목록(`discsToFlip`)에 추가합니다.
 *    - **빈 칸(`null`)**이거나 **보드 경계 밖**으로 벗어난 경우: 닫히지 않았으므로 뒤집을 수 없으며 해당 방향은 무효 처리됩니다.
 *
 * ## 시간 복잡도
 * - 8개 방향에 대해 8×8 보드 크기상 최대 전진 거리는 6칸입니다.
 * - 따라서 최대 순회 횟수는 $8 \times 6 = 48$회로 엄격한 $O(1)$ 상수 시간에 완료됩니다.
 */
function findFlippableDiscs(
  board: Cell[][],
  row: number,
  col: number,
  color: PlayerColor,
): { r: number; c: number }[] {
  const opponentColor: PlayerColor = color === "black" ? "white" : "black";
  const discsToFlip: { r: number; c: number }[] = [];

  for (const [dr, dc] of DIRECTIONS) {
    let r = row + dr;
    let c = col + dc;
    const directionDiscs: { r: number; c: number }[] = [];

    // 상대 돌이 연속으로 있는지 추적
    while (
      r >= 0 &&
      r < OTHELLO_BOARD_SIZE &&
      c >= 0 &&
      c < OTHELLO_BOARD_SIZE &&
      board[r][c] === opponentColor
    ) {
      directionDiscs.push({ r, c });
      r += dr;
      c += dc;
    }

    // 끝에 자신의 돌이 있어 끼우기에 성공한 경우만 뒤집기 목록에 추가
    if (
      directionDiscs.length > 0 &&
      r >= 0 &&
      r < OTHELLO_BOARD_SIZE &&
      c >= 0 &&
      c < OTHELLO_BOARD_SIZE &&
      board[r][c] === color
    ) {
      discsToFlip.push(...directionDiscs);
    }
  }

  return discsToFlip;
}

/**
 * 특정 색상의 플레이어에게 현재 합법적인 착수 위치가 하나라도 존재하는지 검사합니다.
 *
 * @param board - 현재 8×8 오델로 보드 상태
 * @param color - 검사할 플레이어의 돌 색상 (`"black"` | `"white"`)
 * @returns 둘 수 있는 합법적인 위치가 1개 이상이면 `true`, 전혀 없으면 `false`
 *
 * @remarks
 * ## 활용처
 * - 착수 후 상대방의 차례로 넘길 수 있는지(`hasLegalMoves(nextBoard, opponentColor)`),
 *   아니면 상대방이 자동 패스되어 현재 플레이어가 턴을 유지해야 하는지 판정할 때 호출됩니다.
 * - 양쪽 플레이어 모두 `false`인 경우 게임 종료를 확정합니다.
 *
 * ## 성능 최적화 (Early Exit)
 * - 보드의 모든 빈 칸을 순회하다가 **단 하나의 착수 가능한 칸**이라도 발견되면 즉시 `true`를 반환하고 조기 종료합니다.
 * - 최악의 경우에도 $64 \times 48 \approx 3,000$회 미만의 단일 연산으로 수십 마이크로초(µs) 내에 완료됩니다.
 */
export function hasLegalMoves(board: Cell[][], color: PlayerColor): boolean {
  for (let r = 0; r < OTHELLO_BOARD_SIZE; r++) {
    for (let c = 0; c < OTHELLO_BOARD_SIZE; c++) {
      if (board[r][c] === null) {
        if (findFlippableDiscs(board, r, c, color).length > 0) {
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * 보드 위의 흑돌과 백돌 개수를 전수 집계하여 게임 정상 종료 결과를 결정합니다.
 *
 * @param board - 게임이 종료된 시점의 8×8 오델로 보드 상태
 * @returns 승자 및 판정 사유(`"disc_count"`) 또는 무승부(`"draw"`) 결과 객체
 *
 * @remarks
 * - 흑돌 개수 > 백돌 개수: `{ outcome: "win", winner: "black", reason: "disc_count" }`
 * - 백돌 개수 > 흑돌 개수: `{ outcome: "win", winner: "white", reason: "disc_count" }`
 * - 흑돌 개수 == 백돌 개수: `{ outcome: "draw", reason: "draw" }`
 */
function evaluateFinish(board: Cell[][]): OthelloFinish {
  let blackCount = 0;
  let whiteCount = 0;

  for (let r = 0; r < OTHELLO_BOARD_SIZE; r++) {
    for (let c = 0; c < OTHELLO_BOARD_SIZE; c++) {
      if (board[r][c] === "black") blackCount++;
      else if (board[r][c] === "white") whiteCount++;
    }
  }

  if (blackCount > whiteCount) {
    return { outcome: "win", winner: "black", reason: "disc_count" };
  }
  if (whiteCount > blackCount) {
    return { outcome: "win", winner: "white", reason: "disc_count" };
  }
  return { outcome: "draw", reason: "draw" };
}

/**
 * 오델로 게임 상태에 플레이어의 착수를 검증하고 새로운 상태로 전이합니다.
 *
 * 8방향 뒤집기를 적용한 후, 상대방의 합법 수 유무에 따라 일반 교대, 자동 패스(턴 유지),
 * 또는 게임 종료(돌 수 비교) 상태로 전이합니다.
 *
 * @param state - 현재 오델로 게임 상태
 * @param action - 클라이언트의 착수 액션 (`{ type: "place", row, col }`)
 * @param actionColor - 착수를 시도하는 플레이어의 돌 색상 (`"black"` | `"white"`)
 * @returns 착수 성공 시 `{ ok: true, state }`, 실패 시 `{ ok: false, error }`
 *
 * @remarks
 * ## 착수 검증 순서 (Fail-Fast Validation)
 * 1. **게임 종료 여부**: `state.result !== null`이면 `GAME_FINISHED` 오류 반환.
 * 2. **차례 일치 여부**: `actionColor !== state.currentPlayerColor`이면 `INVALID_ACTION` 반환.
 * 3. **액션 타입 검증**: `action.type !== "place"`이면 `INVALID_ACTION` 반환.
 * 4. **좌표 유효성**: 좌표가 정수가 아니거나(`Number.isInteger`) 보드 범위(`0..7`) 밖이면 `INVALID_ACTION` 반환.
 * 5. **빈칸 확인**: 대상 칸에 이미 돌이 놓여 있으면(`board[row][col] !== null`) `INVALID_ACTION` 반환.
 * 6. **뒤집기 가능 여부**: 8방향 중 뒤집을 수 있는 상대 돌이 0개이면 오델로 규칙 위반으로 `INVALID_ACTION` 반환.
 *
 * ## 상태 전이 규칙 (3대 분기 정책)
 * - **분기 1 (일반 차례 교대)**: 착수 적용 후 상대방에게 합법 수가 있으면(`hasLegalMoves`), 다음 차례를 상대방으로 전이합니다.
 * - **분기 2 (자동 패스 / 차례 유지)**: 상대방에게 둘 곳이 없고 현재 플레이어는 둘 곳이 남아 있다면,
 *   별도의 패스 패킷 없이 현재 플레이어의 차례(`actionColor`)를 유지합니다.
 * - **분기 3 (게임 종료)**: 양쪽 플레이어 모두 둘 곳이 없으면(보드가 가득 찼거나, 한쪽이 전멸했거나,
 *   둘 다 둘 곳이 없음) 게임을 종료하고 돌 수로 승패/무승부를 확정합니다.
 *
 * ## 불변성(Immutability) 보장
 * - 인자로 전달된 원본 `state`와 `board`는 절대 직접 변경(Mutation)하지 않으며,
 *   항상 얕은 복사(`[...row]`)를 통해 새로운 2차원 배열을 생성하여 안전하게 반환합니다.
 */
export function applyMove(
  state: OthelloState,
  action: { type: string; row: number; col: number },
  actionColor: PlayerColor,
): OthelloMoveResult {
  // 1. 이미 종료된 게임인지 검사
  if (state.result !== null || state.currentPlayerColor === null) {
    return {
      ok: false,
      error: { code: "GAME_FINISHED", message: "Game is already finished" },
    };
  }

  // 2. 현재 차례인 플레이어인지 검사
  if (actionColor !== state.currentPlayerColor) {
    return {
      ok: false,
      error: { code: "INVALID_ACTION", message: "It is not your turn" },
    };
  }

  // 3. 착수 액션 타입 검사
  if (action.type !== "place") {
    return {
      ok: false,
      error: { code: "INVALID_ACTION", message: "Unsupported action" },
    };
  }

  // 4. 좌표 정수형 검사
  if (!Number.isInteger(action.row) || !Number.isInteger(action.col)) {
    return {
      ok: false,
      error: {
        code: "INVALID_ACTION",
        message: "Board coordinates must be integers",
      },
    };
  }

  // 5. 8×8 보드 경계 검사
  if (
    action.row < 0 ||
    action.row >= OTHELLO_BOARD_SIZE ||
    action.col < 0 ||
    action.col >= OTHELLO_BOARD_SIZE
  ) {
    return {
      ok: false,
      error: {
        code: "INVALID_ACTION",
        message: "Board coordinates out of bounds",
      },
    };
  }

  // 6. 빈 칸 여부 검사
  if (state.board[action.row][action.col] !== null) {
    return {
      ok: false,
      error: { code: "INVALID_ACTION", message: "Cell is already occupied" },
    };
  }

  // 7. 상대 돌 뒤집기 가능 여부 검사 (최소 1개 이상 뒤집어야 합법 착수)
  const flippable = findFlippableDiscs(
    state.board,
    action.row,
    action.col,
    actionColor,
  );
  if (flippable.length === 0) {
    return {
      ok: false,
      error: {
        code: "INVALID_ACTION",
        message: "Move does not capture any opponent pieces",
      },
    };
  }

  // 8. 보드 복제 및 착수/뒤집기 적용 (불변성 보장)
  const nextBoard: Cell[][] = state.board.map((row) => [...row]);
  nextBoard[action.row][action.col] = actionColor;
  for (const { r, c } of flippable) {
    nextBoard[r][c] = actionColor;
  }

  const opponentColor: PlayerColor =
    actionColor === "black" ? "white" : "black";

  // 9. 차례 전이 및 패스/종료 판정 (3대 분기)
  if (hasLegalMoves(nextBoard, opponentColor)) {
    // 분기 1: 상대방이 둘 수 있으면 일반적인 차례 교대
    return {
      ok: true,
      state: {
        board: nextBoard,
        currentPlayerColor: opponentColor,
        result: null,
      },
    };
  }

  // 상대방이 둘 곳이 없음 -> 상대방 자동 패스 판정
  if (hasLegalMoves(nextBoard, actionColor)) {
    // 분기 2: 현재 플레이어는 계속 둘 수 있으므로 차례 유지
    return {
      ok: true,
      state: {
        board: nextBoard,
        currentPlayerColor: actionColor,
        result: null,
      },
    };
  }

  // 분기 3: 양쪽 모두 둘 곳이 없음 (판이 가득 찼거나 둘 다 착수 불가) -> 게임 종료
  return {
    ok: true,
    state: {
      board: nextBoard,
      currentPlayerColor: null,
      result: evaluateFinish(nextBoard),
    },
  };
}
