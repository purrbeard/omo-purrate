/** A leading error class and JSON-RPC style code (`-32600: …`, `Error: -32603: …`) are wire framing, not the sentence. */
const WIRE_PREFIX = /^(?:\w*Error:\s*)?(?:-?\d{3,6}:\s*)?/;

/**
 * Text for a failed UI request: the error's own sentence with any RPC code stripped, or `fallback` (localized) when
 * nothing readable remains. The raw message stays available as `detail` for a tooltip or log.
 * @param error - the rejection value.
 * @param fallback - localized sentence shown instead of a raw code.
 * @returns the visible text and the raw detail.
 */
export function userErrorText(error: unknown, fallback: string): { text: string; detail: string } {
  const detail = error instanceof Error ? error.message : String(error);
  const sentence = detail.replace(WIRE_PREFIX, "").trim();
  return { text: sentence === "" ? fallback : sentence, detail };
}
