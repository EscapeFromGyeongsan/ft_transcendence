// Run against a checkout of PR #11 (or this repository after it is merged).
// Uses a dedicated *_test database; creates uniquely named users and matches.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { gomoku } from "../packages/game-engine/src/index.ts";

const serverRoot = resolve(process.argv[2] ?? ".");
const servicePath = resolve(
  serverRoot,
  "apps/server/src/services/game-command-service.ts",
);
if (!existsSync(servicePath)) {
  throw new Error("Pass the checkout path of PR #11 as the first argument.");
}
if (!process.env.TEST_DATABASE_URL)
  throw new Error("Set TEST_DATABASE_URL to a dedicated *_test database.");
const { createDatabase } = await import(
  pathToFileURL(resolve(serverRoot, "apps/server/src/db/client.ts"))
);
const { createGameCommandService } = await import(pathToFileURL(servicePath));
const { users } = await import(
  pathToFileURL(resolve(serverRoot, "apps/server/src/db/schema/users.ts"))
);
const database = createDatabase(process.env.TEST_DATABASE_URL);

try {
  const name = (
    await database.db.execute(sql`SELECT current_database() AS name`)
  ).rows[0]?.name;
  assert.ok(
    name?.endsWith("_test"),
    "Refusing to run outside a *_test database",
  );
  await migrate(database.db, {
    migrationsFolder: resolve(serverRoot, "apps/server/drizzle"),
  });
  const service = createGameCommandService(database.db, {
    gomoku: gomoku.rules,
  });
  const ids = await database.db
    .insert(users)
    .values(
      ["black", "white", "outsider"].map((color) => ({
        email: `${color}-${randomUUID()}@example.com`,
        nickname: `qa-${randomUUID().replaceAll("-", "").slice(0, 24)}`,
        passwordHash: "unused-engine-integration-test",
      })),
    )
    .returning({ id: users.id });
  const [black, white, outsider] = ids.map((u) => u.id);
  const createMatch = () =>
    service.createMatch({
      gameType: "gomoku",
      rulesVersion: gomoku.GOMOKU_RULES_VERSION,
      blackUserId: black,
      whiteUserId: white,
    });
  const command = (matchId, version, row, col, commandId = randomUUID()) => ({
    matchId,
    userId: version % 2 === 0 ? black : white,
    commandId,
    expectedVersion: version,
    action: { type: "place", row, col },
  });
  const runMoves = async (matchId, cells) => {
    for (const [version, [row, col]] of cells.entries()) {
      assert.deepEqual(
        await service.apply(command(matchId, version, row, col)),
        {
          status: "applied",
          stateVersion: version + 1,
          duplicate: false,
        },
      );
    }
  };
  const assertFinished = async (matchId, outcome, count, winnerUserId) => {
    const match = await service.getMatch(matchId);
    assert.equal(match.game.status, "finished");
    assert.equal(match.game.outcome, outcome);
    assert.equal(
      match.game.resultReason,
      outcome === "win" ? "five_in_row" : "draw",
    );
    assert.equal(match.game.winnerUserId, winnerUserId);
    assert.equal(match.game.stateVersion, count);
    assert.equal(match.game.currentTurn, null);
    assert.ok(match.game.finishedAt instanceof Date);
    assert.equal(match.moves.length, count);
    assert.equal(gomoku.restoreState(match.moves).result.outcome, outcome);
    for (const p of match.players) {
      assert.equal(
        p.result,
        outcome === "draw"
          ? "draw"
          : p.userId === winnerUserId
            ? "win"
            : "loss",
      );
    }
  };

  await test("real engine: black win, duplicate final command and post-finish rejection", async () => {
    const matchId = await createMatch();
    await runMoves(
      matchId,
      Array.from({ length: 8 }, (_, i) => [
        i % 2 === 0 ? 0 : 14,
        Math.floor(i / 2),
      ]),
    );
    const last = command(matchId, 8, 0, 4);
    assert.equal((await service.apply(last)).status, "applied");
    assert.deepEqual(await service.apply(last), {
      status: "applied",
      stateVersion: 9,
      duplicate: true,
    });
    assert.equal(
      (await service.apply(command(matchId, 9, 7, 7))).code,
      "GAME_FINISHED",
    );
    await assertFinished(matchId, "win", 9, black);
  });

  await test("real engine: white win and restored winner color", async () => {
    const matchId = await createMatch();
    await runMoves(
      matchId,
      Array.from({ length: 10 }, (_, i) => [
        i % 2 === 0 ? 0 : 14,
        i % 2 === 0 ? i : Math.floor(i / 2),
      ]),
    );
    await assertFinished(matchId, "win", 10, white);
    assert.equal(
      gomoku.restoreState((await service.getMatch(matchId)).moves).result
        .winner,
      "white",
    );
  });

  await test("real engine: complete 225-move draw persists both player results", async () => {
    const matchId = await createMatch();
    const cells = { black: [], white: [] };
    for (let r = 0; r < 15; r++)
      for (let c = 0; c < 15; c++) {
        cells[(r + 2 * c) % 4 < 2 ? "black" : "white"].push([r, c]);
      }
    await runMoves(
      matchId,
      Array.from(
        { length: 225 },
        (_, i) => cells[i % 2 === 0 ? "black" : "white"][Math.floor(i / 2)],
      ),
    );
    await assertFinished(matchId, "draw", 225, null);
    assert.equal(
      (await service.apply(command(matchId, 225, 0, 0))).code,
      "GAME_FINISHED",
    );
  });

  await test("participant/version/turn/coordinate/occupied-cell errors do not save moves", async () => {
    const matchId = await createMatch();
    assert.equal(
      (await service.apply({ ...command(matchId, 0, 7, 7), userId: outsider }))
        .code,
      "NOT_PARTICIPANT",
    );
    assert.equal(
      (await service.apply({ ...command(matchId, 0, 7, 7), userId: white }))
        .code,
      "NOT_YOUR_TURN",
    );
    const invalid = command(matchId, 0, 15, 0);
    assert.equal((await service.apply(invalid)).code, "INVALID_ACTION");
    assert.deepEqual(await service.apply(invalid), {
      status: "rejected",
      code: "INVALID_ACTION",
      duplicate: true,
    });
    await runMoves(matchId, [[7, 7]]);
    assert.equal(
      (await service.apply(command(matchId, 0, 7, 8))).code,
      "VERSION_CONFLICT",
    );
    assert.equal(
      (await service.apply(command(matchId, 1, 7, 7))).code,
      "INVALID_ACTION",
    );
    const match = await service.getMatch(matchId);
    assert.equal(match.moves.length, 1);
    assert.equal(match.game.stateVersion, 1);
  });

  await test("concurrent placements on one version apply exactly once", async () => {
    const matchId = await createMatch();
    const results = await Promise.all([
      service.apply(command(matchId, 0, 7, 7)),
      service.apply(command(matchId, 0, 8, 8)),
    ]);
    assert.equal(results.filter((r) => r.status === "applied").length, 1);
    assert.equal(
      results.filter((r) => r.code === "VERSION_CONFLICT").length,
      1,
    );
    assert.equal((await service.getMatch(matchId)).moves.length, 1);
  });

  await test("concurrent duplicate command returns one applied and one replay", async () => {
    const matchId = await createMatch();
    const input = command(matchId, 0, 7, 7);
    const results = await Promise.all([
      service.apply(input),
      service.apply(input),
    ]);
    assert.ok(results.every((r) => r.status === "applied"));
    assert.equal(results.filter((r) => r.duplicate).length, 1);
    assert.equal((await service.getMatch(matchId)).moves.length, 1);
  });
} finally {
  await database.close();
}
