import type { Page, WebSocketRoute } from "@playwright/test";
import type { GameSnapshot, GameType } from "@cafe/game-contracts";

/** Synthetic HTTP/WS contracts for #136 UI failures; not real OAuth or DB evidence. */
export async function installEvaluationFixture(
  page: Page,
  options: {
    signedIn?: boolean;
    gameType?: GameType;
    invalidMatch?: "NOT_FOUND" | "NOT_PARTICIPANT";
    queueError?: string;
    callback?: "linked" | "twoFactor" | "failed";
    holdLogout?: boolean;
    logoutFails?: boolean;
    holdDisable?: boolean;
  } = {},
) {
  const user = {
    id: 1,
    email: "evaluation@example.test",
    nickname: "평가사용자",
    avatarUrl: null,
    recordsPublic: true,
    hasPassword: true,
    oauth42Linked: false,
    createdAt: "2026-11-13T00:00:00.000Z",
  };
  const tokens = {
    accessToken: "evaluation-access",
    refreshToken: "evaluation-refresh",
    tokenType: "Bearer",
    expiresIn: 1800,
  };
  const requests: string[] = [];
  const commands: { type: string; payload: Record<string, unknown> }[] = [];
  const sockets = new Set<WebSocketRoute>();
  let logoutRelease: () => void = () => {};
  const logoutGate = new Promise<void>((resolve) => {
    logoutRelease = resolve;
  });
  let disableRelease: () => void = () => {};
  const disableGate = new Promise<void>((resolve) => {
    disableRelease = resolve;
  });
  const gameType = options.gameType ?? "gomoku";
  const size = gameType === "othello" ? 8 : 15;
  const board: GameSnapshot["board"] = Array.from({ length: size }, () =>
    Array(size).fill(null),
  );
  if (gameType === "othello") {
    board[3][3] = board[4][4] = "white";
    board[3][4] = board[4][3] = "black";
  }
  const snapshot: GameSnapshot = {
    matchId: 201,
    gameType,
    rulesVersion:
      gameType === "othello" ? "othello-standard-v1" : "gomoku-freestyle-v1",
    stateVersion: 1,
    status: "playing",
    players: { black: 1, white: 2 },
    board,
    currentPlayerId: 1,
    result: null,
  };
  await page.addInitScript(
    ({ signedIn, refreshToken }) => {
      if (!sessionStorage.getItem("evaluation-seeded")) {
        if (signedIn)
          sessionStorage.setItem("cbc.auth.refreshToken", refreshToken);
        sessionStorage.setItem("evaluation-seeded", "yes");
      }
      if (
        location.pathname === "/oauth/42/callback" &&
        !sessionStorage.getItem("evaluation-flow-seeded")
      ) {
        sessionStorage.setItem(
          "cyber_board_cafe.oauth42.flow_token",
          "evaluation-flow",
        );
        sessionStorage.setItem("evaluation-flow-seeded", "yes");
      }
    },
    { signedIn: options.signedIn !== false, refreshToken: tokens.refreshToken },
  );
  const send = (
    socket: WebSocketRoute,
    type: string,
    payload: unknown,
    requestId?: string,
  ) => socket.send(JSON.stringify({ v: 1, type, payload, requestId }));
  await page.routeWebSocket("**/api/ws", (socket) => {
    sockets.add(socket);
    socket.onClose(() => sockets.delete(socket));
    socket.onMessage((raw) => {
      const message = JSON.parse(String(raw));
      commands.push(message);
      if (message.type === "auth")
        send(socket, "auth.ok", {
          userId: 1,
          activeMatchId: options.gameType ? 201 : null,
        });
      else if (message.type === "ping") send(socket, "pong", {});
      else if (message.type === "match.subscribe") {
        if (options.invalidMatch)
          send(
            socket,
            "error",
            {
              code: options.invalidMatch,
              message: "Match unavailable.",
              matchId: message.payload.matchId,
            },
            message.requestId,
          );
        else send(socket, "match.snapshot", snapshot, message.requestId);
      } else if (message.type === "queue.join") {
        if (options.queueError)
          send(
            socket,
            "error",
            { code: options.queueError, message: "Queue rejected." },
            message.requestId,
          );
        else send(socket, "queue.joined", message.payload, message.requestId);
      } else if (message.type === "queue.leave")
        send(socket, "queue.left", {}, message.requestId);
    });
  });
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    requests.push(`${request.method()} ${path}`);
    if (path === "/api/auth/refresh" || path === "/api/auth/login")
      return route.fulfill({ json: tokens });
    if (path === "/api/auth/logout") {
      if (options.holdLogout) await logoutGate;
      return route.fulfill(
        options.logoutFails
          ? {
              status: 503,
              json: {
                error: { code: "SERVICE_UNAVAILABLE", message: "Unavailable." },
              },
            }
          : { status: 204 },
      );
    }
    if (path === "/api/auth/oauth/42/callback") {
      if (options.callback === "failed")
        return route.fulfill({
          status: 401,
          json: {
            error: { code: "OAUTH_STATE_INVALID", message: "Invalid state." },
          },
        });
      if (options.callback === "linked") {
        user.oauth42Linked = true;
        return route.fulfill({ json: { linked: true } });
      }
      if (options.callback === "twoFactor")
        return route.fulfill({
          json: {
            twoFactorRequired: true,
            challengeToken: "challenge",
            expiresIn: 300,
          },
        });
      return route.fulfill({ json: tokens });
    }
    if (path === "/api/users/me") {
      if (request.method() === "PATCH") {
        Object.assign(user, request.postDataJSON());
        const {
          hasPassword: _password,
          oauth42Linked: _linked,
          ...updated
        } = user;
        return route.fulfill({ json: updated });
      }
      return route.fulfill({ json: user });
    }
    if (path === "/api/auth/2fa")
      return route.fulfill({ json: { enabled: true } });
    if (path === "/api/auth/2fa/disable") {
      if (options.holdDisable) await disableGate;
      return route.fulfill({ status: 204 });
    }
    if (/\/stats$/.test(path))
      return route.fulfill({
        json: {
          userId: 1,
          gameType: url.searchParams.get("gameType"),
          wins: 0,
          losses: 0,
          draws: 0,
          played: 0,
          winRate: 0,
          achievements: { firstWin: false },
          progress: { current: 0, target: 10 },
        },
      });
    if (/\/matches$/.test(path))
      return route.fulfill({ json: { matches: [], nextBefore: null } });
    if (path === "/api/leaderboard") return route.fulfill({ json: [] });
    if (path === "/api/friends")
      return route.fulfill({
        json: { friends: [], incoming: [], outgoing: [] },
      });
    if (/^\/api\/users\/\d+$/.test(path))
      return route.fulfill({
        json: {
          id: Number(path.split("/").at(-1)),
          nickname: "상대방",
          avatarUrl: null,
        },
      });
    return route.fulfill({
      status: 404,
      json: { error: { code: "NOT_FOUND", message: "Not found." } },
    });
  });
  return {
    user,
    requests,
    commands,
    releaseLogout: logoutRelease,
    releaseDisable: disableRelease,
    send(type: string, payload: unknown) {
      for (const socket of sockets) send(socket, type, payload);
    },
  };
}
