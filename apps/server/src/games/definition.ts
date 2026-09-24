import type { GameResult, VersionedGameState } from "@cafe/game-contracts";

export type ActionResult<State> =
  { ok: true; nextState: State } | { ok: false; reason: string };
/** The platform supplies a verified seat, never an engine-specific color or turn. */
export interface GameDefinition<State extends VersionedGameState, Action> {
  gameType: string;
  playerCount: number;
  createInitialState(): State;
  isState(state: VersionedGameState): state is State;
  parseAction(action: unknown): Action | null;
  applyAction(
    state: State,
    actor: { seat: number },
    action: Action,
  ): ActionResult<State>;
  getResult(state: State): GameResult | null;
}
export interface GameAdapter {
  readonly gameType: string;
  readonly playerCount: number;
  createInitialState(): VersionedGameState;
  applyAction(
    state: VersionedGameState,
    actor: { seat: number },
    action: unknown,
  ): ActionResult<VersionedGameState>;
  getResult(state: VersionedGameState): GameResult | null;
}
/** One checked boundary lets the registry hold different state/action types without `any`. */
export function adaptGame<State extends VersionedGameState, Action>(
  game: GameDefinition<State, Action>,
): GameAdapter {
  return {
    gameType: game.gameType,
    playerCount: game.playerCount,
    createInitialState: () => game.createInitialState(),
    applyAction(state, actor, input) {
      if (!game.isState(state))
        return { ok: false, reason: "INCOMPATIBLE_RULES" };
      if (
        !Number.isInteger(actor.seat) ||
        actor.seat < 0 ||
        actor.seat >= game.playerCount
      )
        return { ok: false, reason: "NOT_A_PLAYER" };
      const action = game.parseAction(input);
      if (action === null) return { ok: false, reason: "INVALID_REQUEST" };
      return game.applyAction(state, actor, action);
    },
    getResult(state) {
      if (!game.isState(state))
        throw new Error("Adapter received incompatible state");
      return game.getResult(state);
    },
  };
}
