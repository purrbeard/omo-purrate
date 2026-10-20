import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, type Plugin } from "vite";

const CONTENT_SECURITY_POLICY =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: omo-media:; media-src 'self' blob: omo-media:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'";

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

export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss(), productionCsp()],
  build: { outDir: "dist", emptyOutDir: true, target: "es2022", sourcemap: true },
  server: { port: 5173, strictPort: true },
});
