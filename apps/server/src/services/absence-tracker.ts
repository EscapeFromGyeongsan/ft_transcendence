type Presence = {
  // Subscribed sockets of this user for the match.
  connections: number;
  usedMs: number;
  // Start of the current absence, or null while connected.
  since: number | null;
  // Connected at least once, so a return counts as a reconnect.
  seen: boolean;
  timer?: ReturnType<typeof setTimeout>;
};

/**
 * 경기별 사용자 이탈 시간을 재는 시계를 만듭니다(DEC-03, SDS 2.6의 13번).
 *
 * @param deps.budgetMs - 사용자별 경기 내 누적 이탈 허용 시간. 기본값 60000
 * @param deps.notify - 이탈·복귀를 경기 구독자에게 알리는 함수
 *   (`player.disconnected`, `player.reconnected`)
 * @param deps.onExpire - 누군가의 누적 이탈 시간이 다 찼을 때 호출됩니다.
 *   그 순간 연결이 없는 사용자 전원이 `absentUserIds`로 넘어갑니다.
 *
 * @remarks
 * 이탈 단위는 사용자입니다. 그 경기를 구독한 연결이 0개가 되면 이탈이
 * 시작되고, 1개 이상이 되면 끝납니다. 시계는 메모리에만 있으며 API 인스턴스
 * 1개를 전제합니다. 재시작하면 진행 중 경기는 void가 되므로 저장하지 않습니다.
 *
 * 만료 후에는 그 경기의 타이머를 모두 멈춥니다. 결과 저장이 끝나면 호출하는
 * 쪽이 {@link finish}로 추적을 끝냅니다.
 */
export function createAbsenceTracker(deps: {
  budgetMs?: number;
  notify: (matchId: number, type: string, payload: object) => void;
  onExpire: (matchId: number, absentUserIds: number[]) => void;
}) {
  const budgetMs = deps.budgetMs ?? 60_000;
  const matches = new Map<number, Map<number, Presence>>();

  const remaining = (p: Presence, at: number) =>
    Math.max(0, budgetMs - p.usedMs - (p.since === null ? 0 : at - p.since));

  function stopTimers(players: Map<number, Presence>) {
    for (const p of players.values()) clearTimeout(p.timer);
  }

  function schedule(matchId: number, p: Presence, at: number) {
    clearTimeout(p.timer);
    p.timer = setTimeout(
      () => {
        const players = matches.get(matchId);
        if (!players) return;
        stopTimers(players);
        const absent = [...players]
          .filter(([, q]) => q.connections === 0)
          .map(([userId]) => userId);
        deps.onExpire(matchId, absent);
      },
      remaining(p, at),
    );
  }

  function finish(matchId: number) {
    const players = matches.get(matchId);
    if (players) stopTimers(players);
    matches.delete(matchId);
  }

  return {
    /**
     * 경기 추적을 시작합니다. 이미 추적 중이면 변화가 없습니다.
     *
     * @param at - 이탈 시작으로 볼 시각. 아직 연결하지 않은 참가자는 이때부터
     *   시계가 흐르므로, 매칭 후 나타나지 않으면 기권과 같이 처리됩니다.
     */
    track(matchId: number, userIds: number[], at = Date.now()) {
      if (matches.has(matchId)) return;
      const players = new Map<number, Presence>();
      for (const userId of userIds) {
        const p: Presence = {
          connections: 0,
          usedMs: 0,
          since: at,
          seen: false,
        };
        players.set(userId, p);
        schedule(matchId, p, at);
      }
      matches.set(matchId, players);
    },

    /** 사용자의 경기 연결 하나가 생겼음을 기록합니다. 0→1이면 이탈이 끝납니다. */
    connect(matchId: number, userId: number, at = Date.now()) {
      const p = matches.get(matchId)?.get(userId);
      if (!p) return;
      p.connections++;
      if (p.connections > 1) return;
      p.usedMs += p.since === null ? 0 : at - p.since;
      p.since = null;
      clearTimeout(p.timer);
      if (p.seen) {
        deps.notify(matchId, "player.reconnected", {
          matchId,
          userId,
          remainingMs: remaining(p, at),
        });
      }
      p.seen = true;
    },

    /**
     * 사용자의 경기 연결 하나가 끊겼음을 기록합니다. 1→0이면 이탈이 시작됩니다.
     *
     * @param at - 이탈 시작 시각. heartbeat로 끊김을 감지했으면 마지막으로
     *   응답한 시각을 넘겨, 감지까지 걸린 시간도 이탈로 셉니다.
     */
    disconnect(matchId: number, userId: number, at = Date.now()) {
      const p = matches.get(matchId)?.get(userId);
      if (!p || p.connections === 0) return;
      p.connections--;
      if (p.connections > 0) return;
      p.since = at;
      schedule(matchId, p, Date.now());
      deps.notify(matchId, "player.disconnected", {
        matchId,
        userId,
        remainingMs: remaining(p, Date.now()),
      });
    },

    /** 남은 이탈 허용 시간(ms)입니다. 추적하지 않는 경기면 `undefined`입니다. */
    remainingMs(matchId: number, userId: number) {
      const p = matches.get(matchId)?.get(userId);
      return p && remaining(p, Date.now());
    },

    /** 경기가 끝났을 때 추적과 타이머를 정리합니다. */
    finish,

    /** 서버 종료 시 모든 타이머를 정리합니다. */
    clear() {
      for (const matchId of [...matches.keys()]) finish(matchId);
    },
  };
}

export type AbsenceTracker = ReturnType<typeof createAbsenceTracker>;
