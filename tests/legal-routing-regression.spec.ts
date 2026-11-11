import { expect, test, type Page, type WebSocketRoute } from "@playwright/test";
import type { GomokuSnapshot } from "@cafe/game-contracts";

// HTTP·WS 응답을 대체하여 약관 화면의 탐색과 snapshot 수신을 검증합니다.
async function mockActiveMatch(page: Page) {
  const tokens = {
    accessToken: "routing-access",
    refreshToken: "routing-refresh",
    tokenType: "Bearer",
    expiresIn: 1800,
  };
  await page.addInitScript((refreshToken) => {
    sessionStorage.setItem("cbc.auth.refreshToken", refreshToken);
  }, tokens.refreshToken);
  await page.route(
    (url) => url.pathname.startsWith("/api/"),
    async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/api/auth/refresh") {
        await route.fulfill({ json: tokens });
      } else if (path === "/api/users/me") {
        await route.fulfill({
          json: {
            id: 1,
            email: "routing@example.test",
            nickname: "routing-player",
            avatarUrl: null,
            createdAt: "2026-11-10T00:00:00.000Z",
          },
        });
      } else if (path === "/api/users/2") {
        await route.fulfill({
          json: { id: 2, nickname: "routing-opponent", avatarUrl: null },
        });
      } else {
        await route.fulfill({
          status: 404,
          json: { error: { code: "NOT_FOUND" } },
        });
      }
    },
  );

  const snapshot: GomokuSnapshot = {
    matchId: 42,
    gameType: "gomoku",
    rulesVersion: "gomoku-freestyle-v1",
    stateVersion: 0,
    status: "playing",
    players: { black: 1, white: 2 },
    board: Array.from({ length: 15 }, () => Array(15).fill(null)),
    currentPlayerId: 1,
    result: null,
  };
  const otherSnapshot: GomokuSnapshot = {
    ...snapshot,
    matchId: 43,
    stateVersion: 2,
    board: snapshot.board.map((row) => [...row]),
  };
  otherSnapshot.board[0][0] = "black";
  otherSnapshot.board[0][1] = "white";
  let socket: WebSocketRoute | undefined;
  const subscriptions: number[] = [];
  const unsubscriptions: number[] = [];
  const commands: Record<string, unknown>[] = [];
  let observedSubscriptions = 0;
  await page.routeWebSocket("**/api/ws", (ws) => {
    socket = ws;
    ws.onMessage((raw) => {
      const message = JSON.parse(String(raw)) as {
        type: string;
        payload: Record<string, unknown>;
      };
      if (message.type === "auth") {
        ws.send(
          JSON.stringify({
            v: 1,
            type: "auth.ok",
            payload: { userId: 1, activeMatchId: 42 },
          }),
        );
      } else if (message.type === "match.subscribe") {
        const requestedSnapshot =
          message.payload.matchId === 42
            ? snapshot
            : message.payload.matchId === 43
              ? otherSnapshot
              : undefined;
        if (!requestedSnapshot) return;
        subscriptions.push(requestedSnapshot.matchId);
        ws.send(
          JSON.stringify({
            v: 1,
            type: "match.snapshot",
            payload: requestedSnapshot,
          }),
        );
      } else if (message.type === "match.unsubscribe") {
        if (typeof message.payload.matchId === "number") {
          unsubscriptions.push(message.payload.matchId);
        }
      } else if (message.type === "game.command") {
        commands.push(message.payload);
      } else if (message.type === "ping") {
        ws.send(JSON.stringify({ v: 1, type: "pong", payload: {} }));
      }
    });
  });
  return {
    subscriptions,
    unsubscriptions,
    commands,
    async waitForSnapshot() {
      await expect
        .poll(() => subscriptions.length)
        .toBeGreaterThan(observedSubscriptions);
      observedSubscriptions = subscriptions.length;
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
    },
    async sendMoveSnapshot() {
      snapshot.board[0][0] = "black";
      snapshot.stateVersion = 1;
      snapshot.currentPlayerId = 2;
      socket?.send(
        JSON.stringify({ v: 1, type: "match.snapshot", payload: snapshot }),
      );
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
    },
  };
}

