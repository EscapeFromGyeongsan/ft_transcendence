import {
  applyAction,
  createInitialState,
  RULES_VERSION,
  type OmokAction,
  type OmokState,
} from "@cafe/omok";
import { adaptGame, type GameDefinition } from "./definition.ts";

export const omokDefinition: GameDefinition<OmokState, OmokAction> = {
  gameType: "omok",
  playerCount: 2,
  createInitialState,
  // States are created by this adapter, never accepted from client messages.
  isState: (state): state is OmokState =>
    "gameType" in state &&
    state.gameType === "omok" &&
    "rulesVersion" in state &&
    state.rulesVersion === RULES_VERSION,
  parseAction(input) {
    if (!input || typeof input !== "object" || !("type" in input)) return null;
    if (input.type === "RESIGN") return { type: "RESIGN" };
    if (
      input.type === "PLACE_STONE" &&
      "x" in input &&
      "y" in input &&
      typeof input.x === "number" &&
      typeof input.y === "number"
    )
      return { type: "PLACE_STONE", x: input.x, y: input.y };
    return null;
  },
  applyAction: (state, actor, action) =>
    applyAction(state, actor.seat === 0 ? "black" : "white", action),
  getResult(state) {
    const result = state.result;
    return result
      ? {
          kind: result.kind,
          winnerSeats:
            result.kind === "win" ? [result.winner === "black" ? 0 : 1] : [],
          reason: result.kind === "win" ? result.reason : "draw",
          moveCount: state.moves.length,
        }
      : null;
  },
};
export const omok = adaptGame(omokDefinition);
