import type {
  Cell,
  OthelloCommand,
  OthelloResult,
  OthelloSnapshot,
  PlaceAction,
  PlayerColor,
  PlayerId,
  ResignAction,
} from "@cafe/game-contracts";
import {
  generateCommandId,
  getGameErrorMessage,
  type CommandId,
  type GameErrorBannerState,
  type IncomingSnapshotEventType,
  type MatchId,
  type OpponentDisconnectState,
  type PendingCommandState,
  type StateVersion,
  type WsConnectionPhase,
} from "./gomoku-state.ts";

/** 오델로 표준 보드 크기 (8×8, row/col 0..7) */
export const OTHELLO_BOARD_SIZE = 8;

/** 오델로 표준 규칙 버전 상수 (@cafe/game-engine othello.OTHELLO_RULES_VERSION과 동일) */
export const OTHELLO_RULES_VERSION = "othello-standard-v1";

/** 0부터 7까지의 오델로 행·열 인덱스 목록 */
export const OTHELLO_COORDS: readonly number[] = Array.from(
  { length: OTHELLO_BOARD_SIZE },
  (_, index) => index,
);

/** 오델로 8방향 탐색 오프셋 */
const OTHELLO_DIRECTIONS: ReadonlyArray<readonly [number, number]> = [
  [-1, -1],
  [-1, 0],
  [-1, 1],
  [0, -1],
  [0, 1],
  [1, -1],
  [1, 0],
  [1, 1],
];

/** 오델로 종료 사유 유니언 타입 */
export type OthelloFinishedReason = OthelloResult["reason"];

/** 오델로 종료 결과 구분 유니언 타입 */
export type OthelloOutcome = OthelloResult["outcome"];

/** 합법 착수 위치 및 뒤집히는 돌 개수 정보 (화면 하이라이트 전용, 서버가 최종 판정) */
export interface OthelloLegalMove {
  row: number;
  col: number;
  flipCount: number;
}

/** 직전 snapshot 대비 새로 놓인 돌 및 뒤집힌 돌·자동 패스 표시 정보 (표시 전용) */
export interface OthelloDetectedMove {
  row: number;
  col: number;
  color: PlayerColor;
  byPlayerId: PlayerId;
  isOpponentMove: boolean;
  flippedCoords: ReadonlyArray<{ row: number; col: number }>;
  autoPassedColor: PlayerColor | null;
  stateVersion: StateVersion;
}

/** 오델로 대국 클라이언트 상태 */
export interface OthelloClientState {
  matchId: MatchId | null;
  viewerUserId: PlayerId | null;
  snapshot: OthelloSnapshot | null;
  lastMove: OthelloDetectedMove | null;
  pendingCommand: PendingCommandState | null;
  gameError: GameErrorBannerState | null;
  connectionPhase: WsConnectionPhase;
  reconnectAttempt: number;
  opponentDisconnect: OpponentDisconnectState | null;
  sessionReplaced: boolean;
  ignoredUpdateCount: number;
}

/** 오델로 현재 차례 및 합법 착수 표시 파생 정보 */
export interface OthelloTurnPresentation {
  viewerRole: "black" | "white" | "spectator";
  myColor: PlayerColor | null;
  opponentColor: PlayerColor | null;
  opponentUserId: PlayerId | null;
  currentTurnColor: PlayerColor | null;
  isMyTurn: boolean;
  isOpponentTurn: boolean;
  canPlaceDisc: boolean;
  canResign: boolean;
  legalMoves: readonly OthelloLegalMove[];
  autoPassNotice: string | null;
  turnLabel: string;
  turnDescription: string;
}

/** 서버가 확정한 오델로 종료 결과(snapshot.result) 표시 정보 */
export interface OthelloResultPresentation {
  outcome: OthelloOutcome;
  perspective: "victory" | "defeat" | "draw" | "void" | "finished";
  headline: string;
  subheadline: string;
  badgeText: string;
  winnerId: PlayerId | null;
  winnerColor: PlayerColor | null;
  reason: OthelloFinishedReason;
  reasonTitle: string;
  reasonDescription: string;
  blackCount: number;
  whiteCount: number;
}

