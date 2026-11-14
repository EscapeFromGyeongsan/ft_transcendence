import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

// Run Vite directly (not through npm) so killing the child stops Vite itself.
const viteRoot = dirname(
  createRequire(join(process.cwd(), "apps/web/package.json")).resolve(
    "vite/package.json",
  ),
);
const viteBin = join(viteRoot, "bin/vite.js");
// The container started by `make dev` sets DEV_HOST=0.0.0.0 so the published
// port reaches Vite; on the host it stays on 127.0.0.1.
const host = process.env.DEV_HOST ?? "127.0.0.1";

const children = [];
function run(command, args, options = {}) {
  const child = spawn(command, args, { stdio: "inherit", ...options });
  children.push(child);
  // If either process ends (error, signal or normal exit), stop the other too.
  child.on("exit", (code) => {
    if (!stopping) stop(code ?? 1);
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
run(
  process.execPath,
  [viteBin, "--host", host, ...process.argv.slice(2)],
  { cwd: "apps/web" },
);
