// Runs a command below normal CPU priority, so a long local run (build, e2e) yields the CPU to whatever the user is
// doing. Windows children inherit a below-normal priority class; elsewhere the niceness is inherited.
// Usage: node scripts/low-priority.mjs <command> [args...]
import { spawn } from "node:child_process";
import os from "node:os";

const [command, ...args] = process.argv.slice(2);
if (command === undefined) {
  console.error("usage: node scripts/low-priority.mjs <command> [args...]");
  process.exit(2);
}
os.setPriority(os.constants.priority.PRIORITY_BELOW_NORMAL);
const child = spawn(command, args, { stdio: "inherit", shell: process.platform === "win32" });
child.on("exit", (code) => process.exit(code ?? 1));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
