import type { Database } from "../db/client.ts";
import type { PublicUser } from "../repositories/auth-repository.ts";
import * as repo from "../repositories/user-repository.ts";
import { uniqueViolation } from "./auth-service.ts";

export type UpdateProfileResult =
  | { ok: true; user: PublicUser }
  | { ok: false; code: "NICKNAME_TAKEN" | "NOT_FOUND" };

/** 본인의 닉네임·전적 공개 설정 변경과 공개 프로필 조회를 맡습니다. */
export function createUserService(db: Database) {
  return {
    /**
     * 전달된 닉네임·전적 공개 설정을 함께 저장합니다.
     *
     * @returns 중복 닉네임은 `NICKNAME_TAKEN`, 사용자가 없으면 `NOT_FOUND`. 그 밖의 DB 오류는 예외로 전달됩니다.
     */
    async updateProfile(
      userId: number,
      changes: repo.ProfileUpdate,
    ): Promise<UpdateProfileResult> {
      try {
        const user = await repo.updateProfile(db, userId, changes);
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
