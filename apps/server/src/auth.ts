import {
  createHash,
  randomBytes,
  randomUUID,
  scrypt,
  timingSafeEqual,
} from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import type { Database } from "./db/database.ts";
import { RoomError } from "./rooms.ts";

const COOKIE = "cafe_session";
const LIFETIME = 7 * 24 * 60 * 60;
const digest = (token: string) =>
  createHash("sha256").update(token).digest("hex");
const derive = (password: string, salt: string): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      64,
      { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 },
      (error, key) => (error ? reject(error) : resolve(key)),
    );
  });
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `scrypt:${salt}:${(await derive(password, salt)).toString("hex")}`;
}
async function verifyPassword(password: string, encoded: string) {
  const [algorithm, salt, hash] = encoded.split(":");
  if (algorithm !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "hex"),
    actual = await derive(password, salt);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
type UserRow = {
  id: string;
  email: string;
  display_name: string;
  password_hash: string;
};
const publicUser = (user: UserRow) => ({
  id: user.id,
  email: user.email,
  displayName: user.display_name,
});

export async function registerAuth(
  app: FastifyInstance,
  db: Database,
  options: { origin: string; secure: boolean },
) {
  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  const cookieOptions = {
    path: "/",
    httpOnly: true,
    sameSite: "strict" as const,
    secure: options.secure,
  };
  // Used for absent users too, so failed logins always perform the expensive password check.
  const dummyHash = await hashPassword(randomBytes(32).toString("hex"));
  const currentUser = async (request: FastifyRequest) => {
    const token = request.cookies[COOKIE];
    if (!token || token.length !== 64) return null;
    const result = await db.query<UserRow>(
      `SELECT u.id, u.email, u.display_name FROM users u JOIN sessions s ON s.user_id = u.id
       WHERE s.token_hash = $1 AND s.expires_at > CURRENT_TIMESTAMP`,
      [digest(token)],
    );
    return result.rows[0] ?? null;
  };
  const createSession = async (
    reply: FastifyReply,
    request: FastifyRequest,
    user: UserRow,
  ) => {
    const token = randomBytes(32).toString("hex");
    await db.query(
      "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)",
      [digest(token), user.id, new Date(Date.now() + LIFETIME * 1000)],
    );
    const previous = request.cookies[COOKIE];
    if (previous)
      await db.query("DELETE FROM sessions WHERE token_hash = $1", [
        digest(previous),
      ]);
    await db.query(
      "DELETE FROM sessions WHERE expires_at <= CURRENT_TIMESTAMP",
    );
    reply.setCookie(COOKIE, token, { ...cookieOptions, maxAge: LIFETIME });
  };
  const guard = async (request: FastifyRequest) => {
    if (request.headers.origin && request.headers.origin !== options.origin)
      throw new RoomError(403, "INVALID_ORIGIN");
    if (request.headers["sec-fetch-site"] === "cross-site")
      throw new RoomError(403, "INVALID_ORIGIN");
    if (!request.headers["content-type"]?.startsWith("application/json"))
      throw new RoomError(415, "INVALID_REQUEST");
  };
  const properties = {
    email: { type: "string", minLength: 3, maxLength: 254 },
    password: { type: "string", minLength: 12, maxLength: 128 },
    displayName: { type: "string", minLength: 1, maxLength: 16 },
  };
  const schema = (signup: boolean) => ({
    body: {
      type: "object",
      required: signup
        ? ["email", "password", "displayName"]
        : ["email", "password"],
      properties,
      additionalProperties: false,
    },
  });
  type Credentials = { email: string; password: string; displayName?: string };
  const validate = (body: Credentials) => {
    const email = body.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      throw new RoomError(400, "INVALID_EMAIL");
    return email;
  };
  const limits = { rateLimit: { max: 10, timeWindow: "1 minute" } };
  app.post<{ Body: Credentials }>(
    "/api/auth/register",
    { schema: schema(true), preHandler: guard, config: limits },
    async (request, reply) => {
      const email = validate(request.body),
        displayName = request.body.displayName!.trim();
      if (!displayName) throw new RoomError(400, "INVALID_NAME");
      const hash = await hashPassword(request.body.password);
      let user: UserRow;
      try {
        user = (
          await db.query<UserRow>(
            "INSERT INTO users (id, email, display_name, password_hash) VALUES ($1, $2, $3, $4) RETURNING id, email, display_name",
            [randomUUID(), email, displayName, hash],
          )
        ).rows[0];
      } catch (error) {
        if (
          error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "23505"
        )
          throw new RoomError(409, "EMAIL_IN_USE");
        throw error;
      }
      await createSession(reply, request, user);
      return reply.code(201).send({ user: publicUser(user) });
    },
  );
  app.post<{ Body: Credentials }>(
    "/api/auth/login",
    { schema: schema(false), preHandler: guard, config: limits },
    async (request, reply) => {
      const email = validate(request.body);
      const user = (
        await db.query<UserRow>(
          "SELECT id, email, display_name, password_hash FROM users WHERE email = $1",
          [email],
        )
      ).rows[0];
      const valid = await verifyPassword(
        request.body.password,
        user?.password_hash ?? dummyHash,
      );
      if (!user || !valid) throw new RoomError(401, "INVALID_CREDENTIALS");
      await createSession(reply, request, user);
      return { user: publicUser(user) };
    },
  );
  app.get("/api/auth/me", async (request) => {
    const user = await currentUser(request);
    return { user: user ? publicUser(user) : null };
  });
  app.post(
    "/api/auth/logout",
    { preHandler: guard },
    async (request, reply) => {
      const token = request.cookies[COOKIE];
      if (token)
        await db.query("DELETE FROM sessions WHERE token_hash = $1", [
          digest(token),
        ]);
      reply.clearCookie(COOKIE, cookieOptions);
      return { ok: true };
    },
  );
  return { currentUser, guard };
}
