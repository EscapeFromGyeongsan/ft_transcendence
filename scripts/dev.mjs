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
  [viteBin, "--host", "127.0.0.1", ...process.argv.slice(2)],
  { cwd: "apps/web" },
);
