import type { GameAdapter } from "./definition.ts";
import { omok } from "./omok.ts";

/** Static, explicit composition. Tests may inject a small alternative registry. */
export class GameRegistry {
  private readonly games = new Map<string, GameAdapter>();
  readonly defaultGameType: string;
  constructor(definitions: readonly GameAdapter[], defaultGameType: string) {
    this.defaultGameType = defaultGameType;
    for (const game of definitions) {
      if (this.games.has(game.gameType))
        throw new Error(`Duplicate game type: ${game.gameType}`);
      if (!Number.isInteger(game.playerCount) || game.playerCount < 2)
        throw new Error("Games require at least two seats");
      this.games.set(game.gameType, game);
    }
    if (!this.games.has(defaultGameType))
      throw new Error("Default game is not registered");
  }
  get(gameType: string) {
    return this.games.get(gameType);
  }
  list() {
    return [...this.games.values()].map(({ gameType, playerCount }) => ({
      gameType,
      playerCount,
    }));
  }
}
export const gameRegistry = new GameRegistry([omok], "omok");
