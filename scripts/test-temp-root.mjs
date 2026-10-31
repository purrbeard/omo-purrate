// Global setup shared by vitest and Playwright: one temp root per test run, quarantined when the run ends,
// so every os.tmpdir()/mkdtemp in tests and in the Electron app they launch lands inside it.
import { mkdirSync, mkdtempSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export default function setup() {
  const parent = tmpdir();
  const root = mkdtempSync(path.join(parent, "omo-ui-run-"));
  for (const key of ["TEMP", "TMP", "TMPDIR"]) process.env[key] = root;
  return () => {
    const quarantine = path.join(parent, "_quarantine");
    mkdirSync(quarantine, { recursive: true });
    const destination = mkdtempSync(path.join(quarantine, "run-"));
    renameSync(root, path.join(destination, path.basename(root)));
  };
}
