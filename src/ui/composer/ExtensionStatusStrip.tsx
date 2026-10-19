import { useT } from "../../i18n";
import { useAppSelector } from "../app-context";
import { TESTID } from "../testids";

/** One compact line above the composer with the active thread's omo extension status entries (setStatus). */
export function ExtensionStatusStrip() {
  const t = useT();
  const entries = useAppSelector((state) => (state.activeThreadId === null ? undefined : state.extensionStatus[state.activeThreadId]));
  if (entries === undefined) return null;
  const text = Object.values(entries).filter((entry) => entry.trim() !== "").join(" · ");
  if (text === "") return null;
  return (
    <div className="box-border w-full truncate px-4 pb-1 text-xs leading-4 text-muted-foreground" data-testid={TESTID.extensionStatus} role="status" aria-label={t("conversation.extensionStatus")} title={text}>
      {text}
    </div>
  );
}
