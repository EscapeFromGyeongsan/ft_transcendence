import https from "node:https";
import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import WebSocket from "./harness/node_modules/ws/index.js";
const ports = JSON.parse(
  await readFile(new URL("output/ports.json", import.meta.url), "utf8"),
);
const ca = await readFile(new URL("private/certs/server.crt", import.meta.url));
function post(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request(
      {
        hostname: "127.0.0.1",
        port: ports.https,
        path,
        method: "POST",
        ca,
        rejectUnauthorized: true,
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(data),
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (x) => (raw += x));
        res.on("end", () =>
          resolve({ status: res.statusCode, body: JSON.parse(raw) }),
        );
      },
    );
    req.setTimeout(10000, () => req.destroy(new Error("HTTPS timeout")));
    req.on("error", reject);
    req.end(data);
  });
}
const email = "heartbeat-" + randomUUID() + "@example.com",
  password = randomUUID();
const registered = await post("/api/auth/register", {
  email,
  password,
  nickname: "hb_" + randomUUID().replaceAll("-", "").slice(0, 18),
});
if (registered.status !== 201)
  throw new Error("Timing probe register failed: " + registered.status);
const login = await post("/api/auth/login", { email, password });
if (login.status !== 200)
  throw new Error("Timing probe login failed: " + login.status);
const socket = new WebSocket("wss://127.0.0.1:" + ports.https + "/api/ws", {
  ca,
  rejectUnauthorized: true,
  autoPong: false,
  handshakeTimeout: 10000,
});
const pings = [];
let authSentAt, authAckAt;
socket.on("open", () => {
  authSentAt = performance.now();
  socket.send(
    JSON.stringify({
      type: "auth",
      payload: { accessToken: login.body.accessToken },
    }),
  );
});
socket.on("message", (data) => {
  if (JSON.parse(data.toString()).type === "auth.ok")
    authAckAt = performance.now();
});
socket.on("ping", () => pings.push(Math.round(performance.now() - authSentAt)));
let watchdogFired = false;
const timeout = setTimeout(() => {
  watchdogFired = true;
  socket.terminate();
}, 40000);
await new Promise((resolve, reject) => {
  socket.on("error", reject);
  socket.on("close", async (code) => {
    clearTimeout(timeout);
    const result = {
      authenticated: !!authAckAt,
      watchdogFired,
      closeCode: code,
      noResponseDurationMs: Math.round(performance.now() - authSentAt),
      pingAtMs: pings,
      configuredHeartbeatIntervalMs: 10000,
      configuredHeartbeatTimeoutMs: 20000,
      toleranceMs: 1000,
    };
    result.within20SecondTarget = result.noResponseDurationMs <= 21000;
    await writeFile(
      new URL("output/heartbeat-timing.json", import.meta.url),
      JSON.stringify(result, null, 2) + "\n",
    );
    console.log(JSON.stringify(result));
    if (watchdogFired || !authAckAt || code !== 1006) process.exitCode = 1;
    resolve();
  });
});
