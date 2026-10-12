export interface PaletteEntry {
  id: string;
  kind: "command" | "session";
  title: string;
  subtitle?: string;
  shortcut?: string[];
  run(): void;
}

export type PaletteCommand = Omit<PaletteEntry, "kind">;
export interface PaletteSession {
  id: string;
  title: string;
  workspace: string;
}

/** Preserve command order and the sidebar selector's session order without executing actions. */
export function buildPaletteEntries(
  commands: readonly PaletteCommand[],
  sessions: readonly PaletteSession[],
  openSession: (id: string) => void,
): PaletteEntry[] {
  return [
    ...commands.map(command => ({ ...command, kind: "command" as const })),
    ...sessions.map(session => ({
      id: `session:${session.id}`,
      kind: "session" as const,
      title: session.title,
      subtitle: session.workspace,
      run: () => openSession(session.id),
    })),
  ];
}

function matchRank(text: string, query: string): number | null {
  if (text === query) return 0;
  if (text.startsWith(query)) return 1;
  const words = text.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (query.split(/\s+/).every(term => words.some(word => word.startsWith(term)))) return 2;
  if (text.includes(query)) return 3;
  let cursor = 0;
  for (const letter of query.replace(/\s+/g, "")) {
    const found = text.indexOf(letter, cursor);
    if (found < 0) return null;
    cursor = found + 1;
  }
  return 4;
}

/** Title matches win over workspace matches; commands win only when match quality ties. */
export function filterPaletteEntries(entries: readonly PaletteEntry[], query: string): PaletteEntry[] {
  const normalized = query.trim().toLowerCase();
  if (normalized === "") return [...entries];
  return entries.flatMap((entry, index) => {
    const titleRank = matchRank(entry.title.toLowerCase(), normalized);
    const subtitleRank = entry.subtitle === undefined ? null : matchRank(entry.subtitle.toLowerCase(), normalized);
    const combinedRank = matchRank(`${entry.title} ${entry.subtitle ?? ""}`.toLowerCase(), normalized);
    const ranks = [titleRank, subtitleRank === null ? null : subtitleRank + 5, combinedRank === null ? null : combinedRank + 5]
      .filter((rank): rank is number => rank !== null);
    if (ranks.length === 0) return [];
    return [{ entry, rank: Math.min(...ranks), index }];
  }).sort((a, b) => a.rank - b.rank || Number(a.entry.kind === "session") - Number(b.entry.kind === "session") || a.index - b.index)
    .map(match => match.entry);
}