/**
 * 주어진 행(row)·열(col) 좌표가 8×8 오델로 보드 범위(0..7 정수)인지 검증합니다.
 */
export function isValidOthelloCoord(row: number, col: number): boolean {
  return (
    Number.isInteger(row) &&
    Number.isInteger(col) &&
    row >= 0 &&
    row < OTHELLO_BOARD_SIZE &&
    col >= 0 &&
    col < OTHELLO_BOARD_SIZE
  );
}

/**
 * 표준 8×8 오델로 초기 보드((3,3)·(4,4) 백, (3,4)·(4,3) 흑)를 생성합니다.
 * 서버 snapshot 수신 전 초기 렌더링이나 테스트 픽스처 생성에만 사용합니다.
 */
export function createInitialOthelloBoard(): Cell[][] {
  const board: Cell[][] = Array.from({ length: OTHELLO_BOARD_SIZE }, () =>
    Array.from({ length: OTHELLO_BOARD_SIZE }, () => null),
  );
  board[3][3] = "white";
  board[3][4] = "black";
  board[4][3] = "black";
  board[4][4] = "white";
  return board;
}

/**
 * 8×8 오델로 보드의 흑돌·백돌·빈 칸 개수를 집계합니다 (FR-G2-05).
 */
export function countOthelloDiscs(board: Cell[][]): {
  black: number;
  white: number;
  empty: number;
  total: number;
} {
  let black = 0;
  let white = 0;
  let empty = 0;
  for (let r = 0; r < OTHELLO_BOARD_SIZE; r += 1) {
    for (let c = 0; c < OTHELLO_BOARD_SIZE; c += 1) {
      const cell = board[r]?.[c] ?? null;
      if (cell === "black") black += 1;
      else if (cell === "white") white += 1;
      else empty += 1;
    }
  }
  return {
    black,
    white,
    empty,
    total: black + white,
  };
}

/**
 * 특정 좌표에 `color` 돌을 놓았을 때 8방향으로 끼워 뒤집히는 상대 돌 좌표를 계산합니다.
 * (UI 합법 착수 위치 하이라이트 전용이며, 실제 합법 여부와 승패 판정은 서버가 단독 수행합니다.)
 */
export function findOthelloFlippableDiscs(
  board: Cell[][],
  row: number,
  col: number,
  color: PlayerColor,
): Array<{ row: number; col: number }> {
  if (!isValidOthelloCoord(row, col)) {
    return [];
  }
  if ((board[row]?.[col] ?? null) !== null) {
    return [];
  }

  const opponentColor: PlayerColor = color === "black" ? "white" : "black";
  const flipped: Array<{ row: number; col: number }> = [];

  for (const [dr, dc] of OTHELLO_DIRECTIONS) {
    let r = row + dr;
    let c = col + dc;
    const line: Array<{ row: number; col: number }> = [];

    while (
      isValidOthelloCoord(r, c) &&
      (board[r]?.[c] ?? null) === opponentColor
    ) {
      line.push({ row: r, col: c });
      r += dr;
      c += dc;
    }

    if (
      line.length > 0 &&
      isValidOthelloCoord(r, c) &&
      (board[r]?.[c] ?? null) === color
    ) {
      flipped.push(...line);
    }
  }

  return flipped;
}

/**
 * 주어진 돌 색상(`color`)이 현재 보드에서 착수할 수 있는 합법 좌표 목록을 반환합니다.
 */
export function computeOthelloLegalMoves(
  board: Cell[][],
  color: PlayerColor | null,
): OthelloLegalMove[] {
  if (!color) return [];
  const moves: OthelloLegalMove[] = [];
  for (let r = 0; r < OTHELLO_BOARD_SIZE; r += 1) {
    for (let c = 0; c < OTHELLO_BOARD_SIZE; c += 1) {
      if ((board[r]?.[c] ?? null) === null) {
        const flippable = findOthelloFlippableDiscs(board, r, c, color);
        if (flippable.length > 0) {
          moves.push({ row: r, col: c, flipCount: flippable.length });
        }
      }
    }
  }
  return moves;
}

