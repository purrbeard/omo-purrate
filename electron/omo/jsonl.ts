import { StringDecoder } from "node:string_decoder";

export interface JsonlDecoderOptions {
  onFrame: (value: unknown) => void;
  onMalformed: (line: string, error: Error) => void;
}

/**
 * Incremental decoder for LF-delimited JSON. Accepts string or Buffer chunks, keeps UTF-8
 * sequences intact across chunk boundaries, strips a trailing CR, and skips blank lines.
 * Parse failures go to onMalformed; push() and end() never throw on any input.
 */
export class JsonlDecoder {
  private readonly utf8 = new StringDecoder("utf8");
  private buffer = "";

  constructor(private readonly options: JsonlDecoderOptions) {}

  push(chunk: string | Buffer): void {
    this.buffer += typeof chunk === "string" ? chunk : this.utf8.write(chunk);
    let start = 0;
    let newline = this.buffer.indexOf("\n", start);
    while (newline !== -1) {
      this.handleLine(this.buffer.slice(start, newline));
      start = newline + 1;
      newline = this.buffer.indexOf("\n", start);
    }
    this.buffer = this.buffer.slice(start);
  }

  /** Flushes a final line that has no terminating LF. */
  end(): void {
    const rest = this.buffer + this.utf8.end();
    this.buffer = "";
    this.handleLine(rest);
  }

  private handleLine(raw: string): void {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (line.trim() === "") return;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch (error) {
      this.options.onMalformed(line, error instanceof Error ? error : new Error(String(error)));
      return;
    }
    this.options.onFrame(value);
  }
}
