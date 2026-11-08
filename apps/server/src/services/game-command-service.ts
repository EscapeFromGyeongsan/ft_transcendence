import type {
  Cell,
  GameCommandBase,
  GameError,
  GameSnapshot,
  GameStatus,
  GameType,
  PlaceAction,
  ResignAction,
} from "@cafe/game-contracts";
import type { Database, Executor } from "../db/client.ts";
import * as repo from "../repositories/game-repository.ts";
import type { Seat } from "../repositories/game-repository.ts";

export type GameAction = PlaceAction | ResignAction;
export type ErrorCode = GameError["code"];
/**
 * 엔진이 돌려줄 수 있는 거절 코드입니다.
 *
 * @remarks 엔진은 규칙 판정만 보고하고, 나머지 코드는 이 서비스가 정합니다(IF-01).
 */
export type EngineErrorCode = Extract<
  ErrorCode,
  "INVALID_ACTION" | "GAME_FINISHED"
>;

export type Finish =
  | { outcome: "win"; winner: Seat; reason: string }
  | { outcome: "draw"; reason: "draw" }
  | { outcome: "void"; reason: string };

/**
 * 착수 한 번에 대한 엔진의 판정입니다.
 *
 * @remarks 규칙은 엔진(C)이, 잠금·버전·저장은 이 서비스(B)가 맡습니다.
 */
export type RuleDecision =
  | { ok: false; code: EngineErrorCode }
  | { ok: true; nextTurn: Seat | null; finish?: Finish };

export type StoredMove = { row: number; col: number; stone: string };

/**
 * 게임 엔진의 착수 판정 함수입니다.
 *
 * @remarks `moves`는 서버에 저장된 이전 착수 전체(수 번호 순)입니다. 엔진은 상태를 저장하지 않고 이 기록만으로 판정합니다.
 */
export type GameRules = (input: {
  moves: StoredMove[];
  seat: Seat;
  action: PlaceAction;
}) => RuleDecision;

/**
 * 게임 종류마다 등록하는 엔진입니다.
 *
 * @remarks
 * 새 경기의 규칙 버전은 호출자가 아니라 서버가 정하므로 등록된 버전만 저장됩니다.
 * `board()`는 저장된 착수 기록으로 판을 다시 만듭니다(오델로 뒤집기에는 규칙이 필요해서 엔진이 맡음).
 */
export type RegisteredRules = {
  version: string;
  rules: GameRules;
  board: (moves: StoredMove[]) => Cell[][];
};

/**
 * 계약의 명령에 행위자를 붙인 것입니다.
 *
 * @remarks `userId`는 인증에서 오며 클라이언트 payload에서 받지 않습니다(IF-02).
 */
export type GameCommand = GameCommandBase & {
  userId: number;
  action: GameAction;
};

/** {@link GameCommandService.apply}의 결과입니다. `duplicate`는 이미 처리한 `commandId`의 저장된 결과를 다시 돌려준 경우입니다. */
export type CommandResult =
  | { status: "applied"; stateVersion: number; duplicate: boolean }
  | { status: "rejected"; code: ErrorCode; duplicate: boolean };

/**
 * 서버가 경기를 끝내는 요청입니다(이탈 만료).
 *
 * @remarks `expectedVersion`이 현재 버전과 다르면 그 사이 착수·종료가 있었던 것으로 보고 아무것도 하지 않습니다.
 */
export type SystemFinish = {
  matchId: number;
  reason: "disconnect_timeout";
  absentUserIds: number[];
  expectedVersion: number;
};

export type SystemFinishResult =
  { status: "finished"; stateVersion: number } | { status: "skipped" };

export type PauseStatus = Extract<GameStatus, "playing" | "paused">;

const commandTypes = { place: "place", resign: "resign" } as const;
const engineErrorCodes: readonly string[] = [
  "INVALID_ACTION",
  "GAME_FINISHED",
] satisfies EngineErrorCode[];

async function finishMatch(
  tx: Executor,
  gameId: number,
  players: { userId: number; seat: string }[],
  finish: Finish,
  stateVersion: number,
) {
  const winnerUserId =
    finish.outcome === "win"
      ? players.find((p) => p.seat === finish.winner)!.userId
      : null;
  await repo.updateGameAfterCommand(tx, gameId, {
    stateVersion,
    currentTurn: null,
    status: "finished",
    outcome: finish.outcome,
    resultReason: finish.reason,
    winnerUserId,
    finishedAt: new Date(),
  });
  for (const player of players) {
    const result =
      finish.outcome !== "win"
        ? finish.outcome
        : player.userId === winnerUserId
          ? "win"
          : "loss";
    await repo.setPlayerResult(tx, gameId, player.userId, result);
  }
}

