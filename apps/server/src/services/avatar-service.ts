import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Database } from "../db/client.ts";
import { inspectImage } from "../core/image.ts";
import type { PublicUser } from "../repositories/auth-repository.ts";
import * as repo from "../repositories/user-repository.ts";

// DEC-05: PNG/JPEG up to 2 MiB. Size limit on each side is the SDS proposal.
export const avatarMaxBytes = 2 * 1024 * 1024;
export const avatarMaxSide = 1024;
export const avatarUrlPrefix = "/api/media/avatars/";
// Only names this service creates. Anything else is never read or deleted,
// so a request or a stored URL cannot point outside the avatar directory.
const fileNamePattern = /^[1-9]\d*-[0-9a-f]{16}\.(png|jpg)$/;

export type SaveAvatarResult =
  | { ok: true; user: PublicUser }
  | { ok: false; code: "UNSUPPORTED_IMAGE" | "IMAGE_TOO_BIG" | "NOT_FOUND" };

async function removeQuietly(path: string) {
  // Best effort: a leftover file is harmless, a failed request is not.
  await unlink(path).catch(() => {});
}

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

    async remove(userId: number) {
      const swapped = await swapUrl(userId, null);
      if (!swapped) return false;
      const previous = storedPath(swapped.previous);
      if (previous) await removeQuietly(previous);
      return true;
    },

    // Deletes the file behind a stored URL. Used after account deletion
    // commits, when the URL is already cleared from the user row.
    async removeFile(avatarUrl: string | null) {
      const path = storedPath(avatarUrl);
      if (path) await removeQuietly(path);
    },

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
