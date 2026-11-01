/** A native session entry, identified independently of rendered message blocks. */
export interface SessionTreeNode {
  entryId: string;
  parentId: string | null;
  type: string;
  role: string | null;
  label: string;
  /** Preview for navigation; a read-entry request supplies full text before editing. */
  text?: string;
}

export type SessionTreeEditResult =
  | { outcome: "edited"; leafId: string | null; entry: Record<string, unknown> }
  | { outcome: "unchanged"; leafId: string | null }
  | { outcome: "cancelled"; leafId: string | null; aborted?: boolean };
