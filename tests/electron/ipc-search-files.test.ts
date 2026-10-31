import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createSessionFileResolver, searchThreadWorkspaceFiles } from "../../electron/ipc";
import { quarantineSync } from "../../scripts/quarantine-temp.mjs";

vi.mock("electron", () => ({
  app: { name: "OmO UI", isPackaged: false },
  clipboard: {},
  dialog: {},
  ipcMain: {},
  shell: {},
}));

describe("searchThreadWorkspaceFiles", () => {
  it("rejects a cwd that is not the thread's own workspace", async () => {
    const readThread = vi.fn(async () => ({ thread: { cwd: "/work/project" } }));
    await expect(searchThreadWorkspaceFiles(readThread, "thread-1", "/etc", "passwd")).rejects.toThrow("cwd is not the thread's workspace");
    expect(readThread).toHaveBeenCalledWith("thread-1");
  });

  it("rejects an oversized or non-string query before reading the thread", async () => {
    const readThread = vi.fn(async () => ({ thread: { cwd: "/work/project" } }));
    await expect(searchThreadWorkspaceFiles(readThread, "thread-1", "/work/project", "x".repeat(201))).rejects.toThrow(TypeError);
    await expect(searchThreadWorkspaceFiles(readThread, "thread-1", "/work/project", 5)).rejects.toThrow(TypeError);
    expect(readThread).not.toHaveBeenCalled();
  });
});

it("allows Alpha history reads but refuses changes until it has been copied into the native store", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "purrate-alpha-boundary-"));
  const agent = path.join(root, "agent");
  const alpha = path.join(root, ".omo", "desktop", "userdata", "omo-sessions");
  await mkdir(path.join(agent, "sessions"), { recursive: true });
  await mkdir(alpha, { recursive: true });
  const external = path.join(alpha, "alpha.jsonl"), own = path.join(agent, "sessions", "own.jsonl");
  const original = '{"type":"session","id":"alpha"}\n';
  await writeFile(external, original); await writeFile(own, original);
  vi.stubEnv("OMO_UI_ALPHA_HOME", path.join(root, ".omo", "desktop"));
  try {
    const supervisor = { initializeResult: { codexHome: agent } };
    await expect(createSessionFileResolver(supervisor, root)(external)).resolves.toBe(external);
    await expect(createSessionFileResolver(supervisor, root, true)(external)).rejects.toThrow("Copy this Alpha session");
    await expect(createSessionFileResolver(supervisor, root, true)(own)).resolves.toBe(own);
    expect(await readFile(external, "utf8")).toBe(original);
  } finally { vi.unstubAllEnvs(); quarantineSync(root, { recursive: true, force: true }); }
});

it("keeps the configured native store boundary while the supervisor reconnects", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "purrate-reconnect-boundary-"));
  const agent = path.join(root, "isolated-agent");
  const fallback = path.join(root, ".omo", "agent", "sessions");
  await mkdir(path.join(agent, "sessions"), { recursive: true });
  await mkdir(fallback, { recursive: true });
  const own = path.join(agent, "sessions", "own.jsonl"), unrelated = path.join(fallback, "other.jsonl");
  await writeFile(own, "{}\n"); await writeFile(unrelated, "{}\n");
  vi.stubEnv("OMO_UI_QA_AGENT_DIR", agent);
  try {
    const resolve = createSessionFileResolver({ initializeResult: null }, root, true);
    await expect(resolve(own)).resolves.toBe(own);
    await expect(resolve(unrelated)).rejects.toThrow("Copy this Alpha session");
  } finally { vi.unstubAllEnvs(); quarantineSync(root, { recursive: true, force: true }); }
});
