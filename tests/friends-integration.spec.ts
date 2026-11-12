import { expect, test, type Page } from "@playwright/test";
import { register } from "./helpers/accounts.ts";

test("실제 두 계정의 친구 관계·온라인·새 요청 ID를 검증한다", async ({
  page,
  browser,
  baseURL,
}) => {
  test.skip(
    !process.env.E2E_FRIENDS_INTEGRATION,
    "Requires the documented #95/#98 integration candidate and a dedicated DB.",
  );
  test.setTimeout(90_000);
  const firstLogin = page.waitForResponse("**/api/auth/login");
  const first = await register(page, "friendA");
  const firstToken = (await (await firstLogin).json()).accessToken as string;
  const firstContext = page.context();
  const secondContext = await browser.newContext({
    baseURL,
    viewport: page.viewportSize() ?? undefined,
  });
  const presence: boolean[] = [];
  let owner = page;
  try {
    const other = await secondContext.newPage();
    other.on("websocket", (socket) =>
      socket.on("framereceived", ({ payload }) => {
        const message = JSON.parse(String(payload));
        if (message.type === "presence" && message.payload.userId === first.id)
          presence.push(message.payload.online);
      }),
    );
    const secondLogin = other.waitForResponse("**/api/auth/login");
    const second = await register(other, "friendB");
    const secondToken = (await (await secondLogin).json())
      .accessToken as string;
    for (const player of [owner, other]) {
      await player
        .getByTestId("lobby-view")
        .getByRole("button", { name: "친구 관리", exact: true })
        .click();
      await expect(
        player.getByText("아직 친구가 없습니다.", { exact: true }),
      ).toBeVisible();
    }

    const send = async (player: Page, nickname: string) => {
      await player.getByLabel("닉네임으로 검색").fill(nickname);
      await player.getByRole("button", { name: "검색", exact: true }).click();
      const result = player.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === "/api/friends/requests" &&
          response.request().method() === "POST",
      );
      await player
        .getByRole("list", { name: "검색 결과" })
        .getByRole("button", { name: "친구 요청", exact: true })
        .click();
      const response = await result;
      expect(response.status()).toBe(201);
      return (await response.json()) as { requestId: number };
    };
    const initial = await send(owner, second.nickname);
    const incoming = other.getByRole("list", {
      name: "받은 요청",
      exact: true,
    });
    await expect(
      incoming.getByText(first.nickname, { exact: true }),
    ).toBeVisible();
    await incoming.getByRole("button", { name: "수락", exact: true }).click();
    const friends = other.getByRole("list", { name: "친구 목록", exact: true });
    await expect(friends.getByText("온라인", { exact: true })).toBeVisible();
    await expect(
      owner
        .getByRole("list", { name: "친구 목록", exact: true })
        .getByText(second.nickname, { exact: true }),
    ).toBeVisible();

    const extra = await firstContext.newPage();
    await extra.goto("/friends");
    await expect(
      extra
        .getByRole("list", { name: "친구 목록", exact: true })
        .getByText("온라인", { exact: true }),
    ).toBeVisible();
    await owner.close();
    await expect(friends.getByText("온라인", { exact: true })).toBeVisible();
    await extra.close();
    await expect(friends.getByText("오프라인", { exact: true })).toBeVisible();
    owner = await firstContext.newPage();
    await owner.goto("/friends");
    await expect(friends.getByText("온라인", { exact: true })).toBeVisible();
    await expect(
      owner
        .getByRole("list", { name: "친구 목록", exact: true })
        .getByText(second.nickname, { exact: true }),
    ).toBeVisible();
    expect(presence).toEqual([false, true]);

    await friends
      .getByRole("button", { name: "친구 삭제", exact: true })
      .click();
    await other
      .getByRole("dialog", { name: "친구 관계를 삭제하시겠습니까?" })
      .getByRole("button", { name: "삭제하기", exact: true })
      .click();
    for (const player of [owner, other])
      await expect(
        player.getByText("아직 친구가 없습니다.", { exact: true }),
      ).toBeVisible();
    const deleted = await secondContext.request.delete(
      `/api/friends/${first.id}`,
      { headers: { Authorization: `Bearer ${secondToken}` } },
    );
    expect(deleted.status()).toBe(404);
    expect((await deleted.json()).error.code).toBe("NOT_FOUND");

    const declined = await send(owner, second.nickname);
    expect(declined.requestId).not.toBe(initial.requestId);
    await incoming.getByRole("button", { name: "거절", exact: true }).click();
    await other
      .getByRole("dialog", { name: "친구 요청을 거절하시겠습니까?" })
      .getByRole("button", { name: "거절하기", exact: true })
      .click();
    await expect(
      owner.getByText("보낸 요청이 없습니다.", { exact: true }),
    ).toBeVisible();
    await owner
      .getByRole("list", { name: "검색 결과" })
      .getByRole("button", { name: "친구 요청", exact: true })
      .click();
    await expect(owner.getByRole("alert")).toContainText(
      "이 사용자에게는 친구 요청을 다시 보낼 수 없습니다.",
    );
    const replacement = await send(other, first.nickname);
    expect(replacement.requestId).not.toBe(declined.requestId);
    const obsolete = await firstContext.request.post(
      `/api/friends/requests/${declined.requestId}/accept`,
      { headers: { Authorization: `Bearer ${firstToken}` } },
    );
    expect(obsolete.status()).toBe(404);
    const forbidden = await secondContext.request.post(
      `/api/friends/requests/${replacement.requestId}/accept`,
      { headers: { Authorization: `Bearer ${secondToken}` } },
    );
    expect(forbidden.status()).toBe(403);
    await owner
      .getByRole("list", { name: "받은 요청", exact: true })
      .getByRole("button", { name: "수락", exact: true })
      .click();
    await expect(
      friends.getByText(first.nickname, { exact: true }),
    ).toBeVisible();
    await owner
      .getByRole("list", { name: "친구 목록", exact: true })
      .getByRole("button", {
        name: `${second.nickname} 프로필 보기`,
        exact: true,
      })
      .click();
    await expect(
      owner.getByRole("heading", {
        name: `${second.nickname} 님의 프로필`,
        exact: true,
      }),
    ).toBeVisible();
  } finally {
    await secondContext.close();
  }
});
