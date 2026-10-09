import { rankByName } from "../../dsh/primitives/rank-by-name";
import type { Model, ReasoningEffort } from "../../../shared/protocol";

export interface ModelGroup {
  provider: string;
  models: Model[];
}

export function providerOf(id: string): string {
  const slash = id.indexOf("/");
  return slash === -1 ? id : id.slice(0, slash);
}

/** Groups visible models by provider prefix, providers in first-seen order and models in catalog order. */
export function groupModels(models: readonly Model[]): ModelGroup[] {
  const groups = new Map<string, ModelGroup>();
  for (const model of models) {
    if (model.hidden) continue;
    const wireProvider = providerOf(model.id);
    const segments = model.id.split("/");
    const owner = model.displayName.includes(" · ") ? model.displayName.split(" · ")[0] : "OpenCodex";
    const routeGroup = segments.slice(1, -1).join("/");
    const provider = wireProvider === "opencodex"
      ? `OpenCodex / ${segments.length > 2 ? owner === "openai" && !routeGroup.startsWith("openai") ? `openai / ${routeGroup}` : routeGroup : owner}`
      : wireProvider;
    const group = groups.get(provider);
    if (group === undefined) groups.set(provider, { provider, models: [model] });
    else group.models.push(model);
  }
  return [...groups.values()];
}

/** Filters each group with the shared menu ranking over displayName and id; an empty query keeps every group. */
export function filterGroups(groups: readonly ModelGroup[], query: string): ModelGroup[] {
  const trimmed = query.trim();
  if (trimmed === "") return [...groups];
  return groups
    .map((group) => ({
      provider: group.provider,
      models: rankByName(
        group.models.map((model) => ({ name: model.displayName, label: model.id, model })),
        trimmed,
      ).map((entry) => entry.model),
    }))
    .filter((group) => group.models.length > 0);
}

const EFFORT_ORDER: readonly ReasoningEffort[] = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];

/**
 * A catalog entry reduced to what the model really offers: known levels only, each once, weakest first, with a default
 * taken from that list. omo sends "medium" as every model's default, including models that do not offer it or do not
 * reason at all, so nothing downstream may trust the raw value.
 */
export function normalizeModel(model: Model): Model {
  const supportedReasoningEfforts = EFFORT_ORDER.flatMap((level) => {
    const entry = model.supportedReasoningEfforts.find((candidate) => candidate.reasoningEffort === level);
    return entry === undefined ? [] : [entry];
  });
  const offered = { ...model, supportedReasoningEfforts };
  return { ...offered, defaultReasoningEffort: resolveEffort(offered, null) };
}

/**
 * The effort a model runs with: the composer's choice when the model supports it, else the model's default. omo can
 * report a default the model does not offer (a level its own map leaves out); the next stronger offered level stands in,
 * so the value shown and sent is always one omo accepts.
 */
export function resolveEffort(model: Model | null, effort: ReasoningEffort | null): ReasoningEffort | null {
  if (model === null) return effort;
  const offered = model.supportedReasoningEfforts.map((entry) => entry.reasoningEffort);
  if (offered.length === 0) return null;
  if (effort !== null && offered.includes(effort)) return effort;
  const fallback = model.defaultReasoningEffort;
  if (fallback === null || offered.length === 0 || offered.includes(fallback)) return fallback;
  const wanted = EFFORT_ORDER.indexOf(fallback);
  const ranked = [...offered].sort((left, right) => EFFORT_ORDER.indexOf(left) - EFFORT_ORDER.indexOf(right));
  return ranked.find((entry) => EFFORT_ORDER.indexOf(entry) >= wanted) ?? ranked.at(-1) ?? null;
}
