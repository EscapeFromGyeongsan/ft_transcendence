import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { MatchmakingView } from "./MatchmakingView.tsx";
import {
  GAME_CATALOG,
  GAME_CATALOG_LIST,
  applyMatchmakingError,
  applyMatchmakingWsPhaseChange,
  applyQueueJoinRequested,
  applyQueueJoined,
  applyQueueLeaveRequested,
  applyQueueLeft,
  applyQueueMatched,
  clearMatchmakingError,
  createInitialMatchmakingState,
  formatQueueElapsed,
  getGameCatalogEntry,
  isMatchmakingBusy,
  selectMatchmakingGame,
} from "./matchmaking-state.ts";
import {
  createGameWsClient,
  type MinimalWebSocket,
  type WsEnvelope,
} from "./ws-client.ts";

describe("게임 선택 카탈로그 및 사전 규칙 안내 (FR-CAT-01, FR-CAT-02)", () => {
  it("오목(15×15 자유룰)과 오델로(8×8 표준룰) 카탈로그 및 플레이 가능 상태를 제공한다", () => {
    expect(GAME_CATALOG_LIST).toHaveLength(2);

    const gomoku = getGameCatalogEntry("gomoku");
    expect(gomoku.playable).toBe(true);
    expect(gomoku.boardSizeLabel).toBe("15 × 15");
    expect(gomoku.rulesVersion).toBe("gomoku-freestyle-v1");
    expect(gomoku.rules.some((r) => r.value.includes("5목 이상"))).toBe(true);
    expect(gomoku.rules.some((r) => r.value.includes("금수 없음"))).toBe(true);

    const othello = getGameCatalogEntry("othello");
    expect(othello.playable).toBe(true);
    expect(othello.boardSizeLabel).toBe("8 × 8");
    expect(othello.rulesVersion).toBe("othello-standard-v1");
    expect(GAME_CATALOG.othello.statusBadge).toBe("실시간 대국 가능");
  });
});

