import { defineConfig } from "@playwright/test";

/**
 * End-to-end tests against the running dev stack (docker compose + api:4000 + web:3000 +
 * backoffice:3001). Uses the system Chrome, so no browser download is needed.
 */
export default defineConfig({
  testDir: "tests",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: [["list"]],
  use: {
    channel: "chrome",
    locale: "fa-IR",
    viewport: { width: 1360, height: 900 },
    trace: "retain-on-failure",
  },
});
