import { useState } from "react";
import type { SessionTreeNode } from "../../../shared/session-tree";
import { useLocale } from "../../i18n";
import { Button, Dialog } from "../kit";

export interface SessionTreeDialogProps {
  open: boolean;
  nodes: SessionTreeNode[];
  leafId: string | null;
  busy: boolean;
  onClose(): void;
  onSelect(entryId: string, intent: "select" | "resume"): void;
  onEdit(entryId: string, text: string): void;
}

export function SessionTreeDialog({ open, nodes, leafId, busy, onClose, onSelect, onEdit }: SessionTreeDialogProps) {
  const locale = useLocale();
  const ko = locale === "ko";
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [metadata, setMetadata] = useState(false);
  const depths = new Map<string, number>();
  for (const node of nodes) depths.set(node.entryId, node.parentId === null ? 0 : (depths.get(node.parentId) ?? -1) + 1);
  const displayed = metadata ? nodes : nodes.filter(node => node.role === "user" || node.role === "assistant");
  const editedNode = nodes.find(node => node.entryId === editing && node.type === "message" && node.role === "assistant");
  const canSave = !busy && editedNode !== undefined && draft.trim() !== "" && draft !== editedNode.text;

  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!next && !busy) { setEditing(null); onClose(); } }}>
      <Dialog.Content className="min-w-0" data-testid="session-tree-dialog">
        <Dialog.Title>{ko ? "대화 트리" : "Session tree"}</Dialog.Title>
        <Dialog.Description>{ko ? "항목을 선택하거나 해당 지점에서 이어갑니다." : "Select an entry or resume from it."}</Dialog.Description>
        <label className="text-xs text-muted-foreground"><input type="checkbox" checked={metadata} onChange={event => setMetadata(event.target.checked)} /> {ko ? "내부 기록 포함" : "Include internal entries"}</label>
        <div className="min-h-0 min-w-0 max-h-[50dvh] overflow-auto">
          <ul className="m-0 flex min-w-0 list-none flex-col gap-2 p-0">
            {displayed.map(node => (
              <li key={node.entryId} data-entry-id={node.entryId} data-entry-role={node.role} data-depth={depths.get(node.entryId)} className="min-w-0 rounded-md border border-solid border-border p-2" style={{ marginInlineStart: Math.min(depths.get(node.entryId) ?? 0, 4) * 8 }}>
                <div className="break-all text-xs text-muted-foreground">
                  {node.role ?? node.type} · {node.entryId}
                  {node.parentId !== null && <> ← {node.parentId}</>}
                  {node.entryId === leafId && (ko ? " · 현재" : " · current")}
                </div>
                <div className="min-w-0 break-words text-sm">{node.label}</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => onSelect(node.entryId, "select")}>
                    {ko ? "선택" : "Select"}
                  </Button>
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => onSelect(node.entryId, "resume")}>
                    {ko ? "이어가기" : "Resume"}
                  </Button>
                  {node.type === "message" && node.role === "assistant" && (
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => { setEditing(node.entryId); setDraft(node.text ?? ""); }}>
                      {ko ? "편집" : "Edit"}
                    </Button>
                  )}
                </div>
                {editing === node.entryId && editedNode !== undefined && (
                  <div className="mt-2 flex min-w-0 flex-col gap-2">
                    <textarea
                      className="box-border min-h-24 w-full resize-y rounded-md border border-solid border-input bg-background p-2 text-sm text-foreground [font-family:inherit]"
                      aria-label={ko ? "assistant 응답 편집" : "Edit assistant response"}
                      value={draft}
                      disabled={busy}
                      onChange={event => setDraft(event.target.value)}
                    />
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => setEditing(null)}>{ko ? "취소" : "Cancel"}</Button>
                      <Button size="sm" variant="primary" disabled={!canSave} onClick={() => { if (canSave) onEdit(node.entryId, draft); }}>
                        {ko ? "저장" : "Save"}
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
        <Dialog.Footer>
          <Button variant="outline" disabled={busy} onClick={() => { setEditing(null); onClose(); }}>{ko ? "닫기" : "Close"}</Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}
