import { constants } from "node:fs";
import { copyFile, mkdir, open, readFile, rename, stat } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import JSON5 from "json5";
import { applyEdits, modify, parseTree, type ParseError } from "jsonc-parser";
import type {
  NativeSettingsInput,
  NativeSettingsScope,
  NativeSettingsSnapshot,
  NativeSettingsValues,
} from "../../shared/native-settings";

type Entry = { path: string[]; value: unknown };
type Loaded = { file: string; bytes: Buffer | null };

const rootKeys = [
  "defaultProvider", "defaultModel", "defaultThinkingLevel",
  "favoriteModels", "enabledModels", "compaction", "terminal",
];
const compactionKeys = [
  "enabled", "reserveTokens", "keepRecentTokens", "summarizationMaxDurationMs",
  "modelOverrides", "speculativeLeadTokens", "graceBandEnabled",
  "reserveScalingEnabled", "model",
];
const terminalKeys = [
  "notify", "timeoutAction", "defaultCols", "defaultRows", "scrollback", "maxSessions",
];
const levels = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
const pending = new Map<string, Promise<void>>();

function invalid(): never {
  // Never expose parser messages or input values: either can contain private data.
  throw new Error("Invalid native settings.");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function allowedKeys(value: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) invalid();
}

function stringValue(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "" || /[\r\n\0]/.test(value)) return invalid();
  return value;
}

function numberValue(value: unknown, min: number, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) return invalid();
  return value;
}

function boolValue(value: unknown): boolean {
  if (typeof value !== "boolean") return invalid();
  return value;
}

function choiceValue(value: unknown, choices: string[]): string {
  if (typeof value !== "string" || !choices.includes(value)) return invalid();
  return value;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return invalid();
  return value.map(stringValue);
}

function add(
  target: Record<string, unknown>,
  key: string,
  value: unknown,
  edits: Entry[],
  keyPath: string[],
): void {
  // Define own properties, including names such as "__proto__", without changing prototypes.
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
  edits.push({ path: keyPath, value });
}

/** Produce a new allowlisted view and leaf edits; unrelated settings never leave this module. */
function collect(input: unknown, strict: boolean): { values: NativeSettingsValues; edits: Entry[] } {
  if (!isRecord(input)) return invalid();
  if (strict) allowedKeys(input, rootKeys);
  const values: NativeSettingsValues = {};
  const edits: Entry[] = [];
  for (const key of ["defaultProvider", "defaultModel", "defaultThinkingLevel", "favoriteModels", "enabledModels"]) {
    if (!Object.hasOwn(input, key)) continue;
    const value = key === "favoriteModels" || key === "enabledModels"
      ? stringList(input[key])
      : key === "defaultThinkingLevel" ? choiceValue(input[key], levels) : stringValue(input[key]);
    add(values, key, value, edits, [key]);
  }
  if (Object.hasOwn(input, "compaction")) {
    const source = input["compaction"];
    if (!isRecord(source)) return invalid();
    if (strict) allowedKeys(source, compactionKeys);
    const target: Record<string, unknown> = {};
    values["compaction"] = target;
    for (const key of compactionKeys) {
      if (!Object.hasOwn(source, key)) continue;
      const entry = source[key];
      if (key === "modelOverrides") {
        if (!isRecord(entry)) return invalid();
        const overrides: Record<string, unknown> = {};
        target[key] = overrides;
        for (const [name, override] of Object.entries(entry)) {
          if (!/^[^/\s]+\/\S+$/.test(name) || /[\r\n\0]/.test(name) || !isRecord(override)) return invalid();
          if (strict) allowedKeys(override, ["reserveTokens", "keepRecentTokens"]);
          const fields: Record<string, unknown> = {};
          Object.defineProperty(overrides, name, { value: fields, enumerable: true, writable: true, configurable: true });
          for (const field of ["reserveTokens", "keepRecentTokens"]) {
            if (Object.hasOwn(override, field)) {
              add(fields, field, numberValue(override[field], 0), edits, ["compaction", key, name, field]);
            }
          }
        }
      } else {
        const value = key === "enabled" || key === "graceBandEnabled" || key === "reserveScalingEnabled"
          ? boolValue(entry)
          : key === "model" ? stringValue(entry)
          : key === "summarizationMaxDurationMs" ? numberValue(entry, 1)
          : key === "speculativeLeadTokens" ? numberValue(entry, 8192, 32768)
          : numberValue(entry, 0);
        add(target, key, value, edits, ["compaction", key]);
      }
    }
  }
  if (Object.hasOwn(input, "terminal")) {
    const source = input["terminal"];
    if (!isRecord(source)) return invalid();
    if (strict) allowedKeys(source, terminalKeys);
    const target: Record<string, unknown> = {};
    values["terminal"] = target;
    for (const key of terminalKeys) {
      if (!Object.hasOwn(source, key)) continue;
      const value = key === "notify" ? choiceValue(source[key], ["wake", "next-turn", "off"])
        : key === "timeoutAction" ? choiceValue(source[key], ["background", "kill"])
        : numberValue(source[key], key === "scrollback" ? 0 : 1);
      add(target, key, value, edits, ["terminal", key]);
    }
  }
  return { values, edits };
}

