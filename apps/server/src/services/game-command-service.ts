import type { Database, Executor } from "../db/client.ts";
import * as repo from "../repositories/game-repository.ts";
import type { Seat } from "../repositories/game-repository.ts";

export type PlaceAction = { type: "place"; row: number; col: number };
export type GameAction = PlaceAction | { type: "resign" };

export type Finish =
  | { outcome: "win"; winner: Seat; reason: string }
  | { outcome: "draw"; reason: "draw" }
  | { outcome: "void"; reason: string };

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

// One engine per game type. The server, not the caller, decides which rules
// version a new match uses, so only registered versions are ever stored.
export type RegisteredRules = { version: string; rules: GameRules };

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

export type SystemFinish = {
  matchId: number;
  reason: "disconnect_timeout";
  absentUserIds: number[];
  expectedVersion: number;
};

export type SystemFinishResult =
  | { status: "finished"; stateVersion: number }
  | { status: "skipped" };

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
      finish.outcome !== "win"
        ? finish.outcome
        : player.userId === winnerUserId
          ? "win"
          : "loss";
    await repo.setPlayerResult(tx, gameId, player.userId, result);
  }
}

// Run once at startup, before listen. Clocks and sockets of unfinished matches
// did not survive the restart, so they end as void in one transaction.
// Assumes a single API instance: another running instance would lose its
// live matches.
export function voidUnfinishedGames(db: Database) {
  return db.transaction((tx) => repo.voidUnfinishedGames(tx, "server_restart"));
}

export function createGameCommandService(
  db: Database,
  rulesByGameType: Record<string, RegisteredRules>,
) {
  return {
    // Starts a two-player match directly in "playing" (matchmaking is D's part).
    async createMatch(input: {
      gameType: string;
      blackUserId: number;
      whiteUserId: number;
    }) {
      const registered = rulesByGameType[input.gameType];
      if (!registered) {
        throw new Error(`No rules registered for ${input.gameType}.`);
      }
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
          const registered = rulesByGameType[game.gameType];
          if (!registered)
            throw new Error(`No rules registered for ${game.gameType}.`);
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

    // Called by the match layer (D) when a disconnect budget runs out. Takes
    // the same match lock as apply(), so a return or a last move that commits
    // first wins and this call does nothing (status or version moved on).
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
