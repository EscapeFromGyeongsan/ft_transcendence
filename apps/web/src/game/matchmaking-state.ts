import type { GameType } from "@cafe/game-contracts";
import {
  getGameErrorMessage,
  type MatchId,
  type WsConnectionPhase,
} from "./gomoku-state.ts";

/** 매칭 대기열 클라이언트 단계 (SDS 2.7의 7.1, IF-06) */
export type MatchmakingPhase =
  "idle" | "joining" | "queued" | "leaving" | "matched";

/** 게임 규칙 요약 항목 */
export interface GameRuleSummaryItem {
  label: string;
  value: string;
}

/** 로비 및 매칭 대기 화면에 표시할 게임 카탈로그 메타데이터 (FR-CAT-01, FR-CAT-02) */
export interface GameCatalogEntry {
  gameType: GameType;
  title: string;
  shortTitle: string;
  subtitle: string;
  rulesVersion: string;
  ruleBadge: string;
  boardSizeLabel: string;
  boardSubLabel: string;
  playable: boolean;
  statusBadge: string;
  description: string;
  waitingTitle: string;
  waitingDescription: string;
  rules: readonly GameRuleSummaryItem[];
}

/** 매칭 신청·대기·취소·성립 오류 상태 */
export interface MatchmakingErrorState {
  code: string;
  message: string;
  serverMessage: string;
}

/** 매칭 대기열 클라이언트 상태 (IF-06, FR-MATCH-01, FR-MATCH-02) */
export interface MatchmakingClientState {
  phase: MatchmakingPhase;
  selectedGameType: GameType;
  queuedGameType: GameType | null;
  queuedAtMs: number | null;
  matchedMatchId: MatchId | null;
  matchedGameType: GameType | null;
  error: MatchmakingErrorState | null;
}

/**
 * 지원 게임 카탈로그 및 사전 규칙 안내 명세입니다 (FR-CAT-01, FR-CAT-02, GAME_RULES.md).
 */
export const GAME_CATALOG: Readonly<Record<GameType, GameCatalogEntry>> = {
  gomoku: {
    gameType: "gomoku",
    title: "오목 (15 × 15 자유룰)",
    shortTitle: "오목",
    subtitle: "Gomoku · Freestyle Rules",
    rulesVersion: "gomoku-freestyle-v1",
    ruleBadge: "자유룰",
    boardSizeLabel: "15 × 15",
    boardSubLabel: "선 교차점 착수 (0~14 좌표)",
    playable: true,
    statusBadge: "실시간 대국 가능",
    description:
      "가로, 세로, 대각선으로 돌 5개 이상을 먼저 잇는 턴제 전략 보드게임입니다. 서버 권위 판정(IF-01·IF-05)으로 공정하게 진행됩니다.",
    waitingTitle: "오목 일반 매칭 대기실",
    waitingDescription:
      "다른 플레이어와 15×15 오목 대국을 매칭하고 있습니다. 매칭이 성사되면 자동으로 오목 대국 화면으로 이동합니다.",
    rules: [
      { label: "흑/백 돌 배정", value: "흑 선공 · 자동 매칭 시 무작위 추첨" },
      {
        label: "승리 조건",
        value: "가로·세로·대각선 5목 이상 연속 시 승리 (장목 허용)",
      },
      {
        label: "금수 규정",
        value: "금수 없음 (3-3, 4-4 착수 가능)",
      },
      {
        label: "무승부 기준",
        value: "승자 없이 225개 교차점이 모두 차면 무승부",
      },
    ],
  },
  othello: {
    gameType: "othello",
    title: "오델로 (8 × 8 표준 보드)",
    shortTitle: "오델로",
    subtitle: "Othello · Standard Rules",
    rulesVersion: "othello-standard-v1",
    ruleBadge: "표준룰",
    boardSizeLabel: "8 × 8",
    boardSubLabel: "중앙 4칸 교차 초기 배치 (0~7 좌표)",
    playable: true,
    statusBadge: "실시간 대국 가능",
    description:
      "상대방의 돌을 8방향으로 끼워 뒤집어 자신의 색으로 만들고, 대국 종료 시 더 많은 돌을 차지하는 두뇌 전략 게임입니다.",
    waitingTitle: "오델로 일반 매칭 대기실",
    waitingDescription:
      "다른 플레이어와 8×8 오델로 대국을 매칭하고 있습니다. 매칭이 성사되면 자동으로 대국 화면으로 이동합니다.",
    rules: [
      { label: "초기 배치·선공", value: "중앙 4칸 흑·백 교차 배치 · 흑 선공" },
      {
        label: "착수 및 뒤집기",
        value: "8방향 중 상대 돌을 1개 이상 끼우는 칸에만 착수 가능",
      },
      {
        label: "자동 패스",
        value: "합법 수가 없으면 차례가 상대에게 자동으로 넘어감",
      },
      {
        label: "승리 조건",
        value: "양쪽 착수 불가 또는 64칸 소진 시 돌 수 비교 (동수 무승부)",
      },
    ],
  },
};