describe("자동 매칭 신청·취소·성립 상태 전이 (IF-06, FR-MATCH-01, FR-MATCH-02)", () => {
  it("게임 선택 → queue.join 신청 → queue.joined 대기 → queue.leave 요청 → queue.left 취소 흐름을 처리한다", () => {
    const joinedAt = 1_700_000_000_000;
    let state = createInitialMatchmakingState("gomoku");
    expect(state.phase).toBe("idle");
    expect(isMatchmakingBusy(state)).toBe(false);

    // 로비에서 게임 선택 변경 가능
    state = selectMatchmakingGame(state, "othello");
    expect(state.selectedGameType).toBe("othello");
    state = selectMatchmakingGame(state, "gomoku");
    expect(state.selectedGameType).toBe("gomoku");

    // 1. 매칭 신청 요청 (joining)
    state = applyQueueJoinRequested(state, "gomoku");
    expect(state.phase).toBe("joining");
    expect(state.queuedGameType).toBe("gomoku");
    expect(isMatchmakingBusy(state)).toBe(true);

    // 대기열 진입 중에는 게임 선택이 바뀌지 않음
    expect(selectMatchmakingGame(state, "othello").selectedGameType).toBe(
      "gomoku",
    );

    // 2. 서버 queue.joined 수신 (queued)
    state = applyQueueJoined(state, { gameType: "gomoku" }, joinedAt);
    expect(state.phase).toBe("queued");
    expect(state.queuedAtMs).toBe(joinedAt);
    expect(formatQueueElapsed(state.queuedAtMs, joinedAt + 75_000)).toBe(
      "01:15",
    );

    // 3. 매칭 취소 요청 (leaving) — 서버 queue.left 수신 전까지 임의로 idle로 풀지 않음
    state = applyQueueLeaveRequested(state);
    expect(state.phase).toBe("leaving");
    expect(isMatchmakingBusy(state)).toBe(true);

    // 4. 서버 queue.left 수신 시 비로소 idle 복귀
    state = applyQueueLeft(state);
    expect(state.phase).toBe("idle");
    expect(state.queuedGameType).toBeNull();
    expect(state.queuedAtMs).toBeNull();
    expect(isMatchmakingBusy(state)).toBe(false);
  });

  it("매칭 성립(queue.matched) 시 matched 상태로 전환하고 matchId를 기록한다", () => {
    let state = createInitialMatchmakingState("gomoku");
    state = applyQueueJoinRequested(state, "gomoku");
    state = applyQueueJoined(state, { gameType: "gomoku" }, 1_000);

    state = applyQueueMatched(state, { matchId: 42, gameType: "gomoku" });
    expect(state.phase).toBe("matched");
    expect(state.matchedMatchId).toBe(42);
    expect(state.matchedGameType).toBe("gomoku");
    expect(state.queuedGameType).toBeNull();

    // 만약 지연된 queue.joined가 뒤늦게 도착하더라도 이미 성립된 matched 상태를 덮어쓰지 않음
    const afterLateJoined = applyQueueJoined(
      state,
      { gameType: "gomoku" },
      2_000,
    );
    expect(afterLateJoined.phase).toBe("matched");
    expect(afterLateJoined.matchedMatchId).toBe(42);
  });

  it("취소와 매칭 확정이 경합하여 ALREADY_MATCHED가 오면 대기 상태를 유지하고 직후 queue.matched로 이동한다", () => {
    let state = createInitialMatchmakingState("gomoku");
    state = applyQueueJoinRequested(state, "gomoku");
    state = applyQueueJoined(state, { gameType: "gomoku" }, 1_000);
    state = applyQueueLeaveRequested(state);
    expect(state.phase).toBe("leaving");

    // 서버가 이미 createMatch 실행 중이라 ALREADY_MATCHED 반환
    state = applyMatchmakingError(state, {
      code: "ALREADY_MATCHED",
      message: "A match is being created for you.",
    });
    expect(state.phase).toBe("queued");
    expect(state.error?.code).toBe("ALREADY_MATCHED");
    expect(state.error?.message).toContain("이미 매칭이 성사되어");

    // 직후 도착한 queue.matched로 정상 전이
    state = applyQueueMatched(state, { matchId: 77, gameType: "gomoku" });
    expect(state.phase).toBe("matched");
    expect(state.matchedMatchId).toBe(77);
    expect(state.error).toBeNull();
  });

  it("중복 참가(ALREADY_ACTIVE) 및 소켓 연결 끊김 시 대기열 상태를 해제하고 한국어 안내를 남긴다", () => {
    let state = applyQueueJoinRequested(
      createInitialMatchmakingState("gomoku"),
      "gomoku",
    );

    // 1. ALREADY_ACTIVE 거절
    state = applyMatchmakingError(state, {
      code: "ALREADY_ACTIVE",
      message: "Already queued or playing a match.",
    });
    expect(state.phase).toBe("idle");
    expect(state.error?.code).toBe("ALREADY_ACTIVE");
    expect(state.error?.message).toContain("이미 참가 중인 대국이 있거나");

    state = clearMatchmakingError(state);
    expect(state.error).toBeNull();

    // 2. 대기 중 WebSocket 연결 끊김 (서버 removeSocket 동기화)
    state = applyQueueJoined(
      applyQueueJoinRequested(state, "gomoku"),
      { gameType: "gomoku" },
      5_000,
    );
    state = applyMatchmakingWsPhaseChange(state, "reconnecting");
    expect(state.phase).toBe("idle");
    expect(state.error?.code).toBe("WS_DISCONNECTED");
  });
});

