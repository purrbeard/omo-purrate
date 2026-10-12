import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from "node:fs";
import path from "node:path";

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;

export function initLogging(dir: string, opts?: { maxBytes?: number }) {
  const file = path.join(dir, "main.log");
  const backup = path.join(dir, "main.1.log");
  const maxBytes = opts?.maxBytes ?? DEFAULT_MAX_BYTES;

  return {
    dir,
    log(level: string, message: string, extra?: unknown): void {
      try {
        const details = extra === undefined ? "" : ` ${JSON.stringify(extra, (_key, value: unknown) =>
          value instanceof Error ? { name: value.name, message: value.message, stack: value.stack } : value)}`;
        const line = `${new Date().toISOString()} [${level}] ${message.replace(/\r?\n/g, "\\n")}${details}\n`;
        mkdirSync(dir, { recursive: true });
        if (existsSync(file)) {
          const size = statSync(file).size;
          if (size > 0 && size + Buffer.byteLength(line) > maxBytes) renameSync(file, backup);
        }
        appendFileSync(file, line, "utf8");
      } catch {
        // Logging must never prevent startup or mask the error being reported.
      }
    },
  };
}
