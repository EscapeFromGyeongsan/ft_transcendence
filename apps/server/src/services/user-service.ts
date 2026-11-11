import type { Database } from "../db/client.ts";
import type { PublicUser } from "../repositories/auth-repository.ts";
import * as repo from "../repositories/user-repository.ts";
import { uniqueViolation } from "./auth-service.ts";

export type UpdateNicknameResult =
  | { ok: true; user: PublicUser }
  | { ok: false; code: "NICKNAME_TAKEN" | "NOT_FOUND" };

/** 닉네임 변경과 공개 프로필 조회를 맡는 서비스를 만듭니다. */
export function createUserService(db: Database) {
  return {
    /**
     * 닉네임을 바꿉니다.
     *
     * @returns 중복 닉네임은 `NICKNAME_TAKEN`, 사용자가 없으면 `NOT_FOUND`. 그 밖의 DB 오류는 예외로 전달됩니다.
     */
    async updateNickname(
      userId: number,
      nickname: string,
    ): Promise<UpdateNicknameResult> {
      try {
        const user = await repo.updateNickname(db, userId, nickname);
        return user ? { ok: true, user } : { ok: false, code: "NOT_FOUND" };
      } catch (error) {
        if (uniqueViolation(error) === "users_nickname_unique") {
          return { ok: false, code: "NICKNAME_TAKEN" };
        }
        throw error;
      }
    },

    getProfile(userId: number) {
      return repo.findProfile(db, userId);
    },
  };
}

export type UserService = ReturnType<typeof createUserService>;
