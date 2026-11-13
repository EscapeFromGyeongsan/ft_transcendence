import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

// Read the same root .env as the API server so the proxy follows its PORT.
const rootEnv = fileURLToPath(new URL("../../.env", import.meta.url));
if (existsSync(rootEnv)) loadEnvFile(rootEnv);

const proxy = {
  "/api": {
    target: `http://127.0.0.1:${process.env.PORT ?? "3001"}`,
    changeOrigin: true,
    ws: true,
  },
};
export default defineConfig({
  plugins: [tailwindcss()],
  server: { proxy },
  preview: { proxy },
});
