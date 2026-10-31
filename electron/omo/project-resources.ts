import * as fs from "node:fs/promises";
import path from "node:path";
import JSON5 from "json5";
import type {
  DeclaredPackage, DeclaredResources, ProjectResources, ResourceFilterKind, ResourceSource,
} from "../../shared/project-resources";

const FILTERS: readonly ResourceFilterKind[] = ["extensions", "skills", "prompts", "themes"];

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value) || !value.every(item => typeof item === "string")) {
    throw new Error("Invalid resource declaration");
  }
  return value;
}

function packages(value: unknown): DeclaredPackage[] {
  if (!Array.isArray(value)) throw new Error("Invalid package declaration");
  return value.map((item: unknown): DeclaredPackage => {
    if (typeof item === "string") return item;
    if (!object(item) || typeof item.source !== "string") {
      throw new Error("Invalid package declaration");
    }
    const result: Exclude<DeclaredPackage, string> = { source: item.source };
    for (const key of FILTERS) {
      if (item[key] !== undefined) result[key] = strings(item[key]);
    }
    return result;
  });
}

function declarations(settings: Record<string, unknown>): DeclaredResources {
  const result: DeclaredResources = {
    packages: [], extensions: [], skills: [], prompts: [], themes: [],
  };
  if (settings.packages !== undefined) result.packages = packages(settings.packages);
  for (const key of FILTERS) {
    if (settings[key] !== undefined) result[key] = strings(settings[key]);
  }
  return result;
}

async function readObject(file: string): Promise<Record<string, unknown> | null> {
  let text: string;
  try {
    text = await fs.readFile(file, "utf8");
  } catch (error: unknown) {
    if (object(error) && error.code === "ENOENT") return null;
    throw new Error(`Cannot read ${file}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON5.parse(text);
  } catch {
    throw new Error(`Invalid JSON in ${file}`);
  }
  if (!object(parsed)) throw new Error(`Invalid object in ${file}`);
  return parsed;
}

function pathKey(value: string): string {
  const normalized = path.normalize(value);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function trustEntries(store: Record<string, unknown>): Map<string, boolean> {
  const result = new Map<string, boolean>();
  for (const [directory, decision] of Object.entries(store)) {
    if (!path.isAbsolute(directory) || typeof decision !== "boolean") {
      throw new Error("Invalid trust store");
    }
    const key = pathKey(directory);
    if (result.has(key)) throw new Error("Ambiguous trust store");
    result.set(key, decision);
  }
  return result;
}

function defaultTrust(settings: Record<string, unknown>): "ask" | "always" | "never" {
  const value = settings.defaultProjectTrust;
  if (value === undefined) return "ask";
  if (value === "ask" || value === "always" || value === "never") return value;
  throw new Error("Invalid defaultProjectTrust");
}

function source(
  file: string,
  scope: ResourceSource["scope"],
  settings: Record<string, unknown> | null,
): ResourceSource {
  try {
    return { path: file, scope, exists: settings !== null, declarations: declarations(settings ?? {}) };
  } catch {
    throw new Error(`Invalid resource declarations in ${file}`);
  }
}

/**
 * Reads declarations, not installed or loaded resources. Trust is evidence from
 * files and the non-interactive default, not the running session's decision.
 */
export async function readProjectResources(agentDir: string, cwd: string): Promise<ProjectResources> {
  if (!path.isAbsolute(agentDir) || !path.isAbsolute(cwd)) {
    throw new Error("agentDir and cwd must be absolute");
  }
  const canonicalCwd = await fs.realpath(cwd);
  const settingsFile = async (directory: string): Promise<string> => {
    const preferred = path.join(directory, "settings.jsonc");
    try { await fs.access(preferred); return preferred; }
    catch (error) { if (!object(error) || error.code !== "ENOENT") throw error; }
    return path.join(directory, "settings.json");
  };
  const globalFile = await settingsFile(agentDir);
  const projectFile = await settingsFile(path.join(canonicalCwd, ".omo"));
  const trustFile = path.join(agentDir, "trust.json");
  const [global, project, store] = await Promise.all([
    readObject(globalFile), readObject(projectFile), readObject(trustFile),
  ]);
  const entries = trustEntries(store ?? {});
  const fallback = defaultTrust(global ?? {});
  let current = canonicalCwd;
  let matchedDirectory: string | null = null;
  let trusted: boolean | null = fallback === "ask" ? null : fallback === "always";
  for (;;) {
    const decision = entries.get(pathKey(current));
    if (decision !== undefined) {
      matchedDirectory = current;
      trusted = decision;
      break;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return {
    cwd: canonicalCwd,
    trust: {
      kind: matchedDirectory === null ? "default"
        : pathKey(matchedDirectory) === pathKey(canonicalCwd) ? "direct" : "ancestor",
      trusted,
      path: matchedDirectory === null ? globalFile : trustFile,
      matchedDirectory,
      defaultValue: matchedDirectory === null ? fallback : null,
    },
    sources: [
      source(globalFile, "global", global),
      source(projectFile, "project", project),
    ],
  };
}
