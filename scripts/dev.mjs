import { spawn } from "node:child_process";

const children = [];
function run(command, args) {
  const child = spawn(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  children.push(child);
  child.on("exit", (code) => {
    if (code && !stopping) stop(code);
  });
}
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill();
  process.exitCode = code;
}
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
run(process.execPath, [
  "--experimental-strip-types",
  "apps/server/src/index.ts",
]);
run(process.platform === "win32" ? "npm.cmd" : "npm", [
  "run",
  "dev",
  "--workspace",
  "@cafe/web",
  "--",
  "--host",
  "127.0.0.1",
  ...process.argv.slice(2),
]);
