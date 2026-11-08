import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { GomokuSnapshot } from "@cafe/game-contracts";
import { GomokuMatchView } from "./GomokuMatchView.tsx";
import {
  GOMOKU_BOARD_SIZE,
  GOMOKU_COORDS,
  applyConnectionPhase,
  applyGameError,
  applyIncomingSnapshot,
  applyPlayerDisconnected,
  applyPlayerReconnected,
  applySessionReplaced,
  buildPlaceCommand,
  buildResignCommand,
  createEmptyGomokuBoard,
  createInitialGomokuClientState,
  deriveTurnPresentation,
  describeGomokuResult,
  getGameErrorMessage,
  isValidGomokuCoord,
  markCommandPending,
} from "./gomoku-state.ts";
import {
  createGameWsClient,
  type MinimalWebSocket,
  type WsEnvelope,
} from "./ws-client.ts";

/**
 * 테스트용 서버 확정 GomokuSnapshot 픽스처를 생성합니다.
 */
function makeSnapshot(overrides: Partial<GomokuSnapshot> = {}): GomokuSnapshot {
  return {
    matchId: 10,
    rulesVersion: "gomoku-v1.0",
    gameType: "gomoku",
    stateVersion: 1,
    status: "playing",
    currentPlayerId: 101,
    board: createEmptyGomokuBoard(),
    players: {
      black: 101,
      white: 202,
    },
    result: null,
    ...overrides,
  };
}

