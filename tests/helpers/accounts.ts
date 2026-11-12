import { randomUUID } from "node:crypto";
import { expect, type Page } from "@playwright/test";

/** Real signup and WebSocket authentication; no mocked HTTP/WS responses. */
export async function register(page: Page, prefix = "player") {
  const nickname = `${prefix}_${randomUUID().slice(0, 8)}`;
  const email = `${nickname}@example.test`;
  const password = `Test-${randomUUID()}`;
  await page.goto("/");
  await page.getByRole("button", { name: "회원가입", exact: true }).click();
  await page.getByLabel("이메일", { exact: true }).fill(email);
  await page.getByLabel("비밀번호", { exact: true }).fill(password);
  await page.getByLabel("닉네임", { exact: true }).fill(nickname);
  await page.locator("#agree-terms").check();

  const registered = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/auth/register" &&
      response.request().method() === "POST",
  );
  const authenticated = page
    .waitForEvent(
      "websocket",
      (socket) => new URL(socket.url()).pathname === "/api/ws",
    )
    .then((socket) =>
      socket.waitForEvent("framereceived", (frame) => {
        const message = JSON.parse(String(frame.payload));
        return message.type === "auth.ok";
      }),
    );
  const [response] = await Promise.all([
    registered,
    authenticated,
    page.getByRole("button", { name: "가입하기" }).click(),
  ]);
  expect(response.status()).toBe(201);
  const user = (await response.json()) as { id: number; nickname: string };
  await expect(page.getByTestId("lobby-view")).toBeVisible();
  // email and password are the credentials this helper just registered with.
  return { ...user, email, password };
}

/** Selects the rendered board button using zero-based server coordinates. */
export function boardCell(page: Page, row: number, col: number) {
  return page.locator(`button[data-row="${row}"][data-col="${col}"]`);
}
