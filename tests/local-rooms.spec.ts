import { expect, test, type Page } from "@playwright/test";

async function createRoom(page: Page, title: string, host: string) {
  await page.getByRole("button", { name: "＋ 방 만들기", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(/^방 이름/).fill(title);
  await dialog.getByLabel("방장 이름").fill(host);
  await dialog
    .getByRole("button", { name: "방 만들기 ↗", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: title, exact: true }),
  ).toBeVisible();
}
async function prepareRoom(page: Page, host: string, guest: string) {
  await page
    .getByRole("textbox", { name: "두 번째 플레이어 이름" })
    .fill(guest);
  await page.getByRole("button", { name: "자리 추가", exact: true }).click();
  await page.getByRole("button", { name: `${host} 준비`, exact: true }).click();
  await page
    .getByRole("button", { name: `${guest} 준비`, exact: true })
    .click();
  await page.getByRole("button", { name: "대국 시작하기" }).click();
}
const boardCell = (page: Page, name: string) =>
  page.getByRole("button", { name: new RegExp(`^${name},`) });

test("create and validate a room, prepare both seats, play and keep it in the lobby", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/#/rooms");
  await expect(
    page.getByRole("heading", { name: "아직 비어 있는 카페예요" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "＋ 방 만들기", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(/^방 이름/).fill("   ");
  await dialog.getByLabel("방장 이름").fill("도희");
  await dialog
    .getByRole("button", { name: "방 만들기 ↗", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText("방 이름과 방장 이름");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await createRoom(page, "커피 한 잔과 오목", "도희");
  await expect(
    page.getByRole("button", { name: "대국 시작하기" }),
  ).toBeDisabled();
  await page
    .getByRole("textbox", { name: "두 번째 플레이어 이름" })
    .fill("도희");
  await page.getByRole("button", { name: "자리 추가", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("다른 이름");
  await page
    .getByRole("textbox", { name: "두 번째 플레이어 이름" })
    .fill("친구");
  await page.getByRole("button", { name: "자리 추가", exact: true }).click();
  await page.getByRole("button", { name: "도희 준비", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "대국 시작하기" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "친구 준비", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "대국 시작하기" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "자리 비우기" }).click();
  await expect(
    page.getByRole("button", { name: "도희 준비", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  await prepareRoom(page, "도희", "친구");
  await expect(page.getByRole("status")).toHaveText("흑돌의 차례예요");
  await expect(page.locator(".player strong:visible")).toHaveText([
    "도희",
    "친구",
  ]);
  await boardCell(page, "H8").click();
  await page.getByRole("link", { name: "← 게임 로비" }).click();
  await expect(
    page.getByRole("article").filter({ hasText: "커피 한 잔과 오목" }),
  ).toContainText("대국 중");
  await page.getByRole("link", { name: "대국 이어가기" }).click();
  await expect(boardCell(page, "H8")).toHaveAccessibleName(
    "H8, 흑돌, 마지막 수",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("rooms have independent boards, support search and filters, and close with confirmation", async ({
  page,
}) => {
  await page.goto("/#/rooms");
  await createRoom(page, "첫 번째 테이블", "가");
  await prepareRoom(page, "가", "나");
  await boardCell(page, "A1").click();
  await page.getByRole("link", { name: "← 게임 로비" }).click();
  await createRoom(page, "두 번째 테이블", "다");
  await prepareRoom(page, "다", "라");
  await expect(boardCell(page, "A1")).toHaveAccessibleName("A1, 빈 자리");
  await boardCell(page, "B2").click();
  await page.getByRole("button", { name: "기권하기", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "기권하기" })
    .click();
  await page.getByRole("link", { name: "← 게임 로비" }).click();
  await page
    .getByRole("searchbox", { name: "방 이름 또는 방장 검색" })
    .fill("없는 방");
  await expect(
    page.getByRole("heading", { name: "찾는 테이블이 없어요" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "전체 방 보기", exact: true }).click();
  await page
    .getByRole("group", { name: "방 상태 필터" })
    .getByRole("button", { name: /^종료/ })
    .click();
  await expect(page.getByRole("article")).toHaveCount(1);
  await page.getByRole("link", { name: "결과 보기" }).click();
  await page.getByRole("button", { name: "한 판 더" }).click();
  await page.getByRole("link", { name: "← 게임 로비" }).click();
  await page
    .getByRole("searchbox", { name: "방 이름 또는 방장 검색" })
    .fill("가");
  await expect(page.getByRole("article")).toHaveCount(1);
  await page.getByRole("link", { name: "대국 이어가기" }).click();
  await expect(boardCell(page, "A1")).toHaveAccessibleName(
    "A1, 흑돌, 마지막 수",
  );
  await expect(boardCell(page, "B2")).toHaveAccessibleName("B2, 빈 자리");
  await page.getByRole("button", { name: "방 닫기", exact: true }).click();
  await page.getByRole("button", { name: "방 유지하기" }).click();
  await expect(boardCell(page, "A1")).toHaveAccessibleName(
    "A1, 흑돌, 마지막 수",
  );
  await page.getByRole("button", { name: "방 닫기", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "방 닫기", exact: true })
    .click();
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(page.getByRole("article")).toContainText("두 번째 테이블");
});

test("waiting rooms persist during navigation, but reload and unknown URLs show recovery", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("link", { name: "게임 로비에서 방 만들기" }).click();
  await createRoom(page, "대기실", "방장");
  await page.getByRole("button", { name: "방장 준비", exact: true }).click();
  await page.getByRole("link", { name: "← 게임 로비" }).click();
  await page.getByRole("link", { name: "대기실 열기" }).click();
  await expect(
    page.getByRole("button", { name: "방장 준비", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "테이블을 찾을 수 없어요" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "게임 로비로 돌아가기" }).click();
  await expect(
    page.getByRole("heading", { name: "아직 비어 있는 카페예요" }),
  ).toBeVisible();
  await page.goto("/#/rooms/missing");
  await expect(
    page.getByRole("link", { name: "게임 로비로 돌아가기" }),
  ).toBeVisible();
});
