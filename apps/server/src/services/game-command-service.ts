import type { Database, Executor } from "../db/client.ts";
import * as repo from "../repositories/game-repository.ts";
import type { Seat } from "../repositories/game-repository.ts";

export type PlaceAction = { type: "place"; row: number; col: number };
export type GameAction = PlaceAction | { type: "resign" };

export type Finish =
  | { outcome: "win"; winner: Seat; reason: string }
  | { outcome: "draw"; reason: "draw" };

// Decision returned by a game engine for one placement. The engine owns the
// rules (C); this service owns locking, versioning and persistence (B).
export type RuleDecision =
  | { ok: false; code: string }
  | { ok: true; nextTurn: Seat | null; finish?: Finish };

export type GameRules = (input: {
  moves: { row: number; col: number; stone: string }[];
  seat: Seat;
  action: PlaceAction;
}) => RuleDecision;

export type GameCommand = {
  matchId: number;
  userId: number;
  commandId: string;
  expectedVersion: number;
  action: GameAction;
};

export type CommandResult =
  | { status: "applied"; stateVersion: number; duplicate: boolean }
  | { status: "rejected"; code: string; duplicate: boolean };

const commandTypes = { place: "place", resign: "resign" } as const;

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
      finish.outcome === "draw"
        ? "draw"
        : player.userId === winnerUserId
          ? "win"
          : "loss";
    await repo.setPlayerResult(tx, gameId, player.userId, result);
  }
}

export function createGameCommandService(
  db: Database,
  rulesByGameType: Record<string, GameRules>,
) {
  return {
    // Starts a two-player match directly in "playing" (matchmaking is D's part).
    createMatch(input: {
      gameType: string;
      rulesVersion: string;
      blackUserId: number;
      whiteUserId: number;
    }) {
      return db.transaction(async (tx) => {
        const game = await repo.insertGame(tx, {
          gameType: input.gameType,
          rulesVersion: input.rulesVersion,
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

    // Order: lock match → participant → duplicate commandId → status →
    // expectedVersion → rules → save move/version/command/result → commit.
    // Network sends must happen after this resolves, never inside it.
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
                code: previous.rejectCode!,
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
        const reject = async (code: string): Promise<CommandResult> => {
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
          const rules = rulesByGameType[game.gameType];
          if (!rules)
            throw new Error(`No rules registered for ${game.gameType}.`);
          const history = await repo.findMoves(tx, game.id);
          const decision = rules({
            moves: history,
            seat,
            action: command.action,
          });
          if (!decision.ok) return reject(decision.code);
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

    // Data the match layer (D) needs to build a GameSnapshot; board comes from
    // replaying moves with the engine.
    // One REPEATABLE READ snapshot, so stateVersion, players and moves always
    // describe the same moment even if a command commits in between.
    getMatch(matchId: number) {
      return db.transaction(
        async (tx) => {
          const game = await repo.findGame(tx, matchId);
          if (!game) return undefined;
          const players = await repo.findPlayers(tx, matchId);
          const history = await repo.findMoves(tx, matchId);
          return { game, players, moves: history };
        },
        { isolationLevel: "repeatable read", accessMode: "read only" },
      );
    },
  };
}

export type GameCommandService = ReturnType<typeof createGameCommandService>;
