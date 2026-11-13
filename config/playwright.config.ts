import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";
const port = process.env.E2E_PORT ?? "5173";
const deployedURL = process.env.E2E_BASE_URL;
const baseURL = deployedURL ?? `http://127.0.0.1:${port}`;
export default defineConfig({
  testDir: "../tests",
  // #88 검증은 격리 HTTPS 후보와 별도 인증서 설정이 필요합니다.
  testIgnore: "**/*acceptance-88.spec.ts",
  outputDir: "../test-results",
  fullyParallel: true,
  // Real games share per-game queues; keep different tests' pairs together.
  workers: 1,
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: deployedURL
    ? undefined
    : {
        cwd: fileURLToPath(new URL("../", import.meta.url)),
        command: `npm run dev -- --port ${port} --strictPort`,
        url: `${baseURL}/api/health`,
        reuseExistingServer: !process.env.CI,
      },
});
