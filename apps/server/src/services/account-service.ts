import type { Database } from "../db/client.ts";
import { verifyPassword } from "../core/password.ts";
import * as repo from "../repositories/account-repository.ts";
import * as twoFactorRepo from "../repositories/two-factor-repository.ts";
import { ServiceUnavailableError } from "./auth-service.ts";
import type { AvatarService } from "./avatar-service.ts";
import type { TwoFactorService } from "./two-factor-service.ts";

/** 비밀번호도 2FA도 없는 42 OAuth 계정이 탈퇴하려면 이 시간(초) 안에 로그인했어야 합니다. */
export const RECENT_LOGIN_SECONDS = 10 * 60;

/** 탈퇴 결과. `NOT_FOUND`는 이미 탈퇴했거나 없는 계정입니다. */
export type DeleteAccountResult =
  | { ok: true }
  | {
      ok: false;
      code:
        | "NOT_FOUND"
        | "INVALID_CREDENTIALS"
        | "INVALID_TWO_FACTOR_CODE"
        | "RECENT_LOGIN_REQUIRED"
        | "ACTIVE_MATCH";
    };

/**
 * 회원 탈퇴를 맡는 서비스를 만듭니다.
 *
 * @param onSessionsRevoked - 탈퇴로 폐기한 세션 ID를 commit 후에 받습니다. 실시간 계층이 그 세션의 연결을 닫는 데 씁니다(IF-03).
 * @param onFriendsRemoved - commit 후 탈퇴 사용자와 관계가 삭제된 상대 ID를 받습니다. 관계 재조회 알림과 진행 중인 presence 조회 무효화에 씁니다.
 */
export function createAccountService(
  db: Database,
  twoFactor?: TwoFactorService,
  avatars?: AvatarService,
  onSessionsRevoked?: (sessionIds: string[]) => void,
  onFriendsRemoved?: (userId: number, friendIds: number[]) => void,
) {
  return {
    /**
     * 계정을 탈퇴 처리합니다(DEC-09).
     *
     * @remarks
     * 본인 확인은 비밀번호, 비밀번호가 없는 OAuth 계정은 2FA 코드(복구 코드 포함),
     * 2FA도 없으면 {@link RECENT_LOGIN_SECONDS} 안의 로그인입니다. 끝나지 않은 경기가
     * 있으면 결과가 열린 채 남지 않도록 거절합니다. 친구 관계 삭제는 같은 transaction에서,
     * 관계 변경 알림·아바타 파일 삭제·세션 연결 종료는 commit 뒤에 합니다.
     *
     * @param sessionId - 요청한 세션. 최근 로그인 확인에 씁니다.
     * @throws {@link ServiceUnavailableError} 2FA 계정인데 2FA 키가 설정되지 않은 경우
     */
    async deleteAccount(
      userId: number,
      sessionId: string,
      input: { password?: string; code?: string },
    ): Promise<DeleteAccountResult> {
      const now = new Date();
      const result = await db.transaction(
        async (
          tx,
        ): Promise<
          DeleteAccountResult & {
            avatarUrl?: string | null;
            revokedSessionIds?: string[];
            friendIds?: number[];
          }
        > => {
          const user = await repo.findActiveUserForUpdate(tx, userId);
          if (!user) return { ok: false, code: "NOT_FOUND" };
          // Checked before the code so a refused request never uses up a
          // recovery code or TOTP step.
          if (await repo.hasUnfinishedMatch(tx, userId)) {
            return { ok: false, code: "ACTIVE_MATCH" };
          }

          if (user.passwordHash) {
            const valid =
              input.password !== undefined &&
              (await verifyPassword(user.passwordHash, input.password));
            if (!valid) return { ok: false, code: "INVALID_CREDENTIALS" };
          } else if (await twoFactorRepo.isEnabled(tx, userId)) {
            if (!twoFactor) throw new ServiceUnavailableError();
            const valid =
              input.code !== undefined &&
              (await twoFactor.verifyCode(tx, userId, input.code));
            if (!valid) return { ok: false, code: "INVALID_TWO_FACTOR_CODE" };
          } else {
            const loggedInAt = await repo.findSessionCreatedAt(tx, sessionId);
            const limit = now.getTime() - RECENT_LOGIN_SECONDS * 1000;
            if (!loggedInAt || loggedInAt.getTime() < limit) {
              return { ok: false, code: "RECENT_LOGIN_REQUIRED" };
            }
          }

          const removed = await repo.anonymizeUser(tx, userId, now);
          return { ok: true, avatarUrl: user.avatarUrl, ...removed };
        },
      );
      if (!result.ok) return result;
      onFriendsRemoved?.(userId, result.friendIds ?? []);
      onSessionsRevoked?.(result.revokedSessionIds ?? []);
      // After commit: a leftover file is harmless, a rolled-back deletion
      // with its avatar gone is not.
      await avatars?.removeFile(result.avatarUrl ?? null);
      return { ok: true };
    },
  };
}

export type AccountService = ReturnType<typeof createAccountService>;
