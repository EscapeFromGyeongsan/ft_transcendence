import { buildApp } from "./app.ts";

const app = await buildApp();
const address = await app.listen({
  port: Number(process.env.PORT ?? 3001),
  host: "127.0.0.1",
});
console.log(`Fastify Omok API listening on ${address}`);
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void app.close();
  });
}
