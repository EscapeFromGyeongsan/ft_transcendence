import { useEffect, useState } from "react";
import { getErrorMessage } from "../api/errors.ts";
import {
  profileApi,
  type GameType,
  type LeaderboardEntry,
  type ProfileApi,
} from "../api/profile-api.ts";
import { formatWinRate } from "../api/profile-format.ts";
import { Avatar } from "./Avatar.tsx";

const LEADERBOARD_LIMIT = 50;

/** 로그인 사용자와 프로필 이동 동작·조회 API를 받는 순위 화면 속성입니다. */
interface LeaderboardViewProps {
  currentUserId: number;
  onOpenProfile: (userId: number) => void;
  api?: ProfileApi;
}

const MEDALS = ["1위 금빛 메달", "2위 은빛 메달", "3위 동빛 메달"];

/**
 * 게임별 승수 순위(승수 → 승률 → 사용자 ID 순)를 보여줍니다. 행을 선택하면 해당 사용자의 프로필로 이동합니다.
 */
export function LeaderboardView({
  currentUserId,
  onOpenProfile,
  api = profileApi,
}: LeaderboardViewProps) {
  const [gameType, setGameType] = useState<GameType>("gomoku");
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    api
      .getLeaderboard(gameType, LEADERBOARD_LIMIT)
      .then((list) => {
        if (active) setEntries(list);
      })
      .catch((err) => {
        if (active) {
          setEntries([]);
          setError(getErrorMessage(err));
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [api, gameType]);

  const mine = entries.find((entry) => entry.userId === currentUserId);
  const podium = entries.slice(0, 3);

  return (
    <div className="cbc-profile-page">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <span className="cbc-eyebrow">보드 카페 명예의 전당</span>
          <h1 className="cbc-profile-title">플레이어 순위</h1>
          <p className="m-0 text-sm/5 text-on-surface-variant">
            승수 순으로 정렬되며, 승수가 같으면 승률 순으로 산정됩니다.
          </p>
        </div>
        <div className="cbc-tabs" role="tablist" aria-label="게임 종류">
          {(["gomoku", "othello"] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={gameType === value}
              className={gameType === value ? "is-active" : ""}
              onClick={() => setGameType(value)}
            >
              {value === "gomoku" ? "오목" : "오델로"}
            </button>
          ))}
        </div>
      </header>

      {error && (
        <div className="cbc-error-banner" role="alert">
          <span>{error}</span>
        </div>
      )}

      {mine && (
        <div className="cbc-leaderboard-mine" role="status">
          내 현재 순위 <strong>{mine.rank}위</strong> · {mine.wins}승 / 총{" "}
          {mine.played}국 · 승률 {formatWinRate(mine.winRate)}
        </div>
      )}

      {loading ? (
        <p className="m-0 text-sm/5 text-on-surface-variant" role="status">
          순위를 불러오는 중입니다...
        </p>
      ) : entries.length === 0 && !error ? (
        <p className="m-0 text-sm/5 text-on-surface-variant">
          아직 순위에 오른 플레이어가 없습니다.
        </p>
      ) : (
        <>
          {podium.length > 0 && (
            <div className="cbc-podium">
              {podium.map((entry, index) => (
                <button
                  key={entry.userId}
                  type="button"
                  className="cbc-profile-card cbc-podium-card"
                  onClick={() => onOpenProfile(entry.userId)}
                >
                  <span className="cbc-chip">{MEDALS[index]}</span>
                  <Avatar nickname={entry.nickname} size={64} />
                  <strong>{entry.nickname}</strong>
                  <span>
                    {entry.wins}승 · 총 {entry.played}국
                  </span>
                  <span className="cbc-podium-rate">
                    {formatWinRate(entry.winRate)}
                  </span>
                </button>
              ))}
            </div>
          )}

          <div className="cbc-profile-card cbc-table-wrap">
            <table className="cbc-table">
              <thead>
                <tr>
                  <th>순위</th>
                  <th>플레이어</th>
                  <th>승수</th>
                  <th>전체 경기</th>
                  <th>승률</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr
                    key={entry.userId}
                    className={entry.userId === currentUserId ? "is-mine" : ""}
                  >
                    <td className="cbc-rank-cell">{entry.rank}</td>
                    <td>
                      <button
                        type="button"
                        className="cbc-table-user"
                        onClick={() => onOpenProfile(entry.userId)}
                      >
                        <Avatar nickname={entry.nickname} size={32} />
                        <span>{entry.nickname}</span>
                        {entry.userId === currentUserId && (
                          <span className="cbc-chip">내 순위</span>
                        )}
                      </button>
                    </td>
                    <td>{entry.wins}승</td>
                    <td>{entry.played}국</td>
                    <td>{formatWinRate(entry.winRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
