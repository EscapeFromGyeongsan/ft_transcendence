import { gomoku } from "@cafe/game-engine";
import type { GameType } from "@cafe/game-contracts";
import type { RegisteredRules } from "./services/game-command-service.ts";

/**
 * 실행 서버에 등록하는 게임 엔진(C)입니다. IF-04 등록 형식
 * `{ version, rules, board }`을 따릅니다.
 *
 * @remarks
 * 여기 없는 게임 종류는 매칭을 신청할 수 없고 경기 snapshot도 만들 수 없습니다.
 * 새 경기는 등록된 `version`으로 저장되며, 서버를 재시작하면 끝나지 않은
 * 경기는 모두 void가 되므로 버전을 바꿔도 이전 경기에 다른 규칙이 쓰이지
 * 않습니다(#31).
 */
export const gameEngines: Partial<Record<GameType, RegisteredRules>> = {
  gomoku: {
    version: gomoku.GOMOKU_RULES_VERSION,
    rules: gomoku.rules,
    board: gomoku.board,
  },
};
