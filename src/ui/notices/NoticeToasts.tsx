import { useEffect, useRef } from "react";
import { Toast } from "../kit";
import { useT, type Translate } from "../../i18n";
import { selectToastNotice } from "../../state";
import type { Notice } from "../../state";
import { useActions, useAppSelector } from "../app-context";
import { TESTID } from "../testids";
import { errorText } from "./error-text";

const ERROR_HOLD_MS = 6000;
const INFO_HOLD_MS = 3000;
const ACTION_HOLD_MS = 8000;

/**
 * @returns the user-facing heading and body of a notice: coded notices translate by code, RPC failures drop their
 *   numeric code and translate the ones the UI knows, and other text (omo's own words) is shown as written
 */
export function noticeContent(notice: Notice, t: Translate): { title: string | null; text: string } {
  if (notice.code !== undefined) return { title: notice.level === "error" ? t("notice.title.error") : null, text: t(`notice.${notice.code}`, notice.params) };
  const { text, rpc } = errorText(notice.message, t);
  if (rpc) return { title: t("notice.title.requestFailed"), text };
  return { title: notice.level === "error" ? t("notice.title.error") : null, text };
}

function holdMs(notice: Notice, openThread: string | null): number {
  if (openThread !== null || notice.code === "modelSwitch") return ACTION_HOLD_MS;
  return notice.level === "error" ? ERROR_HOLD_MS : INFO_HOLD_MS;
}

/**
 * Shows store notices one at a time, oldest first, as kit toasts with an icon, a close button and automatic dismissal;
 * a notice leaves the store when its toast closes. Side chat notices render inside the side chat panel instead, and a
 * notice with an `open-thread` action keeps its toast long enough to press Open.
 */
export function NoticeToasts() {
  const t = useT();
  return (
    <Toast.Provider limit={1}>
      <NoticeQueue />
      <Toast.Viewport closeLabel={t("common.close")} />
    </Toast.Provider>
  );
}

function NoticeQueue() {
  const notice = useAppSelector(selectToastNotice);
  const actions = useActions();
  const t = useT();
  const toast = Toast.useToast();
  const shown = useRef<string | null>(null);

  useEffect(() => {
    if (notice === null || shown.current === notice.id) return;
    shown.current = notice.id;
    const { title, text } = noticeContent(notice, t);
    const openThread = notice.action === "open-thread" && notice.threadId !== null ? notice.threadId : null;
    const description = (
      <span data-testid={TESTID.noticeToast} data-level={notice.level}>
        {text}
      </span>
    );
    const common = {
      id: notice.id,
      description,
      // Transient by design: an RPC failure is not a state the user has to acknowledge. Low priority keeps the
      // announcement in the viewport's polite live region instead of a second, duplicated alert copy.
      timeout: holdMs(notice, openThread),
      priority: "low" as const,
      onClose: () => actions.dismissNotice(notice.id),
      ...(openThread === null
        ? {}
        : { actionProps: { children: t("notice.action.open"), onClick: () => { void actions.openThread(openThread); toast.close(notice.id); } } }),
    };
    if (notice.level === "error") toast.add({ ...common, type: "error", title: title ?? t("notice.title.error") });
    else if (notice.level === "warning") toast.add({ ...common, type: "warning", ...(title === null ? {} : { title }) });
    else toast.add({ ...common, type: "info", ...(title === null ? {} : { title }) });
  }, [notice, actions, t, toast]);

  return null;
}
