import type {
  Cell,
  GomokuCommand,
  GomokuResult,
  GomokuSnapshot,
  PlaceAction,
  PlayerColor,
  PlayerId,
  ResignAction,
} from "@cafe/game-contracts";

/** 대국 식별자 타입 */
export type MatchId = GomokuSnapshot["matchId"];

/** 명령 멱등성 식별자(UUID v4) 타입 */
export type CommandId = GomokuCommand["commandId"];

/** 대국 상태 버전 타입 */
export type StateVersion = GomokuSnapshot["stateVersion"];

/** 오목 종료 사유 유니언 타입 */
export type GomokuFinishedReason = GomokuResult["reason"];

/** 오목 종료 결과 구분 유니언 타입 */
export type GomokuOutcome = GomokuResult["outcome"];

/** 오목 표준 보드 크기 (15×15, row/col 0..14) */
export const GOMOKU_BOARD_SIZE = 15;

/** 0부터 14까지의 오목 행·열 인덱스 목록 */
export const GOMOKU_COORDS: readonly number[] = Array.from(
  { length: GOMOKU_BOARD_SIZE },
  (_, index) => index,
);

/** 15×15 오목판 화점(천원 및 4귀 화점) 좌표 */
export const GOMOKU_STAR_POINTS: ReadonlyArray<readonly [number, number]> = [
  [3, 3],
  [3, 11],
  [7, 7],
  [11, 3],
  [11, 11],
];

/** 연결 끊김 시 부여되는 누적 재접속 유예 시간 기본값 (60초) */
export const DISCONNECT_GRACE_TOTAL_MS = 60_000;

/** WebSocket 연결 상태 단계 */
export type WsConnectionPhase =
  | "connecting"
  | "authenticating"
  | "connected"
  | "reconnecting"
  | "disconnected"
  | "session_replaced";

/** 서버에서 수신한 snapshot 이벤트 종류 */
export type IncomingSnapshotEventType = "match.snapshot" | "game.updated";

/** 직전 snapshot 대비 새로 놓인 착수 정보 (표시 전용, 승패 판정 없음) */
export interface DetectedMove {
  row: number;
  col: number;
  color: PlayerColor;
  byPlayerId: PlayerId;
  isOpponentMove: boolean;
  stateVersion: StateVersion;
}

/** 서버가 반환한 game.error 또는 error 이벤트 상태 */
export interface GameErrorBannerState {
  code: string;
  message: string;
  serverMessage: string;
  matchId?: MatchId;
  commandId?: CommandId;
  duplicate?: boolean;
}

/** 상대방 연결 끊김 상태 정보 */
export interface OpponentDisconnectState {
  userId: PlayerId;
  remainingMs: number;
  receivedAtMs: number;
}

/** 전송 중인 명령 상태 */
export interface PendingCommandState {
  commandId: CommandId;
  expectedVersion: StateVersion;
  action: PlaceAction | ResignAction;
}

/** 오목 대국 클라이언트 상태 */
export interface GomokuClientState {
  matchId: MatchId | null;
  viewerUserId: PlayerId | null;
  snapshot: GomokuSnapshot | null;
  lastMove: DetectedMove | null;
  pendingCommand: PendingCommandState | null;
  gameError: GameErrorBannerState | null;
  connectionPhase: WsConnectionPhase;
  reconnectAttempt: number;
  opponentDisconnect: OpponentDisconnectState | null;
  sessionReplaced: boolean;
  ignoredUpdateCount: number;
}

/** 현재 차례 및 플레이어 역할 표시 파생 정보 */
export interface TurnPresentation {
  viewerRole: "black" | "white" | "spectator";
  myColor: PlayerColor | null;
  opponentColor: PlayerColor | null;
  opponentUserId: PlayerId | null;
  currentTurnColor: PlayerColor | null;
  isMyTurn: boolean;
  isOpponentTurn: boolean;
  canPlaceStone: boolean;
  canResign: boolean;
  turnLabel: string;
  turnDescription: string;
}

