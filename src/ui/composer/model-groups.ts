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

/** The effort a model runs with: the composer's choice when the model supports it, else the model's default. */
export function resolveEffort(model: Model | null, effort: ReasoningEffort | null): ReasoningEffort | null {
  if (model === null) return effort;
  if (effort !== null && model.supportedReasoningEfforts.some((entry) => entry.reasoningEffort === effort)) return effort;
  return model.defaultReasoningEffort;
}
