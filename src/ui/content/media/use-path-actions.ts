// Open / reveal / copy actions for a path mentioned in chat, with failures reported through the notice system.

import { useCallback, useContext, useMemo } from "react";
import { useT } from "../../../i18n";
import { StoreContext } from "../../app-context";

export interface PathActions {
  /** Open with the OS default app (programs are revealed instead). */
  open(absolutePath: string): void;
  /** Show the path in its folder. */
  reveal(absolutePath: string): void;
  /** Put the path on the clipboard. */
  copy(absolutePath: string): Promise<void>;
}

/**
 * Actions on an absolute path; errors (a vanished file, a refused open) surface as an error notice.
 */
export function usePathActions(): PathActions {
  const t = useT();
  const store = useContext(StoreContext);
  const fail = useCallback((error: unknown): void => {
    const message = error instanceof Error ? error.message : String(error);
    store?.dispatch({
      type: "notice/pushed",
      notice: { id: crypto.randomUUID(), level: "error", message: t("conversation.path.openFailed", { message }), threadId: null },
    });
  }, [store, t]);
  return useMemo<PathActions>(() => ({
    open: (path) => void window.omo.openPath(path).catch(fail),
    reveal: (path) => void window.omo.revealPath(path).catch(fail),
    copy: (path) => window.omo.copyText(path).catch(fail),
  }), [fail]);
}
