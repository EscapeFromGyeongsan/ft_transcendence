import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Database } from "../db/client.ts";
import { inspectImage } from "../core/image.ts";
import type { PublicUser } from "../repositories/auth-repository.ts";
import * as repo from "../repositories/user-repository.ts";

/** 아바타 파일 최대 크기(바이트). DEC-05의 PNG/JPEG 2 MiB 제한입니다. */
export const avatarMaxBytes = 2 * 1024 * 1024;
/** 아바타 가로·세로 최대 픽셀 수. SDS 제안값입니다. */
export const avatarMaxSide = 1024;
/** 저장한 아바타의 공개 URL 접두사. `users.avatar_url`은 이 접두사 + 파일 이름입니다. */
export const avatarUrlPrefix = "/api/media/avatars/";
// Only names this service creates. Anything else is never read or deleted,
// so a request or a stored URL cannot point outside the avatar directory.
const fileNamePattern = /^[1-9]\d*-[0-9a-f]{16}\.(png|jpg)$/;

/**
 * `save()`의 결과입니다.
 *
 * @remarks
 * 실패 코드: `UNSUPPORTED_IMAGE`(PNG/JPEG가 아님), `IMAGE_TOO_BIG`(가로·세로가 {@link avatarMaxSide} 초과 또는 0), `NOT_FOUND`(사용자 없음).
 * 실패하면 기존 아바타가 그대로 남습니다.
 */
export type SaveAvatarResult =
  | { ok: true; user: PublicUser }
  | { ok: false; code: "UNSUPPORTED_IMAGE" | "IMAGE_TOO_BIG" | "NOT_FOUND" };

async function removeQuietly(path: string) {
  // Best effort: a leftover file is harmless, a failed request is not.
  await unlink(path).catch(() => {});
}

/**
 * 아바타 업로드·삭제·파일 제공 서비스를 만듭니다.
 *
 * @param avatarDir - 아바타 파일을 저장하는 디렉터리. 없으면 첫 업로드 때 만듭니다.
 *
 * @remarks
 * 이 서비스가 만든 이름(`{userId}-{16자리 hex}.png|jpg`)만 읽고 지웁니다. 요청이나 저장된 URL로 디렉터리 밖 파일을 가리킬 수 없습니다.
 */
export function createAvatarService(db: Database, avatarDir: string) {
  const storedPath = (avatarUrl: string | null) => {
    if (!avatarUrl?.startsWith(avatarUrlPrefix)) return undefined;
    const name = avatarUrl.slice(avatarUrlPrefix.length);
    return fileNamePattern.test(name) ? join(avatarDir, name) : undefined;
  };

  // Swaps the user's avatar URL in one locked transaction and returns the
  // previous URL so its file can be deleted after commit.
  const swapUrl = (userId: number, avatarUrl: string | null) =>
    db.transaction(async (tx) => {
      const current = await repo.findAvatarForUpdate(tx, userId);
      if (!current) return undefined;
      const user = await repo.updateAvatarUrl(tx, userId, avatarUrl);
      return { previous: current.avatarUrl, user: user! };
    });

  return {
    /**
     * 이미지를 검사해 저장하고 사용자의 아바타 URL을 바꿉니다.
     *
     * @param data - 업로드된 파일 내용. 형식과 크기는 파일 이름이나 Content-Type이 아니라 이 내용으로 판단합니다.
     * @throws 파일 쓰기 또는 DB 갱신 실패. 이때 새 파일은 지우고 기존 아바타를 유지합니다.
     *
     * @remarks
     * 임시 이름으로 쓴 뒤 rename하므로 쓰다 만 파일이 최종 이름으로 제공되지 않습니다.
     * URL 교체는 사용자 행을 잠근 트랜잭션에서 하고, 이전 파일은 commit 후 지웁니다. 파일 삭제 실패는 무시합니다.
     */
    async save(userId: number, data: Buffer): Promise<SaveAvatarResult> {
      const image = inspectImage(data);
      if (!image) return { ok: false, code: "UNSUPPORTED_IMAGE" };
      if (
        image.width < 1 ||
        image.height < 1 ||
        image.width > avatarMaxSide ||
        image.height > avatarMaxSide
      ) {
        return { ok: false, code: "IMAGE_TOO_BIG" };
      }

      // Write under a temporary name, then rename, so a half-written file is
      // never served under the final name.
      await mkdir(avatarDir, { recursive: true });
      const name = `${userId}-${randomBytes(8).toString("hex")}.${image.type}`;
      const path = join(avatarDir, name);
      const temporary = join(avatarDir, `.${name}.tmp`);
      try {
        await writeFile(temporary, data);
        await rename(temporary, path);
      } catch (error) {
        await removeQuietly(temporary);
        throw error;
      }

      let swapped;
      try {
        swapped = await swapUrl(userId, avatarUrlPrefix + name);
      } catch (error) {
        // DB update failed: keep the old avatar and drop the new file.
        await removeQuietly(path);
        throw error;
      }
      if (!swapped) {
        await removeQuietly(path);
        return { ok: false, code: "NOT_FOUND" };
      }
      const previous = storedPath(swapped.previous);
      if (previous) await removeQuietly(previous);
      return { ok: true, user: swapped.user };
    },

    /**
     * 사용자의 아바타를 지웁니다(URL을 `null`로 바꾸고 파일 삭제).
     *
     * @returns 사용자가 있으면 `true`, 없으면 `false`. 아바타가 원래 없어도 `true`입니다.
     */
    async remove(userId: number) {
      const swapped = await swapUrl(userId, null);
      if (!swapped) return false;
      const previous = storedPath(swapped.previous);
      if (previous) await removeQuietly(previous);
      return true;
    },

    /**
     * 저장된 아바타 파일을 읽습니다.
     *
     * @param name - URL의 파일 이름. 이 서비스가 만든 이름 형식이 아니면 읽지 않습니다.
     * @returns 파일 내용과 Content-Type. 이름이 형식에 맞지 않거나 파일이 없으면 `undefined`
     * @throws `ENOENT` 외의 파일 읽기 오류
     */
    async read(name: string) {
      if (!fileNamePattern.test(name)) return undefined;
      try {
        const data = await readFile(join(avatarDir, name));
        return {
          data,
          contentType: name.endsWith(".png") ? "image/png" : "image/jpeg",
        };
      } catch (error) {
        if ((error as { code?: unknown }).code === "ENOENT") return undefined;
        throw error;
      }
    },
  };
}

export type AvatarService = ReturnType<typeof createAvatarService>;
