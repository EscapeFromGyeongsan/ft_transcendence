import { expect, test } from "vitest";
import { buildApp } from "./app.ts";
import { readListenOptions } from "./listen-options.ts";

test("local listen defaults stay on loopback and port 3001", () => {
  expect(readListenOptions({})).toEqual({ host: "127.0.0.1", port: 3001 });
});

test("PORT overrides the API port without changing the local host", () => {
  expect(readListenOptions({ PORT: "3107" })).toEqual({
    host: "127.0.0.1",
    port: 3107,
  });
});

test.each(["0", "-1", "65536", "3001.5", "bad", ""])(
  "invalid PORT %j is rejected before listening",
  (PORT) => {
    expect(() => readListenOptions({ PORT })).toThrow(/PORT/);
  },
);

test.each(["", " ", " 0.0.0.0"])("invalid API_HOST %j is rejected", (API_HOST) => {
  expect(() => readListenOptions({ API_HOST })).toThrow(/API_HOST/);
});

test("container host accepts requests with a wildcard listen binding", async () => {
  const app = await buildApp();
  try {
    const { host } = readListenOptions({ API_HOST: "0.0.0.0" });
    await app.listen({ host, port: 0 });
    const address = app.server.address();
    if (!address || typeof address === "string") throw new Error("No TCP address");
    expect(address.address).toBe("0.0.0.0");
    const response = await fetch(
      "http://127.0.0.1:" + address.port + "/api/health",
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  } finally {
    await app.close();
  }
});
