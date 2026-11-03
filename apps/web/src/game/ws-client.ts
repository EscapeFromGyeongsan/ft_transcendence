import type {
  GameType,
  GomokuCommand,
  GomokuSnapshot,
  PlayerId,
} from "@cafe/game-contracts";
import type {
  CommandId,
  MatchId,
  StateVersion,
  WsConnectionPhase,
} from "./gomoku-state.ts";

/** WebSocket 메시지 공통 엔벨로프 */
export interface WsEnvelope<TPayload = Record<string, unknown>> {
  type: string;
  requestId?: string;
  payload: TPayload;
}

/** 서버가 전송하는 auth.ok 페이로드 */
export interface WsAuthOkPayload {
  userId: PlayerId;
  activeMatchId: MatchId | null;
}

/** 서버가 전송하는 queue.matched 페이로드 */
export interface WsQueueMatchedPayload {
  matchId: MatchId;
  gameType: GameType;
}

/** 서버가 전송하는 game.ack 페이로드 */
export interface WsGameAckPayload {
  matchId: MatchId;
  commandId: CommandId;
  stateVersion: StateVersion;
  duplicate: boolean;
}

/** 서버가 전송하는 game.error 페이로드 */
export interface WsGameErrorPayload {
  code: string;
  message: string;
  matchId: MatchId;
  commandId: CommandId;
  duplicate?: boolean;
}

/** 서버가 전송하는 일반 error 페이로드 */
export interface WsGeneralErrorPayload {
  code: string;
  message: string;
  matchId?: MatchId;
}

/** 서버가 전송하는 player.disconnected 페이로드 */
export interface WsPlayerDisconnectedPayload {
  matchId: MatchId;
  userId: PlayerId;
  remainingMs: number;
}

/** 서버가 전송하는 player.reconnected 페이로드 */
export interface WsPlayerReconnectedPayload {
  matchId: MatchId;
  userId: PlayerId;
  remainingMs?: number;
}

/** 서버가 전송하는 session.replaced 페이로드 */
export interface WsSessionReplacedPayload {
  matchId: MatchId;
}

