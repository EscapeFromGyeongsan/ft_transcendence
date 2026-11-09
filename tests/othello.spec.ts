import { expect, test } from "@playwright/test";
import { boardCell, register } from "./helpers/accounts.ts";

// A complete legal row-major game: black passes after moves 18, 19, 20 and 47.
// Final result: white 45, black 19. Fixed moves make pass/end regressions reproducible.
const moves = [
  "b23",
  "w22",
  "b21",
  "w11",
  "b01",
  "w00",
  "b32",
  "w02",
  "b12",
  "w13",
  "b03",
  "w04",
  "b10",
  "w20",
  "b45",
  "w14",
  "b05",
  "w06",
  "w15",
  "w24",
  "w41",
  "b31",
  "w40",
  "b30",
  "w42",
  "b50",
  "w35",
  "b25",
  "w26",
  "b16",
  "w17",
  "b07",
  "w27",
  "b37",
  "w36",
  "b52",
  "w46",
  "b47",
  "w51",
  "b62",
  "w53",
  "b54",
  "w55",
  "b56",
  "w57",
  "b67",
  "w60",
  "w61",
  "b70",
  "w63",
  "b64",
  "w65",
  "b66",
  "w76",
  "b71",
  "w72",
  "b73",
  "w74",
  "b75",
  "w77",
] as const;

test("two players flip discs, reconnect, automatically pass and finish an Othello game with persisted history", async ({
  page,
  browser,
  baseURL,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop",
    "One run per shared matchmaking queue",
  );
  test.setTimeout(120_000);
  const secondContext = await browser.newContext({ baseURL });
  try {
    const second = await secondContext.newPage();
    const firstUser = await register(page, "othello1");
    const secondUser = await register(second, "othello2");
    await page.getByTestId("start-matchmaking-othello").click();
    await expect(page.getByTestId("matchmaking-view")).toBeVisible();
    await second.getByTestId("start-matchmaking-othello").click();
    for (const player of [page, second]) {
      await expect(player.getByTestId("othello-match-view")).toBeVisible();
      await expect(player.getByRole("grid").locator("button")).toHaveCount(64);
      await expect(player.getByTestId("othello-disc-count-black")).toHaveText(
        "2",
      );
      await expect(player.getByTestId("othello-disc-count-white")).toHaveText(
        "2",
      );
    }
    await expect(page).toHaveURL(second.url());
    await expect(page.getByTestId("player-card-black")).toContainText(
      new RegExp(`${firstUser.nickname}|${secondUser.nickname}`),
    );
    const firstIsBlack = await page
      .getByTestId("player-card-black")
      .getByText(firstUser.nickname, { exact: false })
      .isVisible();
    const black = firstIsBlack ? page : second;
    let white = firstIsBlack ? second : page;
    const blackName = firstIsBlack ? firstUser.nickname : secondUser.nickname;
    const whiteName = firstIsBlack ? secondUser.nickname : firstUser.nickname;
    await expect(black.locator('[data-legal-move="true"]')).toHaveCount(4);

    // First move through the keyboard also exercises the board input path.
    await boardCell(black, 2, 3).focus();
    await black.keyboard.press("Enter");
    for (const player of [black, white]) {
      await expect(boardCell(player, 3, 3)).toHaveAttribute(
        "data-cell-state",
        "black",
      );
      await expect(player.getByTestId("othello-disc-count-black")).toHaveText(
        "4",
      );
      await expect(player.getByTestId("othello-disc-count-white")).toHaveText(
        "1",
      );
    }

    const context = white.context();
    const matchURL = white.url();
    await white.close();
    await expect(black.getByTestId("opponent-disconnect-banner")).toBeVisible();
    white = await context.newPage();
    await white.goto(matchURL);
    await expect(white.getByTestId("othello-match-view")).toBeVisible();
    await expect(boardCell(white, 3, 3)).toHaveAttribute(
      "data-cell-state",
      "black",
    );
    await expect(black.getByTestId("opponent-disconnect-banner")).toBeHidden();

    // Escape must cancel resignation and restore focus without ending the game.
    const resign = black.getByTestId("resign-trigger-btn");
    await resign.click();
    await expect(
      black.getByRole("dialog", { name: "정말 기권하시겠습니까?" }),
    ).toBeVisible();
    await black.keyboard.press("Escape");
    await expect(black.getByRole("dialog")).toBeHidden();
    await expect(resign).toBeFocused();

    for (let i = 1; i < moves.length; i++) {
      const move = moves[i];
      const color = move[0] === "b" ? "black" : "white";
      const row = Number(move[1]),
        col = Number(move[2]);
      await boardCell(color === "black" ? black : white, row, col).click();
      for (const player of [black, white]) {
        await expect(boardCell(player, row, col)).toHaveAttribute(
          "data-last-move",
          "true",
        );
        await expect(boardCell(player, row, col)).toHaveAttribute(
          "data-cell-state",
          color,
        );
        if ([18, 19, 20, 47].includes(i + 1)) {
          await expect(
            player.getByTestId("othello-auto-pass-banner"),
          ).toBeVisible();
        }
      }
    }

    for (const [player, opponent, summary] of [
      [black, whiteName, "총 1전 0승 1패 0무"],
      [white, blackName, "총 1전 1승 0패 0무"],
    ] as const) {
      await expect(player.getByTestId("othello-result-panel")).toHaveAttribute(
        "data-result-reason",
        "disc_count",
      );
      await expect(player.getByTestId("othello-disc-count-black")).toHaveText(
        "19",
      );
      await expect(player.getByTestId("othello-disc-count-white")).toHaveText(
        "45",
      );
      await player.getByTestId("result-leave-btn").click();
      await player
        .getByTestId("lobby-view")
        .getByRole("button", { name: "내 프로필", exact: true })
        .click();
      await expect(player.getByText(summary, { exact: true })).toBeVisible();
      await player.getByRole("tab", { name: "오델로", exact: true }).click();
      await expect(
        player.getByRole("row", { name: new RegExp(opponent) }),
      ).toHaveCount(1);
      await player.reload();
      await expect(player.getByText(summary, { exact: true })).toBeVisible();
    }
  } finally {
    await secondContext.close();
  }
});
