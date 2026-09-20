import { describe, expect, it } from "vitest";
import {
  applyAction,
  createInitialState,
  RULES_VERSION,
  type OmokState,
  type Stone,
} from "./index";

function place(state: OmokState, x: number, y: number) {
  const result = applyAction(state, state.currentTurn, {
    type: "PLACE_STONE",
    x,
    y,
  });
  if (!result.ok) throw new Error(result.reason);
  return result.nextState;
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.freeze(value);
    Object.values(value).forEach(freeze);
  }
  return value;
}
describe("local freestyle rules", () => {
  it("starts with independent empty rows, black first, versioned serializable state", () => {
    const state = createInitialState();
    expect(state.board).toHaveLength(15);
    expect(state.board.flat().every((cell) => cell === null)).toBe(true);
    expect(new Set(state.board).size).toBe(15);
    expect(state.currentTurn).toBe("black");
    expect(state.stateVersion).toBe(0);
    expect(state.rulesVersion).toBe(RULES_VERSION);
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });
  it("alternates turns, records moves and never mutates a frozen input", () => {
    const initial = freeze(createInitialState());
    const next = place(initial, 7, 7);
    expect(initial.board[7][7]).toBeNull();
    expect(next.board[7][7]).toBe("black");
    expect(next.currentTurn).toBe("white");
    expect(next.moves).toEqual([{ x: 7, y: 7, stone: "black" }]);
    expect(next.stateVersion).toBe(1);
    expect(place(freeze(next), 8, 7).currentTurn).toBe("black");
  });
  it.each([
    [-1, 0],
    [15, 0],
    [0, -1],
    [0, 15],
    [1.5, 0],
    [NaN, 0],
    [Infinity, 0],
  ])("rejects coordinate %s,%s without changing state", (x, y) => {
    const state = freeze(createInitialState());
    const before = JSON.stringify(state);
    expect(applyAction(state, "black", { type: "PLACE_STONE", x, y })).toEqual({
      ok: false,
      reason: "INVALID_COORDINATE",
    });
    expect(JSON.stringify(state)).toBe(before);
  });
  it("rejects wrong actors and occupied intersections without losing a turn", () => {
    const state = freeze(place(createInitialState(), 7, 7));
    const before = JSON.stringify(state);
    expect(
      applyAction(state, "black", { type: "PLACE_STONE", x: 0, y: 0 }),
    ).toEqual({ ok: false, reason: "WRONG_TURN" });
    expect(
      applyAction(state, "white", { type: "PLACE_STONE", x: 7, y: 7 }),
    ).toEqual({ ok: false, reason: "OCCUPIED" });
    expect(JSON.stringify(state)).toBe(before);
  });
  it.each([
    [0, 0, 1, 0],
    [14, 0, 0, 1],
    [0, 0, 1, 1],
    [0, 14, 1, -1],
  ])("wins in direction %s,%s,%s,%s including edges", (x, y, dx, dy) => {
    let state = createInitialState();
    for (let i = 0; i < 5; i++) {
      state = place(state, x + dx * i, y + dy * i);
      if (i < 4) state = place(state, 8 + i, 6);
    }
    expect(state.result).toMatchObject({
      kind: "win",
      winner: "black",
      reason: "five",
    });
    if (state.result?.kind === "win") expect(state.result.line).toHaveLength(5);
    expect(
      applyAction(freeze(state), "black", {
        type: "PLACE_STONE",
        x: 13,
        y: 13,
      }),
    ).toEqual({ ok: false, reason: "GAME_FINISHED" });
  });
  it("counts both sides of a gap and accepts six in a row", () => {
    let state = createInitialState();
    for (const [i, x] of [0, 1, 2, 4, 5].entries()) {
      state = place(state, x, 0);
      state = place(state, i * 2, 14);
    }
    state = place(state, 3, 0);
    expect(state.result).toMatchObject({ kind: "win", winner: "black" });
    if (state.result?.kind === "win") expect(state.result.line).toHaveLength(6);
  });
  it("does not count interrupted lines as a win", () => {
    let state = createInitialState();
    for (const [i, x] of [0, 1, 3, 4, 6].entries()) {
      state = place(state, x, 0);
      state = place(state, i * 2, 14);
    }
    expect(state.result).toBeNull();
  });
  it("completes 225 legal alternating moves as a draw, never ending early", () => {
    const cells: Record<Stone, { x: number; y: number }[]> = {
      black: [],
      white: [],
    };
    for (let y = 0; y < 15; y++)
      for (let x = 0; x < 15; x++)
        cells[(x + 2 * y) % 4 < 2 ? "black" : "white"].push({ x, y });
    let state = createInitialState();
    const cursors = { black: 0, white: 0 };
    for (let i = 0; i < 225; i++) {
      expect(state.result).toBeNull();
      const point = cells[state.currentTurn][cursors[state.currentTurn]++];
      state = place(state, point.x, point.y);
    }
    expect(state.result).toEqual({ kind: "draw" });
    expect(state.moves).toHaveLength(225);
  });
  it("prioritizes a five on the last empty intersection over a full-board draw", () => {
    // Boundary snapshot: fill an otherwise full board and complete a split line.
    const board: (Stone | null)[][] = Array.from({ length: 15 }, (_, y) =>
      Array.from({ length: 15 }, (_, x) =>
        (x + 2 * y) % 4 < 2 ? "black" : "white",
      ),
    );
    for (let x = 5; x <= 9; x++) board[7][x] = "black";
    board[7][7] = null;
    const state = place(freeze({ ...createInitialState(), board }), 7, 7);
    expect(state.board.flat().every(Boolean)).toBe(true);
    expect(state.result).toMatchObject({ kind: "win", winner: "black" });
  });
  it("supports white wins and resignation, rejects further actions, and resets fully", () => {
    let state = createInitialState();
    for (let i = 0; i < 5; i++) {
      state = place(state, i * 2, 0);
      state = place(state, i, 14);
    }
    expect(state.result).toMatchObject({ kind: "win", winner: "white" });
    const resigned = applyAction(freeze(createInitialState()), "black", {
      type: "RESIGN",
    });
    expect(resigned.ok).toBe(true);
    if (resigned.ok) {
      expect(resigned.nextState.result).toMatchObject({
        winner: "white",
        reason: "resignation",
      });
      expect(resigned.nextState.stateVersion).toBe(1);
      expect(
        applyAction(resigned.nextState, "black", { type: "RESIGN" }),
      ).toEqual({ ok: false, reason: "GAME_FINISHED" });
    }
    expect(createInitialState()).toMatchObject({
      currentTurn: "black",
      moves: [],
      result: null,
      stateVersion: 0,
    });
  });
  it("refuses an incompatible persisted rules version", () => {
    const state = {
      ...createInitialState(),
      rulesVersion: "future-rules",
    } as unknown as OmokState;
    expect(
      applyAction(state, "black", { type: "PLACE_STONE", x: 0, y: 0 }),
    ).toEqual({ ok: false, reason: "INCOMPATIBLE_RULES" });
  });
});
