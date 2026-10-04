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
