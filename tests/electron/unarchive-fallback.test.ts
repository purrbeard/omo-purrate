import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { unarchiveBySidecar } from "../../electron/omo/unarchive-fallback";

async function archivedSession(threadId: string, sidecarThreadId = threadId): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "omo-ui-unarchive-"));
  const session = path.join(dir, `2026-10-12T00-00-00-000Z_${threadId}.jsonl`);
  await writeFile(session, '{"type":"session","id":"' + threadId + '"}\n');
  await writeFile(session + ".archived", JSON.stringify({ archivedAt: "2026-10-12T00:00:01.000Z", thread: { id: sidecarThreadId, sessionPath: session } }) + "\n");
  return session;
}

describe("unarchiveBySidecar", () => {
  it("removes the sidecar, keeps the history and moves the session mtime forward", async () => {
    const session = await archivedSession("t1");
    const before = await readFile(session, "utf8");
    const now = Date.now() + 60_000;
    expect(await unarchiveBySidecar("t1", session, now)).toBe(true);
    expect(existsSync(session + ".archived")).toBe(false);
    expect(await readFile(session, "utf8")).toBe(before);
    expect(Math.abs((await stat(session)).mtimeMs - now)).toBeLessThan(1000);
  });

  it("leaves everything untouched when the sidecar is missing or names another thread", async () => {
    const other = await archivedSession("t2", "someone-else");
    expect(await unarchiveBySidecar("t2", other)).toBe(false);
    expect(existsSync(other + ".archived")).toBe(true);
    const missing = await archivedSession("t3");
    expect(await unarchiveBySidecar("t3", missing + ".nope")).toBe(false);
  });
});
