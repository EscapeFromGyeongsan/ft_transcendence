import { devices, expect, test } from "@playwright/test";

test("two browsers join, synchronize turns, reconnect and finish a match", async ({
  browser,
}, testInfo) => {
  const options =
    testInfo.project.name === "mobile"
      ? devices["Pixel 7"]
      : devices["Desktop Chrome"];
  const hostContext = await browser.newContext(options);
  const guestContext = await browser.newContext(options);
  const origin = testInfo.project.use.baseURL!;
  for (const [context, name] of [
    [hostContext, "흑돌"],
    [guestContext, "백돌"],
  ] as const) {
    const response = await context.request.post(`${origin}/api/auth/register`, {
      headers: { origin },
      data: {
        email: `${name === "흑돌" ? "black" : "white"}-${testInfo.project.name}-${Date.now()}@example.com`,
        password: "test password long enough",
        displayName: name,
      },
    });
    expect(response.status()).toBe(201);
  }
  await guestContext.addInitScript(() => {
    const OriginalWebSocket = window.WebSocket;
    const sockets: WebSocket[] = [];
    Object.assign(window, { testSockets: sockets });
    window.WebSocket = class extends OriginalWebSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        sockets.push(this);
      }
    };
  });
  const host = await hostContext.newPage(),
    guest = await guestContext.newPage();
  try {
    await guest.goto(new URL("/", testInfo.project.use.baseURL).href);
    await guest.getByRole("link", { name: "게임 로비", exact: true }).click();
    await host.goto(new URL("/", testInfo.project.use.baseURL).href);
    await host.getByRole("link", { name: "온라인 오목 시작하기" }).click();
    await host.getByRole("button", { name: "＋ 온라인 방 만들기" }).click();
    const dialog = host.getByRole("dialog");
    await dialog
      .getByLabel(/^방 이름/)
      .fill(`두 브라우저 대국 ${testInfo.project.name}`);
    await expect(dialog.getByLabel("방장 이름")).toHaveValue("흑돌");
    await expect(dialog.getByLabel("방장 이름")).toHaveAttribute(
      "readonly",
      "",
    );
    await dialog
      .getByRole("button", { name: "방 만들기 ↗", exact: true })
      .click();
    await expect(
      host.getByRole("heading", { name: /두 브라우저 대국/ }),
    ).toBeVisible();
    await expect(host.getByLabel("두 번째 플레이어 이름")).toHaveCount(0);
    await expect(
      host.getByRole("button", { name: "준비하기", exact: true }),
    ).toHaveCount(1);
    await guest
      .getByRole("article")
      .filter({ hasText: `두 브라우저 대국 ${testInfo.project.name}` })
      .getByRole("link", { name: "방 열기" })
      .click();

    await guest.getByRole("button", { name: "입장하기" }).click();
    await expect(host.getByRole("heading", { name: /백돌/ })).toBeVisible();
    const anotherTab = await hostContext.newPage();
    await anotherTab.goto(host.url());
    await expect(
      anotherTab.getByRole("heading", { name: "흑돌 (나)", exact: true }),
    ).toBeVisible();
    await expect(
      anotherTab.getByRole("button", { name: "입장하기" }),
    ).toHaveCount(0);
    await anotherTab.close();
    await host.getByRole("button", { name: "준비하기" }).click();
    await expect(
      host.getByRole("button", { name: /대국 시작하기/ }),
    ).toBeDisabled();
    await expect(
      host.getByRole("button", { name: "준비하기", exact: true }),
    ).toHaveCount(0);
    await expect(
      guest.getByRole("button", { name: "준비하기", exact: true }),
    ).toHaveCount(1);
    await guest.getByRole("button", { name: "준비하기" }).click();
    await host.getByRole("button", { name: /대국 시작하기/ }).click();
    await expect(guest.getByRole("status")).toContainText("흑돌 차례");
    await host.getByRole("button", { name: /^H8, 빈 자리/ }).click();
    await expect(
      guest.getByRole("button", { name: /^H8, 흑돌/ }),
    ).toBeVisible();
    await host.getByRole("button", { name: /^I8, 빈 자리/ }).click();
    await expect(host.getByRole("alert")).toContainText("상대의 차례");
    await guest.evaluate(() => {
      const sockets = (window as unknown as { testSockets: WebSocket[] })
        .testSockets;
      sockets
        .filter(
          (socket) =>
            socket.url.includes("/api/rooms/") &&
            socket.readyState === WebSocket.OPEN,
        )
        .forEach((socket) => socket.close());
    });
    await expect(
      guest.getByText("서버에 연결 중이에요.", { exact: false }),
    ).toBeVisible();
    await expect(
      guest.getByText("서버와 연결됐어요.", { exact: true }),
    ).toBeVisible();
    await guest.reload();
    await expect(
      guest.getByRole("button", { name: /^H8, 흑돌/ }),
    ).toBeVisible();
    await guest.getByRole("button", { name: /^I8, 빈 자리/ }).click();
    await expect(host.getByRole("button", { name: /^I8, 백돌/ })).toBeVisible();
    host.once("dialog", (dialog) => void dialog.dismiss());
    await host.getByRole("button", { name: "기권하기" }).click();
    await expect(host.getByRole("alert", { includeHidden: true })).toBeEmpty();
    await expect(host.getByRole("status")).toContainText("흑돌 차례");
    host.once("dialog", (dialog) => void dialog.accept());
    await host.getByRole("button", { name: "기권하기" }).click();
    await expect(guest.getByRole("status")).toContainText("백돌 승리");
    const historyTab = await hostContext.newPage();
    await historyTab.goto(`${origin}/#/history`);
    await expect(historyTab.getByLabel("전적 요약")).toContainText("0승 · 1패");
    await expect(
      historyTab.getByRole("heading", { name: "패배 · 상대 백돌" }),
    ).toBeVisible();
    await historyTab.reload();
    await expect(historyTab.getByLabel("전적 요약")).toContainText("총 1경기");
    await historyTab.close();
    await host.getByRole("button", { name: "재대국 준비하기" }).click();
    await expect(guest.getByRole("button", { name: "준비하기" })).toBeVisible();
    host.once("dialog", (dialog) => void dialog.accept());
    await host.getByRole("button", { name: "방 닫기" }).click();
    await expect(host).toHaveURL(/#\/online$/);
    await expect(guest.getByRole("alert")).toHaveText("방이 닫혔어요.");
  } finally {
    await hostContext.close();
    await guestContext.close();
  }
});