/** 오목 종료 사유별 판정 기준 카드 정보 */
export interface GomokuReasonCriterion {
  reason: GomokuFinishedReason;
  title: string;
  description: string;
  active: boolean;
}

/** 서버가 확정한 종료 결과(snapshot.result) 표시 정보 */
export interface GomokuResultPresentation {
  outcome: GomokuOutcome;
  perspective: "victory" | "defeat" | "draw" | "void" | "finished";
  headline: string;
  subheadline: string;
  badgeText: string;
  winnerId: PlayerId | null;
  winnerColor: PlayerColor | null;
  reason: GomokuFinishedReason;
  reasonTitle: string;
  reasonDescription: string;
  criteria: GomokuReasonCriterion[];
}

/**
 * 스냅샷에서 현재 차례 플레이어 ID(`currentPlayerId`)를 반환합니다.
 */
export function getCurrentTurnPlayerId(
  snapshot: GomokuSnapshot | null,
): PlayerId | null {
  if (!snapshot) return null;
  if (typeof snapshot.currentPlayerId === "number") {
    return snapshot.currentPlayerId;
  }
  const fallbackTurn = (
    snapshot as GomokuSnapshot & { currentTurn?: PlayerId | null }
  ).currentTurn;
  return typeof fallbackTurn === "number" ? fallbackTurn : null;
}

/**
 * 주어진 행(row)·열(col) 좌표가 15×15 오목판 범위(0..14 정수)인지 검증합니다.
 */
export function isValidGomokuCoord(row: number, col: number): boolean {
  return (
    Number.isInteger(row) &&
    Number.isInteger(col) &&
    row >= 0 &&
    row < GOMOKU_BOARD_SIZE &&
    col >= 0 &&
    col < GOMOKU_BOARD_SIZE
  );
}

/**
 * 화점(별점) 좌표인지 확인합니다.
 */
export function isGomokuStarPoint(row: number, col: number): boolean {
  return GOMOKU_STAR_POINTS.some(([r, c]) => r === row && c === col);
}

/**
 * 빈 15×15 오목 보드 배열(null 채움)을 생성합니다.
 * 서버 snapshot 수신 전 초기 렌더링이나 테스트 픽스처 생성에만 사용합니다.
 */
export function createEmptyGomokuBoard(): Cell[][] {
  return Array.from({ length: GOMOKU_BOARD_SIZE }, () =>
    Array.from({ length: GOMOKU_BOARD_SIZE }, () => null),
  );
}

/**
 * 보드에 놓인 흑돌·백돌·전체 착수 수를 집계합니다.
 */
export function countPlacedStones(board: Cell[][]): {
  total: number;
  black: number;
  white: number;
} {
  let black = 0;
  let white = 0;
  for (let r = 0; r < board.length; r += 1) {
    const row = board[r];
    if (!row) continue;
    for (let c = 0; c < row.length; c += 1) {
      const cell = row[c];
      if (cell === "black") black += 1;
      else if (cell === "white") white += 1;
    }
  }
  return { total: black + white, black, white };
}

/**
 * UUID v4 형식의 commandId를 생성합니다.
 */
export function generateCommandId(): CommandId {
  if (
    typeof globalThis.crypto !== "undefined" &&
    typeof globalThis.crypto.randomUUID === "function"
  ) {
    return globalThis.crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const rand = Math.floor(Math.random() * 16);
    const value = ch === "x" ? rand : (rand & 0x3) | 0x8;
    return value.toString(16);
  });
}

/**
 * 0부터 시작하는(0..14) 행·열 좌표로 오목 착수(place) 명령 페이로드를 생성합니다.
 * @throws RangeError 좌표가 보드 범위의 정수가 아닌 경우
 */
export function buildPlaceCommand(
  matchId: MatchId,
  expectedVersion: StateVersion,
  row: number,
  col: number,
  commandId: CommandId = generateCommandId(),
): GomokuCommand {
  if (!isValidGomokuCoord(row, col)) {
    throw new RangeError(
      `유효하지 않은 오목 좌표입니다: (${row}, ${col}). 0부터 ${GOMOKU_BOARD_SIZE - 1} 사이의 정수여야 합니다.`,
    );
  }
  const action: PlaceAction = {
    type: "place",
    row,
    col,
  };
  return {
    matchId,
    gameType: "gomoku",
    commandId,
    expectedVersion,
    action,
  };
}

