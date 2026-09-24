import { expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { openDatabase, type Database } from "./database";
import { history } from "../history";

it("backfills old Omok histories without deleting or duplicating them on restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cafe-adapter-migration-"));
  const old = new PGlite(directory);
  let db: Database | undefined;
  const a = randomUUID(),
    b = randomUUID(),
    match = randomUUID();
  try {
    for (const file of ["001-auth.sql", "002-matches.sql"])
      await old.exec(await readFile(new URL(file, import.meta.url), "utf8"));
    for (const [id, name] of [
      [a, "Old A"],
      [b, "Old B"],
    ])
      await old.query(
        "INSERT INTO users(id,email,display_name,password_hash) VALUES ($1,$2,$3,'unused')",
        [id, `${id}@example.com`, name],
      );
    await old.query(
      `INSERT INTO matches VALUES ($1,$2,'Old game',$3,$4,'Old A','Old B',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,'white','resignation',7)`,
      [match, randomUUID(), a, b],
    );
    await old.close();
    db = await openDatabase({ directory });
    expect((await history(db, b)).matches[0]).toMatchObject({
      id: match,
      gameType: "omok",
      opponent: "Old A",
      outcome: "win",
      reason: "resignation",
      moveCount: 7,
    });
    expect((await history(db, a)).summary.losses).toBe(1);
    await db.close();
    db = await openDatabase({ directory });
    expect((await history(db, b)).summary.total).toBe(1);
    expect(
      (await db.query<{ n: number }>("SELECT count(*)::int AS n FROM matches"))
        .rows[0].n,
    ).toBe(1);
    expect(
      (
        await db.query<{ n: number }>(
          "SELECT count(*)::int AS n FROM game_match_players",
        )
      ).rows[0].n,
    ).toBe(2);
  } finally {
    await db?.close();
    if (!old.closed) await old.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 30000);
