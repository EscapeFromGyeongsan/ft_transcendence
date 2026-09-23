import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { buildApp } from "./app";
import type { RoomSnapshot } from "./rooms";

const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});
async function setup() {
  const app = await buildApp();
  apps.push(app);
  return app;
}
async function create(app: Awaited<ReturnType<typeof buildApp>>) {
  const response = await app.inject({
    method: "POST",
    url: "/api/rooms",
    payload: { title: "Test", hostName: "Host" },
  });
  expect(response.statusCode).toBe(201);
  return response.json() as { room: RoomSnapshot; token: string };
}
function client(url: string) {
  const socket = new WebSocket(url);
  const messages: any[] = [];
  socket.on("message", (raw) => messages.push(JSON.parse(raw.toString())));
  let sequence = 0;
  return {
    socket,
    async take(type: string, requestId?: string) {
      const predicate = (message: any) =>
        message.type === type &&
        (!requestId || message.requestId === requestId);
      await expect.poll(() => messages.some(predicate)).toBe(true);
      return messages.splice(messages.findIndex(predicate), 1)[0];
    },
    async command(
      type: string,
      token: string,
      data: object = {},
      error?: string,
    ) {
      const requestId = String(++sequence);
      socket.send(JSON.stringify({ ...data, type, token, requestId }));
      const result = await this.take(error ? "error" : "ack", requestId);
      if (error) expect(result.error).toBe(error);
      return result.room as RoomSnapshot;
    },
  };
}
describe("Fastify HTTP and WebSocket boundary", () => {
  it("validates bodies, handles malformed JSON and limits payload size", async () => {
    const app = await setup();
    for (const payload of [{}, { title: "x", hostName: "" }, null]) {
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/api/rooms",
            payload: JSON.stringify(payload),
            headers: { "content-type": "application/json" },
          })
        ).statusCode,
      ).toBe(400);
    }
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/rooms",
          payload: "{",
          headers: { "content-type": "application/json" },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/rooms",
          payload: { title: "x".repeat(5000), hostName: "A" },
        })
      ).statusCode,
    ).toBe(413);
    expect((await app.inject("/api/rooms/missing")).statusCode).toBe(404);
    const host = await create(app);
    expect((await app.inject("/api/rooms")).json()).toEqual([host.room]);
    expect(
      JSON.stringify((await app.inject(`/api/rooms/${host.room.id}`)).json()),
    ).not.toContain(host.token);
  });
  it("synchronizes players, rejects unauthorized/stale commands, restores snapshots and closes rooms", async () => {
    const app = await setup();
    const address = await app.listen({ port: 0, host: "127.0.0.1" });
    const host = await create(app);
    const id = host.room.id;
    const guest = (
      await app.inject({
        method: "POST",
        url: `/api/rooms/${id}/join`,
        payload: { name: "Guest" },
      })
    ).json();
    const url = address.replace("http:", "ws:") + `/api/rooms/${id}/ws`;
    const a = client(url),
      b = client(url);
    await a.take("snapshot");
    await b.take("snapshot");
    a.socket.send("{");
    expect((await a.take("error")).error).toBe("INVALID_REQUEST");
    await b.command("ready", "invalid", {}, "NOT_A_PLAYER");
    await b.command("close", guest.token, {}, "HOST_ONLY");
    const prepared = await a.command("ready", host.token, {
      playerId: guest.playerId,
    });
    expect(prepared.players.map((player) => player.ready)).toEqual([
      true,
      false,
    ]);
    await b.command("ready", guest.token);
    let room = await a.command("start", host.token);
    const oldMatch = room.matchId;
    const move = { type: "PLACE_STONE", x: 7, y: 7 };
    await b.command(
      "action",
      guest.token,
      { action: move, expectedVersion: 0, matchId: oldMatch },
      "WRONG_TURN",
    );
    room = await a.command("action", host.token, {
      action: move,
      expectedVersion: 0,
      matchId: oldMatch,
    });
    expect(room.game.moves).toHaveLength(1);
    await a.command(
      "action",
      host.token,
      { action: move, expectedVersion: 0, matchId: oldMatch },
      "STALE_STATE",
    );
    b.socket.terminate();
    const reconnected = client(url);
    expect((await reconnected.take("snapshot")).room).toEqual(room);
    await reconnected.command(
      "action",
      guest.token,
      { action: move, expectedVersion: 1, matchId: oldMatch },
      "OCCUPIED",
    );
    room = await reconnected.command("action", guest.token, {
      action: { type: "RESIGN" },
      expectedVersion: 1,
      matchId: oldMatch,
    });
    expect(room.status).toBe("finished");
    const revision = room.revision;
    room = await a.command("rematch", host.token);
    expect(room.revision).toBeGreaterThan(revision);
    expect(room.matchId).not.toBe(oldMatch);
    await a.command("ready", host.token);
    await reconnected.command("ready", guest.token);
    await a.command("start", host.token);
    await a.command(
      "action",
      host.token,
      { action: move, expectedVersion: 0, matchId: oldMatch },
      "STALE_MATCH",
    );
    await a.command("close", host.token);
    await reconnected.take("closed");
    const missing = client(url);
    await missing.take("closed");
  });
});
