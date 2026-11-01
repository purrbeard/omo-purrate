import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

export interface SessionRecord {
  readonly line: string;
  readonly start: number;
  readonly end: number;
  readonly complete: boolean;
}

/** Byte offsets refer to the original UTF-8 file, including CRLF delimiters. Freeze each pass at its stat size. */
export async function* readSessionRecords(file: string, start: number, size: number): AsyncGenerator<SessionRecord> {
  if (start >= size) return;
  const input = createReadStream(file, { start, end: size - 1, highWaterMark: 1 << 20 });
  let pending = Buffer.alloc(0);
  let offset = start;
  try {
    for await (const value of input) {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      const bytes = pending.length === 0 ? chunk : Buffer.concat([pending, chunk]);
      let from = 0;
      for (let at = bytes.indexOf(10); at !== -1; at = bytes.indexOf(10, from)) {
        const end = offset + at - from + 1;
        yield { line: bytes.subarray(from, at).toString("utf8").replace(/\r$/, ""), start: offset, end, complete: true };
        offset = end;
        from = at + 1;
      }
      pending = bytes.subarray(from);
    }
    if (pending.length > 0) yield { line: pending.toString("utf8"), start: offset, end: size, complete: false };
  } finally { input.destroy(); }
}

/** Decode complete UTF-8 records without ever constructing a whole-session string. */
export async function* readSessionLines(file: string): AsyncGenerator<string> {
  const input = createReadStream(file, { encoding: "utf8", highWaterMark: 1 << 20 });
  const lines = createInterface({ input, crlfDelay: Infinity });
  try { for await (const line of lines) yield line; }
  finally { lines.close(); input.destroy(); }
}
