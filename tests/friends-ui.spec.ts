import { expect, test } from "@playwright/test";
import { installFriendsFixture } from "./helpers/friends-fixture.ts";

test.describe("friends contract UI — synthetic REST/auth/WS, not server integration", () => {
  test("온라인 알림은 목록을 다시 읽고 조회 중 겹친 알림과 삭제를 반영한다", async ({
    page,
  }) => {
    const fixture = await installFriendsFixture(page);
    await page.goto("/friends");
    const friends = page.getByRole("list", { name: "친구 목록", exact: true });
    await expect(friends.getByText("온라인", { exact: true })).toBeVisible();
    await expect(
      page.getByText(/온라인 상태는 마지막 목록 조회 시점 기준/),
    ).toBeVisible();

    fixture.setOnline(201, null);
    fixture.notify("presence", { userId: 201, online: false });
    await expect(friends.getByText("확인 불가", { exact: true })).toBeVisible();
    fixture.setOnline(201, false);
    // 알림 payload를 직접 적용하지 않고 현재 REST 값을 사용합니다.
    fixture.notify("presence", { userId: 201, online: true });
    await expect(friends.getByText("오프라인", { exact: true })).toBeVisible();

    const baseline = fixture.getReads();
    const held = fixture.holdNextRead();
    await page.getByRole("button", { name: "목록 새로고침" }).click();
    await held.didStart;
    fixture.setOnline(201, true);
    fixture.notify("presence", { userId: 201, online: false });
    fixture.notify("friends.changed", {});
    // 무효화가 화면에 전달된 뒤 이전 조회를 완료합니다.
    await expect(
      page.getByRole("button", { name: "목록 새로고침" }),
    ).toBeDisabled();
    held.release();
    await expect(friends.getByText("온라인", { exact: true })).toBeVisible();
    await expect.poll(fixture.getReads).toBe(baseline + 2);

    fixture.removeFriend(201);
    fixture.notify("friends.changed", {});
    await expect(
      page.getByText("아직 친구가 없습니다.", { exact: true }),
    ).toBeVisible();
    const removedReads = fixture.getReads();
    fixture.notify("presence", { userId: 201, online: true });
    await expect.poll(fixture.getReads).toBeGreaterThan(removedReads);
    await expect(
      page.getByRole("button", { name: "온라인친구 프로필 보기" }),
    ).toHaveCount(0);
  });

  test("멈춘 목록은 timeout 후 오류로 남고 새 조회로 복구한다", async ({
    page,
  }) => {
    test.setTimeout(45_000);
    const fixture = await installFriendsFixture(page);
    await page.goto("/friends");
    const friend = page.getByRole("button", { name: "온라인친구 프로필 보기" });
    await expect(friend).toBeVisible();
    const held = fixture.holdNextRead();
    await page.getByRole("button", { name: "목록 새로고침" }).click();
    await held.didStart;
    await expect(page.getByRole("alert")).toContainText("응답 시간이 초과", {
      timeout: 20_000,
    });
    const reload = page.getByRole("button", { name: "목록 새로고침" });
    await expect(reload).toBeEnabled();
    await expect(
      page.getByRole("button", { name: "친구 삭제" }),
    ).toBeDisabled();
    await expect(friend).toBeVisible();
    await reload.click();
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "친구 삭제" })).toBeEnabled();
    held.release();
  });

  test("requests, confirmation keyboard flow, reload failure and profile navigation", async ({
    page,
  }, testInfo) => {
    const fixture = await installFriendsFixture(page);
    await page.goto("/friends");
    const incoming = page.getByRole("list", { name: "받은 요청", exact: true });
    const friends = page.getByRole("list", { name: "친구 목록", exact: true });
    const outgoing = page.getByRole("list", { name: "보낸 요청", exact: true });
    await expect(friends.getByText("온라인", { exact: true })).toBeVisible();
    await expect(incoming.getByText("받은친구", { exact: true })).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      )
      .toBe(true);
    await expect
      .poll(() =>
        page.evaluate(() => {
          const header = document
            .querySelector(".cbc-header-inner")!
            .getBoundingClientRect();
          return [
            ".cbc-brand-icon-wrap",
            ".cbc-account-area > .cbc-security-pill",
            ".cbc-avatar-trigger",
          ].every((selector) => {
            const box = document
              .querySelector(selector)!
              .getBoundingClientRect();
            return (
              box.left >= header.left &&
              box.right <= header.right &&
              box.top >= header.top &&
              box.bottom <= header.bottom
            );
          });
        }),
      )
      .toBe(true);
    await page.screenshot({
      path: testInfo.outputPath("friends-overview.png"),
      fullPage: true,
    });

    await page.getByLabel("닉네임으로 검색").fill("새");
    await page.getByRole("button", { name: "검색", exact: true }).click();
    const send = page
      .getByRole("list", { name: "검색 결과" })
      .getByRole("button", { name: "친구 요청", exact: true });
    const heldWrite = fixture.holdNextWrite();
    await send.click();
    await heldWrite.didStart;
    await expect(send).toBeDisabled();
    await expect(outgoing.getByText("새친구")).toHaveCount(0);
    heldWrite.release();
    await expect(
      page.getByText("친구 요청을 보냈습니다.", { exact: true }),
    ).toBeVisible();
    await expect(outgoing.getByText("새친구")).toBeVisible();
    expect(fixture.getWrites()).toBe(1);

    await page.getByLabel("닉네임으로 검색").fill("차단");
    await page.getByRole("button", { name: "검색", exact: true }).click();
    await page
      .getByRole("list", { name: "검색 결과" })
      .getByRole("button", { name: "친구 요청", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText(
      "이 사용자에게는 친구 요청을 다시 보낼 수 없습니다.",
    );

    const reject = incoming
      .getByRole("listitem")
      .filter({ hasText: "거절친구" })
      .getByRole("button", { name: "거절", exact: true });
    await reject.click();
    const dialog = page.getByRole("dialog", {
      name: "친구 요청을 거절하시겠습니까?",
    });
    await expect(dialog).toContainText(
      "마음이 바뀌면 내가 먼저 요청할 수 있습니다.",
    );
    await expect(
      dialog.getByRole("button", { name: "취소", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(
      dialog.getByRole("button", { name: "거절하기", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(reject).toBeFocused();
    await reject.click();
    fixture.failNextRead();
    await dialog.getByRole("button", { name: "거절하기", exact: true }).click();
    await expect(
      page.getByText("친구 요청을 거절했습니다.", { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("alert")).toContainText(
      "변경은 완료됐지만 최신 목록을 불러오지 못했습니다.",
    );
    await expect(reject).toBeDisabled();
    await page.getByRole("button", { name: "목록 새로고침" }).click();
    await expect(incoming.getByText("거절친구")).toHaveCount(0);
    await incoming.getByRole("button", { name: "수락", exact: true }).click();
    await expect(friends.getByText("받은친구", { exact: true })).toBeVisible();

    await friends
      .getByRole("listitem")
      .filter({
        has: page.getByRole("button", {
          name: "온라인친구 프로필 보기",
          exact: true,
        }),
      })
      .getByRole("button", { name: "친구 삭제", exact: true })
      .click();
    await page
      .getByRole("dialog", { name: "친구 관계를 삭제하시겠습니까?" })
      .getByRole("button", { name: "삭제하기", exact: true })
      .click();
    await expect(
      friends.getByRole("button", {
        name: "온라인친구 프로필 보기",
        exact: true,
      }),
    ).toHaveCount(0);
    await friends
      .getByRole("button", { name: "받은친구 프로필 보기", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "받은친구 님의 프로필", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "친구 검색·요청", exact: true })
      .click();
    await expect(page.getByLabel("닉네임으로 검색")).toHaveValue("받은친구");
    await page.goBack();
    await expect(page).toHaveURL(/\/users\/202$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/friends$/);
    await page.reload();
    await expect(page.getByTestId("friends-view")).toBeVisible();
    await expect(friends.getByText("받은친구", { exact: true })).toBeVisible();
  });

  test("guards direct access and discards the previous account's pending list", async ({
    page,
  }) => {
    const fixture = await installFriendsFixture(page, false);
    await page.goto("/friends");
    await expect(
      page.getByRole("button", { name: "로그인", exact: true }),
    ).toBeVisible();
    await expect(page.getByTestId("friends-view")).toHaveCount(0);
    const login = async (email: string) => {
      await page.getByLabel(/^이메일/).fill(email);
      await page
        .getByLabel(/^비밀번호.*필수 입력 항목/)
        .fill("contract-password");
      await page.getByRole("button", { name: "로그인", exact: true }).click();
      await page
        .getByTestId("lobby-view")
        .getByRole("button", { name: "친구 관리", exact: true })
        .click();
    };
    await login("first@example.test");
    await expect(
      page.getByRole("button", { name: "온라인친구 프로필 보기" }),
    ).toBeVisible();
    const held = fixture.holdNextRead();
    await page.getByRole("button", { name: "목록 새로고침" }).click();
    await held.didStart;
    await page.locator(".cbc-avatar-trigger").click();
    await page.getByRole("menuitem", { name: /로그아웃/ }).click();
    await page
      .getByRole("dialog", { name: "정말 로그아웃하시겠습니까?" })
      .getByRole("button", { name: "로그아웃", exact: true })
      .click();
    await login("second@example.test");
    await expect(
      page.getByText("아직 친구가 없습니다.", { exact: true }),
    ).toBeVisible();
    const oldResponse = page.waitForResponse(
      (r) => new URL(r.url()).pathname === "/api/friends",
    );
    held.release();
    await oldResponse;
    await expect(
      page.getByRole("button", { name: "온라인친구 프로필 보기" }),
    ).toHaveCount(0);
    await expect(
      page.getByText("아직 친구가 없습니다.", { exact: true }),
    ).toBeVisible();
  });
});
