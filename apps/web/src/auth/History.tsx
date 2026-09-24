import { getGamePresentation } from "../games/registry";
import { useEffect, useState } from "react";

type HistoryData = {
  summary: {
    total: number;
    wins: number;
    losses: number;
    draws: number;
    winRate: number;
  };
  matches: {
    id: string;
    gameType: string;
    roomTitle: string;
    opponent: string;
    startedAt: string;
    finishedAt: string;
    outcome: "win" | "loss" | "draw";
    reason: string;
    moveCount: number | null;
  }[];
  nextOffset: number | null;
};
export function History() {
  const [data, setData] = useState<HistoryData | null>(null);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    void fetch(`/api/me/matches?offset=${offset}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok)
          throw new Error(
            response.status === 401
              ? "전적을 보려면 로그인해 주세요."
              : "전적을 불러오지 못했어요.",
          );
        return response.json() as Promise<HistoryData>;
      })
      .then((value) => {
        if (!controller.signal.aborted) setData(value);
      })
      .catch((reason) => {
        if (!controller.signal.aborted) {
          setError(reason.message);
          setData(null);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [offset]);
  return (
    <section className="room-lobby" aria-labelledby="history-title">
      <h1 id="history-title">내 전적</h1>
      <p>
        완료된 온라인 대국의 기록이에요. 승률은 전체 완료 경기 중 승리한
        비율입니다.
      </p>
      {error && (
        <>
          <p role="alert">{error}</p>
          <a href="#/account">내 계정으로 이동</a>
        </>
      )}
      {loading && <p role="status">전적을 불러오고 있어요.</p>}
      {!loading && data && (
        <>
          <p className="lobby-notice" aria-label="전적 요약">
            총 {data.summary.total}경기 · {data.summary.wins}승 ·{" "}
            {data.summary.losses}패 · {data.summary.draws}무 · 승률{" "}
            {data.summary.winRate}%
          </p>
          {!data.summary.total && (
            <p>
              아직 완료한 대국이 없어요.{" "}
              <a href="#/rooms">온라인 대국 시작하기</a>
            </p>
          )}
          <div className="room-list">
            {data.matches.map((match) => (
              <article className="room-list-card" key={match.id}>
                <h2>
                  {match.outcome === "win"
                    ? "승리"
                    : match.outcome === "loss"
                      ? "패배"
                      : "무승부"}{" "}
                  · 상대 {match.opponent}
                </h2>
                <p>{match.roomTitle}</p>
                <p>
                  <time dateTime={match.startedAt}>
                    시작 {new Date(match.startedAt).toLocaleString("ko-KR")}
                  </time>
                </p>
                <p>
                  <time dateTime={match.finishedAt}>
                    종료 {new Date(match.finishedAt).toLocaleString("ko-KR")}
                  </time>
                </p>
                <p>
                  {getGamePresentation(match.gameType)?.resultLabel(
                    match.reason,
                  ) ?? match.reason}
                  {match.moveCount !== null && <> · {match.moveCount}수</>}
                </p>
              </article>
            ))}
          </div>
          <div className="dialog-actions">
            <button
              className="button secondary"
              disabled={!offset}
              onClick={() => setOffset(Math.max(0, offset - 20))}
            >
              이전 기록
            </button>
            <button
              className="button secondary"
              disabled={data.nextOffset === null}
              onClick={() => setOffset(data.nextOffset!)}
            >
              다음 기록
            </button>
          </div>
        </>
      )}
    </section>
  );
}
