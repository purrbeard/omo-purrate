#!/usr/bin/env node
// Fake update commands and installation write only beneath the test's explicit temporary HOME.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createServer } from "node:net";

const home = process.env.FAKE_UPDATE_HOME;
if (!home) throw new Error("FAKE_UPDATE_HOME is required");
const marker = join(home, "installed-version");
const version = existsSync(marker) ? readFileSync(marker, "utf8") : "5.1.4";
const args = process.argv.slice(2);
const command = args[0];
if (command === "--version") {
  console.log(`omo ${version}`);
} else if (command === "update") {
  appendFileSync(join(home, "update.log"), "check\n");
  if (process.env.FAKE_UPDATE_MODE === "offline") {
    console.error("offline");
    process.exitCode = 1;
  } else if (process.env.FAKE_UPDATE_MODE === "timeout") {
    // A real event-loop handle, not a sleep: the test advances the runner's fake deadline after READY.
    createServer().listen(0, "127.0.0.1", () => console.error("READY"));
  } else if (process.env.FAKE_UPDATE_MODE === "current" || version === "5.1.5") {
    console.log(`omo ${version} is the newest stable release`);
  } else {
    console.log(`omo 5.1.5 is available (running ${version}). Replace this binary with:\nUNTRUSTED COMMAND MUST NOT RUN`);
  }
} else if (command === "install") {
  if (process.env.HOME !== home) throw new Error("installer must use temporary HOME");
  appendFileSync(join(home, "update.log"), "install\n");
  writeFileSync(marker, "5.1.5");
} else if (command === "app-server") {
  appendFileSync(join(home, "update.log"), `app-server ${version}\n`);
  await import("../../fixtures/fake-omo.mjs");
} else {
  throw new Error(`unexpected command ${command}`);
}