describe("오목 15×15 보드 및 0-기반 좌표 규격 (IF-01, IF-05)", () => {
  it("보드 크기는 15×15이고 행·열 인덱스는 0부터 14까지이다", () => {
    expect(GOMOKU_BOARD_SIZE).toBe(15);
    expect(GOMOKU_COORDS).toHaveLength(15);
    expect(GOMOKU_COORDS[0]).toBe(0);
    expect(GOMOKU_COORDS[14]).toBe(14);

    const board = createEmptyGomokuBoard();
    expect(board).toHaveLength(15);
    for (const row of board) {
      expect(row).toHaveLength(15);
    }

    expect(isValidGomokuCoord(0, 0)).toBe(true);
    expect(isValidGomokuCoord(14, 14)).toBe(true);
    expect(isValidGomokuCoord(-1, 0)).toBe(false);
    expect(isValidGomokuCoord(0, 15)).toBe(false);
    expect(isValidGomokuCoord(3.5, 7)).toBe(false);
  });

  it("buildPlaceCommand는 (0, 0)부터 (14, 14)까지의 0-기반 정수 좌표로 PlaceAction을 생성하고 범위 밖 좌표를 거부한다", () => {
    const cmdTopLeft = buildPlaceCommand(10, 3, 0, 0, "cmd-0-0");
    expect(cmdTopLeft).toEqual({
      matchId: 10,
      gameType: "gomoku",
      commandId: "cmd-0-0",
      expectedVersion: 3,
      action: { type: "place", row: 0, col: 0 },
    });

    const cmdBottomRight = buildPlaceCommand(10, 4, 14, 14, "cmd-14-14");
    expect(cmdBottomRight.action).toEqual({ type: "place", row: 14, col: 14 });

    expect(() => buildPlaceCommand(10, 4, -1, 0)).toThrow(RangeError);
    expect(() => buildPlaceCommand(10, 4, 0, 15)).toThrow(RangeError);
  });

  it("GomokuMatchView는 row 0..14, col 0..14의 225개 교차점 버튼을 렌더링한다", () => {
    const initial = createInitialGomokuClientState(101, 10);
    const connected = applyConnectionPhase(initial, "connected", 0);
    const state = applyIncomingSnapshot(
      connected,
      makeSnapshot({ stateVersion: 1, currentPlayerId: 101 }),
      "match.snapshot",
    );

    const html = renderToStaticMarkup(
      createElement(GomokuMatchView, {
        state,
        viewerNickname: "재일",
        onPlaceStone: vi.fn(),
        onResign: vi.fn(),
        onReconnect: vi.fn(),
        onBackToLobby: vi.fn(),
      }),
    );

    expect(html).toContain('data-row="0" data-col="0"');
    expect(html).toContain('data-row="0" data-col="14"');
    expect(html).toContain('data-row="14" data-col="0"');
    expect(html).toContain('data-row="14" data-col="14"');
    expect(html).not.toContain('data-row="15"');
    expect(html).not.toContain('data-col="15"');
    expect(html).toContain('aria-label="0, 0 빈 칸"');
    expect(html).toContain('aria-label="14, 14 빈 칸"');

    const cellMatches = html.match(/data-cell-state="/g);
    expect(cellMatches).toHaveLength(225);
  });
});

describe("stateVersion 역전 및 중복 갱신 무시 규칙", () => {
  it("game.updated의 stateVersion이 현재 snapshot 이하(<=)이면 무시한다", () => {
    const baseState = applyIncomingSnapshot(
      createInitialGomokuClientState(101, 10),
      makeSnapshot({ stateVersion: 5, currentPlayerId: 202 }),
      "match.snapshot",
    );

    const staleBoard = createEmptyGomokuBoard();
    staleBoard[0][0] = "black";

    // 더 낮은 버전(stateVersion: 4) 무시
    const afterLower = applyIncomingSnapshot(
      baseState,
      makeSnapshot({
        stateVersion: 4,
        currentPlayerId: 101,
        board: staleBoard,
      }),
      "game.updated",
    );
    expect(afterLower.snapshot?.stateVersion).toBe(5);
    expect(afterLower.snapshot?.board[0][0]).toBeNull();
    expect(afterLower.ignoredUpdateCount).toBe(1);

    // 같은 버전(stateVersion: 5) game.updated도 무시
    const afterEqual = applyIncomingSnapshot(
      afterLower,
      makeSnapshot({
        stateVersion: 5,
        currentPlayerId: 101,
        board: staleBoard,
      }),
      "game.updated",
    );
    expect(afterEqual.snapshot?.stateVersion).toBe(5);
    expect(afterEqual.snapshot?.board[0][0]).toBeNull();
    expect(afterEqual.ignoredUpdateCount).toBe(2);

    // 더 높은 버전(stateVersion: 6)은 정상 반영
    const nextBoard = createEmptyGomokuBoard();
    nextBoard[7][7] = "white";
    const afterHigher = applyIncomingSnapshot(
      afterEqual,
      makeSnapshot({
        stateVersion: 6,
        currentPlayerId: 101,
        board: nextBoard,
      }),
      "game.updated",
    );
    expect(afterHigher.snapshot?.stateVersion).toBe(6);
    expect(afterHigher.snapshot?.board[7][7]).toBe("white");
    expect(afterHigher.ignoredUpdateCount).toBe(2);
  });

  it("match.snapshot의 stateVersion이 현재보다 낮으면(<) 무시하고, 같거나 높으면(>=) 반영한다", () => {
    const baseState = applyIncomingSnapshot(
      createInitialGomokuClientState(101, 10),
      makeSnapshot({ stateVersion: 4, status: "playing" }),
      "game.updated",
    );

    // 구독 도중 늦게 도착한 낮은 버전(stateVersion: 3)의 match.snapshot은 무시
    const afterLowerSnapshot = applyIncomingSnapshot(
      baseState,
      makeSnapshot({ stateVersion: 3, status: "playing" }),
      "match.snapshot",
    );
    expect(afterLowerSnapshot.snapshot?.stateVersion).toBe(4);
    expect(afterLowerSnapshot.ignoredUpdateCount).toBe(1);

    // 같은 버전(stateVersion: 4)의 일시정지 전환 match.snapshot은 정상 반영
    const afterSameVersionPause = applyIncomingSnapshot(
      afterLowerSnapshot,
      makeSnapshot({ stateVersion: 4, status: "paused" }),
      "match.snapshot",
    );
    expect(afterSameVersionPause.snapshot?.stateVersion).toBe(4);
    expect(afterSameVersionPause.snapshot?.status).toBe("paused");
    expect(afterSameVersionPause.ignoredUpdateCount).toBe(1);
  });
});

describe("서버 권위 snapshot 표시 및 클라이언트 자체 승패 판정 금지", () => {
  it("보드에 5개의 돌이 연속으로 놓여 있어도 서버 snapshot이 finished 및 result를 확정한 상태가 아니면 승패를 표시하지 않는다", () => {
    const fiveInRowBoard = createEmptyGomokuBoard();
    fiveInRowBoard[7][3] = "black";
    fiveInRowBoard[7][4] = "black";
    fiveInRowBoard[7][5] = "black";
    fiveInRowBoard[7][6] = "black";
    fiveInRowBoard[7][7] = "black";

    const playingSnapshot = makeSnapshot({
      stateVersion: 9,
      status: "playing",
      currentPlayerId: 202,
      board: fiveInRowBoard,
      result: null,
    });

    // 클라이언트는 자체적으로 5목을 계산해 승리 처리하지 않음
    expect(describeGomokuResult(playingSnapshot, 101)).toBeNull();

    const state = applyIncomingSnapshot(
      applyConnectionPhase(createInitialGomokuClientState(101, 10), "connected"),
      playingSnapshot,
      "game.updated",
    );
    const html = renderToStaticMarkup(
      createElement(GomokuMatchView, {
        state,
        onPlaceStone: vi.fn(),
        onResign: vi.fn(),
        onReconnect: vi.fn(),
        onBackToLobby: vi.fn(),
      }),
    );

    expect(html).not.toContain('data-testid="gomoku-result-panel"');
    expect(html).toContain("상대 차례");
  });

  it("착수 명령(markCommandPending)을 전송해도 서버 snapshot 수신 전에는 보드에 돌을 미리 그리지 않는다", () => {
    const initial = applyIncomingSnapshot(
      applyConnectionPhase(createInitialGomokuClientState(101, 10), "connected"),
      makeSnapshot({ stateVersion: 1, currentPlayerId: 101 }),
      "match.snapshot",
    );
    const command = buildPlaceCommand(10, 1, 7, 7, "cmd-place-7-7");
    const pendingState = markCommandPending(initial, command);

    expect(pendingState.pendingCommand?.commandId).toBe("cmd-place-7-7");
    expect(pendingState.snapshot?.board[7][7]).toBeNull();
  });
});

describe("차례 · 상대 착수 · 결과 · game.error · 연결 끊김/재접속 표시", () => {
  it("내 차례와 상대 차례, 상대 착수 좌표와 조회된 상대 닉네임을 정확히 표시한다", () => {
    const initial = applyConnectionPhase(
      createInitialGomokuClientState(101, 10),
      "connected",
    );

    // 1. 내 차례 (흑돌 #101)
    const board1 = createEmptyGomokuBoard();
    board1[7][7] = "black";
    const state1 = applyIncomingSnapshot(
      initial,
      makeSnapshot({
        stateVersion: 1,
        currentPlayerId: 202,
        board: board1,
      }),
      "match.snapshot",
    );
    const turn1 = deriveTurnPresentation(state1);
    expect(turn1.isOpponentTurn).toBe(true);
    expect(turn1.turnLabel).toBe("상대 차례");

    // 2. 상대방(#202, 백돌)이 (7, 8)에 착수한 game.updated 수신
    const board2 = createEmptyGomokuBoard();
    board2[7][7] = "black";
    board2[7][8] = "white";
    const state2 = applyIncomingSnapshot(
      state1,
      makeSnapshot({
        stateVersion: 2,
        currentPlayerId: 101,
        board: board2,
      }),
      "game.updated",
    );

    expect(state2.lastMove).toEqual({
      row: 7,
      col: 8,
      color: "white",
      byPlayerId: 202,
      isOpponentMove: true,
      stateVersion: 2,
    });

    const turn2 = deriveTurnPresentation(state2);
    expect(turn2.isMyTurn).toBe(true);
    expect(turn2.turnLabel).toBe("내 차례");

    const html = renderToStaticMarkup(
      createElement(GomokuMatchView, {
        state: state2,
        viewerNickname: "재일",
        playerNicknames: { 101: "재일", 202: "알파오목" },
        onPlaceStone: vi.fn(),
        onResign: vi.fn(),
        onReconnect: vi.fn(),
        onBackToLobby: vi.fn(),
      }),
    );

    expect(html).toContain("내 차례");
    expect(html).toContain("상대 착수");
    expect(html).toContain("(7, 8)");
    expect(html).toContain("알파오목");
    expect(html).not.toContain("Player #202");
    expect(html).toContain('aria-label="7, 8 백돌 (최근 착수)"');
  });

  it("서버가 확정한 종료 결과(Win! / Lose / Draw / 경기 취소)를 보드 오버레이로 표시하고 game.error를 안내한다", () => {
    const finishedSnapshot = makeSnapshot({
      stateVersion: 15,
      status: "finished",
      currentPlayerId: null,
      result: {
        outcome: "win",
        winnerId: 101,
        reason: "five_in_row",
      },
    });

    // 패배 / 무승부 / 무효 문구도 각각 검증
    expect(describeGomokuResult(finishedSnapshot, 202)?.headline).toBe("Lose");
    expect(
      describeGomokuResult(
        makeSnapshot({
          status: "finished",
          currentPlayerId: null,
          result: { outcome: "draw", winnerId: null, reason: "draw" },
        }),
        101,
      )?.headline,
    ).toBe("Draw");
    expect(
      describeGomokuResult(
        makeSnapshot({
          status: "finished",
          currentPlayerId: null,
          result: {
            outcome: "void",
            winnerId: null,
            reason: "disconnect_timeout",
          },
        }),
        101,
      )?.headline,
    ).toBe("경기 취소");

    let state = applyIncomingSnapshot(
      applyConnectionPhase(createInitialGomokuClientState(101, 10), "connected"),
      finishedSnapshot,
      "game.updated",
    );
    state = applyGameError(state, {
      code: "NOT_YOUR_TURN",
      message: "지금은 당신의 차례가 아닙니다.",
      matchId: 10,
      commandId: "cmd-err-1",
    });

    const html = renderToStaticMarkup(
      createElement(GomokuMatchView, {
        state,
        viewerNickname: "재일",
        onPlaceStone: vi.fn(),
        onResign: vi.fn(),
        onReconnect: vi.fn(),
        onPlayAgain: vi.fn(),
        onBackToLobby: vi.fn(),
      }),
    );

    expect(html).toContain('data-testid="gomoku-result-panel"');
    expect(html).toContain('data-result-outcome="win"');
    expect(html).toContain('data-result-reason="five_in_row"');
    expect(html).toContain("Win!");
    expect(html).toContain("5목 완성");
    expect(html).toContain("다시 하기");
    expect(html).toContain("나가기");
    expect(html).toContain("마지막 판 다시 보기");
    expect(html).toContain("[종료]");
    expect(html).not.toContain("[대기]");
    expect(html).not.toContain("서버 권위 판정");
    expect(html).toContain('data-testid="game-error-banner"');
    expect(html).toContain('data-error-code="NOT_YOUR_TURN"');
    expect(html).toContain("상대방의 차례입니다");
  });

  it("서버가 전송하는 오류 코드(INVALID_MESSAGE, UNSUPPORTED_MESSAGE, INTERNAL_ERROR)를 한국어 안내 문구로 변환한다", () => {
    expect(getGameErrorMessage("INVALID_MESSAGE", "Invalid message")).toBe(
      "요청 메시지 형식이 올바르지 않습니다.",
    );
    expect(
      getGameErrorMessage("UNSUPPORTED_MESSAGE", "Unsupported message"),
    ).toBe("요청 메시지 형식이 올바르지 않습니다.");
    expect(getGameErrorMessage("INTERNAL_ERROR", "Internal error")).toBe(
      "서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.",
    );
  });

  it("일시정지(paused) 상태에서는 기권 버튼(canResign)을 비활성화한다", () => {
    const pausedState = applyIncomingSnapshot(
      applyConnectionPhase(createInitialGomokuClientState(101, 10), "connected"),
      makeSnapshot({ stateVersion: 3, status: "paused", currentPlayerId: 101 }),
      "match.snapshot",
    );
    const turn = deriveTurnPresentation(pausedState);
    expect(turn.canPlaceStone).toBe(false);
    expect(turn.canResign).toBe(false);
  });

  it("연결 끊김·재접속 중 상태와 상대방 연결 끊김(일시정지) 배너를 각각 표시한다", () => {
    const now = 1_700_000_000_000;
    let state = applyIncomingSnapshot(
      createInitialGomokuClientState(101, 10),
      makeSnapshot({ stateVersion: 3, status: "paused", currentPlayerId: 101 }),
      "match.snapshot",
    );
    state = applyConnectionPhase(state, "reconnecting", 2);
    state = applyPlayerDisconnected(
      state,
      { matchId: 10, userId: 202, remainingMs: 45_000 },
      now,
    );

    const html = renderToStaticMarkup(
      createElement(GomokuMatchView, {
        state,
        onPlaceStone: vi.fn(),
        onResign: vi.fn(),
        onReconnect: vi.fn(),
        onBackToLobby: vi.fn(),
      }),
    );

    // 자신의 재접속 중 배너
    expect(html).toContain('data-testid="connection-status-banner"');
    expect(html).toContain('data-connection-phase="reconnecting"');
    expect(html).toContain("연결 끊김 · 재접속 중... (재시도 2회)");

    // 상대방 연결 끊김 / 일시정지 배너
    expect(html).toContain('data-testid="opponent-disconnect-banner"');
    expect(html).toContain("경기 일시정지");
    expect(html).toContain("상대방 연결 끊김 — 재접속 대기 중");
    expect(html).toContain("[재접속 대기 중]");

    // 상대 재접속 및 세션 대체 상태 전환 확인
    const reconnected = applyPlayerReconnected(state, {
      matchId: 10,
      userId: 202,
      remainingMs: 42_000,
    });
    expect(reconnected.opponentDisconnect).toBeNull();

    const replaced = applySessionReplaced(reconnected, 10);
    expect(replaced.sessionReplaced).toBe(true);
    expect(replaced.gameError?.code).toBe("SESSION_REPLACED");
  });
});

describe("실시간 WebSocket 클라이언트(createGameWsClient) 프로토콜 연동", () => {
  it("연결 후 auth → auth.ok → match.subscribe 및 game.command 전송, 연결 끊김 시 자동 재접속을 수행한다", () => {
    vi.useFakeTimers();
    try {
      const instances: Array<{
        sent: WsEnvelope[];
        readyState: number;
        onopen: ((ev: unknown) => void) | null;
        onmessage: ((ev: { data: string }) => void) | null;
        onclose: ((ev: { code?: number; reason?: string }) => void) | null;
        onerror: ((ev: unknown) => void) | null;
        send: (data: string) => void;
        close: (code?: number, reason?: string) => void;
      }> = [];

      const phases: string[] = [];
      const snapshots: GomokuSnapshot[] = [];

      const client = createGameWsClient({
        url: "ws://localhost:3000/api/ws",
        getAccessToken: () => "jwt-token-123",
        reconnectDelaysMs: [100],
        createWebSocket: () => {
          const mockWs = {
            sent: [] as WsEnvelope[],
            readyState: 1,
            onopen: null as ((ev: unknown) => void) | null,
            onmessage: null as ((ev: { data: string }) => void) | null,
            onclose: null as
              | ((ev: { code?: number; reason?: string }) => void)
              | null,
            onerror: null as ((ev: unknown) => void) | null,
            send(data: string) {
              this.sent.push(JSON.parse(data) as WsEnvelope);
            },
            close() {
              this.readyState = 3;
            },
          };
          instances.push(mockWs);
          return mockWs as MinimalWebSocket;
        },
        handlers: {
          onPhaseChange(phase) {
            phases.push(phase);
          },
          onMatchSnapshot(snapshot) {
            snapshots.push(snapshot);
          },
        },
      });

      client.setSubscribedMatchId(10);
      client.connect();

      expect(instances).toHaveLength(1);
      const ws1 = instances[0];
      ws1.onopen?.({});

      // 1. 첫 메시지로 auth 전송
      expect(ws1.sent[0]).toEqual({
        type: "auth",
        requestId: "auth-init",
        payload: { accessToken: "jwt-token-123" },
      });

      // 2. auth.ok 수신 시 자동으로 match.subscribe 전송
      ws1.onmessage?.({
        data: JSON.stringify({
          type: "auth.ok",
          payload: { userId: 101, activeMatchId: 10 },
        }),
      });
      expect(client.getPhase()).toBe("connected");
      expect(ws1.sent[1]?.type).toBe("match.subscribe");
      expect(ws1.sent[1]?.payload).toEqual({ matchId: 10 });

      // 3. match.snapshot 수신 및 착수(place) 명령 전송
      ws1.onmessage?.({
        data: JSON.stringify({
          type: "match.snapshot",
          payload: makeSnapshot({ matchId: 10, stateVersion: 2 }),
        }),
      });
      expect(snapshots).toHaveLength(1);

      const placeCmd = buildPlaceCommand(10, 2, 0, 14, "cmd-place-0-14");
      expect(client.sendGameCommand(placeCmd)).toBe(true);
      expect(ws1.sent[2]).toEqual({
        type: "game.command",
        requestId: "cmd-place-0-14",
        payload: {
          matchId: 10,
          gameType: "gomoku",
          commandId: "cmd-place-0-14",
          expectedVersion: 2,
          action: { type: "place", row: 0, col: 14 },
        },
      });

      // 4. 기권(resign) 명령 빌더 검증
      const resignCmd = buildResignCommand(10, 2, "cmd-resign");
      expect(resignCmd.action).toEqual({ type: "resign" });

      // 5. 예기치 않은 연결 종료 시 reconnecting 전환 후 재접속 및 재구독
      ws1.onclose?.({ code: 1006, reason: "abnormal closure" });
      expect(client.getPhase()).toBe("reconnecting");

      vi.advanceTimersByTime(120);
      expect(instances).toHaveLength(2);
      const ws2 = instances[1];
      ws2.onopen?.({});
      ws2.onmessage?.({
        data: JSON.stringify({
          type: "auth.ok",
          payload: { userId: 101, activeMatchId: 10 },
        }),
      });
      expect(client.getPhase()).toBe("connected");
      expect(ws2.sent[1]?.type).toBe("match.subscribe");
      expect(ws2.sent[1]?.payload).toEqual({ matchId: 10 });

      client.disconnect();
    } finally {
      vi.useRealTimers();
    }
  });

  it("앱 레벨 heartbeat ping을 주기적으로 전송하고 pong 응답이 없으면 자동으로 재연결을 시도한다", () => {
    vi.useFakeTimers();
    try {
      const instances: Array<{
        sent: WsEnvelope[];
        readyState: number;
        onopen: ((ev: unknown) => void) | null;
        onmessage: ((ev: { data: string }) => void) | null;
        onclose: ((ev: { code?: number; reason?: string }) => void) | null;
        onerror: ((ev: unknown) => void) | null;
        send: (data: string) => void;
        close: (code?: number, reason?: string) => void;
      }> = [];

      const client = createGameWsClient({
        url: "ws://localhost:3000/api/ws",
        getAccessToken: () => "jwt-token-123",
        reconnectDelaysMs: [100],
        heartbeatIntervalMs: 1_000,
        heartbeatTimeoutMs: 500,
        createWebSocket: () => {
          const mockWs = {
            sent: [] as WsEnvelope[],
            readyState: 1,
            onopen: null as ((ev: unknown) => void) | null,
            onmessage: null as ((ev: { data: string }) => void) | null,
            onclose: null as
              | ((ev: { code?: number; reason?: string }) => void)
              | null,
            onerror: null as ((ev: unknown) => void) | null,
            send(data: string) {
              this.sent.push(JSON.parse(data) as WsEnvelope);
            },
            close() {
              this.readyState = 3;
            },
          };
          instances.push(mockWs);
          return mockWs as MinimalWebSocket;
        },
        handlers: {},
      });

      client.connect();
      const ws1 = instances[0];
      ws1.onopen?.({});
      ws1.onmessage?.({
        data: JSON.stringify({
          type: "auth.ok",
          payload: { userId: 101, activeMatchId: null },
        }),
      });
      expect(client.getPhase()).toBe("connected");

      // 1초 경과 시 앱 레벨 ping 전송
      vi.advanceTimersByTime(1_000);
      expect(ws1.sent.some((m) => m.type === "ping")).toBe(true);

      // pong 응답 수신 시 연결 유지
      ws1.onmessage?.({
        data: JSON.stringify({ type: "pong", payload: {} }),
      });
      vi.advanceTimersByTime(500);
      expect(client.getPhase()).toBe("connected");

      // 다음 ping 후 500ms 동안 pong이 없으면 재연결 트리거
      vi.advanceTimersByTime(1_000);
      expect(ws1.sent.filter((m) => m.type === "ping").length).toBeGreaterThanOrEqual(2);
      vi.advanceTimersByTime(550);
      expect(client.getPhase()).toBe("reconnecting");

      client.disconnect();
    } finally {
      vi.useRealTimers();
    }
  });
});
