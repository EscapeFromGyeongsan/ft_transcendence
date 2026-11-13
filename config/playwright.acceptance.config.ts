import { defineConfig } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL;
const pin = process.env.E2E_TLS_SPKI;
if (!baseURL?.startsWith("https://") || !pin) {
  throw new Error(
    "Set HTTPS E2E_BASE_URL and the isolated certificate E2E_TLS_SPKI.",
  );
}

export default defineConfig({
  testDir: "../tests",
  outputDir: "../test-results/acceptance-88",
  workers: 1,
  retries: 0,
  timeout: 120_000,
  use: {
    baseURL,
    channel: "chrome",
    ignoreHTTPSErrors: false,
    launchOptions: { args: [`--ignore-certificate-errors-spki-list=${pin}`] },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 900 } } },
    { name: "tablet", use: { viewport: { width: 768, height: 1024 } } },
    {
      name: "mobile",
      use: {
        viewport: { width: 360, height: 800 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
});