/** 지원 게임 카탈로그 순서 목록 */
export const GAME_CATALOG_LIST: readonly GameCatalogEntry[] = [
  GAME_CATALOG.gomoku,
  GAME_CATALOG.othello,
];

/**
 * 선택한 게임 종류의 카탈로그 및 규칙 정보를 반환합니다.
 *
 * @param gameType - 조회할 게임 종류 (`"gomoku"` 또는 `"othello"`)
 */
export function getGameCatalogEntry(gameType: GameType): GameCatalogEntry {
  return GAME_CATALOG[gameType] ?? GAME_CATALOG.gomoku;
}

/**
 * 초기 매칭 클라이언트 상태를 생성합니다.
 *
 * @param selectedGameType - 매칭 화면에 표시할 기본 게임 종류 (기본값: `"gomoku"`)
 */
export function createInitialMatchmakingState(
  selectedGameType: GameType = "gomoku",
): MatchmakingClientState {
  return {
    phase: "idle",
    selectedGameType,
    queuedGameType: null,
    queuedAtMs: null,
    matchedMatchId: null,
    matchedGameType: null,
    error: null,
  };
}

/**
 * 현재 매칭 대기열에 참가 중이거나 신청/취소 처리 중인지 확인합니다.
 */
export function isMatchmakingBusy(state: MatchmakingClientState): boolean {
  return (
    state.phase === "joining" ||
    state.phase === "queued" ||
    state.phase === "leaving"
  );
}

/**
 * 클라이언트가 `queue.join` 전송을 시작할 때 호출하여 중복 신청을 잠급니다.
 */
export function applyQueueJoinRequested(
  state: MatchmakingClientState,
  gameType: GameType = state.selectedGameType,
): MatchmakingClientState {
  if (isMatchmakingBusy(state)) {
    return state;
  }
  return {
    ...state,
    phase: "joining",
    selectedGameType: gameType,
    queuedGameType: gameType,
    queuedAtMs: null,
    matchedMatchId: null,
    matchedGameType: null,
    error: null,
  };
}

/**
 * 서버로부터 `queue.joined` 응답을 수신했을 때 대기열 등록 완료 상태로 전이합니다.
 *
 * @remarks
 * 대기 중인 상대가 있어 `queue.matched`가 먼저 반영된 경우에는 `matched` 상태를 유지합니다.
 */
export function applyQueueJoined(
  state: MatchmakingClientState,
  payload: { gameType: GameType },
  nowMs: number = Date.now(),
): MatchmakingClientState {
  if (state.phase === "matched" && state.matchedMatchId !== null) {
    return state;
  }
  return {
    ...state,
    phase: "queued",
    selectedGameType: payload.gameType,
    queuedGameType: payload.gameType,
    queuedAtMs: state.queuedAtMs ?? nowMs,
    error: null,
  };
}

/**
 * 클라이언트가 `queue.leave` 전송을 시작할 때 호출하여 취소 처리 중(`leaving`) 상태로 전이합니다.
 *
 * @remarks
 * 서버의 `queue.left` 응답을 받기 전에 임의로 대기열 상태를 해제하지 않습니다 (FR-MATCH-01, IF-06).
 */
export function applyQueueLeaveRequested(
  state: MatchmakingClientState,
): MatchmakingClientState {
  if (state.phase !== "queued" && state.phase !== "joining") {
    return state;
  }
  return {
    ...state,
    phase: "leaving",
    error: null,
  };
}

/**
 * 서버로부터 `queue.left` 응답을 수신했을 때 대기 상태를 해제하고 로비(`idle`)로 복귀합니다.
 */
export function applyQueueLeft(
  state: MatchmakingClientState,
): MatchmakingClientState {
  return {
    ...state,
    phase: "idle",
    queuedGameType: null,
    queuedAtMs: null,
    error: null,
  };
}

