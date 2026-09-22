import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { RoomError, RoomStore } from "./rooms.ts";

const store = new RoomStore();
const port = Number(process.env.PORT ?? 3001);
const send = (res: ServerResponse, status: number, value: unknown) => {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(value));
};
async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 4096) throw new RoomError(413, "BODY_TOO_LARGE");
  }
  try {
    const parsed: unknown = JSON.parse(raw || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
      return parsed as Record<string, unknown>;
  } catch {
    /* invalid JSON */
  }
  throw new RoomError(400, "INVALID_JSON");
}
const tokenOf = (req: IncomingMessage) => {
  const header = req.headers.authorization ?? "";
  if (!header.startsWith("Bearer ")) throw new RoomError(403, "NOT_A_PLAYER");
  return header.slice(7);
};
const server = createServer(async (req, res) => {
  try {
    const url = new URL(
      req.url ?? "/",
      `http://${req.headers.host ?? "localhost"}`,
    );
    const path = url.pathname;
    if (req.method === "GET" && path === "/api/rooms")
      return send(res, 200, store.list());
    const match =
      /^\/api\/rooms\/([a-f0-9-]+)(?:\/(events|join|ready|start|action|rematch|leave))?$/.exec(
        path,
      );
    if (req.method === "POST" && path === "/api/rooms") {
      const data = await body(req);
      return send(res, 201, store.create(data.title, data.hostName));
    }
    if (!match) throw new RoomError(404, "NOT_FOUND");
    const [, id, operation] = match;
    if (req.method === "GET" && !operation)
      return send(res, 200, store.get(id));
    if (req.method === "GET" && operation === "events") {
      store.get(id);
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
      });
      const publish = (changedId: string) => {
        if (changedId !== id) return;
        try {
          res.write(`data: ${JSON.stringify(store.get(id))}\n\n`);
        } catch {
          res.write("event: closed\ndata: {}\n\n");
          res.end();
        }
      };
      const unsubscribe = store.subscribe(publish);
      const heartbeat = setInterval(() => res.write(": heartbeat\n\n"), 20000);
      res.on("close", () => {
        unsubscribe();
        clearInterval(heartbeat);
      });
      publish(id);
      return;
    }
    if (req.method === "POST" && operation === "join") {
      const data = await body(req);
      return send(res, 200, store.join(id, data.name));
    }
    if (req.method === "POST" && operation === "ready")
      return send(res, 200, store.ready(id, tokenOf(req)));
    if (req.method === "POST" && operation === "start")
      return send(res, 200, store.start(id, tokenOf(req)));
    if (req.method === "POST" && operation === "rematch")
      return send(res, 200, store.rematch(id, tokenOf(req)));
    if (req.method === "POST" && operation === "leave")
      return send(res, 200, store.leave(id, tokenOf(req)));
    if (req.method === "POST" && operation === "action") {
      const token = tokenOf(req),
        data = await body(req);
      return send(
        res,
        200,
        store.action(id, token, data.action as never, data.expectedVersion),
      );
    }
    if (req.method === "DELETE" && !operation) {
      store.close(id, tokenOf(req));
      return send(res, 200, { ok: true });
    }
    throw new RoomError(404, "NOT_FOUND");
  } catch (error) {
    if (error instanceof RoomError)
      send(res, error.status, { error: error.code });
    else {
      console.error(error);
      send(res, 500, { error: "INTERNAL_ERROR" });
    }
  }
});
server.listen(port, "127.0.0.1", () =>
  console.log(`Online Omok API listening on ${port}`),
);