function parse(bytes: Buffer): Record<string, unknown> {
  const text = bytes.toString("utf8").replace(/^\uFEFF/, "");
  let value: unknown;
  try { value = JSON5.parse(text); } catch { return invalid(); }
  const errors: ParseError[] = [];
  const tree = parseTree(text, errors, { allowTrailingComma: true });
  if (!tree || tree.type !== "object" || errors.length > 0 || !isRecord(value)) return invalid();
  return value;
}

function directory(agentDir: string, scope: NativeSettingsScope, cwd?: string): string {
  if (scope === "global") return path.resolve(agentDir);
  if (scope === "project" && cwd) return path.resolve(cwd, ".omo");
  throw new Error("A project directory is required.");
}

async function readOptional(file: string): Promise<Buffer | null> {
  try { return await readFile(file); }
  catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

async function load(dir: string): Promise<Loaded> {
  for (const name of ["settings.jsonc", "settings.json"]) {
    const file = path.join(dir, name);
    const bytes = await readOptional(file);
    if (bytes !== null) return { file, bytes };
  }
  return { file: path.join(dir, "settings.json"), bytes: null };
}

function revision(loaded: Loaded): string {
  const hash = createHash("sha256").update(loaded.file).update("\0");
  if (loaded.bytes === null) hash.update("missing");
  else hash.update("present\0").update(loaded.bytes);
  return hash.digest("hex");
}

function snapshot(scope: NativeSettingsScope, loaded: Loaded): NativeSettingsSnapshot {
  const value = loaded.bytes === null ? {} : parse(loaded.bytes);
  return {
    scope,
    configPath: loaded.file,
    revision: revision(loaded),
    values: collect(value, false).values,
  };
}

export async function readNativeSettings(
  agentDir: string,
  scope: NativeSettingsScope,
  cwd?: string,
): Promise<NativeSettingsSnapshot> {
  try { return snapshot(scope, await load(directory(agentDir, scope, cwd))); }
  catch { throw new Error("Could not read native settings. Check the scope and configuration format."); }
}

async function serial<T>(dir: string, action: () => Promise<T>): Promise<T> {
  const key = process.platform === "win32" ? dir.toLowerCase() : dir;
  const previous = pending.get(key) ?? Promise.resolve();
  let release = () => {};
  const current = new Promise<void>((resolve) => { release = resolve; });
  pending.set(key, current);
  await previous;
  try { return await action(); }
  finally {
    release();
    if (pending.get(key) === current) pending.delete(key);
  }
}

export async function saveNativeSettings(
  agentDir: string,
  input: NativeSettingsInput,
  cwd?: string,
): Promise<NativeSettingsSnapshot> {
  if (!isRecord(input) || (input.scope !== "global" && input.scope !== "project")
      || typeof input.revision !== "string") return invalid();
  allowedKeys(input, ["scope", "revision", "values"]);
  const scope = input.scope;
  const changes = collect(input.values, true);
  const dir = directory(agentDir, scope, cwd);
  return serial(dir, async () => {
    const original = await load(dir);
    if (revision(original) !== input.revision) throw new Error("Native settings changed. Reload before saving.");
    const current = snapshot(scope, original);
    if (changes.edits.length === 0) return current;
    const originalText = original.bytes === null ? "{}\n" : original.bytes.toString("utf8");
    const bom = originalText.startsWith("\uFEFF") ? "\uFEFF" : "";
    let output = originalText.replace(/^\uFEFF/, "");
    try {
      for (const edit of changes.edits) {
        output = applyEdits(output, modify(output, edit.path, edit.value, {
          formattingOptions: { insertSpaces: true, tabSize: 2, eol: output.includes("\r\n") ? "\r\n" : "\n" },
        }));
      }
      const candidate = Buffer.from(bom + output, "utf8");
      const next = snapshot(scope, { file: original.file, bytes: candidate });
      if (original.bytes !== null && original.bytes.equals(candidate)) return current;
      await mkdir(dir, { recursive: true });
      let mode = 0o600;
      if (original.bytes !== null) {
        mode = (await stat(original.file)).mode & 0o777;
        const backup = `${original.file}.${randomUUID()}.bak`;
        await copyFile(original.file, backup, constants.COPYFILE_EXCL);
        if (!(await readFile(backup)).equals(original.bytes)) {
          throw new Error("Native settings changed. Reload before saving.");
        }
      }
      const temp = `${original.file}.${randomUUID()}.tmp`;
      const staged = await open(temp, "wx", mode);
      try { await staged.writeFile(candidate); await staged.sync(); }
      finally { await staged.close(); }
      if (revision(await load(dir)) !== revision(original)) {
        throw new Error("Native settings changed. Reload before saving.");
      }
      await rename(temp, original.file);
      return next;
    } catch (error) {
      if (error instanceof Error && error.message === "Native settings changed. Reload before saving.") throw error;
      throw new Error("Could not save native settings.");
    }
  });
}
