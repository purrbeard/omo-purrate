// Global setup shared by vitest and Playwright: one temp root per test run, removed when the run ends,
// so every os.tmpdir()/mkdtemp in tests and in the Electron app they launch lands inside it.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export default function setup() {
  const root = mkdtempSync(path.join(tmpdir(), "omo-ui-run-"));
  for (const key of ["TEMP", "TMP", "TMPDIR"]) process.env[key] = root;
  return () => {
    try {
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch (error) {
      console.warn(`test temp root not removed: ${root}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
}