/**
 * 진행 중인 경기를 모두 무효(`server_restart`)로 한 트랜잭션에서 끝냅니다.
 *
 * @returns 무효로 끝낸 경기 ID
 *
 * @remarks
 * 시작할 때 listen 전에 한 번 호출합니다. 재시작으로 미완료 경기의 시계와 소켓이 사라지기 때문입니다(DEC-07).
 * API 인스턴스 하나를 전제합니다. 다른 인스턴스가 돌고 있으면 그 진행 경기도 끝나 버립니다.
 */
export function voidUnfinishedGames(db: Database) {
  return db.transaction((tx) => repo.voidUnfinishedGames(tx, "server_restart"));
}

/**
 * 경기 생성·명령 적용·서버 종료·상태 전환·조회를 맡는 서버 권위 서비스를 만듭니다.
 *
 * @param rulesByGameType - 게임 종류별 등록 엔진. 등록되지 않은 종류를 쓰면 예외입니다.
 *
 * @remarks
 * 경기를 바꾸는 경로는 모두 경기 행 잠금을 먼저 잡으므로 한 경기의 변경은 직렬화됩니다.
 * 네트워크 전송은 이 서비스의 Promise가 끝난 뒤(commit 후)에 해야 합니다.
 */
export function createGameCommandService(
  db: Database,
  rulesByGameType: Partial<Record<GameType, RegisteredRules>>,
) {
  const registeredFor = (gameType: string) => {
    const registered = rulesByGameType[gameType as GameType];
    if (!registered) throw new Error(`No rules registered for ${gameType}.`);
    return registered;
  };

  // One REPEATABLE READ snapshot, so stateVersion, players and moves always
  // describe the same moment even if a command commits in between.
  const getMatch = (matchId: number) =>
    db.transaction(
      async (tx) => {
        const game = await repo.findGame(tx, matchId);
        if (!game) return undefined;
        const players = await repo.findPlayers(tx, matchId);
        const history = await repo.findMoves(tx, matchId);
        return { game, players, moves: history };
      },
      { isolationLevel: "repeatable read", accessMode: "read only" },
    );

  return {
    /**
     * 2인 경기를 만들어 바로 `playing`, 흑 차례로 시작합니다.
     *
     * @returns 새 경기 ID
     * @throws 등록되지 않은 `gameType`인 경우
     *
     * @remarks 규칙 버전은 등록된 엔진의 버전으로 저장합니다. 매칭은 D가 맡습니다.
     */
    async createMatch(input: {
      gameType: GameType;
      blackUserId: number;
      whiteUserId: number;
    }) {
      const registered = registeredFor(input.gameType);
      return db.transaction(async (tx) => {
        const game = await repo.insertGame(tx, {
          gameType: input.gameType,
          rulesVersion: registered.version,
          status: "playing",
          currentTurn: "black",
          startedAt: new Date(),
        });
        await repo.insertPlayer(tx, {
          gameId: game.id,
          userId: input.blackUserId,
          seat: "black",
        });
        await repo.insertPlayer(tx, {
          gameId: game.id,
          userId: input.whiteUserId,
          seat: "white",
        });
        return game.id;
      });
    },

    /**
     * 착수·기권 명령 하나를 한 트랜잭션에서 검증하고 적용합니다.
     *
     * @returns 적용되면 새 `stateVersion`, 거절되면 공개 오류 코드. 같은 참가자가 같은 `commandId`를 다시 보내면 처음 결과를 `duplicate: true`로 돌려줍니다.
     * @throws 엔진이 공개 목록 밖의 코드를 돌려주거나, 저장된 규칙 버전과 등록 버전이 다른 경우(롤백, 기록 없음)
     *
     * @remarks
     * 순서: 경기 잠금 → 참가자 → 중복 `commandId` → 상태 → `expectedVersion` → 규칙 → 착수·버전·명령·결과 저장 → commit.
     * 거절도 명령 기록으로 남깁니다. 다른 사용자가 쓴 `commandId`는 `COMMAND_ID_CONFLICT`입니다.
     * 네트워크 전송은 이 Promise가 끝난 뒤에 해야 하고 안에서 하면 안 됩니다.
     */
    apply(command: GameCommand): Promise<CommandResult> {
      return db.transaction(async (tx) => {
        const game = await repo.findGameForUpdate(tx, command.matchId);
        if (!game)
          return { status: "rejected", code: "NOT_FOUND", duplicate: false };
        const players = await repo.findPlayers(tx, game.id);
        const player = players.find((p) => p.userId === command.userId);
        if (!player) {
          return {
            status: "rejected",
            code: "NOT_PARTICIPANT",
            duplicate: false,
          };
        }

        const previous = await repo.findCommand(tx, game.id, command.commandId);
        if (previous) {
          // Same commandId from another user is never the same request.
          if (previous.userId !== command.userId) {
            return {
              status: "rejected",
              code: "COMMAND_ID_CONFLICT",
              duplicate: false,
            };
          }
          return previous.status === "applied"
            ? {
                status: "applied",
                stateVersion: previous.appliedVersion!,
                duplicate: true,
              }
            : {
                status: "rejected",
                code: previous.rejectCode! as ErrorCode,
                duplicate: true,
              };
        }

        const record = {
          gameId: game.id,
          userId: command.userId,
          commandId: command.commandId,
          commandType: commandTypes[command.action.type],
          expectedVersion: command.expectedVersion,
        };
        const reject = async (code: ErrorCode): Promise<CommandResult> => {
          await repo.insertCommand(tx, {
            ...record,
            status: "rejected",
            rejectCode: code,
          });
          return { status: "rejected", code, duplicate: false };
        };

        if (game.status === "finished") return reject("GAME_FINISHED");
        if (game.status !== "playing") return reject("GAME_NOT_ACTIVE");
        if (command.expectedVersion !== game.stateVersion) {
          return reject("VERSION_CONFLICT");
        }

        const seat = player.seat as Seat;
        const nextVersion = game.stateVersion + 1;

        if (command.action.type === "resign") {
          await finishMatch(
            tx,
            game.id,
            players,
            {
              outcome: "win",
              winner: seat === "black" ? "white" : "black",
              reason: "resign",
            },
            nextVersion,
          );
        } else {
          if (game.currentTurn !== seat) return reject("NOT_YOUR_TURN");
          const registered = registeredFor(game.gameType);
          // Startup voids every unfinished match, so a mismatch means the
          // engine changed without a restart: never apply other rules.
          if (registered.version !== game.rulesVersion) {
            throw new Error(
              `Match ${game.id} uses ${game.rulesVersion}, but ${registered.version} is registered.`,
            );
          }
          const history = await repo.findMoves(tx, game.id);
          const decision = registered.rules({
            moves: history,
            seat,
            action: command.action,
          });
          if (!decision.ok) {
            // An unknown code is an engine bug, not a player error: roll back.
            if (!engineErrorCodes.includes(decision.code)) {
              throw new Error(
                `Engine for ${game.gameType} returned unknown code ${decision.code}.`,
              );
            }
            return reject(decision.code);
          }
          await repo.insertMove(tx, {
            gameId: game.id,
            userId: command.userId,
            turnNumber: history.length + 1,
            rowIdx: command.action.row,
            colIdx: command.action.col,
            stone: seat,
          });
          if (decision.finish) {
            await finishMatch(
              tx,
              game.id,
              players,
              decision.finish,
              nextVersion,
            );
          } else {
            await repo.updateGameAfterCommand(tx, game.id, {
              stateVersion: nextVersion,
              currentTurn: decision.nextTurn,
            });
          }
        }

        await repo.insertCommand(tx, {
          ...record,
          status: "applied",
          appliedVersion: nextVersion,
        });
        return {
          status: "applied",
          stateVersion: nextVersion,
          duplicate: false,
        };
      });
    },

    /**
     * 이탈 예산이 다 된 경기를 끝냅니다. 한 명이 부재면 상대 승리, 둘 다 부재면 무효입니다.
     *
     * @returns 끝냈으면 새 `stateVersion`. 경기가 없거나 이미 끝났거나 버전이 달라졌으면 `skipped`
     * @throws `absentUserIds`가 비었거나 참가자가 아닌 사용자가 들어 있는 경우
     *
     * @remarks
     * 경기 진행 계층(D)이 호출합니다. `apply()`와 같은 경기 잠금을 쓰므로 먼저 commit된 착수·종료로 버전이나 종료 상태가 바뀌면 `skipped`입니다.
     * 복귀의 `setStatus()`는 버전을 올리지 않으며 이 함수는 `playing`과 `paused`를 모두 허용합니다.
     * 따라서 복귀만으로 오래된 이탈 종료 요청을 자동으로 무시하지 않습니다. D가 호출 전에 현재 부재자를 다시 확인하고 복귀 시 이탈 타이머를 취소해야 합니다.
     */
    finishBySystem(input: SystemFinish): Promise<SystemFinishResult> {
      return db.transaction(async (tx) => {
        const game = await repo.findGameForUpdate(tx, input.matchId);
        if (!game) return { status: "skipped" };
        const players = await repo.findPlayers(tx, game.id);
        const absent = new Set(input.absentUserIds);
        if (
          absent.size === 0 ||
          [...absent].some((id) => !players.some((p) => p.userId === id))
        ) {
          throw new Error(
            `absentUserIds must be participants of match ${game.id}.`,
          );
        }
        if (game.status !== "playing" && game.status !== "paused") {
          return { status: "skipped" };
        }
        if (game.stateVersion !== input.expectedVersion) {
          return { status: "skipped" };
        }

        const present = players.filter((p) => !absent.has(p.userId));
        const finish: Finish =
          present.length === 1
            ? {
                outcome: "win",
                winner: present[0].seat as Seat,
                reason: input.reason,
              }
            : { outcome: "void", reason: input.reason };
        const nextVersion = game.stateVersion + 1;
        await finishMatch(tx, game.id, players, finish, nextVersion);
        return { status: "finished", stateVersion: nextVersion };
      });
    },

    /**
     * 경기가 아직 `from` 상태일 때만 `to`로 바꿉니다.
     *
     * @returns 바꿨으면 `true`, 상태가 이미 달라졌거나 경기가 없으면 `false`
     *
     * @remarks
     * 경기 진행 계층(D)이 이탈(`playing` → `paused`)과 복귀(`paused` → `playing`)에 씁니다.
     * 상태를 비교하고 바꾸므로 늦게 온 이탈 처리가 끝난 경기를 다시 열지 않습니다.
     * `stateVersion`은 올리지 않습니다. 일시정지는 `player.*` 이벤트로 알립니다(IF-05).
     */
    setStatus(
      matchId: number,
      from: PauseStatus,
      to: PauseStatus,
    ): Promise<boolean> {
      return repo.updateGameStatus(db, matchId, from, to);
    },

    /**
     * 경기·참가자·착수 행을 한 REPEATABLE READ 읽기 전용 트랜잭션에서 읽습니다.
     *
     * @returns 경기가 없으면 `undefined`
     *
     * @remarks 참가자 확인·기록 조회처럼 원본 행이 필요한 경우에 씁니다. 세 값은 항상 같은 시점을 가리킵니다.
     */
    getMatch,

    /** 이 게임 종류의 엔진이 등록되어 경기를 만들 수 있는지 확인합니다. */
    isRegistered(gameType: string) {
      return rulesByGameType[gameType as GameType] !== undefined;
    },

    /**
     * 사용자의 끝나지 않은 경기(`waiting`/`playing`/`paused`) ID를 찾습니다.
     *
     * @returns 경기 ID, 없으면 `undefined`
     *
     * @remarks
     * 매칭 신청 거절(FR-MATCH-02)과 재접속 시 진행 중 경기 안내(D)에 씁니다.
     * 잠금 없이 읽으므로, 동시 신청 경합은 호출하는 쪽에서 막습니다.
     */
    findActiveMatchId(userId: number) {
      return repo.findActiveGameIdForUser(db, userId);
    },

    /**
     * 서버가 확정한 경기 상태를 공통 계약의 `GameSnapshot` 형태로 돌려줍니다.
     *
     * @returns 경기가 없으면 `undefined`
     *
     * @remarks
     * `match.snapshot`, 재접속, `VERSION_CONFLICT` 복구에 씁니다(IF-01, IF-05).
     * 판은 엔진의 `board()`로 만들고, 결과는 DB에 저장된 값을 씁니다. 좌석은 사용자 ID로 바꿔 담습니다.
     */
    async getSnapshot(matchId: number): Promise<GameSnapshot | undefined> {
      const match = await getMatch(matchId);
      if (!match) return undefined;
      const { game, players, moves } = match;
      const userIdOf = (seat: string) =>
        players.find((p) => p.seat === seat)!.userId;
      const result =
        game.status !== "finished"
          ? null
          : game.outcome === "win"
            ? {
                outcome: "win",
                winnerId: game.winnerUserId,
                reason: game.resultReason,
              }
            : {
                outcome: game.outcome,
                winnerId: null,
                reason: game.resultReason,
              };
      // Values come from CHECK-constrained columns that mirror the contract.
      return {
        matchId: game.id,
        gameType: game.gameType,
        rulesVersion: game.rulesVersion,
        stateVersion: game.stateVersion,
        status: game.status as GameStatus,
        players: { black: userIdOf("black"), white: userIdOf("white") },
        board: registeredFor(game.gameType).board(moves),
        currentPlayerId: game.currentTurn ? userIdOf(game.currentTurn) : null,
        result,
      } as GameSnapshot;
    },
  };
}

export type GameCommandService = ReturnType<typeof createGameCommandService>;
