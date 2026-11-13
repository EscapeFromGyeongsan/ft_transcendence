import type { GameType, MatchResult } from "./profile-api.ts";

export const GAME_LABELS: Record<GameType, string> = {
  gomoku: "오목 (15×15)",
  othello: "오델로 (8×8)",
};

export const RESULT_LABELS: Record<MatchResult, string> = {
  win: "승리",
  loss: "패배",
  draw: "무승부",
  void: "무효",
};

/**
 * 아바타 이미지가 없을 때 원형 기본 이미지에 표시할 한 글자를 반환합니다.
 */
export function avatarInitial(nickname: string | null | undefined): string {
  const first = Array.from(nickname?.trim() ?? "")[0];
  return first ? first.toUpperCase() : "?";
}

/**
 * 0~1 범위 승률을 `66.7%` 형태의 문자열로 변환합니다.
 */
export function formatWinRate(winRate: number): string {
  if (!Number.isFinite(winRate)) return "0.0%";
  return `${(winRate * 100).toFixed(1)}%`;
}

/**
 * ISO 날짜 문자열을 `2024.11.02` 형태로 변환합니다 (로컬 시간대 기준).
 */
export function formatMatchDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "-";
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}.${mm}.${dd}`;
}

/**
 * 게임별 통계를 합산해 전체 전적과 종합 승률을 계산합니다.
 */
export function sumStats(
  list: ReadonlyArray<{ wins: number; losses: number; draws: number }>,
): {
  wins: number;
  losses: number;
  draws: number;
  played: number;
  winRate: number;
} {
  const wins = list.reduce((acc, s) => acc + s.wins, 0);
  const losses = list.reduce((acc, s) => acc + s.losses, 0);
  const draws = list.reduce((acc, s) => acc + s.draws, 0);
  const played = wins + losses + draws;
  return {
    wins,
    losses,
    draws,
    played,
    winRate: played === 0 ? 0 : wins / played,
  };
}

/** 서버 제한과 동일한 클라이언트 사전 검증 기준 (PNG/JPEG, 2 MiB). */
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
export const AVATAR_ACCEPT_TYPES = ["image/png", "image/jpeg"];

/**
 * 아바타 업로드 전 파일 형식·크기를 확인하고 문제가 있으면 안내 문구를 반환합니다.
 * 최종 판정(파일 내용 확인, 해상도)은 서버가 수행합니다.
 */
export function validateAvatarFile(file: {
  type: string;
  size: number;
}): string | null {
  if (!AVATAR_ACCEPT_TYPES.includes(file.type)) {
    return "PNG 또는 JPEG 이미지만 업로드할 수 있습니다.";
  }
  if (file.size > AVATAR_MAX_BYTES) {
    return "이미지 크기는 2MB 이하여야 합니다.";
  }
  return null;
}
