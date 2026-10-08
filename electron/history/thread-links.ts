import { createReadStream } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import type { ThreadLink } from "../../shared/ipc";

const ID = /^[A-Za-z0-9_-]{1,256}$/u;
type Header = { id: string; parentSession?: string };

/** Reads only native session headers; both children and their parent paths use the history boundary. */
export async function loadHeaderLinks(
  paths: string[], resolveSessionFile: (sessionPath: string) => Promise<string>,
): Promise<ThreadLink[]> {
  const headers = new Map<string, Promise<Header | null>>();
  const readHeader = (sessionPath: string): Promise<Header | null> => {
    const cached = headers.get(sessionPath);
    if (cached !== undefined) return cached;
    const result = (async (): Promise<Header | null> => {
      try {
        const input = createReadStream(await resolveSessionFile(sessionPath), { encoding: "utf8", highWaterMark: 4096 });
        const lines = createInterface({ input, crlfDelay: Infinity });
        try {
          for await (const line of lines) {
            const header: unknown = JSON.parse(line);
            if (typeof header !== "object" || header === null || Array.isArray(header)) return null;
            const entry = header as Record<string, unknown>;
            if (entry["type"] !== "session" || typeof entry["id"] !== "string" || !ID.test(entry["id"])) return null;
            return { id: entry["id"], ...(typeof entry["parentSession"] === "string" && path.isAbsolute(entry["parentSession"])
              ? { parentSession: entry["parentSession"] } : {}) };
          }
          return null;
        } finally {
          lines.close();
          input.destroy();
        }
      } catch (error) {
        if (error instanceof SyntaxError || (error instanceof Error && "code" in error &&
          (error.code === "ENOENT" || error.code === "ENOTDIR"))) return null;
        throw error;
      }
    })();
    headers.set(sessionPath, result);
    return result;
  };
  const pending = new Set(paths);
  const links = new Map<string, ThreadLink>();
  for (const sessionPath of pending) {
    const child = await readHeader(sessionPath);
    if (child?.parentSession === undefined) continue;
    const parent = await readHeader(child.parentSession);
    if (parent === null || parent.id === child.id) continue;
    links.set(child.id, { parentId: parent.id, childId: child.id, title: child.id, origin: "native" });
    pending.add(child.parentSession);
  }
  return [...links.values()];
}
