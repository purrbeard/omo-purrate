/** A leading JSON-RPC style code (`-32600: …`, `Error: -32603: …`) marks a wire error rather than a sentence. */
const RPC_CODE = /^(?:\w*Error:\s*)?-?\d{3,6}:\s/;

/**
 * Text for a failed UI request: the error's own sentence, or `fallback` (localized) when the message is a raw
 * RPC code. The raw message stays available as `detail` for a tooltip or log.
 * @param error - the rejection value.
 * @param fallback - localized sentence shown instead of a raw code.
 * @returns the visible text and the raw detail.
 */
export function userErrorText(error: unknown, fallback: string): { text: string; detail: string } {
  const detail = error instanceof Error ? error.message : String(error);
  const sentence = detail.replace(/^\w*Error:\s*/, "").trim();
  return { text: sentence === "" || RPC_CODE.test(detail) ? fallback : sentence, detail };
}
