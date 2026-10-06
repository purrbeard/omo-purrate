import { describe, expect, it } from "vitest";
import { createInitialState, reduce, selectSkillCatalog } from "../../src/state";
import type { AppState } from "../../src/state";
import type { SkillMetadata } from "../../shared/protocol";
import { OMO_INSTALL_COMMAND } from "../../shared/ipc";
import { makeThread, notification } from "./helpers";

const cwd = "/tmp/work/project";
const skills: SkillMetadata[] = [{ name: "ulw-loop", description: "Loop", path: "/skills/ulw-loop/SKILL.md", scope: "system", enabled: true }];

function loading(state: AppState = createInitialState()): AppState {
  return reduce(state, { type: "skills/loading", cwd });
}

function loaded(state: AppState, generation = selectSkillCatalog(state, cwd).generation): AppState {
  return reduce(state, { type: "skills/loaded", cwd, generation, skills, errors: [] });
}

describe("skill catalogs", () => {
  it("returns a stable idle catalog for an unrequested cwd", () => {
    const state = createInitialState();
    expect(selectSkillCatalog(state, cwd)).toMatchObject({ status: "idle", skills: [], errors: [], stale: false });
    expect(selectSkillCatalog(state, cwd)).toBe(selectSkillCatalog(state, "/tmp/other"));
  });

  it("settles the requested cwd without changing another catalog", () => {
    const first = loaded(loading());
    const second = reduce(first, { type: "skills/loading", cwd: "/tmp/other" });
    expect(selectSkillCatalog(second, cwd)).toMatchObject({ status: "ready", skills });
    expect(selectSkillCatalog(second, "/tmp/other").status).toBe("loading");
    expect(selectSkillCatalog(second, cwd)).toBe(selectSkillCatalog(first, cwd));
  });

  it("drops both stale success and failure responses", () => {
    const first = loading();
    const generation = selectSkillCatalog(first, cwd).generation;
    const second = loading(first);
    expect(loaded(second, generation)).toBe(second);
    expect(reduce(second, { type: "skills/failed", cwd, generation, message: "old failure" })).toBe(second);
    expect(selectSkillCatalog(loaded(second), cwd).skills).toEqual(skills);
  });

  it("settles a loaded entry with per-file diagnostics as ready and keeps the diagnostics", () => {
    const state = loading();
    const errors = [{ path: "/skills/broken/SKILL.md", message: "Invalid frontmatter" }];
    const next = reduce(state, { type: "skills/loaded", cwd, generation: selectSkillCatalog(state, cwd).generation, skills, errors });
    expect(selectSkillCatalog(next, cwd)).toMatchObject({ status: "ready", skills, errors, stale: false });
  });

  it("marks only a failed request as an error and keeps the previous skills", () => {
    const reloading = loading(loaded(loading()));
    const next = reduce(reloading, { type: "skills/failed", cwd, generation: selectSkillCatalog(reloading, cwd).generation, message: "Disconnected" });
    expect(selectSkillCatalog(next, cwd)).toMatchObject({ status: "error", skills, errors: [{ path: cwd, message: "Disconnected" }] });
  });

  it("invalidates all catalogs and fences pending responses", () => {
    const ready = loaded(loading());
    const pending = reduce(ready, { type: "skills/loading", cwd: "/tmp/other" });
    const next = reduce(pending, notification("skills/changed", {}));
    expect(selectSkillCatalog(next, cwd)).toMatchObject({ status: "idle", stale: true, skills });
    expect(selectSkillCatalog(next, "/tmp/other")).toMatchObject({ status: "idle", stale: true });
    expect(reduce(next, { type: "skills/loaded", cwd: "/tmp/other", generation: pending.skillGeneration, skills, errors: [] })).toBe(next);
  });

  it("clears catalogs and loaded cwds on disconnect without reusing generations", () => {
    const state = loading(reduce(createInitialState(), { type: "thread/opened", thread: makeThread("thread-1"), resumed: true }));
    expect(state.loadedSkillCwds[cwd]).toBe(true);
    const disconnected = reduce(state, { type: "bridge/status", status: {
      state: "exited", omo: null, userAgent: null, message: null, stderrTail: null,
      exitCode: 0, restartAttempt: 0, installCommand: OMO_INSTALL_COMMAND,
    } });
    expect(disconnected.skillCatalogs).toEqual({});
    expect(disconnected.loadedSkillCwds).toEqual({});
    expect(loaded(disconnected, state.skillGeneration)).toBe(disconnected);
    const next = loading(disconnected);
    expect(next.skillGeneration).toBeGreaterThan(state.skillGeneration);
    expect(loaded(next, state.skillGeneration)).toBe(next);
  });
});
