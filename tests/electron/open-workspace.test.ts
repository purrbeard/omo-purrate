import { describe, expect, it } from "vitest";
import { createOpenWorkspace, isOpenTargetId } from "../../electron/open-workspace";

interface Call {
  file: string;
  args: readonly string[];
}

function harness(installed: readonly string[], options: { directories?: readonly string[]; openPathProblem?: string } = {}) {
  const calls: Call[] = [];
  const opened: string[] = [];
  const directories = options.directories ?? ["/repo/server"];
  const service = createOpenWorkspace({
    exec: async (file, args) => {
      calls.push({ file, args });
      if (file === "/usr/bin/mdfind") {
        const bundle = /'([^']+)'/.exec(args[0] ?? "")?.[1] ?? "";
        return installed.includes(bundle) ? `/Applications/${bundle}.app\n` : "";
      }
      return "";
    },
    openPath: async (target) => {
      opened.push(target);
      return options.openPathProblem ?? "";
    },
    statPath: async (target) => {
      if (!directories.includes(target)) throw new Error(`ENOENT: ${target}`);
      return { isDirectory: () => true };
    },
  });
  return { service, calls, opened };
}

const VSCODE = "com.microsoft.VSCode";
const TERMINAL = "com.apple.Terminal";

describe("createOpenWorkspace", () => {
  it("lists installed editors, Terminal and always Finder", async () => {
    const { service } = harness([VSCODE, TERMINAL]);
    expect((await service.listTargets()).map((target) => target.id)).toEqual(["vscode", "terminal", "finder"]);
    expect((await harness([]).service.listTargets()).map((target) => target.id)).toEqual(["finder"]);
  });

  it("opens the default target in VS Code through /usr/bin/open -b when installed", async () => {
    const { service, calls, opened } = harness([VSCODE]);
    await expect(service.openDefault("/repo/server")).resolves.toBe("vscode");
    expect(calls.at(-1)).toEqual({ file: "/usr/bin/open", args: ["-b", VSCODE, "/repo/server"] });
    expect(opened).toEqual([]);
  });

  it("falls back to Finder through shell.openPath when no editor is installed", async () => {
    const { service, calls, opened } = harness([]);
    await expect(service.openDefault("/repo/server")).resolves.toBe("finder");
    expect(opened).toEqual(["/repo/server"]);
    expect(calls.filter((call) => call.file === "/usr/bin/open")).toEqual([]);
  });

  it("opens Terminal with open -a Terminal", async () => {
    const { service, calls } = harness([TERMINAL]);
    await service.open("/repo/server", "terminal");
    expect(calls.at(-1)).toEqual({ file: "/usr/bin/open", args: ["-a", "Terminal", "/repo/server"] });
  });

  it("rejects relative, missing and non-directory paths before spawning anything", async () => {
    const { service, calls, opened } = harness([VSCODE], { directories: ["/repo/server"] });
    await expect(service.open("repo/server", "vscode")).rejects.toThrow(/absolute/);
    await expect(service.open("/repo/missing", "vscode")).rejects.toThrow(/does not exist/);
    await expect(service.open("", "finder")).rejects.toThrow(/non-empty/);
    expect(calls.filter((call) => call.file === "/usr/bin/open")).toEqual([]);
    expect(opened).toEqual([]);
  });

  it("rejects targets outside the allowlist and editors that are not installed", async () => {
    const { service, calls } = harness([]);
    await expect(service.open("/repo/server", "textedit")).rejects.toThrow(/unknown open target/);
    await expect(service.open("/repo/server", "vscode")).rejects.toThrow(/not installed/);
    expect(calls.filter((call) => call.file === "/usr/bin/open")).toEqual([]);
  });

  it("surfaces the problem string shell.openPath returns", async () => {
    const { service } = harness([], { openPathProblem: "Finder refused" });
    await expect(service.open("/repo/server", "finder")).rejects.toThrow("Finder refused");
  });

  it("narrows target ids", () => {
    expect(isOpenTargetId("finder")).toBe(true);
    expect(isOpenTargetId("rm -rf")).toBe(false);
  });
});
