import { authApi, type AuthUser, type RequestOptions } from "./auth-client.ts";

export type GameType = "gomoku" | "othello";
export type MatchResult = "win" | "loss" | "draw" | "void";

/** 다른 사용자에게 공개되는 프로필 (이메일 제외). */
export interface PublicProfile {
  id: number;
  nickname: string;
  avatarUrl: string | null;
}

export interface GameStats {
  userId: number;
  gameType: GameType;
  wins: number;
  losses: number;
  draws: number;
  played: number;
  /** 0~1 범위 비율. played가 0이면 0입니다. */
  winRate: number;
  achievements: { firstWin: boolean };
  progress: { current: number; target: number };
}

export interface MatchRecord {
  matchId: number;
  gameType: GameType;
  result: MatchResult;
  reason: string;
  seat: "black" | "white";
  opponent: { id: number; nickname: string };
  finishedAt: string;
}

export interface MatchPage {
  matches: MatchRecord[];
  /** 다음(더 오래된) 페이지를 위한 `before` 값. 마지막 페이지면 `null`. */
  nextBefore: number | null;
}

export interface LeaderboardEntry {
  rank: number;
  userId: number;
  nickname: string;
  wins: number;
  played: number;
  winRate: number;
}

export interface MatchQuery {
  gameType?: GameType;
  before?: number;
  limit?: number;
}

type RequestFn = <T>(path: string, options?: RequestOptions) => Promise<T>;

/**
 * 프로필·아바타·통계·전적·리더보드 API 클라이언트를 생성합니다.
 *
 * @param request - 인증 헤더와 401 refresh 재시도를 처리하는 공통 요청 함수
 */
export function createProfileApi(request: RequestFn) {
  return {
    /** 내 정보 조회 (`GET /api/users/me`). */
    getMe: () => request<AuthUser>("/api/users/me"),

    /** 다른 사용자의 공개 프로필 조회 (`GET /api/users/{id}`). */
    getProfile: (userId: number) =>
      request<PublicProfile>(`/api/users/${userId}`),

    /** 닉네임 변경 (`PATCH /api/users/me`). */
    updateNickname: (nickname: string) =>
      request<AuthUser>("/api/users/me", {
        method: "PATCH",
        body: { nickname },
      }),

    /** 아바타 업로드·교체 (`PUT /api/users/me/avatar`, multipart `file`). */
    uploadAvatar: (file: File | Blob) => {
      const form = new FormData();
      form.append("file", file);
      return request<AuthUser>("/api/users/me/avatar", {
        method: "PUT",
        body: form,
      });
    },

    /** 아바타 삭제 → 기본 이미지로 복귀 (`DELETE /api/users/me/avatar`). */
    deleteAvatar: () =>
      request<void>("/api/users/me/avatar", { method: "DELETE" }),

    /** 게임별 승·패·무와 승률 (`GET /api/users/{id}/stats`). */
    getStats: (userId: number, gameType: GameType) =>
      request<GameStats>(`/api/users/${userId}/stats?gameType=${gameType}`),

    /** 종료된 경기 전적, 최신순 (`GET /api/users/{id}/matches`). */
    getMatches: (userId: number, query: MatchQuery = {}) => {
      const params = new URLSearchParams();
      if (query.gameType) params.set("gameType", query.gameType);
      if (query.before !== undefined) {
        params.set("before", String(query.before));
      }
      if (query.limit !== undefined) params.set("limit", String(query.limit));
      const qs = params.toString();
      return request<MatchPage>(
        `/api/users/${userId}/matches${qs ? `?${qs}` : ""}`,
      );
    },

    /** 게임별 승수 순위 (`GET /api/leaderboard`). */
    getLeaderboard: (gameType: GameType, limit = 10) =>
      request<LeaderboardEntry[]>(
        `/api/leaderboard?gameType=${gameType}&limit=${limit}`,
      ),
  };
}

export type ProfileApi = ReturnType<typeof createProfileApi>;

export const profileApi = createProfileApi((path, options) =>
  authApi.request(path, options),
);
