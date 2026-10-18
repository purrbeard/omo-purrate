// Run with ELECTRON_RUN_AS_NODE=1 against either the development or packaged runtime.
const path = require("node:path");
const pty = require(process.argv[2] ? path.resolve(process.argv[2]) : "node-pty");
const shell = pty.spawn(process.env.ComSpec || "C:\\Windows\\System32\\cmd.exe", ["/c", "echo pty-ok"], {
  name: "xterm-256color", cols: 80, rows: 24, cwd: process.cwd(), env: process.env,
});
let output = "";
const timeout = setTimeout(() => {
  console.error("PTY_PROOF_TIMEOUT");
  shell.kill();
  process.exitCode = 1;
}, 15_000);
shell.onData(data => {
  output += data;
  process.stdout.write(data);
  // ConPTY can query the attached terminal's cursor position during startup.
  if (data.includes("\u001b[6n")) shell.write("\u001b[1;1R");
});
shell.onExit(({ exitCode }) => {
  clearTimeout(timeout);
  const success = exitCode === 0 && output.includes("pty-ok");
  console.log(`\nPTY_PROOF=${success ? "PASS" : "FAIL"} exit=${exitCode} abi=${process.versions.modules}`);
  // node-pty's console-list helper may retain an IPC handle after ConPTY exit in Electron's Node mode.
  process.exit(success ? 0 : 1);
});
