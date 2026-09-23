import { registerAuth } from "./auth.ts";
import type { Database } from "./db/database.ts";
import Fastify from "fastify";
import websocket from "@fastify/websocket";
import { RoomError, RoomStore } from "./rooms.ts";
import type { OmokAction } from "@cafe/omok";

export async function buildApp(
  store = new RoomStore(),
  options?: { database: Database; origin: string; secureCookies: boolean },
) {
  const app = Fastify({ bodyLimit: 4096 });
  await app.register(websocket, { options: { maxPayload: 4096 } });
  app.addHook("onSend", async (_request, reply) => {
    reply.header("cache-control", "no-store");
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof RoomError)
      return reply.code(error.status).send({ error: error.code });
    const status =
      error instanceof Error &&
      "statusCode" in error &&
      typeof error.statusCode === "number"
        ? error.statusCode
        : 500;
    if (status >= 500) app.log.error(error);
    return reply
      .code(status)
      .send({ error: status >= 500 ? "INTERNAL_ERROR" : "INVALID_REQUEST" });
  });
  if (options)
    await registerAuth(app, options.database, {
      origin: options.origin,
      secure: options.secureCookies,
    });
  const named = (properties: Record<string, unknown>, required: string[]) => ({
    type: "object",
    properties,
    required,
    additionalProperties: false,
  });
  const name = { type: "string", minLength: 1, maxLength: 16 };
  app.get("/api/rooms", async () => store.list());
  app.post<{ Body: { title: string; hostName: string } }>(
    "/api/rooms",
    {
      schema: {
        body: named(
          {
            title: { type: "string", minLength: 1, maxLength: 40 },
            hostName: name,
          },
          ["title", "hostName"],
        ),
      },
    },
    async (req, reply) =>
      reply.code(201).send(store.create(req.body.title, req.body.hostName)),
  );
  app.get<{ Params: { id: string } }>("/api/rooms/:id", async (req) =>
    store.get(req.params.id),
  );
  app.post<{ Params: { id: string }; Body: { name: string } }>(
    "/api/rooms/:id/join",
    {
      schema: { body: named({ name }, ["name"]) },
    },
    async (req) => store.join(req.params.id, req.body.name),
  );

  app.get<{ Params: { id: string } }>(
    "/api/rooms/:id/ws",
    { websocket: true },
    (socket, req) => {
      const id = req.params.id;
      const send = (value: unknown) => {
        if (socket.readyState === 1) {
          if (socket.bufferedAmount > 1024 * 1024) return socket.terminate();
          socket.send(JSON.stringify(value));
        }
      };
      const publish = (changedId: string) => {
        if (changedId !== id) return;
        try {
          send({ type: "snapshot", room: store.get(id) });
        } catch {
          send({ type: "closed" });
          socket.close(1000);
        }
      };
      const unsubscribe = store.subscribe(publish);
      let alive = true;
      socket.on("pong", () => {
        alive = true;
      });
      const heartbeat = setInterval(() => {
        if (!alive) return socket.terminate();
        alive = false;
        socket.ping();
      }, 20000);
      socket.on("close", () => {
        unsubscribe();
        clearInterval(heartbeat);
      });
      socket.on("error", () => socket.terminate());
      socket.on("message", (raw) => {
        let requestId: string | undefined;
        try {
          const data = JSON.parse(raw.toString());
          if (
            !data ||
            typeof data !== "object" ||
            typeof data.requestId !== "string" ||
            data.requestId.length > 100
          )
            throw new RoomError(400, "INVALID_REQUEST");
          requestId = data.requestId;
          if (typeof data.token !== "string")
            throw new RoomError(403, "NOT_A_PLAYER");
          let result: unknown;
          switch (data.type) {
            case "ready":
              result = store.ready(id, data.token);
              break;
            case "start":
              result = store.start(id, data.token);
              break;
            case "rematch":
              result = store.rematch(id, data.token);
              break;
            case "leave":
              result = store.leave(id, data.token);
              break;
            case "close": {
              const room = store.get(id);
              if (
                room.players.find(
                  (player) => player.id === store.identity(id, data.token),
                )?.seat !== 0
              )
                throw new RoomError(403, "HOST_ONLY");
              send({ type: "ack", requestId, room });
              store.close(id, data.token);
              return;
            }
            case "action":
              if (
                !data.action ||
                !["PLACE_STONE", "RESIGN"].includes(data.action.type)
              )
                throw new RoomError(400, "INVALID_REQUEST");
              result = store.action(
                id,
                data.token,
                data.action as OmokAction,
                data.expectedVersion,
                data.matchId,
              );
              break;
            default:
              throw new RoomError(400, "INVALID_REQUEST");
          }
          send({ type: "ack", requestId, room: result });
        } catch (error) {
          send({
            type: "error",
            requestId,
            error: error instanceof RoomError ? error.code : "INVALID_REQUEST",
          });
        }
      });
      publish(id);
    },
  );
  return app;
}
