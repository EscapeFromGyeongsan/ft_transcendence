import { afterEach, expect, test } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.ts";

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
});

test("GET /api/health returns ok", async () => {
  app = await buildApp();
  const response = await app.inject({ method: "GET", url: "/api/health" });
  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({ status: "ok" });
});

test("GET /docs/json lists declared routes", async () => {
  app = await buildApp();
  const response = await app.inject({ method: "GET", url: "/docs/json" });
  expect(response.statusCode).toBe(200);
  expect(response.json().paths["/api/health"].get.responses).toHaveProperty(
    "200",
  );
  const databaseResponses =
    response.json().paths["/api/health/db"].get.responses;
  expect(databaseResponses).toHaveProperty("200");
  expect(databaseResponses).toHaveProperty("503");
});

test("DB health fails with 503 when no database is configured", async () => {
  app = await buildApp();
  const response = await app.inject({ method: "GET", url: "/api/health/db" });
  expect(response.statusCode).toBe(503);
  expect(response.json()).toEqual({
    error: {
      code: "SERVICE_UNAVAILABLE",
      message: "Database is unavailable.",
    },
  });
});

test("DB connection failure does not expose connection details", async () => {
  app = await buildApp(
    {},
    "postgresql://probe:private-password@127.0.0.1:1/probe",
  );
  const response = await app.inject({ method: "GET", url: "/api/health/db" });
  expect(response.statusCode).toBe(503);
  expect(response.json()).toEqual({
    error: {
      code: "SERVICE_UNAVAILABLE",
      message: "Database is unavailable.",
    },
  });
  expect(response.body).not.toContain("private-password");
  const health = await app.inject({ method: "GET", url: "/api/health" });
  expect(health.statusCode).toBe(200);
});

test("statement timeout (57014) maps to 503", async () => {
  app = await buildApp();
  app.get("/probe/statement-timeout", async () => {
    throw new Error("Failed query", {
      cause: Object.assign(
        new Error("canceling statement due to statement timeout"),
        { code: "57014" },
      ),
    });
  });
  const response = await app.inject({
    method: "GET",
    url: "/probe/statement-timeout",
  });
  expect(response.statusCode).toBe(503);
  expect(response.json().error.code).toBe("SERVICE_UNAVAILABLE");
});

test("unknown route returns 404 in the common error format", async () => {
  app = await buildApp();
  for (const [method, url] of [
    ["GET", "/api/nope"],
    ["PUT", "/api/users/me"],
  ] as const) {
    const response = await app.inject({ method, url });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: { code: "NOT_FOUND", message: "Route not found." },
    });
  }
});

test("GET /api/ws without upgrade returns 404 with no body", async () => {
  app = await buildApp();
  const response = await app.inject({ method: "GET", url: "/api/ws" });
  expect(response.statusCode).toBe(404);
  expect(response.body).toBe("");
});

test("multipart body on a JSON route returns 415", async () => {
  app = await buildApp();
  const boundary = "json-route-boundary";
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    payload: `--${boundary}\r\nContent-Disposition: form-data; name="email"\r\n\r\na@b.io\r\n--${boundary}--\r\n`,
  });
  expect(response.statusCode).toBe(415);
  expect(response.json()).toEqual({
    error: {
      code: "UNSUPPORTED_MEDIA_TYPE",
      message: "Use application/json.",
    },
  });
});

test("every Swagger route has a summary and response descriptions", async () => {
  app = await buildApp();
  const paths = (await app.inject({ method: "GET", url: "/docs/json" })).json()
    .paths as Record<
    string,
    Record<
      string,
      { summary?: string; responses: Record<string, { description?: string }> }
    >
  >;
  const missing: string[] = [];
  for (const [path, operations] of Object.entries(paths)) {
    for (const [method, operation] of Object.entries(operations)) {
      if (!operation.summary) missing.push(`${method} ${path} summary`);
      for (const [code, response] of Object.entries(operation.responses)) {
        if (
          !response.description ||
          response.description === "Default Response"
        ) {
          missing.push(`${method} ${path} ${code}`);
        }
      }
    }
  }
  expect(missing).toEqual([]);
});
