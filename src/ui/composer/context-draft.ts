export interface DraftContext {
  readonly kind: "file" | "folder" | "terminal";
  readonly value: string;
}

export const CONTEXT_LIMIT = 10;
export const CONTEXT_HEADER = "Attached context (file and folder entries are local references; inspect them with tools):";

export function addContext(current: readonly DraftContext[], added: readonly DraftContext[]): DraftContext[] {
  return [...current, ...added].filter((entry, index, all) => all.findIndex(candidate => candidate.kind === entry.kind && candidate.value === entry.value) === index).slice(0, CONTEXT_LIMIT);
}

export function contextMessage(text: string, context: readonly DraftContext[]): string {
  if (context.length === 0) return text;
  const block = `${CONTEXT_HEADER}\n${JSON.stringify(context, null, 2)}`;
  return text === "" ? block : `${text}\n\n${block}`;
}

export function splitContext(text: string): { text: string; context: DraftContext[] } {
  const index = text.lastIndexOf(`${CONTEXT_HEADER}\n`);
  if (index < 0) return { text, context: [] };
  try {
    const value: unknown = JSON.parse(text.slice(index + CONTEXT_HEADER.length));
    if (!Array.isArray(value) || !value.every(entry => typeof entry === "object" && entry !== null &&
      (entry.kind === "file" || entry.kind === "folder" || entry.kind === "terminal") && typeof entry.value === "string")) return { text, context: [] };
    return { text: text.slice(0, index).trimEnd(), context: value };
  } catch { return { text, context: [] }; }
}
