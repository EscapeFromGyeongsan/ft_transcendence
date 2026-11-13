import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { OthelloSnapshot } from "@cafe/game-contracts";
import { OthelloMatchView } from "./OthelloMatchView.tsx";
import {
  OTHELLO_RULES_VERSION,
  applyOthelloConnectionPhase,
  applyOthelloSessionReplaced,
  applyOthelloIncomingSnapshot,
  buildOthelloPlaceCommand,
  buildOthelloResignCommand,
  computeOthelloLegalMoves,
  countOthelloDiscs,
  createInitialOthelloBoard,
  createInitialOthelloClientState,
  deriveOthelloTurnPresentation,
  describeOthelloResult,
  findOthelloFlippableDiscs,
} from "./othello-state.ts";

function makeOthelloSnapshot(
  overrides: Partial<OthelloSnapshot> = {},
): OthelloSnapshot {
  return {
    gameType: "othello",
    rulesVersion: OTHELLO_RULES_VERSION,
    matchId: 201,
    status: "playing",
    stateVersion: 1,
    players: {
      black: 11,
      white: 22,
    },
    currentPlayerId: 11,
    board: createInitialOthelloBoard(),
    result: null,
    ...overrides,
  };
}

describe("othello-state & OthelloMatchView (FR-G2-01 ~ FR-G2-05)", () => {
  it("제어권 상실 뒤 재인증만으로는 잠금을 풀지 않고 재구독 스냅샷에서 착수·기권을 복구한다 (#136)", () => {
    const snapshot = makeOthelloSnapshot();
    const initial = applyOthelloIncomingSnapshot(
      applyOthelloConnectionPhase(
        createInitialOthelloClientState(11, 201),
        "connected",
      ),
      snapshot,
      "match.snapshot",
    );
    const replaced = applyOthelloSessionReplaced(initial, 201);
    const watched = applyOthelloIncomingSnapshot(
      replaced,
      snapshot,
      "match.snapshot",
    );
    expect(watched.sessionReplaced).toBe(true);
    expect(deriveOthelloTurnPresentation(watched).canResign).toBe(false);
    const connected = applyOthelloConnectionPhase(watched, "connected");
    expect(deriveOthelloTurnPresentation(connected).canPlaceDisc).toBe(false);
    const restored = applyOthelloIncomingSnapshot(
      connected,
      snapshot,
      "match.snapshot",
    );
    expect(restored.sessionReplaced).toBe(false);
    expect(restored.gameError).toBeNull();
    expect(deriveOthelloTurnPresentation(restored)).toMatchObject({
      canPlaceDisc: true,
      canResign: true,
    });
  });
  it("8×8 초기 보드 중앙 4칸에 백·흑 대각선 교차 배치 및 돌 개수를 정확히 집계한다 (FR-G2-01, FR-G2-05)", () => {
    const board = createInitialOthelloBoard();
    expect(board).toHaveLength(8);
    expect(board[0]).toHaveLength(8);
    expect(board[3][3]).toBe("white");
    expect(board[3][4]).toBe("black");
    expect(board[4][3]).toBe("black");
    expect(board[4][4]).toBe("white");

    const counts = countOthelloDiscs(board);
    expect(counts).toEqual({
      black: 2,
      white: 2,
      empty: 60,
      total: 4,
    });
  });

  it("8방향 탐색으로 합법 착수 위치와 뒤집힐 돌 좌표를 계산한다 (FR-G2-02)", () => {
    const board = createInitialOthelloBoard();
    const blackMoves = computeOthelloLegalMoves(board, "black");
    const coords = blackMoves.map((m) => `${m.row},${m.col}`);
    expect(coords).toEqual(["2,3", "3,2", "4,5", "5,4"]);
    expect(blackMoves.every((m) => m.flipCount === 1)).toBe(true);

    const flippedAt23 = findOthelloFlippableDiscs(board, 2, 3, "black");
    expect(flippedAt23).toEqual([{ row: 3, col: 3 }]);
    expect(findOthelloFlippableDiscs(board, 0, 0, "black")).toEqual([]);
  });

  it("game.updated 수신 시 새로 놓인 돌·뒤집힌 돌 및 자동 패스 발생 여부를 감지한다 (FR-G2-02, FR-G2-03)", () => {
    const initial = createInitialOthelloClientState(11, 201);
    const snap1 = makeOthelloSnapshot();
    const afterSnap1 = applyOthelloIncomingSnapshot(
      initial,
      snap1,
      "match.snapshot",
    );

    const nextBoard = createInitialOthelloBoard();
    // 흑(11)이 (2, 3)에 착수해 (3, 3) 백돌이 흑돌로 뒤집힌 상태
    nextBoard[2][3] = "black";
    nextBoard[3][3] = "black";

    // 백(22)에게 합법 수가 없어 다시 흑(11) 차례로 자동 패스된 경우 시뮬레이션
    const snap2 = makeOthelloSnapshot({
      stateVersion: 2,
      board: nextBoard,
      currentPlayerId: 11,
    });

    const afterSnap2 = applyOthelloIncomingSnapshot(
      afterSnap1,
      snap2,
      "game.updated",
    );

    expect(afterSnap2.lastMove).toEqual({
      row: 2,
      col: 3,
      color: "black",
      byPlayerId: 11,
      isOpponentMove: false,
      flippedCoords: [{ row: 3, col: 3 }],
      autoPassedColor: "white",
      stateVersion: 2,
    });

    const turn = deriveOthelloTurnPresentation(afterSnap2);
    expect(turn.isMyTurn).toBe(true);
    expect(turn.autoPassNotice).toContain("백돌");
  });

  it("대국 종료 사유(disc_count, draw, resign)를 사용자 친화적인 문구로 변환한다 (FR-G2-04, FR-G2-05)", () => {
    const endBoard = createInitialOthelloBoard();
    endBoard[0][0] = "black";
    endBoard[0][1] = "black";

    const winSnap = makeOthelloSnapshot({
      status: "finished",
      stateVersion: 10,
      board: endBoard,
      currentPlayerId: null,
      result: {
        outcome: "win",
        winnerId: 11,
        reason: "disc_count",
      },
    });
    const winDesc = describeOthelloResult(winSnap, 11);
    expect(winDesc?.perspective).toBe("victory");
    expect(winDesc?.headline).toBe("Win!");
    expect(winDesc?.subheadline).toContain("돌 개수 우세");

    const drawSnap = makeOthelloSnapshot({
      status: "finished",
      stateVersion: 11,
      currentPlayerId: null,
      result: {
        outcome: "draw",
        winnerId: null,
        reason: "draw",
      },
    });
    const drawDesc = describeOthelloResult(drawSnap, 11);
    expect(drawDesc?.perspective).toBe("draw");
    expect(drawDesc?.headline).toBe("Draw");

    const resignSnap = makeOthelloSnapshot({
      status: "finished",
      stateVersion: 12,
      currentPlayerId: null,
      result: {
        outcome: "win",
        winnerId: 22,
        reason: "resign",
      },
    });
    const resignDesc = describeOthelloResult(resignSnap, 11);
    expect(resignDesc?.perspective).toBe("defeat");
    expect(resignDesc?.subheadline).toContain("기권");
  });

  it("buildOthelloPlaceCommand 및 buildOthelloResignCommand가 표준 계약을 생성한다", () => {
    const placeCmd = buildOthelloPlaceCommand(201, 4, 2, 3, "cmd-othello-1");
    expect(placeCmd).toEqual({
      gameType: "othello",
      matchId: 201,
      expectedVersion: 4,
      commandId: "cmd-othello-1",
      action: {
        type: "place",
        row: 2,
        col: 3,
      },
    });

    const resignCmd = buildOthelloResignCommand(201, 4, "cmd-othello-2");
    expect(resignCmd.action).toEqual({ type: "resign" });
  });

  it("OthelloMatchView가 8×8 격자(64칸), 돌 개수 스코어보드, 합법 착수 표시를 렌더링한다", () => {
    const state = applyOthelloIncomingSnapshot(
      {
        ...createInitialOthelloClientState(11, 201),
        connectionPhase: "connected",
      },
      makeOthelloSnapshot(),
      "match.snapshot",
    );

    const html = renderToStaticMarkup(
      createElement(OthelloMatchView, {
        state,
        viewerNickname: "Sunbear",
        playerNicknames: { 11: "Sunbear", 22: "Opponent" },
        onPlaceDisc: () => {},
        onResign: () => {},
        onReconnect: () => {},
        onBackToLobby: () => {},
      }),
    );

    expect(html).toContain('data-testid="othello-match-view"');
    expect(html).toContain('data-testid="othello-scoreboard"');
    expect(html).toContain('data-testid="othello-disc-count-black">2<');
    expect(html).toContain('data-testid="othello-disc-count-white">2<');
    expect(html).toContain('data-legal-move="true"');
    expect(html).toContain('data-row="7" data-col="7"');
  });
});
