import { build } from "esbuild";

const common = {
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  mainFields: ["module", "main"],
  sourcemap: true,
  external: ["electron"],
  logLevel: "warning",
};

try {
  await Promise.all([
    build({ ...common, format: "esm", entryPoints: ["electron/omo/tree-selection-extension.ts"], outfile: "dist-electron/tree-selection-extension.js" }),
    build({ ...common, entryPoints: ["electron/main.ts"], outfile: "dist-electron/main.cjs" }),
    build({ ...common, entryPoints: ["electron/preload.ts"], outfile: "dist-electron/preload.cjs" }),
    build({ ...common, entryPoints: ["scripts/smoke-bridge.ts"], outfile: "dist-electron/smoke-bridge.cjs" }),
  ]);
} catch (error) {
  console.error(error);
  process.exit(1);
}
