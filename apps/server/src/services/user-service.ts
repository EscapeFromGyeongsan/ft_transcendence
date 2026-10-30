import type { Database } from "../db/client.ts";
import type { PublicUser } from "../repositories/auth-repository.ts";
import * as repo from "../repositories/user-repository.ts";
import { uniqueViolation } from "./auth-service.ts";

export type UpdateNicknameResult =
  | { ok: true; user: PublicUser }
  | { ok: false; code: "NICKNAME_TAKEN" | "NOT_FOUND" };

export function createUserService(db: Database) {
  return {
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
