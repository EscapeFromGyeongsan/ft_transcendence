import { expect, type Page } from "@playwright/test";
import { boardCell } from "./accounts.ts";

/** Plays nine legal UI moves on the real server and returns both players to the lobby. */
export async function finishGomoku(
  first: Page,
  second: Page,
  names: readonly [string, string],
) {
  await Promise.all([first.goto("/"), second.goto("/")]);
  for (const player of [first, second]) {
    await expect(player.getByTestId("lobby-view")).toBeVisible();
    await expect(
      player.locator(".cbc-account-area .cbc-security-pill"),
    ).toHaveText("온라인");
  }
  await first.getByTestId("start-matchmaking-gomoku").click();
  await expect(first.getByTestId("matchmaking-view")).toBeVisible();
  await second.getByTestId("start-matchmaking-gomoku").click();
  for (const player of [first, second]) {
    await expect(player.getByTestId("gomoku-match-view")).toBeVisible();
  }
  await expect(first).toHaveURL(second.url());
  await expect(first.getByTestId("player-card-black")).toContainText(
    new RegExp(names.join("|")),
  );
  const firstIsBlack = await first
    .getByTestId("player-card-black")
    .getByText(names[0], { exact: false })
    .isVisible();
  const black = firstIsBlack ? first : second;
  const white = firstIsBlack ? second : first;
  for (let col = 3; col <= 7; col++) {
    await boardCell(black, 7, col).click();
    for (const player of [black, white]) {
      await expect(boardCell(player, 7, col)).toHaveAttribute(
        "data-cell-state",
        "black",
      );
    }
    if (col < 7) {
      await boardCell(white, 0, (col - 3) * 2).click();
      await expect(boardCell(black, 0, (col - 3) * 2)).toHaveAttribute(
        "data-cell-state",
        "white",
      );
    }
  }
  for (const player of [black, white]) {
    await expect(player.getByTestId("gomoku-result-panel")).toBeVisible();
    await player.getByTestId("result-leave-btn").click();
    await expect(player.getByTestId("lobby-view")).toBeVisible();
  }
}
