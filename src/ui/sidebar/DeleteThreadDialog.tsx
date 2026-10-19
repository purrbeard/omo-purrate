import { useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { useT } from "../../i18n";
import { useActions } from "../app-context";
import { Button, Dialog } from "../kit";

export interface DeleteTarget {
  threadId: string;
  title: string;
}

export function DeleteThreadDialog({ target, onClose }: { target: DeleteTarget | null; onClose(): void }) {
  const t = useT();
  const actions = useActions();
  const [deleting, setDeleting] = useState(false);
  const cancel = useRef<HTMLButtonElement>(null);

  const confirm = async (): Promise<void> => {
    if (target === null) return;
    setDeleting(true);
    await actions.deleteThread(target.threadId);
    setDeleting(false);
    onClose();
  };

  return (
    <Dialog.Root open={target !== null} onOpenChange={(open) => { if (!open && !deleting) onClose(); }}>
      <Dialog.Content className="[word-break:keep-all] wrap-break-word" initialFocus={cancel}>
        <Dialog.Title>{t("shell.sidebar.deleteTitle")}</Dialog.Title>
        {target !== null && <Dialog.Description>{t("shell.sidebar.deleteDescription", { name: target.title })}</Dialog.Description>}
        {deleting && <p className="m-0 text-xs leading-4 text-muted-foreground" role="status">{t("shell.sidebar.deleting")}</p>}
        <Dialog.Footer>
          <Button ref={cancel} variant="outline" disabled={deleting} onClick={onClose}>{t("common.cancel")}</Button>
          <Button variant="destructive" icon={<Trash2 />} disabled={deleting} onClick={() => void confirm()}>{t("shell.sidebar.delete")}</Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}