/**
 * 0부터 시작하는(0..7) 행·열 좌표로 오델로 착수(place) 명령 페이로드를 생성합니다.
 */
export function buildOthelloPlaceCommand(
  matchId: MatchId,
  expectedVersion: StateVersion,
  row: number,
  col: number,
  commandId: CommandId = generateCommandId(),
): OthelloCommand {
  if (!isValidOthelloCoord(row, col)) {
    throw new RangeError(
      `유효하지 않은 오델로 좌표입니다: (${row}, ${col}). 0부터 ${OTHELLO_BOARD_SIZE - 1} 사이의 정수여야 합니다.`,
    );
  }
  const action: PlaceAction = {
    type: "place",
    row,
    col,
  };
  return {
    matchId,
    gameType: "othello",
    commandId,
    expectedVersion,
    action,
  };
}

/**
 * 오델로 기권(resign) 명령 페이로드를 생성합니다.
 */
export function buildOthelloResignCommand(
  matchId: MatchId,
  expectedVersion: StateVersion,
  commandId: CommandId = generateCommandId(),
): OthelloCommand {
  const action: ResignAction = {
    type: "resign",
  };
  return {
    matchId,
    gameType: "othello",
    commandId,
    expectedVersion,
    action,
  };
}

/**
 * 수신된 오델로 snapshot의 stateVersion을 현재 snapshot과 비교하여 반영 여부를 결정합니다.
 */
export function shouldAcceptOthelloSnapshot(
  currentSnapshot: OthelloSnapshot | null,
  incomingSnapshot: OthelloSnapshot,
  eventType: IncomingSnapshotEventType = "game.updated",
): boolean {
  if (!currentSnapshot) {
    return true;
  }
  if (currentSnapshot.matchId !== incomingSnapshot.matchId) {
    return true;
  }
  if (eventType === "game.updated") {
    return incomingSnapshot.stateVersion > currentSnapshot.stateVersion;
  }
  return incomingSnapshot.stateVersion >= currentSnapshot.stateVersion;
}

/**
 * 이전 snapshot과 새 snapshot의 보드를 비교하여 새로 놓인 돌, 뒤집힌 돌 좌표, 자동 패스 발생 여부를 감지합니다.
 * (표시 전용이며 승패 판정은 수행하지 않습니다.)
 */
export function detectOthelloMoveAndFlips(
  prevSnapshot: OthelloSnapshot | null,
  nextSnapshot: OthelloSnapshot,
  viewerUserId: PlayerId | null,
  prevLastMove: OthelloDetectedMove | null = null,
): OthelloDetectedMove | null {
  if (prevSnapshot && prevSnapshot.matchId === nextSnapshot.matchId) {
    const newlyPlaced: Array<{ row: number; col: number; color: PlayerColor }> =
      [];
    const flippedCoords: Array<{ row: number; col: number }> = [];

    for (let r = 0; r < OTHELLO_BOARD_SIZE; r += 1) {
      for (let c = 0; c < OTHELLO_BOARD_SIZE; c += 1) {
        const before = prevSnapshot.board[r]?.[c] ?? null;
        const after = nextSnapshot.board[r]?.[c] ?? null;
        if (before === null && (after === "black" || after === "white")) {
          newlyPlaced.push({ row: r, col: c, color: after });
        } else if (
          (before === "black" || before === "white") &&
          (after === "black" || after === "white") &&
          before !== after
        ) {
          flippedCoords.push({ row: r, col: c });
        }
      }
    }

    if (newlyPlaced.length === 1) {
      const placed = newlyPlaced[0];
      const byPlayerId =
        placed.color === "black"
          ? nextSnapshot.players.black
          : nextSnapshot.players.white;
      const isOpponentMove =
        viewerUserId !== null
          ? byPlayerId !== viewerUserId
          : nextSnapshot.currentPlayerId !== byPlayerId;

      // 착수 후에도 경기가 진행 중인데 차례(currentPlayerId)가 착수자 그대로라면 상대방에게 합법 수가 없어 자동 패스된 것입니다 (FR-G2-03).
      let autoPassedColor: PlayerColor | null = null;
      if (
        nextSnapshot.status === "playing" &&
        nextSnapshot.currentPlayerId === byPlayerId
      ) {
        autoPassedColor = placed.color === "black" ? "white" : "black";
      }

      return {
        row: placed.row,
        col: placed.col,
        color: placed.color,
        byPlayerId,
        isOpponentMove,
        flippedCoords,
        autoPassedColor,
        stateVersion: nextSnapshot.stateVersion,
      };
    }
  }

  if (prevLastMove) {
    const currentCell =
      nextSnapshot.board[prevLastMove.row]?.[prevLastMove.col] ?? null;
    if (currentCell !== null) {
      const isOpponentMove =
        viewerUserId !== null
          ? prevLastMove.byPlayerId !== viewerUserId
          : prevLastMove.isOpponentMove;
      return {
        ...prevLastMove,
        isOpponentMove,
      };
    }
  }

  return null;
}

