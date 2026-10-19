import { readdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { SshHost } from "../../shared/servers";

/** One `Host` (or `Match`, which never applies here) block, or the global settings before the first block. */
interface Block {
  patterns: string[] | null;
  match: boolean;
  options: Array<[keyword: string, value: string]>;
}

/** Splits a config value into words; double quotes group words and are removed. */
export function words(value: string): string[] {
  const result: string[] = [];
  for (const match of value.matchAll(/"([^"]*)"|(\S+)/g)) result.push(match[1] ?? match[2] ?? "");
  return result;
}

function wildcard(pattern: string): RegExp {
  return new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`, "i");
}

/** ssh_config(5) pattern lists: some positive pattern matches and no negated (`!`) pattern does. */
export function hostMatches(patterns: readonly string[], alias: string): boolean {
  let matched = false;
  for (const pattern of patterns) {
    const negated = pattern.startsWith("!");
    if (!wildcard(negated ? pattern.slice(1) : pattern).test(alias)) continue;
    if (negated) return false;
    matched = true;
  }
  return matched;
}

function expandHome(file: string, home: string): string {
  return file === "~" ? home : file.startsWith("~/") || file.startsWith("~\\") ? path.join(home, file.slice(2)) : file;
}

/** Files an Include word names: relative words resolve against ~/.ssh, and `*` / `?` in the file name are globbed. */
function includeFiles(word: string, home: string, sshDir: string): string[] {
  const expanded = expandHome(word, home);
  const absolute = path.isAbsolute(expanded) ? expanded : path.join(sshDir, expanded);
  const name = path.basename(absolute);
  if (!/[*?]/.test(name)) return [absolute];
  const dir = path.dirname(absolute);
  try {
    const pattern = wildcard(name);
    return readdirSync(dir).filter((entry) => pattern.test(entry)).sort().map((entry) => path.join(dir, entry));
  } catch { return []; }
}

export interface ParseOptions {
  home?: string;
  /** Directory relative Include paths resolve against; defaults to `<home>/.ssh`. */
  sshDir?: string;
  read?: (file: string) => string;
}

/**
 * The concrete hosts of an OpenSSH client config: every non-wildcard alias of a `Host` line, in order, with the
 * HostName, User, Port and IdentityFile that apply to it (first obtained value wins, as in ssh). `Include` is followed
 * one level deep; `Match` blocks are skipped.
 */
export function parseSshConfig(text: string, options: ParseOptions = {}): SshHost[] {
  const home = options.home ?? os.homedir();
  const sshDir = options.sshDir ?? path.join(home, ".ssh");
  const read = options.read ?? ((file: string) => readFileSync(file, "utf8"));
  const blocks: Block[] = [{ patterns: null, match: false, options: [] }];
  const aliases: string[] = [];
  const consume = (content: string, depth: number): void => {
    for (const raw of content.split(/\r?\n/)) {
      const line = raw.trim();
      if (line === "" || line.startsWith("#")) continue;
      const parsed = /^(\S+?)(?:\s*=\s*|\s+)(.*)$/.exec(line);
      if (parsed === null) continue;
      const keyword = (parsed[1] ?? "").toLowerCase();
      const value = (parsed[2] ?? "").trim();
      if (keyword === "host") {
        const patterns = words(value);
        blocks.push({ patterns, match: false, options: [] });
        for (const pattern of patterns) if (!/[*?!]/.test(pattern) && !aliases.includes(pattern)) aliases.push(pattern);
      } else if (keyword === "match") {
        blocks.push({ patterns: null, match: true, options: [] });
      } else if (keyword === "include") {
        if (depth > 0) continue;
        for (const file of words(value).flatMap((word) => includeFiles(word, home, sshDir))) {
          try { consume(read(file), depth + 1); } catch { /* a missing include is skipped, as ssh does */ }
        }
      } else {
        blocks.at(-1)!.options.push([keyword, value]);
      }
    }
  };
  consume(text, 0);
  return aliases.map((alias) => {
    const values = new Map<string, string>();
    const identityFiles: string[] = [];
    for (const block of blocks) {
      if (block.match || (block.patterns !== null && !hostMatches(block.patterns, alias))) continue;
      for (const [keyword, value] of block.options) {
        if (keyword === "identityfile") { for (const file of words(value)) if (!identityFiles.includes(file)) identityFiles.push(file); }
        else if (!values.has(keyword)) values.set(keyword, words(value)[0] ?? "");
      }
    }
    const port = Number(values.get("port"));
    return {
      alias,
      hostName: (values.get("hostname") ?? alias).replace(/%h/g, alias),
      user: values.get("user") || null,
      port: Number.isInteger(port) && port > 0 && port < 65536 ? port : 22,
      identityFiles,
    };
  });
}

/** OMO_UI_SSH_CONFIG, or the user's `~/.ssh/config`. */
export function sshConfigPath(env: NodeJS.ProcessEnv, home = os.homedir()): string {
  return env["OMO_UI_SSH_CONFIG"] || path.join(home, ".ssh", "config");
}
