import { expect, test, type Page } from "@playwright/test";
import { boardCell, register } from "./helpers/accounts.ts";
import { finishGomoku } from "./helpers/matches.ts";

const REFRESH_STORAGE_KEY = "cbc.auth.refreshToken";

async function openMyProfile(page: Page) {
  await page
    .getByTestId("lobby-view")
    .getByRole("button", { name: "내 프로필", exact: true })
    .click();
  await expect(page).toHaveURL(/\/me$/);
  await expect(
    page.getByRole("heading", { name: "내 프로필 및 활동" }),
  ).toBeVisible();
}

function deleteResponse(page: Page) {
  return page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/users/me" &&
      response.request().method() === "DELETE",
  );
}

function confirmDialog(page: Page) {
  return page.getByRole("alertdialog", { name: "정말 회원 탈퇴할까요?" });
}

async function storedRefreshTokens(page: Page) {
  return page.evaluate((key) => {
    return [
      globalThis.localStorage.getItem(key),
      globalThis.sessionStorage.getItem(key),
    ].filter((value) => value !== null);
  }, REFRESH_STORAGE_KEY);
}

test.describe("회원 탈퇴 (#85, DELETE /api/users/me #89)", () => {
  test.skip(
    process.env.E2E_ACCOUNT_DELETION_INTEGRATION !== "1",
    "Requires the #89 account-deletion integration candidate and a dedicated DB.",
  );

  test("확인 대화상자의 키보드·포커스, 본인 확인 실패 후 세션 유지, 성공 시 토큰 정리와 탈퇴 사용자 표시", async ({
    page,
    browser,
    baseURL,
  }) => {
    test.setTimeout(120_000);
    const leaver = await register(page, "leaver");
    const stayerContext = await browser.newContext({ baseURL });
    try {
      const stayerPage = await stayerContext.newPage();
      const stayer = await register(stayerPage, "stayer");
      await finishGomoku(page, stayerPage, [leaver.nickname, stayer.nickname]);

      // --- 진입과 확인 대화상자 (되돌릴 수 없음 안내, 키보드·포커스) ---
      await openMyProfile(page);
      const trigger = page.getByTestId("open-delete-account-btn");
      await trigger.scrollIntoViewIfNeeded();
      await trigger.focus();
      await page.keyboard.press("Enter");
      const dialog = confirmDialog(page);
      await expect(dialog).toBeVisible();
      await expect(dialog).toHaveAttribute("aria-modal", "true");
      await expect(dialog).toContainText("되돌릴 수 없습니다");
      await expect(dialog).toContainText("(탈퇴한 사용자)");
      const password = page.getByTestId("delete-account-password");
      await expect(password).toBeFocused();

      // Tab은 대화상자 안에서만 돈다.
      await page.keyboard.press("Shift+Tab");
      await expect(page.getByTestId("delete-account-confirm")).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(password).toBeFocused();
      await expect(dialog.getByRole("radio")).toHaveCount(0);

      // Escape는 닫고 열기 버튼으로 포커스를 돌려준다.
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      await expect(trigger).toBeFocused();

      // 바깥(backdrop) 클릭으로도 닫힌다.
      await trigger.click();
      await expect(dialog).toBeVisible();
      await page
        .getByTestId("delete-account-backdrop")
        .click({ position: { x: 4, y: 4 } });
      await expect(dialog).toBeHidden();

      // --- 입력 검증: 빈 비밀번호는 요청 없이 막는다 ---
      await trigger.click();
      let requested = false;
      page.on("request", (request) => {
        if (
          new URL(request.url()).pathname === "/api/users/me" &&
          request.method() === "DELETE"
        ) {
          requested = true;
        }
      });
      await page.getByTestId("delete-account-confirm").click();
      await expect(
        dialog
          .getByRole("alert")
          .filter({ hasText: "비밀번호를 입력해 주세요." }),
      ).toBeVisible();
      expect(requested).toBe(false);
      await expect(password).toBeFocused();

      // --- 본인 확인 실패: 400 INVALID_CREDENTIALS, 세션은 유지된다 ---
      await password.fill("Wrong-password-0");
      const wrong = deleteResponse(page);
      await page.getByTestId("delete-account-confirm").click();
      const wrongResponse = await wrong;
      expect(wrongResponse.status()).toBe(400);
      expect((await wrongResponse.json()).error.code).toBe(
        "INVALID_CREDENTIALS",
      );
      await expect(
        dialog.getByRole("alert").filter({
          hasText: "비밀번호가 올바르지 않습니다",
        }),
      ).toBeVisible();
      await expect(dialog).toBeVisible();
      await expect(password).toBeFocused();
      await expect(password).toHaveValue("");
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      // 401이 아니라 400이므로 refresh·로그아웃으로 이어지지 않아 새로고침 후에도 로그인 상태다.
      await page.reload();
      await expect(
        page.getByRole("heading", { name: "내 프로필 및 활동" }),
      ).toBeVisible();
      expect((await storedRefreshTokens(page)).length).toBeGreaterThan(0);

      // --- 성공: 204, 토큰 삭제, 로그인 화면 ---
      await trigger.click();
      await password.fill(leaver.password);
      const ok = deleteResponse(page);
      await page.getByTestId("delete-account-confirm").click();
      expect((await ok).status()).toBe(204);
      await expect(page.getByRole("heading", { name: "로그인" })).toBeVisible();
      await expect(page).toHaveURL(/\/login$/);
      await expect(
        page.getByText("회원 탈퇴가 완료되었습니다.", { exact: false }),
      ).toBeVisible();
      expect(await storedRefreshTokens(page)).toEqual([]);
      await page.reload();
      await expect(page.getByRole("heading", { name: "로그인" })).toBeVisible();
      await expect(page.getByTestId("lobby-view")).toHaveCount(0);

      // 서버: 같은 자격 증명으로 로그인할 수 없고, 같은 이메일·닉네임으로 다시 가입할 수 있다.
      const relogin = await page.request.post("/api/auth/login", {
        data: { email: leaver.email, password: leaver.password },
      });
      expect(relogin.status()).toBe(401);
      const again = await page.request.post("/api/auth/register", {
        data: {
          email: leaver.email,
          password: leaver.password,
          nickname: leaver.nickname,
        },
      });
      expect(again.status()).toBe(201);
      expect((await again.json()).id).not.toBe(leaver.id);

      // --- 상대방 화면: 경기 당시 닉네임 + (탈퇴한 사용자), 링크 없음, 프로필 404, 리더보드 제외 ---
      await stayerPage.goto("/me");
      const row = stayerPage.getByRole("row", {
        name: new RegExp(leaver.nickname),
      });
      await expect(row).toHaveCount(1);
      await expect(row).toContainText(`${leaver.nickname} (탈퇴한 사용자)`);
      await expect(row.getByTestId("deleted-opponent")).toBeVisible();
      await expect(row.getByRole("button")).toHaveCount(0);
      await expect(row.getByRole("link")).toHaveCount(0);

      const profile404 = stayerPage.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === `/api/users/${leaver.id}`,
      );
      await stayerPage.goto(`/users/${leaver.id}`);
      expect((await profile404).status()).toBe(404);
      await expect(
        stayerPage.getByText("존재하지 않거나 탈퇴한 사용자입니다."),
      ).toBeVisible();

      await stayerPage.goto("/me");
      await stayerPage
        .getByRole("button", { name: "리더보드 보기", exact: true })
        .click();
      await expect(
        stayerPage.getByRole("row", { name: new RegExp(stayer.nickname) }),
      ).toHaveCount(1);
      await expect(
        stayerPage.getByRole("row", { name: new RegExp(leaver.nickname) }),
      ).toHaveCount(0);
    } finally {
      await stayerContext.close();
    }
  });

  test("탈퇴하면 다른 기기도 새로고침 시 세션을 복원할 수 없다", async ({
    page,
    browser,
    baseURL,
  }) => {
    test.setTimeout(60_000);
    const user = await register(page, "multi");
    const second = await browser.newContext({ baseURL });
    try {
      const other = await second.newPage();
      await other.goto("/login");
      await other.locator("#emailInput").fill(user.email);
      await other.locator("#passwordInput").fill(user.password);
      await other.getByRole("button", { name: "로그인", exact: true }).click();
      await expect(other.getByTestId("lobby-view")).toBeVisible();

      await openMyProfile(page);
      await page.getByTestId("open-delete-account-btn").click();
      await page.getByTestId("delete-account-password").fill(user.password);
      const ok = deleteResponse(page);
      await page.getByTestId("delete-account-confirm").click();
      expect((await ok).status()).toBe(204);
      await expect(page.getByRole("heading", { name: "로그인" })).toBeVisible();

      // 다른 기기: 폐기된 세션의 refresh는 실패하므로 새로고침하면 로그인 화면이다.
      await other.reload();
      await expect(
        other.getByRole("heading", { name: "로그인" }),
      ).toBeVisible();
      await expect(other.getByTestId("lobby-view")).toHaveCount(0);
      expect(await storedRefreshTokens(other)).toEqual([]);
    } finally {
      await second.close();
    }
  });

  test("탈퇴 응답을 기다리다 뒤로가기로 이동해도 204 뒤 로그인 상태를 정리한다", async ({
    page,
  }) => {
    const user = await register(page, "delete-navigation");
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let committed!: (status: number) => void;
    const committedStatus = new Promise<number>((resolve) => {
      committed = resolve;
    });
    await page.route("**/api/users/me", async (route) => {
      if (route.request().method() !== "DELETE") return route.fallback();
      // 실제 탈퇴 commit·세션 폐기를 끝내고 HTTP 응답 전달만 보류합니다.
      const response = await route.fetch();
      committed(response.status());
      await held;
      return route.fulfill({ response });
    });
    try {
      await openMyProfile(page);
      await page.getByTestId("open-delete-account-btn").click();
      await page.getByTestId("delete-account-password").fill(user.password);
      const deleted = deleteResponse(page);
      await page.getByTestId("delete-account-confirm").click();
      expect(await committedStatus).toBe(204);
      await expect(confirmDialog(page)).toBeVisible();
      await page.goBack();
      await expect(page.getByTestId("lobby-view")).toBeVisible();
      await expect(confirmDialog(page)).toHaveCount(0);
      release();
      expect((await deleted).status()).toBe(204);
      await expect(page.getByRole("heading", { name: "로그인" })).toBeVisible();
      await expect(page).toHaveURL(/\/login$/);
      await expect(
        page.getByText("회원 탈퇴가 완료되었습니다.", { exact: false }),
      ).toBeVisible();
      expect(await storedRefreshTokens(page)).toEqual([]);
    } finally {
      release();
    }
  });

  test("진행 중인 경기가 있으면 409 ACTIVE_MATCH로 거절되고 계정·세션은 그대로다", async ({
    page,
    browser,
    baseURL,
  }) => {
    test.setTimeout(90_000);
    const user = await register(page, "busy");
    const rivalContext = await browser.newContext({ baseURL });
    try {
      const rival = await rivalContext.newPage();
      await register(rival, "rival");

      await page.getByTestId("start-matchmaking-gomoku").click();
      await expect(page.getByTestId("matchmaking-view")).toBeVisible();
      await rival.getByTestId("start-matchmaking-gomoku").click();
      await expect(page.getByTestId("gomoku-match-view")).toBeVisible();
      await expect(rival.getByTestId("gomoku-match-view")).toBeVisible();
      await expect(boardCell(rival, 7, 7)).toBeVisible();

      // queue.matched는 같은 사용자의 모든 탭으로 오므로, 경기 생성 뒤 프로필을 연다.
      await page.locator(".cbc-avatar-trigger").click();
      await page.getByRole("menuitem", { name: /내 프로필/ }).click();
      await expect(page).toHaveURL(/\/me$/);
      await page.getByTestId("open-delete-account-btn").click();
      const dialog = confirmDialog(page);
      await page.getByTestId("delete-account-password").fill(user.password);
      const conflict = deleteResponse(page);
      await page.getByTestId("delete-account-confirm").click();
      const response = await conflict;
      expect(response.status()).toBe(409);
      expect((await response.json()).error.code).toBe("ACTIVE_MATCH");
      const error = dialog.getByTestId("delete-account-error");
      await expect(error).toContainText("진행 중이거나 대기 중인 경기");
      await expect(error).toHaveAttribute("data-kind", "active-match");
      // 오류를 읽은 뒤 키보드로 이어갈 수 있게 포커스가 버튼에 있다.
      await expect(page.getByTestId("delete-account-confirm")).toBeFocused();
      await expect(dialog).toBeVisible();

      // 비밀번호가 맞아도 거절되었으므로 계정은 살아 있고 로그인 상태다.
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      await page.reload();
      await expect(page.getByTestId("gomoku-match-view")).toBeVisible();
      expect((await storedRefreshTokens(page)).length).toBeGreaterThan(0);
    } finally {
      await rivalContext.close();
    }
  });
});

