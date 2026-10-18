import { existsSync, renameSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { ImportEvidence, Preferences, ThreadCreatorEvidence, ThreadOrigin } from "../../shared/ipc";

export type ThreadState = Pick<Preferences, "managedThreadIds" | "pinnedThreadIds" | "threadParents" | "settledThreads" | "unsettledThreads">
  & { threadOrigins: Record<string, ThreadOrigin>; threadCreators: Record<string, ThreadCreatorEvidence> };

export const THREAD_STATE_KEYS = ["managedThreadIds", "pinnedThreadIds", "threadParents", "threadOrigins", "threadCreators", "settledThreads", "unsettledThreads"] as const;

const LISTS = ["managedThreadIds", "pinnedThreadIds", "settledThreads", "unsettledThreads"] as const;

export interface ImportRecord {
  threadId: string;
  sessionPath: string;
  sizeBytes: number;
  mtimeMs: number;
  evidence: ImportEvidence;
  importedAtMs: number;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS thread_lists (list TEXT NOT NULL, position INTEGER NOT NULL, thread_id TEXT NOT NULL, PRIMARY KEY (list, thread_id));
CREATE TABLE IF NOT EXISTS thread_parents (child_id TEXT PRIMARY KEY, parent_id TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS thread_origins (thread_id TEXT PRIMARY KEY, origin TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS thread_creators (thread_id TEXT PRIMARY KEY, origin TEXT NOT NULL, source TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS session_imports (thread_id TEXT PRIMARY KEY, session_path TEXT NOT NULL, size_bytes INTEGER NOT NULL,
  mtime_ms REAL NOT NULL, evidence TEXT NOT NULL, imported_at_ms INTEGER NOT NULL);
`;

/** Thread state and import records in `<userData>/omo-ui.sqlite`; a file that is not a readable database is set aside. */
export class ThreadDb {
  private constructor(private readonly db: DatabaseSync, readonly recoveredFrom: string | null) {}

  static open(file: string, nowMs = Date.now()): ThreadDb {
    try {
      return new ThreadDb(ThreadDb.connect(file), null);
    } catch (error) {
      if (!existsSync(file)) throw error;
      const aside = `${file}.corrupt-${nowMs}`;
      renameSync(file, aside);
      return new ThreadDb(ThreadDb.connect(file), aside);
    }
  }

  private static connect(file: string): DatabaseSync {
    const db = new DatabaseSync(file);
    try {
      const check = db.prepare("PRAGMA quick_check").get() as { quick_check?: unknown } | undefined;
      if (check?.quick_check !== "ok") throw new Error(`thread database failed its integrity check: ${String(check?.quick_check)}`);
      db.exec(SCHEMA);
      return db;
    } catch (error) {
      db.close();
      throw error;
    }
  }

  get migrated(): boolean {
    return this.db.prepare("SELECT value FROM meta WHERE key = 'migrated-from-json'").get() !== undefined;
  }

  read(): ThreadState {
    const lists = Object.fromEntries(LISTS.map(list => [list, (this.db.prepare("SELECT thread_id FROM thread_lists WHERE list = ? ORDER BY position")
      .all(list) as { thread_id: string }[]).map(row => row.thread_id)])) as Pick<ThreadState, (typeof LISTS)[number]>;
    const pairs = <T>(sql: string, map: (row: Record<string, string>) => [string, T]) =>
      Object.fromEntries((this.db.prepare(sql).all() as Record<string, string>[]).map(map));
    return {
      ...lists,
      threadParents: pairs("SELECT child_id, parent_id FROM thread_parents", row => [row["child_id"]!, row["parent_id"]!]),
      threadOrigins: pairs("SELECT thread_id, origin FROM thread_origins", row => [row["thread_id"]!, row["origin"] as ThreadOrigin]),
      threadCreators: pairs("SELECT thread_id, origin, source FROM thread_creators",
        row => [row["thread_id"]!, { origin: row["origin"], source: row["source"] } as ThreadCreatorEvidence]),
    };
  }

  write(state: ThreadState, options: { migrated?: boolean } = {}): void {
    this.transaction(() => {
      this.db.exec("DELETE FROM thread_lists; DELETE FROM thread_parents; DELETE FROM thread_origins; DELETE FROM thread_creators;");
      const list = this.db.prepare("INSERT INTO thread_lists (list, position, thread_id) VALUES (?, ?, ?)");
      for (const name of LISTS) state[name].forEach((id, position) => list.run(name, position, id));
      const parent = this.db.prepare("INSERT INTO thread_parents (child_id, parent_id) VALUES (?, ?)");
      for (const [child, parentId] of Object.entries(state.threadParents)) parent.run(child, parentId);
      const origin = this.db.prepare("INSERT INTO thread_origins (thread_id, origin) VALUES (?, ?)");
      for (const [id, value] of Object.entries(state.threadOrigins)) origin.run(id, value);
      const creator = this.db.prepare("INSERT INTO thread_creators (thread_id, origin, source) VALUES (?, ?, ?)");
      for (const [id, value] of Object.entries(state.threadCreators)) creator.run(id, value.origin, value.source);
      if (options.migrated === true) this.db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('migrated-from-json', ?)").run(new Date().toISOString());
    });
  }

  recordImports(records: readonly ImportRecord[]): void {
    this.transaction(() => {
      const insert = this.db.prepare(`INSERT OR REPLACE INTO session_imports (thread_id, session_path, size_bytes, mtime_ms, evidence, imported_at_ms)
        VALUES (?, ?, ?, ?, ?, ?)`);
      for (const record of records) insert.run(record.threadId, record.sessionPath, record.sizeBytes, record.mtimeMs, record.evidence, record.importedAtMs);
    });
  }

  imports(): ImportRecord[] {
    return (this.db.prepare("SELECT thread_id, session_path, size_bytes, mtime_ms, evidence, imported_at_ms FROM session_imports ORDER BY imported_at_ms, thread_id")
      .all() as Record<string, string | number>[]).map(row => ({
      threadId: String(row["thread_id"]), sessionPath: String(row["session_path"]), sizeBytes: Number(row["size_bytes"]),
      mtimeMs: Number(row["mtime_ms"]), evidence: row["evidence"] as ImportEvidence, importedAtMs: Number(row["imported_at_ms"]),
    }));
  }

  close(): void {
    this.db.close();
  }

  private transaction(work: () => void): void {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      work();
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
}