/**
 * 초기 오델로 클라이언트 상태를 생성합니다.
 */
export function createInitialOthelloClientState(
  viewerUserId: PlayerId | null = null,
  matchId: MatchId | null = null,
): OthelloClientState {
  return {
    matchId,
    viewerUserId,
    snapshot: null,
    lastMove: null,
    pendingCommand: null,
    gameError: null,
    connectionPhase: "connecting",
    reconnectAttempt: 0,
    opponentDisconnect: null,
    sessionReplaced: false,
    ignoredUpdateCount: 0,
  };
}

/**
 * 서버로부터 수신한 오델로 snapshot(match.snapshot 또는 game.updated)을 상태에 반영합니다.
 */
export function applyOthelloIncomingSnapshot(
  state: OthelloClientState,
  incomingSnapshot: OthelloSnapshot,
  eventType: IncomingSnapshotEventType = "game.updated",
): OthelloClientState {
  if (!shouldAcceptOthelloSnapshot(state.snapshot, incomingSnapshot, eventType)) {
    return {
      ...state,
      ignoredUpdateCount: state.ignoredUpdateCount + 1,
    };
  }

  const nextLastMove = detectOthelloMoveAndFlips(
    state.snapshot,
    incomingSnapshot,
    state.viewerUserId,
    state.lastMove,
  );

  const nextOpponentDisconnect =
    incomingSnapshot.status === "paused" ? state.opponentDisconnect : null;

  const nextGameError =
    eventType === "game.updated" ||
    (state.gameError && state.gameError.code === "NOT_SUBSCRIBED")
      ? null
      : state.gameError;

  return {
    ...state,
    matchId: incomingSnapshot.matchId,
    snapshot: incomingSnapshot,
    lastMove: nextLastMove,
    pendingCommand: null,
    gameError: nextGameError,
    opponentDisconnect: nextOpponentDisconnect,
  };
}

/**
 * 오델로 명령 전송 직후 낙관적 보드 반영 없이 pendingCommand만 기록합니다.
 */
export function markOthelloCommandPending(
  state: OthelloClientState,
  command: OthelloCommand,
): OthelloClientState {
  return {
    ...state,
    pendingCommand: {
      commandId: command.commandId,
      expectedVersion: command.expectedVersion,
      action: command.action,
    },
    gameError: null,
  };
}

/**
 * game.ack 수신 시 전송 대기 중이던 오델로 명령 상태를 정리합니다.
 */
export function applyOthelloGameAck(
  state: OthelloClientState,
  payload: {
    matchId: MatchId;
    commandId: CommandId;
    stateVersion: StateVersion;
    duplicate: boolean;
  },
): OthelloClientState {
  if (
    state.pendingCommand &&
    state.pendingCommand.commandId === payload.commandId
  ) {
    return {
      ...state,
      pendingCommand: null,
    };
  }
  return state;
}

