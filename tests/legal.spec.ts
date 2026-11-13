import { expect, test } from "@playwright/test";
import { register } from "./helpers/accounts.ts";

test("legal pages support direct access, browser history and 404 recovery", async ({
  page,
}) => {
  await page.goto("/terms");
  await expect(
    page.getByRole("heading", { name: "서비스 이용약관", exact: true }),
  ).toBeVisible();
  await page.getByTestId("tab-legal-privacy").click();
  await expect(page).toHaveURL(/\/privacy$/);
  await expect(
    page.getByRole("heading", { name: "개인정보처리방침", exact: true }),
  ).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/terms$/);
  await expect(page.getByTestId("legal-document-view")).toHaveAttribute(
    "data-legal-doc",
    "terms",
  );
  await page.goForward();
  await expect(page.getByTestId("legal-document-view")).toHaveAttribute(
    "data-legal-doc",
    "privacy",
  );
  await page.reload();
  await expect(page.getByTestId("legal-document-view")).toHaveAttribute(
    "data-legal-doc",
    "privacy",
  );
  await page.goto("/does-not-exist");
  await expect(page.getByTestId("not-found-view")).toBeVisible();
  await page.getByTestId("not-found-home-btn").click();
  await expect(
    page.getByRole("heading", { name: "로그인", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
  await page.getByTestId("footer-link-terms").click();
  await expect(page).toHaveURL(/\/terms$/);
});

test("signup policy links return to the unfinished signup form", async ({
  page,
}) => {
  await page.goto("/signup");
  await page
    .getByLabel("이메일", { exact: true })
    .fill("unfinished@example.test");
  for (const kind of ["terms", "privacy"] as const) {
    await page.getByTestId(`signup-open-${kind}`).click();
    await expect(page.getByTestId("legal-document-view")).toHaveAttribute(
      "data-legal-doc",
      kind,
    );
    await page.getByTestId("legal-back-btn").click();
    await expect(page).toHaveURL(/\/signup$/);
    await expect(page.getByLabel("이메일", { exact: true })).toHaveValue(
      "unfinished@example.test",
    );
  }
});

test("authenticated policy navigation preserves the session and Escape cancels logout", async ({
  page,
}) => {
  await register(page, "legal");
  await page.getByTestId("footer-link-privacy").click();
  await expect(page).toHaveURL(/\/privacy$/);
  await page.getByTestId("legal-back-btn").click();
  await expect(page.getByTestId("lobby-view")).toBeVisible();

  const trigger = page.locator(".cbc-avatar-trigger");
  await trigger.click();
  await page.getByRole("menuitem", { name: /로그아웃/ }).click();
  const dialog = page.getByRole("dialog", {
    name: "정말 로그아웃하시겠습니까?",
  });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  await page.reload();
  await expect(page.getByTestId("lobby-view")).toBeVisible();
});
