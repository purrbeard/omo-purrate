import { readFile, rm, stat, utimes } from "node:fs/promises";

/** The suffix omo writes next to a session file to mark its thread archived. */
export const ARCHIVE_SUFFIX = ".archived";

/**
 * omo 5.1.30 lists archived threads by checking each session's sidecar, but thread/unarchive looks them up only in
 * settings.sessionDir; with the default per-project session folders that list is empty, so restoring always fails
 * with "thread not found". This mirrors omo's own unarchive for one sidecar the caller has already located:
 * it bumps the session file's mtime (so the thread sorts as recent) and removes the sidecar.
 * Returns false when the sidecar is missing or names another thread, leaving everything untouched.
 */
export async function unarchiveBySidecar(threadId: string, sessionPath: string, nowMs = Date.now()): Promise<boolean> {
  const sidecar = sessionPath + ARCHIVE_SUFFIX;
  let record: unknown;
  try {
    record = JSON.parse(await readFile(sidecar, "utf8"));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
  const thread = typeof record === "object" && record !== null ? (record as { thread?: unknown }).thread : undefined;
  if (typeof thread !== "object" || thread === null || (thread as { id?: unknown }).id !== threadId) return false;
  const session = await stat(sessionPath);
  await utimes(sessionPath, session.atime, new Date(Math.max(nowMs, session.mtimeMs + 1)));
  await rm(sidecar, { force: true });
  return true;
}