/**
 * 서버로부터 game.error 또는 error 이벤트를 수신했을 때 에러 배너 상태를 갱신합니다.
 */
export function applyOthelloGameError(
  state: OthelloClientState,
  errorPayload: {
    code: string;
    message: string;
    matchId?: MatchId;
    commandId?: CommandId;
    duplicate?: boolean;
  },
): OthelloClientState {
  const friendlyMessage =
    errorPayload.code === "INVALID_ACTION"
      ? "해당 칸에는 착수할 수 없습니다. 상대 돌을 1개 이상 끼워 뒤집을 수 있는 합법 위치(0~7)를 선택해 주세요."
      : getGameErrorMessage(errorPayload.code, errorPayload.message);

  return {
    ...state,
    pendingCommand: null,
    gameError: {
      code: errorPayload.code,
      message: friendlyMessage,
      serverMessage: errorPayload.message,
      matchId: errorPayload.matchId,
      commandId: errorPayload.commandId,
      duplicate: errorPayload.duplicate,
    },
  };
}

/**
 * 상대방 연결 끊김(player.disconnected) 이벤트를 오델로 상태에 반영합니다.
 */
export function applyOthelloPlayerDisconnected(
  state: OthelloClientState,
  payload: { matchId: MatchId; userId: PlayerId; remainingMs: number },
  nowMs: number = Date.now(),
): OthelloClientState {
  if (state.matchId !== null && state.matchId !== payload.matchId) {
    return state;
  }
  return {
    ...state,
    opponentDisconnect: {
      userId: payload.userId,
      remainingMs: Math.max(0, payload.remainingMs),
      receivedAtMs: nowMs,
    },
  };
}

/**
 * 상대방 재접속(player.reconnected) 이벤트를 오델로 상태에 반영합니다.
 */
export function applyOthelloPlayerReconnected(
  state: OthelloClientState,
  payload: { matchId: MatchId; userId: PlayerId; remainingMs?: number },
): OthelloClientState {
  if (state.matchId !== null && state.matchId !== payload.matchId) {
    return state;
  }
  return {
    ...state,
    opponentDisconnect: null,
  };
}

/**
 * 자신의 WebSocket 연결 단계를 오델로 상태에 반영합니다.
 */
export function applyOthelloConnectionPhase(
  state: OthelloClientState,
  phase: WsConnectionPhase,
  reconnectAttempt: number = state.reconnectAttempt,
): OthelloClientState {
  return {
    ...state,
    connectionPhase: phase,
    reconnectAttempt,
    pendingCommand: phase === "connected" ? state.pendingCommand : null,
  };
}

/**
 * session.replaced 수신 시 현재 탭의 제어권 상실 상태를 기록합니다.
 */
export function applyOthelloSessionReplaced(
  state: OthelloClientState,
  matchId: MatchId,
): OthelloClientState {
  if (state.matchId !== null && state.matchId !== matchId) {
    return state;
  }
  return {
    ...state,
    connectionPhase: "session_replaced",
    sessionReplaced: true,
    pendingCommand: null,
    gameError: {
      code: "SESSION_REPLACED",
      message: getGameErrorMessage("SESSION_REPLACED"),
      serverMessage: "다른 연결이 대국 제어권을 가져갔습니다.",
      matchId,
    },
  };
}

/**
 * 현재 오델로 snapshot과 접속자 ID를 기반으로 차례, 돌 색상, 합법 착수 위치, 자동 패스 안내를 계산합니다.
 */
