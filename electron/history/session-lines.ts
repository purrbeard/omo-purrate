import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

/** Decode complete UTF-8 records without ever constructing a whole-session string. */
export async function* readSessionLines(file: string): AsyncGenerator<string> {
  const input = createReadStream(file, { encoding: "utf8", highWaterMark: 1 << 20 });
  const lines = createInterface({ input, crlfDelay: Infinity });
  try { for await (const line of lines) yield line; }
  finally { lines.close(); input.destroy(); }
}