describe("매칭 대기 화면(MatchmakingView) 렌더링 및 WebSocket 프로토콜 연동", () => {
  it("경과 시간, 게임 규칙 요약, 내 전적(0판 시 승률 '-') 및 취소 버튼을 렌더링한다", () => {
    const queuedState = applyQueueJoined(
      createInitialMatchmakingState("gomoku"),
      { gameType: "gomoku" },
      Date.now() - 15_000,
    );

    const htmlZeroPlayed = renderToStaticMarkup(
      createElement(MatchmakingView, {
        state: queuedState,
        connectionPhase: "connected",
        initialStats: {
          userId: 1,
          gameType: "gomoku",
          wins: 0,
          losses: 0,
          draws: 0,
          played: 0,
          winRate: 0,
          achievements: { firstWin: false },
          progress: { current: 0, target: 10 },
        },
        onCancelQueue: vi.fn(),
      }),
    );

    expect(htmlZeroPlayed).toContain('data-testid="matchmaking-view"');
    expect(htmlZeroPlayed).toContain('data-matchmaking-phase="queued"');
    expect(htmlZeroPlayed).toContain("오목 일반 매칭 대기실");
    expect(htmlZeroPlayed).toContain("대전 상대를 찾는 중입니다...");
    expect(htmlZeroPlayed).toContain("15 × 15");
    expect(htmlZeroPlayed).toContain("매칭 취소 및 로비로 이동");
    // 완료 대국 0건일 때 승률은 0%가 아니라 '-' (DEC-08)
    expect(htmlZeroPlayed).toContain('data-testid="matchmaking-winrate">-<');

    // leaving 단계에서는 취소 버튼이 비활성화됨
    const leavingState = applyQueueLeaveRequested(queuedState);
    const htmlLeaving = renderToStaticMarkup(
      createElement(MatchmakingView, {
        state: leavingState,
        connectionPhase: "connected",
        onCancelQueue: vi.fn(),
      }),
    );
    expect(htmlLeaving).toContain('data-matchmaking-phase="leaving"');
    expect(htmlLeaving).toContain("매칭 취소 처리 중...");
    expect(htmlLeaving).toContain("disabled");
  });

  it("WebSocket 클라이언트에서 queue.join → queue.joined → queue.leave → queue.left 및 queue.matched → 자동 match.subscribe를 수행한다", () => {
    const sent: WsEnvelope[] = [];
    const instances: MinimalWebSocket[] = [];

    const events: string[] = [];
    const matchedPayloads: Array<{ matchId: number; gameType: string }> = [];

    const client = createGameWsClient({
      url: "ws://localhost:3000/api/ws",
      getAccessToken: () => "token-abc",
      createWebSocket: () => {
        const ws: MinimalWebSocket = {
          readyState: 1,
          onopen: null,
          onmessage: null,
          onclose: null,
          onerror: null,
          send(data: string) {
            sent.push(JSON.parse(data) as WsEnvelope);
          },
          close() {
            // no-op
          },
        };
        instances.push(ws);
        return ws;
      },
      handlers: {
        onQueueJoined({ gameType }) {
          events.push(`joined:${gameType}`);
        },
        onQueueLeft() {
          events.push("left");
        },
        onQueueMatched(payload) {
          events.push(`matched:${payload.matchId}:${payload.gameType}`);
          matchedPayloads.push(payload);
        },
      },
    });

    client.connect();
    const ws = instances[0];
    expect(ws).toBeDefined();
    ws.onopen?.({});
    ws.onmessage?.({
      data: JSON.stringify({
        type: "auth.ok",
        payload: { userId: 101, activeMatchId: null },
      }),
    });

    // 1. 매칭 신청 (queue.join)
    expect(client.joinQueue("gomoku")).toBe(true);
    expect(sent.at(-1)?.type).toBe("queue.join");
    expect(sent.at(-1)?.payload).toEqual({ gameType: "gomoku" });

    ws.onmessage?.({
      data: JSON.stringify({
        type: "queue.joined",
        payload: { gameType: "gomoku" },
      }),
    });
    expect(events).toContain("joined:gomoku");

    // 2. 매칭 취소 (queue.leave -> queue.left)
    expect(client.leaveQueue()).toBe(true);
    expect(sent.at(-1)?.type).toBe("queue.leave");

    ws.onmessage?.({
      data: JSON.stringify({
        type: "queue.left",
        payload: {},
      }),
    });
    expect(events).toContain("left");

    // 3. 재신청 후 매칭 성립 (queue.matched -> 자동 match.subscribe 전송)
    expect(client.joinQueue("gomoku")).toBe(true);
    ws.onmessage?.({
      data: JSON.stringify({
        type: "queue.matched",
        payload: { matchId: 55, gameType: "gomoku" },
      }),
    });

    expect(matchedPayloads[0]).toEqual({ matchId: 55, gameType: "gomoku" });
    expect(client.getSubscribedMatchId()).toBe(55);
    expect(sent.at(-1)).toEqual({
      type: "match.subscribe",
      requestId: expect.stringMatching(/^match\.subscribe-/),
      payload: { matchId: 55 },
    });

    client.disconnect();
  });
});
