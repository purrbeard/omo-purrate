import { rankByName } from "@deepseek-ai/dsh-client-ui-primitives";
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
    const provider = providerOf(model.id);
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
