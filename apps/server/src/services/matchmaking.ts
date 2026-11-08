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

/**
 * 매칭 신청 결과입니다.
 * - `joined`: 대기열에 들어감
 * - `ALREADY_ACTIVE`: 이미 대기 중이거나 끝나지 않은 경기가 있음
 * - `closed`: 진행 중 경기를 확인하는 사이에 연결이 닫혀 등록하지 않음
 */
export type JoinResult = "joined" | "ALREADY_ACTIVE" | "closed";
/**
 * 매칭 취소 결과입니다. `ALREADY_MATCHED`는 이미 경기를 만드는 중이라
 * 취소할 수 없다는 뜻입니다.
 */
export type LeaveResult = "left" | "ALREADY_MATCHED";

/**
 * 자동 매칭 대기열을 만듭니다(SDS 2.7의 7.1, IF-06).
 *
 * @param deps.send - 매칭 실패 오류를 신청한 연결에 보내는 함수
 * @param deps.notifyUser - `queue.matched`를 사용자의 모든 연결에 보내는 함수.
 *   신청한 탭이 매칭 중에 닫혀도 다른 탭이 경기를 알 수 있습니다.
 * @param deps.onError - `createMatch()` 실패를 기록하는 함수
 * @param deps.random - 흑·백 배정에 쓰는 난수. 테스트에서 고정할 때 넘깁니다.
 * @param deps.onMatched - 경기가 만들어진 직후, 알림을 보내기 전에 호출됩니다.
 *   이탈 시계 시작에 씁니다.
 *
 * @remarks
 * 게임 종류별로 먼저 온 순서대로 두 명씩 짝을 짓고, 색은 무작위로 정해
 * `createMatch()`를 호출합니다. 두 사람에게 `queue.matched`를 보냅니다.
 *
 * 대기열은 메모리에만 있습니다. API 인스턴스 1개를 전제하며, 재시작하면
 * 대기열은 사라지고 진행 중 경기는 void가 됩니다. 대기 항목은 신청한 연결에
 * 묶여 있어, 그 연결이 닫히면 대기열에서 빠집니다.
 *
 * 동시성: 짝은 한 tick 안에서 동기적으로 뽑으므로 한 사람이 두 경기에
 * 들어가지 않습니다. `createMatch()`가 실행되는 동안 두 사람은 `matching`
 * 상태로 남아 다시 신청하거나 취소할 수 없습니다. 실패하면 둘 다 대기 전
 * 상태로 돌아가고 오류를 받습니다.
 */
export function createMatchmaking(deps: {
  getGames: () => GameCommandService;
  send: (socket: WebSocket, type: string, payload: object) => void;
  notifyUser: (userId: number, type: string, payload: object) => void;
  onError: (error: unknown) => void;
  random?: () => number;
  onMatched?: (matchId: number, userIds: number[]) => void;
}) {
  const random = deps.random ?? Math.random;
  const queues = new Map<GameType, Entry[]>();
  const entries = new Map<number, Entry>();
  // Users whose join is still checking the DB.
  const joining = new Set<number>();

  function dequeue(entry: Entry) {
    const queue = queues.get(entry.gameType) ?? [];
    const index = queue.indexOf(entry);
    if (index >= 0) queue.splice(index, 1);
    if (entries.get(entry.userId) === entry) entries.delete(entry.userId);
  }

  // Pairs are taken synchronously, so one entry never ends up in two matches.
  function pairNext(gameType: GameType) {
    const queue = queues.get(gameType) ?? [];
    const waiting = queue.filter((entry) => entry.state === "waiting");
    if (waiting.length < 2) return;
    const pair = waiting.slice(0, 2);
    for (const entry of pair) entry.state = "matching";
    void createMatch(pair).catch(deps.onError);
  }

  async function createMatch(pair: Entry[]) {
    const [black, white] = random() < 0.5 ? pair : [pair[1], pair[0]];
    try {
      const matchId = await deps.getGames().createMatch({
        gameType: black.gameType,
        blackUserId: black.userId,
        whiteUserId: white.userId,
      });
      deps.onMatched?.(matchId, [black.userId, white.userId]);
      for (const entry of pair) {
        dequeue(entry);
        deps.notifyUser(entry.userId, "queue.matched", {
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
    /**
     * 사용자를 게임 종류의 대기열에 넣고, 두 명이 모이면 매칭을 시작합니다.
     *
     * @remarks
     * 끝나지 않은 경기는 DB로 확인합니다(`findActiveMatchId`). 조회하는 동안
     * 그 사용자의 다른 신청은 거절하므로, 여러 탭에서 동시에 신청해도 하나만
     * 들어갑니다. 한 신청이 매칭까지 끝내는 사이 다른 신청의 조회가 예전 DB
     * 상태를 읽어 다시 대기열에 들어가는 일이 없습니다.
     */
    async join(
      userId: number,
      socket: WebSocket,
      gameType: GameType,
    ): Promise<JoinResult> {
      if (entries.has(userId) || joining.has(userId)) return "ALREADY_ACTIVE";
      joining.add(userId);
      let activeMatchId: number | undefined;
      try {
        activeMatchId = await deps.getGames().findActiveMatchId(userId);
      } finally {
        joining.delete(userId);
      }
      if (activeMatchId !== undefined) return "ALREADY_ACTIVE";
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

    /** 대기열에서 뺍니다. 대기 중이 아니어도 `left`를 돌려줍니다. */
    leave(userId: number): LeaveResult {
      const entry = entries.get(userId);
      if (!entry) return "left";
      if (entry.state === "matching") return "ALREADY_MATCHED";
      dequeue(entry);
      return "left";
    },

    /**
     * 닫힌 연결이 신청한 대기 항목을 뺍니다. 이미 경기를 만드는 중인 항목은
     * 그대로 두어 경기가 만들어집니다.
     */
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
