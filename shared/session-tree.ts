/** A native session entry, identified independently of rendered message blocks. */
export interface SessionTreeNode {
  entryId: string;
  parentId: string | null;
  type: string;
  role: string | null;
  label: string;
  /** Full conversation text for user/assistant entries; assistant entries are editable. Internal entries keep labels. */
  text?: string;
}

export type SessionTreeEditResult =
  | { outcome: "edited"; leafId: string | null; entry: Record<string, unknown> }
  | { outcome: "unchanged"; leafId: string | null }
  | { outcome: "cancelled"; leafId: string | null; aborted?: boolean };