/** 테스트 주입 및 브라우저 호환을 위한 최소 WebSocket 인터페이스 */
export interface MinimalWebSocket {
  readonly readyState: number;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: string }) => void) | null;
  onclose: ((event: { code?: number; reason?: string }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

/** WebSocket 인스턴스 생성 팩토리 타입 */
export type WebSocketFactory = (url: string) => MinimalWebSocket;

/** 실시간 게임 WebSocket 클라이언트 이벤트 리스너 */
export interface GameWsClientHandlers {
  onPhaseChange?: (phase: WsConnectionPhase, reconnectAttempt: number) => void;
  onAuthOk?: (payload: WsAuthOkPayload) => void;
  onAuthFailed?: (reason: string) => void;
  onQueueJoined?: (payload: { gameType: GameType }) => void;
  onQueueLeft?: () => void;
  onQueueMatched?: (payload: WsQueueMatchedPayload) => void;
  onMatchSnapshot?: (snapshot: GomokuSnapshot) => void;
  onGameUpdated?: (snapshot: GomokuSnapshot) => void;
  onGameAck?: (payload: WsGameAckPayload) => void;
  onGameError?: (payload: WsGameErrorPayload) => void;
  onError?: (payload: WsGeneralErrorPayload) => void;
  onPlayerDisconnected?: (payload: WsPlayerDisconnectedPayload) => void;
  onPlayerReconnected?: (payload: WsPlayerReconnectedPayload) => void;
  onSessionReplaced?: (payload: WsSessionReplacedPayload) => void;
}

/** 실시간 게임 WebSocket 클라이언트 생성 옵션 */
export interface GameWsClientOptions {
  url?: string;
  getAccessToken: () => string | null;
  refreshAccessToken?: () => Promise<string | null>;
  createWebSocket?: WebSocketFactory;
  reconnectDelaysMs?: readonly number[];
  maxReconnectAttempts?: number;
  handlers?: GameWsClientHandlers;
}

/** 실시간 게임 WebSocket 클라이언트 제어 인터페이스 */
export interface GameWsClient {
  connect(): void;
  disconnect(): void;
  reconnectNow(): void;
  getPhase(): WsConnectionPhase;
  getSubscribedMatchId(): MatchId | null;
  setSubscribedMatchId(matchId: MatchId | null): void;
  joinQueue(gameType: GameType): boolean;
  leaveQueue(): boolean;
  subscribeMatch(matchId: MatchId): boolean;
  unsubscribeMatch(matchId: MatchId): boolean;
  sendGameCommand(command: GomokuCommand): boolean;
  sendPing(): boolean;
}

const WS_READY_STATE_OPEN = 1;
const DEFAULT_RECONNECT_DELAYS_MS = [600, 1200, 2400, 4000] as const;
const DEFAULT_MAX_RECONNECT_ATTEMPTS = 10;

/**
 * 현재 브라우저 위치(window.location)를 기준으로 `/api/ws` 엔드포인트 URL을 생성합니다.
 */
export function resolveDefaultWsUrl(): string {
  if (
    typeof globalThis.window !== "undefined" &&
    globalThis.window.location &&
    globalThis.window.location.host
  ) {
    const protocol =
      globalThis.window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${globalThis.window.location.host}/api/ws`;
  }
  return "ws://localhost:3000/api/ws";
}

/**
 * 수신된 객체가 서버가 확정한 오목 스냅샷(GomokuSnapshot) 구조인지 검증합니다.
 */
export function isGomokuSnapshotPayload(
  value: unknown,
): value is GomokuSnapshot {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.matchId === "number" &&
    candidate.gameType === "gomoku" &&
    typeof candidate.stateVersion === "number" &&
    typeof candidate.status === "string" &&
    Array.isArray(candidate.board) &&
    typeof candidate.players === "object" &&
    candidate.players !== null
  );
}

/**
 * `/api/ws` 실시간 WebSocket 연결·인증·재접속·대국 구독 및 명령 전송을 관리하는 클라이언트를 생성합니다.
 */
export function createGameWsClient(options: GameWsClientOptions): GameWsClient {
  const wsUrl = options.url ?? resolveDefaultWsUrl();
  const reconnectDelays =
    options.reconnectDelaysMs ?? DEFAULT_RECONNECT_DELAYS_MS;
  const maxReconnectAttempts =
    options.maxReconnectAttempts ?? DEFAULT_MAX_RECONNECT_ATTEMPTS;
  const createSocket: WebSocketFactory =
    options.createWebSocket ??
    ((url: string) => new globalThis.WebSocket(url) as unknown as MinimalWebSocket);

  let socket: MinimalWebSocket | null = null;
  let phase: WsConnectionPhase = "disconnected";
  let reconnectAttempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let manualDisconnect = false;
  let sessionReplaced = false;
  let subscribedMatchId: MatchId | null = null;
  let requestCounter = 0;

  function setPhase(nextPhase: WsConnectionPhase, attempt = reconnectAttempt) {
    phase = nextPhase;
    reconnectAttempt = attempt;
    options.handlers?.onPhaseChange?.(phase, reconnectAttempt);
  }

  function clearReconnectTimer() {
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  function nextRequestId(prefix: string): string {
    requestCounter += 1;
    return `${prefix}-${requestCounter}`;
  }

  function sendEnvelope(
    type: string,
    payload: Record<string, unknown>,
    requestId = nextRequestId(type),
  ): boolean {
    if (!socket || socket.readyState !== WS_READY_STATE_OPEN) {
      return false;
    }
    const envelope: WsEnvelope = {
      type,
      requestId,
      payload,
    };
    socket.send(JSON.stringify(envelope));
    return true;
  }

  function scheduleReconnect() {
    if (manualDisconnect || sessionReplaced) {
      return;
    }
    if (reconnectAttempt >= maxReconnectAttempts) {
      setPhase("disconnected", reconnectAttempt);
      return;
    }

    const nextAttempt = reconnectAttempt + 1;
    setPhase("reconnecting", nextAttempt);

    const delayIndex = Math.min(nextAttempt - 1, reconnectDelays.length - 1);
    const delayMs = reconnectDelays[delayIndex] ?? 1000;

    clearReconnectTimer();
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      openSocket(true);
    }, delayMs);
  }

  async function handleAuthCloseAndRetry() {
    if (manualDisconnect || sessionReplaced) {
      return;
    }
    if (options.refreshAccessToken) {
      try {
        setPhase("reconnecting", reconnectAttempt + 1);
        const refreshedToken = await options.refreshAccessToken();
        if (refreshedToken) {
          openSocket(true);
          return;
        }
      } catch {
        // 토큰 갱신 실패 시 인증 만료 처리
      }
    }
    setPhase("disconnected", reconnectAttempt);
    options.handlers?.onAuthFailed?.("인증 세션이 만료되었습니다. 다시 로그인해 주세요.");
  }

  function handleMessage(rawData: string) {
    let parsed: WsEnvelope<Record<string, unknown>>;
    try {
      parsed = JSON.parse(rawData) as WsEnvelope<Record<string, unknown>>;
    } catch {
      return;
    }

    if (!parsed || typeof parsed.type !== "string") {
      return;
    }

    const payload =
      typeof parsed.payload === "object" && parsed.payload !== null
        ? parsed.payload
        : {};

    switch (parsed.type) {
      case "auth.ok": {
        const userId = Number(payload.userId);
        const activeMatchId =
          typeof payload.activeMatchId === "number"
            ? payload.activeMatchId
            : null;
        setPhase("connected", 0);
        options.handlers?.onAuthOk?.({ userId, activeMatchId });

        // 재접속 또는 초기 연결 직후 구독 대상 대국이 있으면 즉시 match.subscribe 전송
        const targetMatchId = subscribedMatchId ?? activeMatchId;
        if (targetMatchId !== null) {
          subscribedMatchId = targetMatchId;
          sendEnvelope("match.subscribe", { matchId: targetMatchId });
        }
        break;
      }

      case "queue.joined": {
        const gameType =
          payload.gameType === "othello" ? "othello" : "gomoku";
        options.handlers?.onQueueJoined?.({ gameType });
        break;
      }

      case "queue.left": {
        options.handlers?.onQueueLeft?.();
        break;
      }

      case "queue.matched": {
        if (typeof payload.matchId === "number") {
          const gameType: GameType =
            payload.gameType === "othello" ? "othello" : "gomoku";
          subscribedMatchId = payload.matchId;
          options.handlers?.onQueueMatched?.({
            matchId: payload.matchId,
            gameType,
          });
          sendEnvelope("match.subscribe", { matchId: payload.matchId });
        }
        break;
      }

      case "match.snapshot": {
        if (isGomokuSnapshotPayload(payload)) {
          subscribedMatchId = payload.matchId;
          options.handlers?.onMatchSnapshot?.(payload);
        }
        break;
      }

      case "game.updated": {
        if (isGomokuSnapshotPayload(payload)) {
          options.handlers?.onGameUpdated?.(payload);
        }
        break;
      }

      case "game.ack": {
        if (
          typeof payload.matchId === "number" &&
          typeof payload.commandId === "string" &&
          typeof payload.stateVersion === "number"
        ) {
          options.handlers?.onGameAck?.({
            matchId: payload.matchId,
            commandId: payload.commandId,
            stateVersion: payload.stateVersion,
            duplicate: Boolean(payload.duplicate),
          });
        }
        break;
      }

      case "game.error": {
        const code =
          typeof payload.code === "string" ? payload.code : "UNKNOWN_ERROR";
        const message =
          typeof payload.message === "string"
            ? payload.message
            : "게임 명령 처리 중 오류가 발생했습니다.";
        const matchId =
          typeof payload.matchId === "number"
            ? payload.matchId
            : (subscribedMatchId ?? 0);
        const commandId =
          typeof payload.commandId === "string" ? payload.commandId : "";

        options.handlers?.onGameError?.({
          code,
          message,
          matchId,
          commandId,
          duplicate:
            typeof payload.duplicate === "boolean"
              ? payload.duplicate
              : undefined,
        });

        // 구독 누락 시 자동으로 match.subscribe 재전송
        if (code === "NOT_SUBSCRIBED" && matchId > 0) {
          sendEnvelope("match.subscribe", { matchId });
        }
        break;
      }

      case "error": {
        const code =
          typeof payload.code === "string" ? payload.code : "UNKNOWN_ERROR";
        const message =
          typeof payload.message === "string"
            ? payload.message
            : "요청 처리 중 오류가 발생했습니다.";
        const matchId =
          typeof payload.matchId === "number" ? payload.matchId : undefined;
        options.handlers?.onError?.({ code, message, matchId });
        break;
      }

      case "player.disconnected": {
        if (
          typeof payload.matchId === "number" &&
          typeof payload.userId === "number"
        ) {
          options.handlers?.onPlayerDisconnected?.({
            matchId: payload.matchId,
            userId: payload.userId,
            remainingMs:
              typeof payload.remainingMs === "number"
                ? payload.remainingMs
                : 60_000,
          });
        }
        break;
      }

      case "player.reconnected": {
        if (
          typeof payload.matchId === "number" &&
          typeof payload.userId === "number"
        ) {
          options.handlers?.onPlayerReconnected?.({
            matchId: payload.matchId,
            userId: payload.userId,
            remainingMs:
              typeof payload.remainingMs === "number"
                ? payload.remainingMs
                : undefined,
          });
        }
        break;
      }

      case "session.replaced": {
        const matchId =
          typeof payload.matchId === "number"
            ? payload.matchId
            : (subscribedMatchId ?? 0);
        sessionReplaced = true;
        clearReconnectTimer();
        setPhase("session_replaced", reconnectAttempt);
        options.handlers?.onSessionReplaced?.({ matchId });
        break;
      }

      default:
        break;
    }
  }

  function detachSocketListeners(target: MinimalWebSocket | null) {
    if (!target) return;
    target.onopen = null;
    target.onmessage = null;
    target.onclose = null;
    target.onerror = null;
  }

  function openSocket(isRetry: boolean) {
    clearReconnectTimer();
    const token = options.getAccessToken();
    if (!token) {
      setPhase("disconnected", reconnectAttempt);
      options.handlers?.onAuthFailed?.("인증 토큰이 없습니다.");
      return;
    }

    if (socket) {
      const prev = socket;
      detachSocketListeners(prev);
      socket = null;
      try {
        prev.close(1000, "reconnecting");
      } catch {
        // ignore close errors
      }
    }

    manualDisconnect = false;
    sessionReplaced = false;
    setPhase(isRetry ? "reconnecting" : "connecting", reconnectAttempt);

    let currentSocket: MinimalWebSocket;
    try {
      currentSocket = createSocket(wsUrl);
    } catch {
      scheduleReconnect();
      return;
    }

    socket = currentSocket;

    currentSocket.onopen = () => {
      if (socket !== currentSocket) return;
      const latestToken = options.getAccessToken() ?? token;
      setPhase(
        reconnectAttempt > 0 ? "reconnecting" : "authenticating",
        reconnectAttempt,
      );
      sendEnvelope("auth", { accessToken: latestToken }, "auth-init");
    };

    currentSocket.onmessage = (event) => {
      if (socket !== currentSocket) return;
      if (typeof event.data === "string") {
        handleMessage(event.data);
      }
    };

    currentSocket.onclose = (event) => {
      if (socket !== currentSocket) return;
      socket = null;

      if (manualDisconnect || sessionReplaced) {
        return;
      }

      if (event?.code === 4401) {
        void handleAuthCloseAndRetry();
        return;
      }

      scheduleReconnect();
    };

    currentSocket.onerror = () => {
      // onclose가 이어서 호출되므로 재접속 스케줄링은 onclose에서 일원화합니다.
    };
  }

  return {
    connect() {
      reconnectAttempt = 0;
      openSocket(false);
    },

    disconnect() {
      manualDisconnect = true;
      clearReconnectTimer();
      const current = socket;
      socket = null;
      detachSocketListeners(current);
      if (current) {
        try {
          current.close(1000, "client disconnect");
        } catch {
          // ignore
        }
      }
      setPhase("disconnected", 0);
    },

    reconnectNow() {
      manualDisconnect = false;
      sessionReplaced = false;
      clearReconnectTimer();
      openSocket(true);
    },

    getPhase() {
      return phase;
    },

    getSubscribedMatchId() {
      return subscribedMatchId;
    },

    setSubscribedMatchId(matchId: MatchId | null) {
      subscribedMatchId = matchId;
    },

    joinQueue(gameType: GameType) {
      if (phase !== "connected") return false;
      return sendEnvelope("queue.join", { gameType });
    },

    leaveQueue() {
      if (phase !== "connected") return false;
      return sendEnvelope("queue.leave", {});
    },

    subscribeMatch(matchId: MatchId) {
      subscribedMatchId = matchId;
      if (phase !== "connected") return false;
      return sendEnvelope("match.subscribe", { matchId });
    },

    unsubscribeMatch(matchId: MatchId) {
      if (subscribedMatchId === matchId) {
        subscribedMatchId = null;
      }
      if (phase !== "connected") return false;
      return sendEnvelope("match.unsubscribe", { matchId });
    },

    sendGameCommand(command: GomokuCommand) {
      if (phase !== "connected") return false;
      return sendEnvelope(
        "game.command",
        {
          matchId: command.matchId,
          gameType: command.gameType,
          commandId: command.commandId,
          expectedVersion: command.expectedVersion,
          action: command.action,
        },
        command.commandId,
      );
    },

    sendPing() {
      if (phase !== "connected") return false;
      return sendEnvelope("ping", {});
    },
  };
}

