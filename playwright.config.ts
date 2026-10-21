import os from "node:os";
import { defineConfig } from "@playwright/test";

// A local run yields the CPU to whatever the owner is doing: the runner, its workers and every app they launch inherit
// below-normal priority. CI keeps normal priority; OMO_UI_E2E_PRIORITY=normal opts a local run out.
if (process.env["CI"] === undefined && process.env["OMO_UI_E2E_PRIORITY"] !== "normal") os.setPriority(os.constants.priority.PRIORITY_BELOW_NORMAL);

export default defineConfig({
  testDir: "e2e",
  globalSetup: "./scripts/test-temp-root.mjs",
  workers: 1,
  fullyParallel: false,
  timeout: 240_000,
  expect: { timeout: 30_000 },
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: { screenshot: "only-on-failure", trace: "retain-on-failure" },
  outputDir: "test-results",
});
