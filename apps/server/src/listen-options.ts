export function readListenOptions(env: NodeJS.ProcessEnv = process.env) {
  const port = Number(env.PORT ?? 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Set PORT to an integer between 1 and 65535.");
  }
  const host = env.API_HOST ?? "127.0.0.1";
  if (!host || host !== host.trim()) {
    throw new Error("Set API_HOST to a non-empty listen address.");
  }
  return { port, host };
}
