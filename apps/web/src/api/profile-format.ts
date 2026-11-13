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

/** 서버 `nicknameSchema`(`apps/server/src/api/auth-routes.ts`)와 같은 규칙입니다. */
export const NICKNAME_PATTERN = "[\\p{L}\\p{N}_\\-]{2,32}";
export const NICKNAME_RULE_MESSAGE =
  "닉네임은 2~32자의 문자, 숫자, 밑줄(_), 하이픈(-)만 사용할 수 있습니다.";

/**
 * 닉네임을 보내기 전에 서버와 같은 규칙으로 확인하고 문제가 있으면 안내 문구를 반환합니다.
 * 중복 여부는 서버가 판정합니다.
 */
export function validateNickname(nickname: string): string | null {
  return new RegExp(`^${NICKNAME_PATTERN}$`, "v").test(nickname)
    ? null
    : NICKNAME_RULE_MESSAGE;
}

/**
 * 2FA 코드가 인증 앱의 6자리 숫자나 복구 코드(`ABCD-EFGH`) 형식인지 확인합니다.
 * 코드가 맞는지는 서버가 판정합니다.
 *
 * @remarks 서버와 같은 기준입니다. 정확히 6자리 숫자면 인증 앱 코드, 그 밖에는 16자 이하에서 공백·하이픈을 모두 지우고 대소문자를 무시한 복구 코드로 봅니다.
 */
export function validateTwoFactorCode(code: string): string | null {
  return /^\d{6}$/.test(code) ||
    (code.length <= 16 && /^[A-Z2-7]{8}$/i.test(code.replace(/[\s-]/g, "")))
    ? null
    : "현재 6자리 인증 코드 또는 복구 코드(ABCD-EFGH)를 입력해 주세요.";
}
