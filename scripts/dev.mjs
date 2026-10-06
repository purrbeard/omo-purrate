import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { createServer } from "vite";

const built = spawnSync(process.execPath, ["scripts/build-electron.mjs"], { stdio: "inherit" });
if (built.status !== 0) process.exit(built.status ?? 1);

const server = await createServer({ server: { port: 5173, strictPort: true } });
await server.listen();

const electronPath = createRequire(import.meta.url)("electron");
const child = spawn(electronPath, ["."], {
  stdio: "inherit",
  env: { ...process.env, OMO_UI_DEV_URL: "http://localhost:5173" },
});

child.on("exit", async (code) => {
  await server.close();
  process.exit(code ?? 0);
});
