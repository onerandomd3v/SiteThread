import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.REHEARSAL_BASE_URL ?? "http://localhost:3002";
const port = new URL(baseURL).port || "3002";
const local = new URL(baseURL).hostname === "localhost";

export default defineConfig({
  testDir: "./tests/rehearsal",
  fullyParallel: false,
  timeout: 2 * 60 * 60 * 1000,
  reporter: "list",
  use: { baseURL, trace: "retain-on-failure", ...devices["Desktop Chrome"] },
  projects: [{ name: "live-chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: local ? { command: process.platform === "win32" ? `.\\node_modules\\.bin\\next.cmd dev --port ${port}` : `pnpm exec next dev --port ${port}`, url: baseURL, timeout: 120_000, reuseExistingServer: false } : undefined,
});
