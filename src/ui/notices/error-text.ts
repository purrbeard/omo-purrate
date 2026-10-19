import type { Translate } from "../../i18n";

/** omo and the bridge report request failures as `<JSON-RPC code>: <message>`; the code never reaches the user. */
const RPC_ERROR = /^-?\d+: ([\s\S]*)$/;

/**
 * @returns the user-facing text of an error or error message: the numeric RPC code is dropped, failures the UI
 *   knows are translated, and other text (omo's own words) is kept; `rpc` tells whether a code was present
 */
export function errorText(error: unknown, t: Translate): { text: string; rpc: boolean } {
  const message = error instanceof Error ? error.message : String(error);
  const rpc = RPC_ERROR.exec(message);
  const detail = rpc?.[1] ?? message;
  if (rpc !== null && /^thread not found\b/.test(detail)) return { text: t("notice.rpc.threadNotFound"), rpc: true };
  return { text: detail, rpc: rpc !== null };
}
