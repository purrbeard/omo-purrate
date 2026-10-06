import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const ROOT = path.dirname(fileURLToPath(import.meta.url));

const CONTENT_SECURITY_POLICY =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'";

/** Adds the Content-Security-Policy meta tag to index.html in production builds only. */
function productionCsp(): Plugin {
  return {
    name: "omo-ui-production-csp",
    apply: "build",
    transformIndexHtml: () => [
      {
        tag: "meta",
        attrs: { "http-equiv": "Content-Security-Policy", content: CONTENT_SECURITY_POLICY },
        injectTo: "head-prepend",
      },
    ],
  };
}

/**
 * Maps a DSH package name to its vendored copy under src/dsh: the bare specifier
 * resolves to the package entry and "<name>/src/<file>" to the same relative file.
 * The table mirrors compilerOptions.paths in tsconfig.json.
 */
function vendored(name: string, dir: string, entry = "index.ts"): { find: RegExp; replacement: string }[] {
  const escaped = name.replace(/[/@.-]/g, (c) => "\\" + c);
  return [
    { find: new RegExp("^" + escaped + "/src/(.*)$"), replacement: path.join(ROOT, dir, "$1") },
    { find: new RegExp("^" + escaped + "$"), replacement: path.join(ROOT, dir, entry) },
  ];
}

export default defineConfig({
  base: "./",
  plugins: [react(), productionCsp()],
  resolve: {
    alias: [
      ...vendored("@deepseek-ai/dsh-client-ui-primitives", "src/dsh/primitives"),
      ...vendored("@deepseek-ai/dsh-util-code-language", "src/dsh/vendor/code-language"),
      ...vendored("@deepseek-ai/dsh-util-workspace-path", "src/dsh/vendor/workspace-path"),
      ...vendored("@deepseek-ai/dsh-client-store", "src/dsh/vendor/store"),
    ],
  },
  build: { outDir: "dist", emptyOutDir: true, target: "es2022", sourcemap: true },
  server: { port: 5173, strictPort: true },
});