/**
 * 오목 기권(resign) 명령 페이로드를 생성합니다.
 */
export function buildResignCommand(
  matchId: MatchId,
  expectedVersion: StateVersion,
  commandId: CommandId = generateCommandId(),
): GomokuCommand {
  const action: ResignAction = {
    type: "resign",
  };
  return {
    matchId,
    gameType: "gomoku",
    commandId,
    expectedVersion,
    action,
  };
}

/**
 * 수신된 snapshot의 stateVersion을 현재 snapshot과 비교하여 반영 여부를 결정합니다.
 *
 * - `game.updated`: 현재 stateVersion 이하(`<=`)인 갱신은 무시하고, 더 높은 경우(`>`)에만 반영합니다.
 * - `match.snapshot`: 현재 stateVersion보다 낮은(`<`) 스냅샷은 무시하고, 같거나 높은 경우(`>=`) 반영합니다.
 *   (일시정지/재개 전환은 stateVersion 증가 없이 status만 변경될 수 있기 때문)
 */
export function shouldAcceptSnapshot(
  currentSnapshot: GomokuSnapshot | null,
  incomingSnapshot: GomokuSnapshot,
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
 * 이전 snapshot과 새 snapshot의 보드를 비교하여 가장 최근에 놓인 돌의 위치를 찾습니다.
 * 승패나 금수 등 게임 규칙은 일절 계산하지 않고, 오직 화면에 최근 착수 위치를 표시하기 위해 사용합니다.
 */
export function detectPlacedMove(
  prevSnapshot: GomokuSnapshot | null,
  nextSnapshot: GomokuSnapshot,
  viewerUserId: PlayerId | null,
  prevLastMove: DetectedMove | null = null,
): DetectedMove | null {
  const diffCoords: Array<{ row: number; col: number; color: PlayerColor }> = [];

  if (prevSnapshot && prevSnapshot.matchId === nextSnapshot.matchId) {
    for (let r = 0; r < GOMOKU_BOARD_SIZE; r += 1) {
      for (let c = 0; c < GOMOKU_BOARD_SIZE; c += 1) {
        const before = prevSnapshot.board[r]?.[c] ?? null;
        const after = nextSnapshot.board[r]?.[c] ?? null;
        if (before === null && (after === "black" || after === "white")) {
          diffCoords.push({ row: r, col: c, color: after });
        }
      }
    }
  } else {
    // 첫 snapshot 수신 시 보드에 돌이 정확히 1개 놓여 있다면 첫 착수로 표시합니다.
    const allStones: Array<{ row: number; col: number; color: PlayerColor }> =
      [];
    for (let r = 0; r < GOMOKU_BOARD_SIZE; r += 1) {
      for (let c = 0; c < GOMOKU_BOARD_SIZE; c += 1) {
        const cell = nextSnapshot.board[r]?.[c] ?? null;
        if (cell === "black" || cell === "white") {
          allStones.push({ row: r, col: c, color: cell });
        }
      }
    }
    if (allStones.length === 1) {
      diffCoords.push(allStones[0]);
    }
  }

  if (diffCoords.length === 1) {
    const placed = diffCoords[0];
    const byPlayerId =
      placed.color === "black"
        ? nextSnapshot.players.black
        : nextSnapshot.players.white;
    const currentTurnPlayerId = getCurrentTurnPlayerId(nextSnapshot);
    const isOpponentMove =
      viewerUserId !== null
        ? byPlayerId !== viewerUserId
        : currentTurnPlayerId !== byPlayerId;

    return {
      row: placed.row,
      col: placed.col,
      color: placed.color,
      byPlayerId,
      isOpponentMove,
      stateVersion: nextSnapshot.stateVersion,
    };
  }

  // 새 돌이 놓이지 않은 상태 전이(예: paused/playing 전환, 기권/시간초과 종료)에서는 기존 마지막 착수를 유지합니다.
  if (prevLastMove) {
    const currentCell =
      nextSnapshot.board[prevLastMove.row]?.[prevLastMove.col] ?? null;
    if (currentCell === prevLastMove.color) {
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
 * 서버가 보낸 game.error 또는 error의 code에 따라 사용자에게 표시할 한국어 안내 문구를 반환합니다.
 */
export function getGameErrorMessage(
  code: string,
  fallbackMessage?: string,
): string {
  switch (code) {
    case "NOT_YOUR_TURN":
      return "상대방의 차례입니다. 내 차례가 될 때까지 기다려 주세요.";
    case "INVALID_ACTION":
      return "해당 위치에는 착수할 수 없습니다. 비어 있는 교차점(0~14)을 선택해 주세요.";
    case "VERSION_CONFLICT":
      return "대국 상태 버전이 일치하지 않습니다. 서버의 최신 스냅샷으로 동기화합니다.";
    case "GAME_NOT_ACTIVE":
      return "현재 대국이 진행 중이 아닙니다 (일시정지 또는 대기 중).";
    case "GAME_FINISHED":
      return "이미 종료된 대국입니다.";
    case "NOT_PARTICIPANT":
      return "이 대국의 참가자가 아니므로 착수할 수 없습니다.";
    case "NOT_FOUND":
      return "요청한 대국을 찾을 수 없습니다.";
    case "COMMAND_ID_CONFLICT":
      return "동일한 명령 ID로 다른 요청이 감지되었습니다. 다시 시도해 주세요.";
    case "NOT_SUBSCRIBED":
      return "대국 구독이 필요합니다. 대국 정보를 다시 구독합니다.";
    case "SESSION_REPLACED":
      return "다른 기기 또는 브라우저 탭에서 접속하여 현재 화면의 제어권이 이동되었습니다.";
    case "ALREADY_ACTIVE":
      return "이미 참가 중인 대국이 있거나 매칭 대기열에 등록되어 있습니다.";
    case "ALREADY_MATCHED":
      return "이미 매칭이 성사되어 대기열을 취소할 수 없습니다.";
    case "INVALID_MESSAGE":
    case "UNSUPPORTED_MESSAGE":
      return "요청 메시지 형식이 올바르지 않습니다.";
    case "INTERNAL_ERROR":
      return "서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.";
    default:
      return fallbackMessage?.trim() || "게임 요청 처리 중 오류가 발생했습니다.";
  }
}

/**
 * 초기 오목 클라이언트 상태를 생성합니다.
 */
export function createInitialGomokuClientState(
  viewerUserId: PlayerId | null = null,
  matchId: MatchId | null = null,
): GomokuClientState {
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
 * 서버로부터 수신한 snapshot(match.snapshot 또는 game.updated)을 상태에 반영합니다.
 * `game.updated`는 현재 버전 이하를, `match.snapshot`은 더 낮은 버전만 무시하고 ignoredUpdateCount를 증가시킵니다.
 */
export function applyIncomingSnapshot(
  state: GomokuClientState,
  incomingSnapshot: GomokuSnapshot,
  eventType: IncomingSnapshotEventType = "game.updated",
): GomokuClientState {
  if (!shouldAcceptSnapshot(state.snapshot, incomingSnapshot, eventType)) {
    return {
      ...state,
      ignoredUpdateCount: state.ignoredUpdateCount + 1,
    };
  }

  const nextLastMove = detectPlacedMove(
    state.snapshot,
    incomingSnapshot,
    state.viewerUserId,
    state.lastMove,
  );

  // 경기 상태가 playing 또는 finished로 전환되면 상대 끊김 배너를 정리합니다.
  const nextOpponentDisconnect =
    incomingSnapshot.status === "paused" ? state.opponentDisconnect : null;

  // 새로운 정상 착수 진행(game.updated)이 도착하면 이전 gameError를 해제합니다.
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
 * 명령 전송 직후 낙관적 보드 반영 없이 pendingCommand만 기록합니다.
 * (화면은 서버가 확정한 snapshot만 표시합니다.)
 */
export function markCommandPending(
  state: GomokuClientState,
  command: GomokuCommand,
): GomokuClientState {
  if (command.action.type !== "place" && command.action.type !== "resign") {
    return state;
  }
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
 * game.ack 수신 시 전송 대기 중이던 명령 상태를 정리합니다.
 */
export function applyGameAck(
  state: GomokuClientState,
  payload: {
    matchId: MatchId;
    commandId: CommandId;
    stateVersion: StateVersion;
    duplicate: boolean;
  },
): GomokuClientState {
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
export function applyGameError(
  state: GomokuClientState,
  errorPayload: {
    code: string;
    message: string;
    matchId?: MatchId;
    commandId?: CommandId;
    duplicate?: boolean;
  },
): GomokuClientState {
  return {
    ...state,
    pendingCommand: null,
    gameError: {
      code: errorPayload.code,
      message: getGameErrorMessage(errorPayload.code, errorPayload.message),
      serverMessage: errorPayload.message,
      matchId: errorPayload.matchId,
      commandId: errorPayload.commandId,
      duplicate: errorPayload.duplicate,
    },
  };
}

/**
 * 상대방 연결 끊김(player.disconnected) 이벤트를 상태에 반영합니다.
 */
export function applyPlayerDisconnected(
  state: GomokuClientState,
  payload: { matchId: MatchId; userId: PlayerId; remainingMs: number },
  nowMs: number = Date.now(),
): GomokuClientState {
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
 * 상대방 재접속(player.reconnected) 이벤트를 상태에 반영합니다.
 */
export function applyPlayerReconnected(
  state: GomokuClientState,
  payload: { matchId: MatchId; userId: PlayerId; remainingMs?: number },
): GomokuClientState {
  if (state.matchId !== null && state.matchId !== payload.matchId) {
    return state;
  }
  return {
    ...state,
    opponentDisconnect: null,
  };
}

/**
 * 자신의 WebSocket 연결 단계(연결됨, 재접속 중, 연결 끊김 등)를 상태에 반영합니다.
 */
export function applyConnectionPhase(
  state: GomokuClientState,
  phase: WsConnectionPhase,
  reconnectAttempt: number = state.reconnectAttempt,
): GomokuClientState {
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
export function applySessionReplaced(
  state: GomokuClientState,
  matchId: MatchId,
): GomokuClientState {
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
 * 현재 snapshot과 접속자 ID를 기반으로 차례(내 차례/상대 차례), 돌 색상, 조작 가능 여부를 계산합니다.
 */
export function deriveTurnPresentation(
  state: GomokuClientState,
): TurnPresentation {
  const {
    snapshot,
    viewerUserId,
    connectionPhase,
    sessionReplaced,
    pendingCommand,
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
      canPlaceStone: false,
      canResign: false,
      turnLabel: "대국 정보 동기화 중",
      turnDescription: "서버로부터 확정된 대국 스냅샷을 불러오고 있습니다.",
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

  const currentTurnPlayerId = getCurrentTurnPlayerId(snapshot);
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

  const canPlaceStone = Boolean(isMyTurn && isOnline && !pendingCommand);
  const canResign = Boolean(
    isParticipant && isPlaying && isOnline && !pendingCommand,
  );

  let turnLabel = "대국 대기 중";
  let turnDescription = "대국 시작을 기다리고 있습니다.";

  if (snapshot.status === "finished") {
    turnLabel = "대국 종료";
    turnDescription = "서버가 확정한 최종 대국 결과를 확인하세요.";
  } else if (snapshot.status === "paused") {
    turnLabel = "경기 일시정지";
    turnDescription =
      "상대방 연결이 끊어져 재접속을 기다리는 중입니다. 유예 시간 동안 착수가 잠깁니다.";
  } else if (isMyTurn) {
    const stoneKor = myColor === "black" ? "흑돌" : "백돌";
    turnLabel = "내 차례";
    turnDescription = `나의 착수 차례입니다 (${stoneKor}). 원하는 교차점을 선택해 돌을 놓으세요.`;
  } else if (isOpponentTurn) {
    const stoneKor = opponentColor === "black" ? "흑돌" : "백돌";
    turnLabel = "상대 차례";
    turnDescription = `상대방(${stoneKor})이 수를 고민하고 있습니다.`;
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
    canPlaceStone,
    canResign,
    turnLabel,
    turnDescription,
  };
}

const GOMOKU_REASON_META: Record<
  GomokuFinishedReason,
  { title: string; description: string }
> = {
  five_in_row: {
    title: "5목 완성",
    description:
      "가로, 세로, 또는 대각선으로 5개의 돌을 연속 배치하여 승리했습니다.",
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
    title: "무승부 (판이 가득 참)",
    description:
      "15×15 보드의 모든 교차점(225칸)이 채워져 무승부로 종료되었습니다.",
  },
  server_restart: {
    title: "무효 (서버 재시작)",
    description:
      "서버 재시작으로 인해 진행 중이던 경기가 무효(void) 처리되었습니다.",
  },
};

const ALL_GOMOKU_REASONS: readonly GomokuFinishedReason[] = [
  "five_in_row",
  "resign",
  "disconnect_timeout",
  "draw",
  "server_restart",
];

/**
 * 서버가 확정한 snapshot.status === "finished" 및 snapshot.result만을 기반으로
 * 결과 화면 표시 정보를 생성합니다.
 *
 * 보드 위에 5목이 놓여 있더라도 서버 snapshot이 finished 및 result를 확정한 경우가 아니면
 * 절대 클라이언트에서 승패를 직접 판정하지 않고 null을 반환합니다.
 */
export function describeGomokuResult(
  snapshot: GomokuSnapshot | null,
  viewerUserId: PlayerId | null,
): GomokuResultPresentation | null {
  if (!snapshot || snapshot.status !== "finished" || !snapshot.result) {
    return null;
  }

  const { outcome, winnerId, reason } = snapshot.result;
  const reasonMeta = GOMOKU_REASON_META[reason] ?? {
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

  let perspective: GomokuResultPresentation["perspective"] = "finished";
  let headline = "대국 종료";
  let subheadline = reasonMeta.description;
  let badgeText = "FINISHED";

  if (outcome === "draw") {
    perspective = "draw";
    headline = "Draw";
    badgeText = "DRAW";
    subheadline = `무승부 · ${reasonMeta.title}`;
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
      subheadline = `승리! · ${reasonMeta.title}`;
    } else if (isParticipant) {
      perspective = "defeat";
      headline = "Lose";
      badgeText = "LOSE";
      subheadline = `패배 · ${reasonMeta.title}`;
    } else {
      perspective = "finished";
      headline = "경기 종료";
      badgeText = "FINISHED";
      subheadline = `${reasonMeta.title}`;
    }
  }

  const criteria: GomokuReasonCriterion[] = ALL_GOMOKU_REASONS.map((item) => ({
    reason: item,
    title: GOMOKU_REASON_META[item].title,
    description: GOMOKU_REASON_META[item].description,
    active: item === reason,
  }));

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
    criteria,
  };
}

/**
 * 남은 재접속 유예 시간을 밀리초·초·`MM:SS` 문자열·진행률을 담은 객체로 변환합니다.
 */
export function formatRemainingGraceTime(remainingMs: number): {
  clampedMs: number;
  seconds: number;
  mmss: string;
  progressPercent: number;
} {
  const clampedMs = Math.max(
    0,
    Math.min(DISCONNECT_GRACE_TOTAL_MS, remainingMs),
  );
  const totalSeconds = Math.ceil(clampedMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  const mmss = `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  const progressPercent = Math.round(
    (clampedMs / DISCONNECT_GRACE_TOTAL_MS) * 100,
  );
  return {
    clampedMs,
    seconds: totalSeconds,
    mmss,
    progressPercent,
  };
}
