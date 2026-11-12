import type { Page, WebSocketRoute } from "@playwright/test";
import type { AuthUser } from "../../apps/web/src/api/auth-client.ts";
import type { FriendsList } from "../../apps/web/src/api/friends-api.ts";

/** Synthetic contract data only. This fixture does not exercise the #69 server. */
export async function installFriendsFixture(page: Page, signedIn = true) {
  let account: AuthUser = {
    id: 501,
    nickname: "contract_viewer_with_a_long_name",
    email: "first@example.test",
    avatarUrl: null,
    recordsPublic: true,
    createdAt: "2026-11-09T00:00:00.000Z",
  };
  const people = [
    { userId: 201, nickname: "온라인친구", avatarUrl: null },
    { userId: 202, nickname: "받은친구", avatarUrl: null },
    { userId: 203, nickname: "거절친구", avatarUrl: null },
    { userId: 204, nickname: "보낸친구", avatarUrl: null },
    { userId: 205, nickname: "새친구", avatarUrl: null },
    { userId: 206, nickname: "차단친구", avatarUrl: null },
  ];
  const request = (index: number, requestId: number) => ({
    ...people[index],
    requestId,
    createdAt: "2026-11-09T00:00:00.000Z",
  });
  let list: FriendsList = {
    friends: [{ ...people[0], online: true }],
    incoming: [request(1, 42), request(2, 43)],
    outgoing: [request(3, 44)],
  };
  let failRead = false;
  let nextRead: ReturnType<typeof barrier> | null = null;
  let nextWrite: ReturnType<typeof barrier> | null = null;
  let writes = 0;
  let reads = 0;
  const sockets = new Set<WebSocketRoute>();
  const pair = {
    accessToken: "contract-access",
    refreshToken: "contract-refresh",
    tokenType: "Bearer",
    expiresIn: 1800,
  };
  if (signedIn)
    await page.addInitScript(() => {
      if (!sessionStorage.getItem("friends-fixture-seeded")) {
        localStorage.setItem(
          "cyber_board_cafe.auth.tokens",
          JSON.stringify({
            accessToken: "contract-access",
            refreshToken: "contract-refresh",
          }),
        );
        sessionStorage.setItem("friends-fixture-seeded", "yes");
      }
    });
  await page.routeWebSocket("**/api/ws", (socket) => {
    sockets.add(socket);
    socket.onClose(() => sockets.delete(socket));
    socket.onMessage((raw) => {
      const message = JSON.parse(String(raw));
      if (message.type === "auth")
        socket.send(
          JSON.stringify({
            type: "auth.ok",
            payload: { userId: account.id, activeMatchId: null },
          }),
        );
      if (message.type === "ping")
        socket.send(JSON.stringify({ type: "pong", payload: {} }));
    });
  });
  await page.route("**/api/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    // Vite also serves /src/api/*.ts; only replace actual REST endpoints.
    if (!path.startsWith("/api/")) return route.continue();
    const error = (status: number, code: string) =>
      route.fulfill({ status, json: { error: { code, message: code } } });
    if (path === "/api/users/me") return route.fulfill({ json: account });
    if (path === "/api/auth/login") {
      if (req.postDataJSON().email === "second@example.test")
        account = {
          ...account,
          id: 502,
          nickname: "second_viewer",
          email: "second@example.test",
        };
      return route.fulfill({ json: pair });
    }
    if (path === "/api/auth/refresh") return route.fulfill({ json: pair });
    if (path === "/api/auth/logout") return route.fulfill({ status: 204 });
    if (path === "/api/friends" && req.method() === "GET") {
      reads++;
      const snapshot = structuredClone(
        account.id === 502 ? { friends: [], incoming: [], outgoing: [] } : list,
      );
      const held = nextRead;
      nextRead = null;
      if (held) {
        held.started();
        await held.wait;
      }
      if (failRead) {
        failRead = false;
        return error(503, "SERVICE_UNAVAILABLE");
      }
      return route.fulfill({ json: snapshot });
    }
    if (path === "/api/users")
      return route.fulfill({
        json: people
          .filter((p) =>
            p.nickname.startsWith(url.searchParams.get("nickname") ?? ""),
          )
          .map(({ userId, ...p }) => ({ ...p, id: userId })),
      });
    if (path.startsWith("/api/friends/")) {
      writes++;
      const held = nextWrite;
      nextWrite = null;
      if (held) {
        held.started();
        await held.wait;
      }
      if (path === "/api/friends/requests") {
        const userId = req.postDataJSON().userId;
        if (userId === 206) return error(409, "REQUEST_DECLINED");
        const person = people.find((p) => p.userId === userId)!;
        list.outgoing.push({
          ...person,
          requestId: 55,
          createdAt: "2026-11-09T00:00:00.000Z",
        });
        return route.fulfill({
          status: 201,
          json: { ...person, requestId: 55, status: "pending" },
        });
      }
      const match = /\/requests\/(\d+)\/(accept|decline)$/.exec(path);
      if (match) {
        const found = list.incoming.find(
          (p) => p.requestId === Number(match[1]),
        );
        if (!found) return error(404, "NOT_FOUND");
        list.incoming = list.incoming.filter(
          (p) => p.requestId !== found.requestId,
        );
        if (match[2] === "decline") return route.fulfill({ status: 204 });
        list.friends.push({
          userId: found.userId,
          nickname: found.nickname,
          avatarUrl: found.avatarUrl,
          online: true,
        });
        return route.fulfill({ json: { ...found, status: "accepted" } });
      }
      if (req.method() === "DELETE") {
        list.friends = list.friends.filter(
          (p) => p.userId !== Number(path.split("/").at(-1)),
        );
        return route.fulfill({ status: 204 });
      }
    }
    const profile = /^\/api\/users\/(\d+)(?:\/(stats|matches))?$/.exec(path);
    if (profile) {
      const person = people.find((p) => p.userId === Number(profile[1]))!;
      if (profile[2] === "matches")
        return route.fulfill({ json: { matches: [], nextBefore: null } });
      if (profile[2] === "stats")
        return route.fulfill({
          json: {
            userId: person.userId,
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
      return route.fulfill({
        json: {
          id: person.userId,
          nickname: person.nickname,
          avatarUrl: person.avatarUrl,
        },
      });
    }
    return error(404, "NOT_FOUND");
  });
  return {
    getWrites: () => writes,
    getReads: () => reads,
    setOnline(userId: number, online: boolean | null) {
      list.friends.find((person) => person.userId === userId)!.online = online;
    },
    removeFriend(userId: number) {
      list.friends = list.friends.filter((person) => person.userId !== userId);
    },
    notify(
      type: "presence" | "friends.changed",
      payload: Record<string, unknown>,
    ) {
      for (const socket of sockets)
        socket.send(JSON.stringify({ type, payload }));
    },
    failNextRead: () => {
      failRead = true;
    },
    holdNextRead: () => {
      nextRead = barrier();
      return nextRead;
    },
    holdNextWrite: () => {
      nextWrite = barrier();
      return nextWrite;
    },
  };
}

function barrier() {
  let release!: () => void;
  let started!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  const didStart = new Promise<void>((resolve) => {
    started = resolve;
  });
  return { wait, release, started, didStart };
}
