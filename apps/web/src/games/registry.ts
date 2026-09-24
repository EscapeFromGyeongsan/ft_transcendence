import { OnlineOmokGame } from "./omok/OnlineOmokGame";
/** Display metadata stays outside the rules package. Register future games here. */
export const games = [
  {
    id: "omok",
    title: "오목",
    subtitle: "단순한 한 수, 깊어지는 승부.",
    players: "2인",
    duration: "10–20분",
    mode: "온라인 대전",
    ruleLabel: "15 × 15 · 자유룰",
    seatLabel: (seat: number) => (seat === 0 ? "방장 · 흑돌" : "백돌"),
    resultLabel: (reason: string) =>
      ({ five: "오목 완성", resignation: "기권", draw: "무승부" })[reason] ??
      reason,
    OnlineGame: OnlineOmokGame,
  },
] as const;

export const getGamePresentation = (gameType: string) =>
  games.find((game) => game.id === gameType);
