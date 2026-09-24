import { defineConfig, devices } from "@playwright/test";
const port = process.env.E2E_PORT ?? "5173";
const baseURL = `http://127.0.0.1:${port}`;
export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  use: { baseURL, trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: `npm run dev -- --port ${port} --strictPort`,
    url: `${baseURL}/api/rooms`,
    env: { APP_ORIGIN: baseURL },
    reuseExistingServer: !process.env.CI,
  },
});
