import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { openLocalPath, statPaths } from "../../electron/path-actions";
import type { PathActionDeps } from "../../electron/path-actions";

function deps(overrides: Partial<PathActionDeps> = {}): PathActionDeps & { opened: string[]; revealed: string[] } {
  const opened: string[] = [];
  const revealed: string[] = [];
  return {
    opened,
    revealed,
    openPath: async (target) => {
      opened.push(target);
      return "";
    },
    showItemInFolder: (target) => {
      revealed.push(target);
    },
    ...overrides,
  };
}

async function workspace(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "omo-path-"));
  await writeFile(path.join(dir, "note.txt"), "hi");
  await writeFile(path.join(dir, "tool.exe"), "MZ");
  await mkdir(path.join(dir, "sub"));
  return dir;
}

describe("statPaths", () => {
  it("reports files, directories and misses in request order", async () => {
    const dir = await workspace();
    const result = await statPaths([path.join(dir, "note.txt"), path.join(dir, "sub"), path.join(dir, "nope"), "relative.txt", 7]);
    expect(result).toEqual([{ kind: "file", size: 2 }, { kind: "dir" }, { kind: "missing" }, { kind: "missing" }, { kind: "missing" }]);
  });

  it("rejects a non-array", async () => {
    await expect(statPaths("x")).rejects.toThrow(TypeError);
  });
});

describe("openLocalPath", () => {
  it("opens files and folders with the OS default app", async () => {
    const dir = await workspace();
    const d = deps();
    expect(await openLocalPath(path.join(dir, "note.txt"), d)).toBe("opened");
    expect(await openLocalPath(path.join(dir, "sub"), d)).toBe("opened");
    expect(d.opened).toEqual([path.join(dir, "note.txt"), path.join(dir, "sub")]);
    expect(d.revealed).toEqual([]);
  });

  it("reveals programs instead of running them", async () => {
    const dir = await workspace();
    const d = deps();
    expect(await openLocalPath(path.join(dir, "tool.exe"), d)).toBe("revealed");
    expect(d.opened).toEqual([]);
    expect(d.revealed).toEqual([path.join(dir, "tool.exe")]);
  });

  it("refuses missing and relative paths with a clear error", async () => {
    const dir = await workspace();
    await expect(openLocalPath(path.join(dir, "nope.txt"), deps())).rejects.toThrow(/does not exist/);
    await expect(openLocalPath("note.txt", deps())).rejects.toThrow(/absolute/);
    await expect(openLocalPath(42, deps())).rejects.toThrow(TypeError);
  });

  it("surfaces an OS failure", async () => {
    const dir = await workspace();
    await expect(openLocalPath(path.join(dir, "note.txt"), deps({ openPath: async () => "no app" }))).rejects.toThrow("no app");
  });

  it("logs instead of launching when a QA log is set", async () => {
    const dir = await workspace();
    const qaLog = path.join(dir, "open.log");
    const d = deps({ qaLog });
    await openLocalPath(path.join(dir, "note.txt"), d);
    await openLocalPath(path.join(dir, "tool.exe"), d);
    const lines = (await readFile(qaLog, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as unknown);
    expect(lines).toEqual([{ action: "open", path: path.join(dir, "note.txt") }, { action: "reveal", path: path.join(dir, "tool.exe") }]);
    expect(d.opened).toEqual([]);
    expect(d.revealed).toEqual([]);
  });
});