// 계정 종류·2FA 상태와 DELETE 오류만 계약 fixture로 바꿉니다. 가입·로그인·세션·refresh는 실제 서버입니다.
test.describe("회원 탈퇴 UI 계약 응답 — 인증은 실제 서버", () => {
  async function accountKind(
    page: Page,
    hasPassword: boolean | undefined,
    twoFactorEnabled?: boolean,
  ) {
    await page.route("**/api/users/me", async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      const response = await route.fetch();
      const user = await response.json();
      if (hasPassword === undefined) delete user.hasPassword;
      else user.hasPassword = hasPassword;
      return route.fulfill({ response, json: user });
    });
    if (twoFactorEnabled !== undefined) {
      await page.route("**/api/auth/2fa", (route) =>
        route.request().method() === "GET"
          ? route.fulfill({ json: { enabled: twoFactorEnabled } })
          : route.fallback(),
      );
    }
  }

  async function openDialog(page: Page) {
    await openMyProfile(page);
    await page.getByTestId("open-delete-account-btn").click();
    await expect(confirmDialog(page)).toBeVisible();
  }

  test("403 RECENT_LOGIN_REQUIRED: 다시 로그인 안내 후 로그아웃하고 로그인 화면으로 보낸다", async ({
    page,
  }) => {
    await accountKind(page, false);
    await register(page, "recent");
    await page.route("**/api/users/me", async (route) => {
      if (route.request().method() !== "DELETE") return route.fallback();
      return route.fulfill({
        status: 403,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "RECENT_LOGIN_REQUIRED",
            message: "Log in again to delete the account.",
          },
        }),
      });
    });
    await openDialog(page);
    await expect(confirmDialog(page).getByRole("radio")).toHaveCount(0);
    await expect(page.getByTestId("delete-account-password")).toHaveCount(0);
    await expect(page.getByTestId("delete-account-code")).toHaveCount(0);
    // 2FA를 쓰지 않는 42 계정은 코드 없이 제출할 수 있다.
    const rejected = deleteResponse(page);
    await page.getByTestId("delete-account-confirm").click();
    expect((await rejected).request().postData()).toBeNull();
    const error = page.getByTestId("delete-account-error");
    await expect(error).toContainText("최근 10분 안에 로그인");
    await expect(error).toHaveAttribute("data-kind", "relogin");
    const relogin = page.getByTestId("delete-account-relogin");
    await expect(relogin).toBeFocused();

    const loggedOut = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/auth/logout" &&
        response.status() === 204,
    );
    await relogin.click();
    await loggedOut;
    await expect(page.getByRole("heading", { name: "로그인" })).toBeVisible();
    await expect(page.getByText("다시 로그인한 뒤 10분 안에")).toBeVisible();
    expect(await storedRefreshTokens(page)).toEqual([]);
  });

  test("비밀번호 계정은 요청 중 포커스를 유지하고 400 뒤 비밀번호 입력으로 돌아온다", async ({
    page,
  }) => {
    await accountKind(page, true);
    await register(page, "password-focus");
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/api/users/me", async (route) => {
      if (route.request().method() !== "DELETE") return route.fallback();
      await held;
      return route.fulfill({
        status: 400,
        json: {
          error: {
            code: "INVALID_CREDENTIALS",
            message: "Incorrect password.",
          },
        },
      });
    });
    try {
      await openDialog(page);
      const dialog = confirmDialog(page);
      const password = page.getByTestId("delete-account-password");
      const confirm = page.getByTestId("delete-account-confirm");
      await expect(dialog.getByRole("radio")).toHaveCount(0);
      await expect(page.getByTestId("delete-account-code")).toHaveCount(0);
      await password.fill("wrong-password");
      const rejected = deleteResponse(page);
      await confirm.click();
      await expect(confirm).toBeDisabled();
      await expect(password).toBeDisabled();
      await expect(dialog).toBeFocused();
      for (const key of ["Tab", "Shift+Tab", "Escape"]) {
        await page.keyboard.press(key);
        await expect(dialog).toBeFocused();
        await expect(dialog).toBeVisible();
      }
      await page
        .getByTestId("delete-account-backdrop")
        .click({ position: { x: 4, y: 4 } });
      await expect(dialog).toBeVisible();
      release();
      expect((await rejected).status()).toBe(400);
      await expect(dialog.getByRole("alert")).toContainText(
        "비밀번호가 올바르지 않습니다",
      );
      await expect(password).toBeFocused();
      await expect(password).toHaveValue("");
      expect((await storedRefreshTokens(page)).length).toBeGreaterThan(0);
    } finally {
      release();
    }
  });

  test("2FA 상태가 바뀌면 서버 오류 뒤 코드 입력을 열고 코드만 다시 보낸다", async ({
    page,
  }) => {
    await accountKind(page, false, false);
    await register(page, "oauth-code");
    let requests = 0;
    await page.route("**/api/users/me", (route) => {
      if (route.request().method() !== "DELETE") return route.fallback();
      requests++;
      return route.fulfill({
        status: 400,
        json: {
          error: {
            code: "INVALID_TWO_FACTOR_CODE",
            message: "Invalid code.",
          },
        },
      });
    });
    await openDialog(page);
    const dialog = confirmDialog(page);
    const code = page.getByTestId("delete-account-code");
    const confirm = page.getByTestId("delete-account-confirm");
    await expect(dialog.getByRole("radio")).toHaveCount(0);
    await expect(page.getByTestId("delete-account-password")).toHaveCount(0);
    await expect(code).toHaveCount(0);
    const newlyRequired = deleteResponse(page);
    await confirm.click();
    const first = await newlyRequired;
    expect(first.status()).toBe(400);
    expect(first.request().postData()).toBeNull();
    await expect(dialog.getByRole("alert")).toContainText(
      "2단계 인증 코드 또는 복구 코드가 올바르지 않습니다",
    );
    await expect(code).toBeFocused();
    await confirm.click();
    await expect(dialog.getByRole("alert")).toContainText(
      "2단계 인증 코드 또는 복구 코드를 입력해 주세요",
    );
    expect(requests).toBe(1);
    await expect(code).toBeFocused();
    await code.fill("ABCD-EFGH");
    const rejected = deleteResponse(page);
    await confirm.click();
    const response = await rejected;
    expect(response.status()).toBe(400);
    expect(response.request().postDataJSON()).toEqual({ code: "ABCD-EFGH" });
    expect(requests).toBe(2);
    await expect(dialog.getByRole("alert")).toContainText(
      "2단계 인증 코드 또는 복구 코드가 올바르지 않습니다",
    );
    await expect(code).toBeFocused();
    await expect(code).toHaveValue("");
    expect((await storedRefreshTokens(page)).length).toBeGreaterThan(0);
  });

  test("비밀번호 보유 정보가 없으면 본인 확인 방법을 수동 선택할 수 있다", async ({
    page,
  }) => {
    await accountKind(page, undefined);
    await register(page, "legacy-kind");
    await openDialog(page);
    await expect(page.getByTestId("delete-account-password")).toBeFocused();
    await page.getByTestId("delete-account-password").fill("not-submitted");
    await page.getByTestId("delete-method-oauth").check();
    await expect(page.getByTestId("delete-account-code")).toBeVisible();
    await page.getByTestId("delete-method-password").check();
    await expect(page.getByTestId("delete-account-password")).toHaveValue("");
  });

  test("401: 세션이 끝난 계정은 오류 안내와 함께 로그인 화면으로 이동한다", async ({
    page,
  }) => {
    await register(page, "expired");
    await page.route("**/api/users/me", async (route) => {
      if (route.request().method() !== "DELETE") return route.fallback();
      return route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "UNAUTHENTICATED",
            message: "Authentication required.",
          },
        }),
      });
    });
    await openDialog(page);
    await page.getByTestId("delete-account-password").fill("whatever-123");
    await page.getByTestId("delete-account-confirm").click();
    await expect(page.getByRole("heading", { name: "로그인" })).toBeVisible();
    await expect(
      page.getByText("이미 탈퇴 처리된 계정입니다", { exact: false }),
    ).toBeVisible();
    expect(await storedRefreshTokens(page)).toEqual([]);
  });

  test("429·503·네트워크 단절: 대화상자를 유지하고 재시도할 수 있으며 세션은 그대로다", async ({
    page,
  }) => {
    await register(page, "flaky");
    let mode: "429" | "503" | "abort" = "429";
    await page.route("**/api/users/me", async (route) => {
      if (route.request().method() !== "DELETE") return route.fallback();
      if (mode === "abort") return route.abort("failed");
      const code = mode === "429" ? "RATE_LIMITED" : "SERVICE_UNAVAILABLE";
      return route.fulfill({
        status: Number(mode),
        contentType: "application/json",
        body: JSON.stringify({ error: { code, message: code } }),
      });
    });
    await openDialog(page);
    const dialog = confirmDialog(page);
    const password = page.getByTestId("delete-account-password");
    const confirm = page.getByTestId("delete-account-confirm");
    await password.fill("whatever-123");

    await confirm.click();
    await expect(dialog.getByTestId("delete-account-error")).toContainText(
      "요청이 너무 많습니다",
    );
    mode = "503";
    await confirm.click();
    await expect(dialog.getByTestId("delete-account-error")).toContainText(
      "서버 오류로 탈퇴를 처리하지 못했습니다",
    );
    mode = "abort";
    await confirm.click();
    await expect(dialog.getByTestId("delete-account-error")).toContainText(
      "처리되었는지 알 수 없습니다",
    );
    await expect(dialog).toBeVisible();
    // 어느 경우에도 로그아웃되지 않는다.
    expect((await storedRefreshTokens(page)).length).toBeGreaterThan(0);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(
      page.getByRole("heading", { name: "내 프로필 및 활동" }),
    ).toBeVisible();
  });
});
