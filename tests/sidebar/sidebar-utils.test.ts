import { describe, expect, it } from "vitest";
import { t as translate } from "../../src/i18n";
import type { ThreadSummary, WorkspaceGroup } from "../../src/state";
import { containsThread, filterGroups, isLiveRunning, threadMatches } from "../../src/ui/sidebar/thread-filter";
import { createInitialState } from "../../src/state";
import { emptyConversation } from "../../src/state/conversation";
import type { LiveTask } from "../../shared/protocol";
import { OMO_INSTALL_COMMAND } from "../../shared/ipc";
import type { ThreadFilter } from "../../src/ui/sidebar/thread-filter";
import { formatThreadTime } from "../../src/ui/sidebar/thread-time";
import { workspaceHue, workspaceInitials } from "../../src/ui/sidebar/workspace-badge";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const NO_FILTER: ThreadFilter = { query: "", runningOnly: false, period: "any" };

function thread(id: string, overrides: Partial<ThreadSummary> = {}): ThreadSummary {
  return { id, cwd: "/w/server", name: null, preview: "", updatedAt: 0, status: { type: "idle" }, path: null, source: null, ...overrides };
}

describe("workspaceInitials", () => {
  it("takes the first letters of the first two words", () => {
    expect(workspaceInitials("/Users/me/omo-ui macosapp")).toBe("OU");
    expect(workspaceInitials("/w/deepseek_harness")).toBe("DH");
    expect(workspaceInitials("/w/my.repo/")).toBe("MR");
  });

  it("falls back to the first two characters of a single word", () => {
    expect(workspaceInitials("/w/server")).toBe("SE");
    expect(workspaceInitials("/w/x")).toBe("X");
    expect(workspaceInitials("/w/한글폴더")).toBe("한글");
  });

  it("returns ? for an empty name", () => {
    expect(workspaceInitials("")).toBe("?");
  });
});

describe("workspaceHue", () => {
  it("is deterministic and within 0-359", () => {
    const first = workspaceHue("/w/server");
    expect(first).toBe(workspaceHue("/w/server"));
    expect(first).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThan(360);
  });

  it("differs between sibling workspaces", () => {
    expect(workspaceHue("/w/server")).not.toBe(workspaceHue("/w/client"));
  });
});

describe("formatThreadTime", () => {
  const en = (key: Parameters<typeof translate>[1], vars?: Parameters<typeof translate>[2]) => translate("en", key, vars);
  const now = new Date(2026, 5, 15, 15, 0).getTime();

  it("buckets into now, minutes and hours within a day", () => {
    expect(formatThreadTime(now - 20_000, now, en, "system", "en-US")).toBe("now");
    expect(formatThreadTime(now - 5 * MIN, now, en, "system", "en-US")).toBe("5m");
    expect(formatThreadTime(now - 2 * HOUR, now, en, "system", "en-US")).toBe("2h");
  });

  it("shows a clock honoring the time format from a day on", () => {
    const at = new Date(2026, 5, 11, 9, 5).getTime();
    expect(formatThreadTime(at, now, en, "12h", "en-US")).toBe("Jun 11, 9:05 AM");
    expect(formatThreadTime(at, now, en, "24h", "en-US")).toBe("Jun 11, 09:05");
    expect(formatThreadTime(at, now, en, "system", "en-US")).toMatch(/Jun 11, (9:05 AM|09:05)/);
  });

  it("never reports a future time as anything but now", () => {
    expect(formatThreadTime(now + HOUR, now, en, "system", "en-US")).toBe("now");
  });
});

describe("threadMatches and filterGroups", () => {
  const titled = (candidate: ThreadSummary): string => candidate.name ?? candidate.preview ?? "New thread";
  const groups: WorkspaceGroup[] = [
    { cwd: "/w/server", label: "server", threads: [thread("a", { name: "Fix the login bug" }), thread("b", { preview: "ulw ship it" })] },
    { cwd: "/w/client", label: "client", threads: [thread("c", { name: "Restyle sidebar", cwd: "/w/client" })] },
  ];

  it("matches case-insensitively on title, name and preview", () => {
    expect(threadMatches(thread("a", { name: "Fix the Login bug" }), "Fix the Login bug", "LOGIN")).toBe(true);
    expect(threadMatches(thread("b", { preview: "ulw ship it" }), "New thread", "ship")).toBe(true);
    expect(threadMatches(thread("c"), "New thread", "login")).toBe(false);
  });

  it("treats a blank query as matching everything", () => {
    expect(threadMatches(thread("c"), "New thread", "   ")).toBe(true);
    expect(filterGroups(groups, { ...NO_FILTER, query: "  " }, 0, titled)).toEqual(groups);
  });

  it("drops groups whose threads all miss", () => {
    const filtered = filterGroups(groups, { ...NO_FILTER, query: "login" }, 0, titled);
    expect(filtered.map((group) => group.cwd)).toEqual(["/w/server"]);
    expect(filtered[0]?.threads.map((entry) => entry.id)).toEqual(["a"]);
  });
});