export function deriveOthelloTurnPresentation(
  state: OthelloClientState,
): OthelloTurnPresentation {
  const {
    snapshot,
    viewerUserId,
    connectionPhase,
    sessionReplaced,
    pendingCommand,
    lastMove,
  } = state;

  if (!snapshot) {
    return {
      viewerRole: "spectator",
      myColor: null,
      opponentColor: null,
      opponentUserId: null,
      currentTurnColor: null,
      isMyTurn: false,
      isOpponentTurn: false,
      canPlaceDisc: false,
      canResign: false,
      legalMoves: [],
      autoPassNotice: null,
      turnLabel: "대국 정보 동기화 중",
      turnDescription: "서버로부터 확정된 오델로 대국 스냅샷을 불러오고 있습니다.",
    };
  }

  const isBlack =
    viewerUserId !== null && snapshot.players.black === viewerUserId;
  const isWhite =
    viewerUserId !== null && snapshot.players.white === viewerUserId;
  const viewerRole: "black" | "white" | "spectator" = isBlack
    ? "black"
    : isWhite
      ? "white"
      : "spectator";

  const myColor: PlayerColor | null = isBlack
    ? "black"
    : isWhite
      ? "white"
      : null;
  const opponentColor: PlayerColor | null = isBlack
    ? "white"
    : isWhite
      ? "black"
      : null;
  const opponentUserId: PlayerId | null = isBlack
    ? snapshot.players.white
    : isWhite
      ? snapshot.players.black
      : null;

  const currentTurnPlayerId = snapshot.currentPlayerId;
  const currentTurnColor: PlayerColor | null =
    currentTurnPlayerId === snapshot.players.black
      ? "black"
      : currentTurnPlayerId === snapshot.players.white
        ? "white"
        : null;

  const isParticipant = viewerRole !== "spectator";
  const isPlaying = snapshot.status === "playing";
  const isOnline = connectionPhase === "connected" && !sessionReplaced;

  const isMyTurn = Boolean(
    isParticipant &&
      isPlaying &&
      viewerUserId !== null &&
      currentTurnPlayerId === viewerUserId,
  );
  const isOpponentTurn = Boolean(
    isParticipant &&
      isPlaying &&
      currentTurnPlayerId !== null &&
      currentTurnPlayerId !== viewerUserId,
  );

  const legalMoves =
    isPlaying && currentTurnColor
      ? computeOthelloLegalMoves(snapshot.board, currentTurnColor)
      : [];

  const canPlaceDisc = Boolean(
    isMyTurn && isOnline && !pendingCommand && legalMoves.length > 0,
  );
  const canResign = Boolean(
    isParticipant && isPlaying && isOnline && !pendingCommand,
  );

  let autoPassNotice: string | null = null;
  if (isPlaying && lastMove?.autoPassedColor) {
    const passedKor =
      lastMove.autoPassedColor === "black" ? "흑돌" : "백돌";
    const activeKor =
      lastMove.autoPassedColor === "black" ? "백돌" : "흑돌";
    autoPassNotice = `${passedKor}에게 합법 착수 위치가 없어 자동 패스되었습니다. ${activeKor} 차례가 계속됩니다.`;
  }

  let turnLabel = "대국 대기 중";
  let turnDescription = "대국 시작을 기다리고 있습니다.";

  if (snapshot.status === "finished") {
    turnLabel = "대국 종료";
    turnDescription = "서버가 확정한 최종 오델로 대국 결과를 확인하세요.";
  } else if (snapshot.status === "paused") {
    turnLabel = "경기 일시정지";
    turnDescription =
      "상대방 연결이 끊어져 재접속을 기다리는 중입니다. 유예 시간 동안 착수가 잠깁니다.";
  } else if (isMyTurn) {
    const stoneKor = myColor === "black" ? "흑돌" : "백돌";
    turnLabel = "내 차례";
    turnDescription = `나의 착수 차례입니다 (${stoneKor}, 합법 위치 ${legalMoves.length}곳). 상대 돌을 끼울 수 있는 표시된 칸에 착수하세요.`;
  } else if (isOpponentTurn) {
    const stoneKor = opponentColor === "black" ? "흑돌" : "백돌";
    turnLabel = "상대 차례";
    turnDescription = `상대방(${stoneKor})이 착수할 위치를 고르고 있습니다.`;
  } else if (currentTurnColor) {
    turnLabel = currentTurnColor === "black" ? "흑돌 차례" : "백돌 차례";
    turnDescription = `현재 ${turnLabel}입니다.`;
  }

  return {
    viewerRole,
    myColor,
    opponentColor,
    opponentUserId,
    currentTurnColor,
    isMyTurn,
    isOpponentTurn,
    canPlaceDisc,
    canResign,
    legalMoves,
    autoPassNotice,
    turnLabel,
    turnDescription,
  };
}

