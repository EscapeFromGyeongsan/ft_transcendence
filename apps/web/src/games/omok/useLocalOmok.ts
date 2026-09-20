import { useReducer } from "react";
import {
  applyAction,
  createInitialState,
  type OmokAction,
  type OmokState,
  type ErrorCode,
} from "@cafe/omok";

const messages: Record<ErrorCode, string> = {
  OCCUPIED: "이미 돌이 놓인 자리예요. 빈 교차점을 선택해 주세요.",
  INVALID_COORDINATE: "보드 안의 교차점을 선택해 주세요.",
  GAME_FINISHED: "대국이 끝났어요. 새 게임을 시작해 주세요.",
  WRONG_TURN: "현재 차례의 플레이어만 둘 수 있어요.",
  INVALID_ACTION: "지원하지 않는 행동이에요.",
  INCOMPATIBLE_RULES: "규칙 버전이 맞지 않아요. 새 게임을 시작해 주세요.",
};
type Session = { game: OmokState; error: string };
function reducer(
  session: Session,
  action: OmokAction | { type: "RESET" },
): Session {
  if (action.type === "RESET") return { game: createInitialState(), error: "" };
  const result = applyAction(session.game, session.game.currentTurn, action);
  return result.ok
    ? { game: result.nextState, error: "" }
    : { ...session, error: messages[result.reason] };
}
/** Local session boundary: a future remote session receives snapshots instead of running rules in the browser. */
export function useLocalOmok() {
  const [session, dispatch] = useReducer(reducer, undefined, () => ({
    game: createInitialState(),
    error: "",
  }));
  return {
    ...session,
    place: (x: number, y: number) => dispatch({ type: "PLACE_STONE", x, y }),
    resign: () => dispatch({ type: "RESIGN" }),
    reset: () => dispatch({ type: "RESET" }),
  };
}
export type LocalOmokSession = ReturnType<typeof useLocalOmok>;
