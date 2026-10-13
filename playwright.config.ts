/**
 * Browser specs against THE STAND: a real Adminium with this app installed
 * and its sample in (`e2e/stand.mjs`). There is no browser-only build of this
 * app to test instead: every screen reads the server.
 *
 * One worker, one stand per run. The stand is started by the global setup and
 * stopped by the teardown; `CRM_STAND_KEEP=1` leaves it running for the next
 * run (and for a look by hand), and a stand that is already up is reused.
 */
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.e2e\.ts$/,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  timeout: 120_000,
  expect: { timeout: 15_000 },
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  use: { ...devices["Desktop Chrome"], trace: "retain-on-failure", screenshot: "only-on-failure", video: "off" },
  outputDir: "./e2e/.results",
});
