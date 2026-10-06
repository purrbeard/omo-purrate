import type { AppEvent, AppState, SkillCatalog } from "./types";

export const EMPTY_SKILL_CATALOG: SkillCatalog = {
  status: "idle",
  skills: [],
  errors: [],
  generation: 0,
  stale: false,
};

export function invalidateSkillCatalogs(state: AppState): AppState {
  const generation = state.skillGeneration + 1;
  const skillCatalogs = Object.fromEntries(
    Object.entries(state.skillCatalogs).map(([cwd, catalog]) => [
      cwd,
      { ...catalog, status: "idle" as const, stale: true, generation },
    ]),
  );
  return { ...state, skillCatalogs, skillGeneration: generation };
}

export function reduceSkillCatalog(
  state: AppState,
  event: Extract<AppEvent, { type: "skills/loading" | "skills/loaded" | "skills/failed" }>,
): AppState {
  const catalog = state.skillCatalogs[event.cwd] ?? EMPTY_SKILL_CATALOG;
  if (event.type === "skills/loading") {
    const generation = state.skillGeneration + 1;
    return {
      ...state,
      skillGeneration: generation,
      skillCatalogs: { ...state.skillCatalogs, [event.cwd]: { ...catalog, status: "loading", generation, errors: [] } },
    };
  }
  if (catalog.status !== "loading" || catalog.generation !== event.generation) return state;
  const errors = event.type === "skills/failed" ? [{ path: event.cwd, message: event.message }] : event.errors;
  return {
    ...state,
    skillCatalogs: {
      ...state.skillCatalogs,
      [event.cwd]: {
        ...catalog,
        status: event.type === "skills/failed" ? "error" : "ready",
        skills: event.type === "skills/loaded" ? event.skills : catalog.skills,
        errors,
        stale: false,
      },
    },
  };
}
