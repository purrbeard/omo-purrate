import { useState } from "react";
import clsx from "clsx";
import { Button, Modal } from "@deepseek-ai/dsh-client-ui-primitives";
import { useT } from "../../i18n";
import { useActions } from "../app-context";
import css from "./Sidebar.module.css";

export interface DeleteTarget {
  threadId: string;
  title: string;
}

export function DeleteThreadDialog({ target, onClose }: { target: DeleteTarget | null; onClose(): void }) {
  const t = useT();
  const actions = useActions();
  const [deleting, setDeleting] = useState(false);

  const confirm = async (): Promise<void> => {
    if (target === null) return;
    setDeleting(true);
    await actions.deleteThread(target.threadId);
    setDeleting(false);
    onClose();
  };

  return (
    <Modal
      open={target !== null}
      onClose={() => {
        if (!deleting) onClose();
      }}
      className={css.deleteDialog}
      title={t("shell.sidebar.deleteTitle")}
      closeLabel={t("common.close")}
      description={target === null ? undefined : t("shell.sidebar.deleteDescription", { name: target.title })}
      footer={
        <>
          <Button variant="outline" className={css.dialogAction} disabled={deleting} data-modal-autofocus="" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="outline"
            className={clsx(css.dialogAction, css.deleteAction)}
            disabled={deleting}
            onClick={() => void confirm()}
          >
            {t("shell.sidebar.delete")}
          </Button>
        </>
      }
    >
      {deleting ? (
        <div className={css.deleteStatus} role="status">
          {t("shell.sidebar.deleting")}
        </div>
      ) : undefined}
    </Modal>
  );
}
