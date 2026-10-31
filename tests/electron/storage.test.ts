import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, symlink, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readStorageUsage } from "../../electron/storage";

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "omo-storage-"));
  const agentDir = path.join(root, "agent");
  const userData = path.join(root, "user");
  await mkdir(agentDir);
  await mkdir(userData);
  return { root, agentDir, userData };
}

async function hash(file: string) {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}

describe("readStorageUsage", () => {
  it("counts files and old candidates without changing contents, and excludes a junction", async () => {
    const { root, agentDir, userData } = await fixture();
    const sessions = path.join(agentDir, "sessions");
    const outside = path.join(root, "outside");
    await mkdir(sessions);
    await mkdir(outside);
    const old = path.join(sessions, "old");
    const recent = path.join(sessions, "recent");
    await writeFile(old, "abc");
    await writeFile(recent, "1234567");
    await writeFile(path.join(outside, "secret"), "not counted");
    await utimes(old, new Date("2000-01-01T00:00:00Z"), new Date("2000-01-01T00:00:00Z"));
    await symlink(outside, path.join(sessions, "external"), process.platform === "win32" ? "junction" : "dir");
    const before = await Promise.all([hash(old), hash(recent), hash(path.join(outside, "secret"))]);
    const result = await readStorageUsage({ agentDir, userData, olderThanDays: 30 });
    expect(result.rows).toEqual([
      { category: "sessions", state: "present", count: 2, bytes: 10, candidateCount: 1, candidateBytes: 3, skipped: 1, errors: 0, incomplete: false },
      { category: "attachments", state: "absent", count: 0, bytes: 0, candidateCount: 0, candidateBytes: 0, skipped: 0, errors: 0, incomplete: false },
      { category: "screenshots", state: "absent", count: 0, bytes: 0, candidateCount: 0, candidateBytes: 0, skipped: 0, errors: 0, incomplete: false },
    ]);
    expect(result.incomplete).toBe(false);
    expect(await Promise.all([hash(old), hash(recent), hash(path.join(outside, "secret"))])).toEqual(before);
  });

  it("reports an inaccessible base as unavailable rather than an absent or empty root", async () => {
    const { root, agentDir } = await fixture();
    const result = await readStorageUsage({ agentDir, userData: path.join(root, "missing"), olderThanDays: 30 });
    expect(result.incomplete).toBe(true);
    expect(result.rows.slice(1)).toEqual([
      expect.objectContaining({ category: "attachments", state: "unavailable", errors: 1, incomplete: true }),
      expect.objectContaining({ category: "screenshots", state: "unavailable", errors: 1, incomplete: true }),
    ]);
  });

  it("rejects invalid age and relative roots", async () => {
    const { agentDir, userData } = await fixture();
    for (const olderThanDays of [0, -1, 1.5, NaN, 3651]) {
      await expect(readStorageUsage({ agentDir, userData, olderThanDays })).rejects.toThrow();
    }
    await expect(readStorageUsage({ agentDir: "relative", userData, olderThanDays: 30 })).rejects.toThrow();
  });
});
