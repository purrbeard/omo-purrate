import { readFile } from "node:fs/promises";
import path from "node:path";
import type { AccountUsage, UsageProvider, UsageWindow } from "../../shared/ipc";

/** The slice of `fetch` the readers use; tests pass a double. */
export type UsageFetch = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

export interface ReadUsageOptions {
  /** omo's agent directory (codexHome), which holds auth.json. */
  agentDir: string;
  fetch?: UsageFetch;
  now?: () => number;
  timeoutMs?: number;
}

type JsonObject = Record<string, unknown>;

// omo writes this placeholder into anthropic-subscription's flat fields when the Claude SDK owns the credential.
const SENTINEL_TOKEN = "claude-sdk-oauth-managed";
const CLAUDE_URL = "https://api.anthropic.com/api/oauth/usage";
const CODEX_URL = "https://chatgpt.com/backend-api/wham/usage";
const CLAUDE_LABELS: Record<string, string> = {
  five_hour: "5h",
  seven_day: "weekly",
  seven_day_opus: "weekly opus",
  seven_day_sonnet: "weekly sonnet",
  seven_day_oauth_apps: "weekly oauth apps",
  extra_usage: "extra usage",
};

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

interface Slot {
  provider: UsageProvider;
  account: string;
  token: string | null;
  expires: number | null;
  accountId: string | null;
}

/** Stored accounts of each usage provider in auth.json; a provider without an `accounts` pool is its one flat slot. */
export function usageSlots(auth: unknown): Slot[] {
  if (!isRecord(auth)) return [];
  const slots: Slot[] = [];
  for (const provider of ["anthropic-subscription", "chatgpt-subscription"] as const) {
    const entry = auth[provider];
    if (!isRecord(entry)) continue;
    const pool = Array.isArray(entry["accounts"]) ? entry["accounts"].filter(isRecord) : [];
    const sources = pool.length > 0 ? pool : [{ ...entry, name: "default" }];
    for (const source of sources) {
      const token = str(source["access"]);
      slots.push({
        provider,
        account: str(source["name"]) ?? "unnamed",
        token: token === SENTINEL_TOKEN ? null : token,
        expires: typeof source["expires"] === "number" ? source["expires"] : null,
        accountId: str(source["accountId"]),
      });
    }
  }
  return slots;
}

function claudeWindows(body: unknown): UsageWindow[] {
  if (!isRecord(body)) throw new Error("the usage response is not an object");
  const windows: UsageWindow[] = [];
  for (const [key, raw] of Object.entries(body)) {
    if (!isRecord(raw) || typeof raw["utilization"] !== "number") continue;
    const resetsAt = str(raw["resets_at"]);
    // A zero window without a reset time carries no information.
    if (resetsAt === null && raw["utilization"] === 0) continue;
    windows.push({ label: CLAUDE_LABELS[key] ?? key, percent: raw["utilization"], resetsAt, limited: str(raw["locked_reason"]) !== null });
  }
  return windows;
}

function codexUsage(body: unknown): Pick<AccountUsage, "email" | "plan" | "windows"> {
  if (!isRecord(body) || !isRecord(body["rate_limit"])) throw new Error("the usage response has no rate_limit");
  const limit = body["rate_limit"];
  const windows: UsageWindow[] = [];
  for (const key of ["primary_window", "secondary_window"] as const) {
    const window = limit[key];
    if (!isRecord(window) || typeof window["used_percent"] !== "number") continue;
    const seconds = typeof window["limit_window_seconds"] === "number" ? window["limit_window_seconds"] : null;
    const label = seconds === null ? (key === "primary_window" ? "primary" : "secondary")
      : seconds % 86_400 === 0 ? (seconds === 604_800 ? "weekly" : `${seconds / 86_400}d`) : `${Math.round(seconds / 3_600)}h`;
    const reset = typeof window["reset_at"] === "number" ? new Date(window["reset_at"] * 1000).toISOString() : null;
    windows.push({ label, percent: window["used_percent"], resetsAt: reset, limited: limit["limit_reached"] === true });
  }
  return { email: str(body["email"]), plan: str(body["plan_type"]), windows };
}

async function readSlot(slot: Slot, fetchImpl: UsageFetch, now: number, timeoutMs: number): Promise<AccountUsage> {
  const base: AccountUsage = { provider: slot.provider, account: slot.account, email: null, plan: null, windows: [], state: "ok", message: null };
  if (slot.token === null) return { ...base, state: "failed", message: "no stored token" };
  if (slot.expires !== null && slot.expires <= now) return { ...base, state: "expired" };
  const headers: Record<string, string> = { authorization: `Bearer ${slot.token}`, accept: "application/json" };
  if (slot.provider === "chatgpt-subscription" && slot.accountId !== null) headers["chatgpt-account-id"] = slot.accountId;
  if (slot.provider === "anthropic-subscription") headers["anthropic-beta"] = "oauth-2025-04-20";
  try {
    const response = await fetchImpl(slot.provider === "anthropic-subscription" ? CLAUDE_URL : CODEX_URL, {
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (response.status === 401) return { ...base, state: "expired" };
    if (!response.ok) return { ...base, state: "failed", message: `HTTP ${response.status}` };
    const body = await response.json();
    return slot.provider === "anthropic-subscription" ? { ...base, windows: claudeWindows(body) } : { ...base, ...codexUsage(body) };
  } catch (error) {
    return { ...base, state: "failed", message: error instanceof Error ? error.message : String(error) };
  }
}

/** Reads usage for every stored subscription account in `<agentDir>/auth.json`, in parallel. */
export async function readAccountUsage(options: ReadUsageOptions): Promise<AccountUsage[]> {
  let auth: unknown;
  try {
    auth = JSON.parse(await readFile(path.join(options.agentDir, "auth.json"), "utf8"));
  } catch (error) {
    // No credential store means no signed-in account, not a failure.
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
  const fetchImpl = options.fetch ?? (globalThis.fetch as UsageFetch);
  const now = (options.now ?? Date.now)();
  return Promise.all(usageSlots(auth).map((slot) => readSlot(slot, fetchImpl, now, options.timeoutMs ?? 10_000)));
}
