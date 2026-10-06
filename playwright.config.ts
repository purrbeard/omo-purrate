import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  workers: 1,
  fullyParallel: false,
  timeout: 240_000,
  expect: { timeout: 30_000 },
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: { screenshot: "only-on-failure", trace: "retain-on-failure" },
  outputDir: "test-results",
});
