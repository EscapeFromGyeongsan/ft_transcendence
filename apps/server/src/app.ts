import { registerAuth } from "./auth.ts";
import type { Database } from "./db/database.ts";
import Fastify, { type FastifyRequest } from "fastify";
import { saveResult, history } from "./history.ts";
import websocket from "@fastify/websocket";
import { RoomError, RoomStore } from "./rooms.ts";

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
  const auth = options
    ? await registerAuth(app, options.database, {
        origin: options.origin,
        secure: options.secureCookies,
      })
    : null;
  const requireUser = async (req: FastifyRequest) => {
    const user = await auth?.currentUser(req);
    if (!user) throw new RoomError(401, "LOGIN_REQUIRED");
    return user;
  };
  // Serialize all room mutations, including persistence and session validation.
  const queues = new Map<string, Promise<void>>();
  const serial = <T>(id: string, work: () => Promise<T>): Promise<T> => {
    const result = (queues.get(id) ?? Promise.resolve()).then(work);
    const tail = result.then(
      () => {},
      () => {},
    );
    queues.set(id, tail);
    void tail.then(() => {
      if (queues.get(id) === tail) queues.delete(id);
    });
    return result;
  };
  const identities = new WeakMap<FastifyRequest, string | null>();
  if (options)
    app.get<{ Querystring: { offset?: number } }>(
      "/api/me/matches",
      {
        schema: {
          querystring: {
            type: "object",
            properties: {
              offset: { type: "integer", minimum: 0, maximum: 1000000 },
            },
            additionalProperties: false,
          },
        },
      },
      async (req) =>
        history(
          options.database,
          (await requireUser(req)).id,
          req.query.offset ?? 0,
        ),
    );
  const named = (properties: Record<string, unknown>, required: string[]) => ({
    type: "object",
    properties,
    required,
    additionalProperties: false,
  });
  const name = { type: "string", minLength: 1, maxLength: 16 };
  app.get("/api/games", async () => store.registry.list());
  app.get("/api/rooms", async () => store.list());
  app.post<{ Body: { title: string; hostName: string; gameType?: string } }>(
    "/api/rooms",
    {
      schema: {
        body: named(
          {
            title: { type: "string", minLength: 1, maxLength: 40 },
            hostName: name,
            gameType: { type: "string", minLength: 1, maxLength: 64 },
          },
          auth ? ["title"] : ["title", "hostName"],
        ),
      },
    },
    async (req, reply) => {
      if (!auth)
        return reply
          .code(201)
          .send(
            store.create(
              req.body.title,
              req.body.hostName,
              undefined,
              req.body.gameType,
            ),
          );
      await auth.guard(req);
      const user = await requireUser(req);
      const created = store.create(
        req.body.title,
        user.display_name,
        user.id,
        req.body.gameType,
      );
      return reply.code(201).send({ room: created.room, playerId: user.id });
    },
  );
  app.get<{ Params: { id: string } }>("/api/rooms/:id", async (req) =>
    store.get(req.params.id),
  );
  app.post<{ Params: { id: string }; Body: { name: string } }>(
    "/api/rooms/:id/join",
    {
      schema: { body: named({ name }, auth ? [] : ["name"]) },
    },
    async (req) =>
      serial(req.params.id, async () => {
        if (!auth) return store.join(req.params.id, req.body.name);
        await auth.guard(req);
        const user = await requireUser(req);
        const joined = store.join(req.params.id, user.display_name, user.id);
        return { room: joined.room, playerId: user.id };
      }),
  );

  app.get<{ Params: { id: string } }>(
    "/api/rooms/:id/ws",
    {
      websocket: true,
      preValidation: async (req) => {
        if (
          options &&
          req.headers.origin &&
          req.headers.origin !== options.origin
        )
          throw new RoomError(403, "INVALID_ORIGIN");
        if (req.headers["sec-fetch-site"] === "cross-site")
          throw new RoomError(403, "INVALID_ORIGIN");
        identities.set(req, (await auth?.currentUser(req))?.id ?? null);
      },
    },
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
          send({
            type: "snapshot",
            room: store.get(id),
            playerId: identities.get(req),
          });
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
        void serial(id, async () => {
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
            const token = auth ? (await requireUser(req)).id : data.token;
            if (typeof token !== "string")
              throw new RoomError(403, "NOT_A_PLAYER");
            let result: unknown;
            switch (data.type) {
              case "ready":
                result = store.ready(id, token);
                break;
              case "start":
                result = store.start(id, token);
                break;
              case "rematch":
                result = store.rematch(id, token);
                break;
              case "leave":
                result = store.leave(id, token);
                break;
              case "close": {
                const room = store.get(id);
                if (
                  room.players.find(
                    (player) => player.id === store.identity(id, token),
                  )?.seat !== 0
                )
                  throw new RoomError(403, "HOST_ONLY");
                if (room.status === "playing")
                  throw new RoomError(409, "CANNOT_CLOSE_PLAYING");
                send({
                  type: "ack",
                  requestId,
                  room,
                  playerId: identities.get(req),
                });
                store.close(id, token);
                return;
              }
              case "action":
                result = store.previewAction(
                  id,
                  token,
                  data.action,
                  data.expectedVersion,
                  data.matchId,
                );
                if (
                  options &&
                  (result as ReturnType<RoomStore["get"]>).result
                ) {
                  try {
                    await saveResult(
                      options.database,
                      result as ReturnType<RoomStore["get"]>,
                    );
                  } catch (error) {
                    app.log.error(error);
                    throw new RoomError(503, "RESULT_SAVE_FAILED");
                  }
                }
                result = store.commitAction(
                  id,
                  result as ReturnType<RoomStore["get"]>,
                );
                break;
              default:
                throw new RoomError(400, "INVALID_REQUEST");
            }
            send({
              type: "ack",
              requestId,
              room: result,
              playerId: identities.get(req),
            });
          } catch (error) {
            send({
              type: "error",
              requestId,
              error:
                error instanceof RoomError ? error.code : "INVALID_REQUEST",
            });
          }
        });
      });
      publish(id);
    },
  );
  return app;
}