const OTHELLO_REASON_META: Record<
  OthelloFinishedReason,
  { title: string; description: string }
> = {
  disc_count: {
    title: "돌 개수 우세 승리",
    description:
      "대국 종료 시 보드 위에 더 많은 돌을 차지하여 승리했습니다.",
  },
  resign: {
    title: "기권",
    description: "일방의 기권 선언으로 인해 경기가 즉시 종료되었습니다.",
  },
  disconnect_timeout: {
    title: "연결 끊김 시간 초과",
    description:
      "재접속 유예 시간(누적 60초)이 초과되어 시간패 처리되었습니다.",
  },
  draw: {
    title: "무승부 (돌 수 동률)",
    description:
      "대국 종료 시 흑돌과 백돌의 개수가 동일하여 무승부로 종료되었습니다.",
  },
  server_restart: {
    title: "무효 (서버 재시작)",
    description:
      "서버 재시작으로 인해 진행 중이던 경기가 무효(void) 처리되었습니다.",
  },
};

/**
 * 서버가 확정한 오델로 `snapshot.status === "finished"` 및 `snapshot.result`를 기반으로
 * 결과 오버레이 표시 정보를 생성합니다 (IF-01, FR-G2-04, FR-G2-05).
 */
export function describeOthelloResult(
  snapshot: OthelloSnapshot | null,
  viewerUserId: PlayerId | null,
): OthelloResultPresentation | null {
  if (!snapshot || snapshot.status !== "finished" || !snapshot.result) {
    return null;
  }

  const { outcome, winnerId, reason } = snapshot.result;
  const counts = countOthelloDiscs(snapshot.board);
  const reasonMeta = OTHELLO_REASON_META[reason] ?? {
    title: reason,
    description: "서버 판정에 의해 경기가 종료되었습니다.",
  };

  const winnerColor: PlayerColor | null =
    winnerId === null
      ? null
      : winnerId === snapshot.players.black
        ? "black"
        : winnerId === snapshot.players.white
          ? "white"
          : null;

  const isParticipant =
    viewerUserId !== null &&
    (snapshot.players.black === viewerUserId ||
      snapshot.players.white === viewerUserId);

  const scoreSuffix = `흑 ${counts.black} : 백 ${counts.white}`;
  let perspective: OthelloResultPresentation["perspective"] = "finished";
  let headline = "대국 종료";
  let subheadline = `${reasonMeta.title} (${scoreSuffix})`;
  let badgeText = "FINISHED";

  if (outcome === "draw") {
    perspective = "draw";
    headline = "Draw";
    badgeText = "DRAW";
    subheadline = `무승부 · ${reasonMeta.title} (${scoreSuffix})`;
  } else if (outcome === "void") {
    perspective = "void";
    headline = "경기 취소";
    badgeText = "VOID";
    subheadline = `경기 취소 · ${reasonMeta.title}`;
  } else if (outcome === "win") {
    if (isParticipant && winnerId === viewerUserId) {
      perspective = "victory";
      headline = "Win!";
      badgeText = "WIN";
      subheadline = `승리! · ${reasonMeta.title} (${scoreSuffix})`;
    } else if (isParticipant) {
      perspective = "defeat";
      headline = "Lose";
      badgeText = "LOSE";
      subheadline = `패배 · ${reasonMeta.title} (${scoreSuffix})`;
    } else {
      perspective = "finished";
      headline = "경기 종료";
      badgeText = "FINISHED";
      subheadline = `${reasonMeta.title} (${scoreSuffix})`;
    }
  }

  return {
    outcome,
    perspective,
    headline,
    subheadline,
    badgeText,
    winnerId,
    winnerColor,
    reason,
    reasonTitle: reasonMeta.title,
    reasonDescription: reasonMeta.description,
    blackCount: counts.black,
    whiteCount: counts.white,
  };
}

