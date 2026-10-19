import { describe, expect, it, vi } from "vitest";
import { searchThreadWorkspaceFiles } from "../../electron/ipc";

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