/**
 * 서버로부터 `queue.matched` 이벤트를 수신했을 때 매칭 성립(`matched`) 상태로 전이합니다.
 */
export function applyQueueMatched(
  state: MatchmakingClientState,
  payload: { matchId: MatchId; gameType: GameType },
): MatchmakingClientState {
  return {
    ...state,
    phase: "matched",
    selectedGameType: payload.gameType,
    queuedGameType: null,
    queuedAtMs: null,
    matchedMatchId: payload.matchId,
    matchedGameType: payload.gameType,
    error: null,
  };
}

/**
 * 매칭 신청·취소 중 서버에서 수신한 `error` 이벤트를 반영합니다 (IF-06, FR-MATCH-01, FR-MATCH-02).
 *
 * @remarks
 * - `ALREADY_MATCHED`: 취소 요청 시점에 이미 매칭이 성사되어 경기가 생성 중인 경우,
 *   로비로 나가지 않고 대기 상태를 유지하면서 곧 도착할 `queue.matched`를 기다립니다.
 * - `ALREADY_ACTIVE`: 이미 다른 탭에서 대기 중이거나 진행 중인 대국이 있는 경우,
 *   신청 상태를 해제(`idle`)하고 안내 문구를 표시합니다.
 */
export function applyMatchmakingError(
  state: MatchmakingClientState,
  payload: { code: string; message: string },
): MatchmakingClientState {
  const friendlyMessage = getGameErrorMessage(payload.code, payload.message);
  const errorState: MatchmakingErrorState = {
    code: payload.code,
    message: friendlyMessage,
    serverMessage: payload.message,
  };

  if (payload.code === "ALREADY_MATCHED") {
    return {
      ...state,
      phase: "queued",
      queuedGameType: state.queuedGameType ?? state.selectedGameType,
      error: errorState,
    };
  }

  return {
    ...state,
    phase: "idle",
    queuedGameType: null,
    queuedAtMs: null,
    error: errorState,
  };
}

/**
 * WebSocket 연결 상태 변화에 따라 매칭 대기 상태를 동기화합니다.
 *
 * @remarks
 * 서버(`matchmaking.ts`)는 소켓 연결이 끊기면(`removeSocket`) 해당 연결의 대기 항목을 즉시 제거합니다.
 * 따라서 대기 중 연결이 끊기면 클라이언트도 대기 상태를 해제하고 안내 메시지를 표시합니다.
 */
export function applyMatchmakingWsPhaseChange(
  state: MatchmakingClientState,
  wsPhase: WsConnectionPhase,
): MatchmakingClientState {
  if (!isMatchmakingBusy(state)) {
    return state;
  }
  if (
    wsPhase === "reconnecting" ||
    wsPhase === "disconnected" ||
    wsPhase === "session_replaced"
  ) {
    const code =
      wsPhase === "session_replaced" ? "SESSION_REPLACED" : "WS_DISCONNECTED";
    const message =
      wsPhase === "session_replaced"
        ? getGameErrorMessage("SESSION_REPLACED")
        : "실시간 서버와 연결이 끊어져 매칭 대기가 해제되었습니다. 재연결 후 다시 매칭을 신청해 주세요.";

    return {
      ...state,
      phase: "idle",
      queuedGameType: null,
      queuedAtMs: null,
      error: {
        code,
        message,
        serverMessage: message,
      },
    };
  }
  return state;
}

/**
 * 매칭 오류 배너를 닫습니다.
 */
export function clearMatchmakingError(
  state: MatchmakingClientState,
): MatchmakingClientState {
  if (!state.error) return state;
  return {
    ...state,
    error: null,
  };
}

/**
 * 매칭 대기 경과 시간을 `MM:SS` 형식(예: `"00:15"`, `"03:17"`)으로 반환합니다.
 *
 * @param queuedAtMs - 대기열 진입 시각 (epoch ms)
 * @param nowMs - 현재 시각 (epoch ms)
 */
export function formatQueueElapsed(
  queuedAtMs: number | null,
  nowMs: number = Date.now(),
): string {
  if (queuedAtMs === null || !Number.isFinite(queuedAtMs)) {
    return "00:00";
  }
  const totalSeconds = Math.max(0, Math.floor((nowMs - queuedAtMs) / 1000));
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}