describe("filterGroups running and period filters", () => {
  const now = new Date(2026, 5, 15, 15, 0).getTime();
  const groups: WorkspaceGroup[] = [
    {
      cwd: "/w/server",
      label: "server",
      threads: [
        thread("running", { status: { type: "active", activeFlags: [] }, updatedAt: now - 5 * MIN }),
        thread("this-morning", { updatedAt: new Date(2026, 5, 15, 0, 30).getTime() }),
        thread("last-night", { updatedAt: new Date(2026, 5, 14, 23, 30).getTime() }),
      ],
    },
    {
      cwd: "/w/client",
      label: "client",
      threads: [
        thread("ten-days", { cwd: "/w/client", name: "Ten days old", updatedAt: now - 10 * DAY }),
        thread("forty-days", { cwd: "/w/client", name: "Forty days old", updatedAt: now - 40 * DAY }),
      ],
    },
  ];
  const kept = (filter: Partial<ThreadFilter>): string[] =>
    filterGroups(groups, { ...NO_FILTER, ...filter }, now, (candidate) => candidate.name ?? "").flatMap((group) =>
      group.threads.map((entry) => entry.id),
    );

  it("keeps only running threads when runningOnly is set", () => {
    expect(kept({ runningOnly: true })).toEqual(["running"]);
  });

  it("starts today at local midnight", () => {
    expect(kept({ period: "today" })).toEqual(["running", "this-morning"]);
  });

  it("keeps the last 7 or 30 days", () => {
    expect(kept({ period: "week" })).toEqual(["running", "this-morning", "last-night"]);
    expect(kept({ period: "month" })).toEqual(["running", "this-morning", "last-night", "ten-days"]);
  });

  it("requires every part of the filter", () => {
    expect(kept({ runningOnly: true, period: "today" })).toEqual(["running"]);
    expect(kept({ period: "month", query: "days" })).toEqual(["ten-days"]);
  });

  it("requires task title matches to pass the running and period filters", () => {
    const candidates: WorkspaceGroup[] = [{ cwd: "/w/server", label: "server", threads: [
      thread("old", { updatedAt: now - 40 * DAY, tasks: [{ parentId: "old", taskId: "old-task", title: "Deploy database", status: "running" }] }),
      thread("done", { updatedAt: now, tasks: [{ parentId: "done", taskId: "done-task", title: "Deploy database", status: "completed" }] }),
      thread("live", { updatedAt: now, tasks: [{ parentId: "live", taskId: "live-task", title: "Deploy database", status: "running" }] }),
    ] }];
    const result = filterGroups(candidates, { query: " DEPLOY ", runningOnly: true, period: "today" }, now, () => "");
    expect(result[0]?.threads.map(entry => entry.id)).toEqual(["live"]);
  });

  it("keeps ancestors of nested matches and finds active descendants across workspaces", () => {
    const leaf = thread("leaf", { cwd: "/w/other", name: "Nested match", updatedAt: now });
    const root = thread("root", { children: [thread("middle", { children: [leaf] })] });
    expect(containsThread(root, "leaf")).toBe(true);
    expect(containsThread(root, "unrelated")).toBe(false);
    const result = filterGroups([{ cwd: root.cwd, label: "server", threads: [root] }], { ...NO_FILTER, query: "nested", period: "today" }, now, entry => entry.name ?? "");
    expect(result[0]?.threads).toEqual([root]);
  });
});

describe("sidebar running freshness", () => {
  it("rejects persisted, disconnected and stale work, then resumes on a fresh roster", () => {
    const state = createInitialState();
    state.bridge = { state: "connected", omo: null, userAgent: null, message: null, stderrTail: null, exitCode: null, restartAttempt: 0, installCommand: OMO_INSTALL_COMMAND };
    const conversation = emptyConversation("parent");
    state.conversations.parent = conversation;
    const parent = thread("parent", { tasks: [{ parentId: "parent", taskId: "task", title: "Work", status: "running" }] });
    expect(isLiveRunning(parent, state)).toBe(false);
    conversation.live.freshness = "live";
    conversation.live.tasks.task = { task_id: "task", status: "running", description: "Work" } as LiveTask;
    expect(isLiveRunning(parent, state)).toBe(true);
    conversation.live.tasks.task.residency_state = "persisted_only";
    expect(isLiveRunning(parent, state)).toBe(false);
    conversation.live.tasks.task.residency_state = "resident";
    conversation.live.freshness = "stale";
    expect(isLiveRunning(parent, state)).toBe(false);
    state.bridge.state = "restarting";
    expect(isLiveRunning(thread("active", { status: { type: "active", activeFlags: [] } }), state)).toBe(false);
    state.bridge.state = "connected";
    expect(isLiveRunning(parent, state)).toBe(false);
    conversation.live.freshness = "live";
    expect(isLiveRunning(parent, state)).toBe(true);
    conversation.live.tasks.task.status = "completed";
    expect(isLiveRunning(parent, state)).toBe(false);
  });

  it("uses descendant live state for ancestor counts and filtering", () => {
    const state = createInitialState();
    state.bridge = { state: "connected", omo: null, userAgent: null, message: null, stderrTail: null, exitCode: null, restartAttempt: 0, installCommand: OMO_INSTALL_COMMAND };
    const child = thread("child", { status: { type: "active", activeFlags: [] } });
    state.conversations.child = emptyConversation("child");
    state.conversations.child.live.freshness = "live";
    const root = thread("root", { children: [child] });
    expect(isLiveRunning(root, state)).toBe(true);
    state.conversations.child.live.freshness = "stale";
    expect(isLiveRunning(root, state)).toBe(false);
    expect(filterGroups([{ cwd: root.cwd, label: "server", threads: [root] }], { ...NO_FILTER, runningOnly: true }, 0, () => "", entry => isLiveRunning(entry, state))).toEqual([]);
  });
});
