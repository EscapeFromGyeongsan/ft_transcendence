/** Pure, serializable rules. No React, storage, clocks, or network dependencies. */
export const BOARD_SIZE = 15;
export const RULES_VERSION = "freestyle-1" as const;
export type Stone = "black" | "white";
export type Point = Readonly<{ x: number; y: number }>;
export type Move = Point & Readonly<{ stone: Stone }>;
export type GameResult =
  | Readonly<{
      kind: "win";
      winner: Stone;
      reason: "five" | "resignation";
      line: readonly Point[];
    }>
  | Readonly<{ kind: "draw" }>;
export interface OmokState {
  readonly gameType: "omok";
  readonly rulesVersion: typeof RULES_VERSION;
  readonly stateVersion: number;
  readonly board: readonly (readonly (Stone | null)[])[];
  readonly currentTurn: Stone;
  readonly moves: readonly Move[];
  readonly result: GameResult | null;
}
export type OmokAction =
  | Readonly<{ type: "PLACE_STONE"; x: number; y: number }>
  | Readonly<{ type: "RESIGN" }>;
export type ErrorCode =
  | "INCOMPATIBLE_RULES"
  | "GAME_FINISHED"
  | "WRONG_TURN"
  | "INVALID_COORDINATE"
  | "OCCUPIED"
  | "INVALID_ACTION";
export type ActionResult =
  { ok: true; nextState: OmokState } | { ok: false; reason: ErrorCode };
export const otherStone = (stone: Stone): Stone =>
  stone === "black" ? "white" : "black";
export function createInitialState(): OmokState {
  return {
    gameType: "omok",
    rulesVersion: RULES_VERSION,
    stateVersion: 0,
    board: Array.from({ length: BOARD_SIZE }, () =>
      Array<Stone | null>(BOARD_SIZE).fill(null),
    ),
    currentTurn: "black",
    moves: [],
    result: null,
  };
}
const inside = (x: number, y: number) =>
  x >= 0 && y >= 0 && x < BOARD_SIZE && y < BOARD_SIZE;
function winningLine(
  board: OmokState["board"],
  x: number,
  y: number,
  stone: Stone,
): Point[] {
  for (const [dx, dy] of [
    [1, 0],
    [0, 1],
    [1, 1],
    [1, -1],
  ]) {
    const line: Point[] = [{ x, y }];
    for (const sign of [-1, 1]) {
      let nx = x + dx * sign,
        ny = y + dy * sign;
      while (inside(nx, ny) && board[ny][nx] === stone) {
        if (sign === -1) line.unshift({ x: nx, y: ny });
        else line.push({ x: nx, y: ny });
        nx += dx * sign;
        ny += dy * sign;
      }
    }
    if (line.length >= 5) return line;
  }
  return [];
}
/** The future server must authenticate the actor and serialize commands before calling this. */
export function applyAction(
  state: OmokState,
  actor: Stone,
  action: OmokAction,
): ActionResult {
  if (state.gameType !== "omok" || state.rulesVersion !== RULES_VERSION)
    return { ok: false, reason: "INCOMPATIBLE_RULES" };
  if (state.result) return { ok: false, reason: "GAME_FINISHED" };
  if (actor !== state.currentTurn) return { ok: false, reason: "WRONG_TURN" };
  if (!action || (action.type !== "PLACE_STONE" && action.type !== "RESIGN"))
    return { ok: false, reason: "INVALID_ACTION" };
  if (action.type === "RESIGN") {
    return {
      ok: true,
      nextState: {
        ...state,
        stateVersion: state.stateVersion + 1,
        result: {
          kind: "win",
          winner: otherStone(actor),
          reason: "resignation",
          line: [],
        },
      },
    };
  }
  const { x, y } = action;
  if (!Number.isInteger(x) || !Number.isInteger(y) || !inside(x, y))
    return { ok: false, reason: "INVALID_COORDINATE" };
  if (state.board[y][x] !== null) return { ok: false, reason: "OCCUPIED" };
  const board = state.board.map((row) => [...row]);
  board[y][x] = actor;
  const moves = [...state.moves, { x, y, stone: actor }];
  const line = winningLine(board, x, y, actor);
  const result: GameResult | null =
    line.length >= 5
      ? { kind: "win", winner: actor, reason: "five", line }
      : board.every((row) => row.every((cell) => cell !== null))
        ? { kind: "draw" }
        : null;
  return {
    ok: true,
    nextState: {
      ...state,
      board,
      moves,
      stateVersion: state.stateVersion + 1,
      currentTurn: result ? actor : otherStone(actor),
      result,
    },
  };
}
