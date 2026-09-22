import { expect, test } from "@playwright/test";

test("two browsers join, synchronize turns, reconnect and finish a match", async ({
  browser,
}) => {
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const host = await hostContext.newPage(),
    guest = await guestContext.newPage();
  try {
    await host.goto("http://127.0.0.1:5173/#/online");
    await host.getByRole("button", { name: "＋ 온라인 방 만들기" }).click();
    const dialog = host.getByRole("dialog");
    await dialog.getByLabel(/^방 이름/).fill("두 브라우저 대국");
    await dialog.getByLabel("방장 이름").fill("흑돌");
    await dialog
      .getByRole("button", { name: "방 만들기 ↗", exact: true })
      .click();
    await expect(
      host.getByRole("heading", { name: /두 브라우저 대국/ }),
    ).toBeVisible();
    const link = host.url();
    await guest.goto(link);
    await guest.getByLabel("참가할 이름").fill("백돌");
    await guest.getByRole("button", { name: "입장하기" }).click();
    await expect(host.getByRole("heading", { name: /백돌/ })).toBeVisible();
    await host.getByRole("button", { name: "준비하기" }).click();
    await guest.getByRole("button", { name: "준비하기" }).click();
    await host.getByRole("button", { name: /대국 시작하기/ }).click();
    await expect(guest.getByRole("status")).toContainText("흑돌 차례");
    await host.getByRole("button", { name: /^H8, 빈 자리/ }).click();
    await expect(
      guest.getByRole("button", { name: /^H8, 흑돌/ }),
    ).toBeVisible();
    await host.getByRole("button", { name: /^I8, 빈 자리/ }).click();
    await expect(host.getByRole("alert")).toContainText("상대의 차례");
    await guest.reload();
    await expect(
      guest.getByRole("button", { name: /^H8, 흑돌/ }),
    ).toBeVisible();
    await guest.getByRole("button", { name: /^I8, 빈 자리/ }).click();
    await expect(host.getByRole("button", { name: /^I8, 백돌/ })).toBeVisible();
    host.once("dialog", (dialog) => void dialog.accept());
    await host.getByRole("button", { name: "기권하기" }).click();
    await expect(guest.getByRole("status")).toContainText("백돌 승리");
    await host.getByRole("button", { name: "재대국 준비하기" }).click();
    await expect(guest.getByRole("button", { name: "준비하기" })).toBeVisible();
  } finally {
    await hostContext.close();
    await guestContext.close();
  }
});
