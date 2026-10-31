import type { GameType } from "@cafe/game-contracts";
import type { WebSocket } from "ws";
import type { GameCommandService } from "./game-command-service.ts";

type Entry = {
  userId: number;
  socket: WebSocket;
  gameType: GameType;
  // "matching" while createMatch() runs: too late to leave, still busy.
  state: "waiting" | "matching";
};

export type JoinResult = "joined" | "ALREADY_ACTIVE" | "closed";
export type LeaveResult = "left" | "ALREADY_MATCHED";

// Automatic matchmaking (SDS 2.7의 7.1, IF-06). Queues live in memory: the
// API runs as one instance and a restart voids unfinished matches anyway.
// A queue entry belongs to the socket that joined; closing it leaves.
export function createMatchmaking(deps: {
  getGames: () => GameCommandService;
  send: (socket: WebSocket, type: string, payload: object) => void;
  onError: (error: unknown) => void;
  random?: () => number;
}) {
  const random = deps.random ?? Math.random;
  const queues = new Map<GameType, Entry[]>();
  const entries = new Map<number, Entry>();

  function dequeue(entry: Entry) {
    const queue = queues.get(entry.gameType) ?? [];
    queue.splice(queue.indexOf(entry), 1);
    entries.delete(entry.userId);
  }

  // Pairs are taken synchronously, so one entry never ends up in two matches.
  function pairNext(gameType: GameType) {
    const queue = queues.get(gameType) ?? [];
    const waiting = queue.filter((entry) => entry.state === "waiting");
    if (waiting.length < 2) return;
    const pair = waiting.slice(0, 2);
    for (const entry of pair) entry.state = "matching";
    void createMatch(pair);
  }

  async function createMatch(pair: Entry[]) {
    const [black, white] = random() < 0.5 ? pair : [pair[1], pair[0]];
    try {
      const matchId = await deps.getGames().createMatch({
        gameType: black.gameType,
        blackUserId: black.userId,
        whiteUserId: white.userId,
      });
      for (const entry of pair) {
        dequeue(entry);
        deps.send(entry.socket, "queue.matched", {
          matchId,
          gameType: entry.gameType,
        });
      }
    } catch (error) {
      // Both go back to idle and may join again.
      deps.onError(error);
      for (const entry of pair) {
        dequeue(entry);
        deps.send(entry.socket, "error", {
          code: "INTERNAL_ERROR",
          message: "Matchmaking failed. Join the queue again.",
        });
      }
    }
  }

  return {
    async join(
      userId: number,
      socket: WebSocket,
      gameType: GameType,
    ): Promise<JoinResult> {
      // Checked before and after the lookup: a join that starts while the
      // user is being matched must not see the old DB state as idle.
      if (entries.has(userId)) return "ALREADY_ACTIVE";
      const activeMatchId = await deps.getGames().findActiveMatchId(userId);
      if (activeMatchId !== undefined || entries.has(userId)) {
        return "ALREADY_ACTIVE";
      }
      // Closed during the lookup: removeSocket() has already run.
      if (socket.readyState !== socket.OPEN) return "closed";
      const entry: Entry = { userId, socket, gameType, state: "waiting" };
      entries.set(userId, entry);
      const queue = queues.get(gameType) ?? [];
      queue.push(entry);
      queues.set(gameType, queue);
      pairNext(gameType);
      return "joined";
    },

    // Leaving when not queued is fine (idempotent).
    leave(userId: number): LeaveResult {
      const entry = entries.get(userId);
      if (!entry) return "left";
      if (entry.state === "matching") return "ALREADY_MATCHED";
      dequeue(entry);
      return "left";
    },

    removeSocket(socket: WebSocket) {
      for (const entry of entries.values()) {
        if (entry.socket === socket && entry.state === "waiting") {
          dequeue(entry);
        }
      }
    },

    isQueued(userId: number) {
      return entries.has(userId);
    },
  };
}

export type Matchmaking = ReturnType<typeof createMatchmaking>;