for (const kind of ["terms", "privacy"] as const) {
  test(`활성 대국이 있어도 /${kind} 직접 접근·새로고침 화면을 유지한다`, async ({
    page,
  }) => {
    const match = await mockActiveMatch(page);
    await page.goto(`/${kind}`);
    await match.waitForSnapshot();
    await expect(page).toHaveURL(new RegExp(`/${kind}$`));
    await expect(page.getByTestId("legal-document-view")).toHaveAttribute(
      "data-legal-doc",
      kind,
    );
    const restored = page.waitForResponse("**/api/users/me");
    await page.reload();
    await restored;
    await match.waitForSnapshot();
    await expect(page).toHaveURL(new RegExp(`/${kind}$`));
    await expect(page.getByTestId("legal-document-view")).toHaveAttribute(
      "data-legal-doc",
      kind,
    );
  });
}

test("대국 중 약관을 열어도 snapshot은 판만 갱신하고 뒤로·앞으로 가기를 보존한다", async ({
  page,
}) => {
  const match = await mockActiveMatch(page);
  await page.goto("/match/42");
  await match.waitForSnapshot();
  await expect(page.getByTestId("gomoku-match-view")).toBeVisible();
  await page.getByTestId("footer-link-terms").click();
  await expect(page).toHaveURL(/\/terms$/);
  await match.sendMoveSnapshot();
  await expect(page.getByTestId("legal-document-view")).toHaveAttribute(
    "data-legal-doc",
    "terms",
  );
  await page.getByTestId("tab-legal-privacy").click();
  await expect(page).toHaveURL(/\/privacy$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/terms$/);
  await expect(page.getByTestId("legal-document-view")).toHaveAttribute(
    "data-legal-doc",
    "terms",
  );
  await page.goBack();
  await expect(page).toHaveURL(/\/match\/42$/);
  await expect(
    page.locator('button[data-row="0"][data-col="0"]'),
  ).toHaveAttribute("aria-label", /흑/);
  await page.goForward();
  await expect(page).toHaveURL(/\/terms$/);
  await page.goForward();
  await expect(page).toHaveURL(/\/privacy$/);
});

test("다른 대국의 뒤로·앞으로 가기는 URL과 판·구독·착수 대상을 일치시킨다", async ({
  page,
}) => {
  const match = await mockActiveMatch(page);
  const firstCell = page.locator('button[data-row="0"][data-col="0"]');
  const secondCell = page.locator('button[data-row="0"][data-col="1"]');
  await page.goto("/match/42");
  await match.waitForSnapshot();
  await expect(firstCell).toHaveAttribute("data-cell-state", "empty");

  await page.getByTestId("leave-match-btn").click();
  await expect(page).toHaveURL(/\/$/);
  await page.locator("#matchIdInput").fill("43");
  await page.getByRole("button", { name: "대국실 입장", exact: true }).click();
  await match.waitForSnapshot();
  await expect(page).toHaveURL(/\/match\/43$/);
  expect(match.subscriptions.at(-1)).toBe(43);
  await expect(firstCell).toHaveAttribute("data-cell-state", "black");
  await expect(secondCell).toHaveAttribute("data-cell-state", "white");

  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator("#matchIdInput")).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/match\/42$/);
  await match.waitForSnapshot();
  expect(match.subscriptions.at(-1)).toBe(42);
  await expect.poll(() => match.unsubscriptions).toContain(43);
  await expect(firstCell).toHaveAttribute("data-cell-state", "empty");
  await expect(secondCell).toHaveAttribute("data-cell-state", "empty");
  await firstCell.click();
  await expect
    .poll(() => match.commands.at(-1))
    .toMatchObject({
      matchId: 42,
      expectedVersion: 0,
      action: { type: "place", row: 0, col: 0 },
    });

  await page.goForward();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator("#matchIdInput")).toBeVisible();
  await page.goForward();
  await expect(page).toHaveURL(/\/match\/43$/);
  await match.waitForSnapshot();
  expect(match.subscriptions.at(-1)).toBe(43);
  await expect(firstCell).toHaveAttribute("data-cell-state", "black");
  await expect(secondCell).toHaveAttribute("data-cell-state", "white");
});

test("360px 개인정보 화면은 가로 넘침 없이 푸터 약관 링크를 누를 수 있다", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  const match = await mockActiveMatch(page);
  await page.goto("/privacy");
  await match.waitForSnapshot();
  await expect(page.getByTestId("legal-document-view")).toHaveAttribute(
    "data-legal-doc",
    "privacy",
  );
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      ),
    )
    .toBeLessThanOrEqual(0);
  await page.getByTestId("footer-link-terms").click();
  await expect(page).toHaveURL(/\/terms$/);
  await expect(page.getByTestId("legal-document-view")).toHaveAttribute(
    "data-legal-doc",
    "terms",
  );
});
