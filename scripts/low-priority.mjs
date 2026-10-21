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
// The Windows shell (needed for npm/npx .cmd shims) splits on spaces, so an argument such as an exe path is quoted.
const quote = (value) => (/[\s"]/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value);
const windows = process.platform === "win32";
const child = spawn(windows ? quote(command) : command, windows ? args.map(quote) : args, { stdio: "inherit", shell: windows });
child.on("exit", (code) => process.exit(code ?? 1));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
