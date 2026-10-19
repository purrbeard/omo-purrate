/** The browser dock's remembered URLs: the last page per thread and the 10 most recent pages, kept with the dock layout in localStorage. */

const KEY = "omo-ui.browser.v1";
export const RECENT_LIMIT = 10;
const THREAD_LIMIT = 200;

export interface BrowserMemory {
  lastUrl: Record<string, string>;
  recent: string[];
}

export function parseBrowserMemory(raw: string | null): BrowserMemory {
  const empty: BrowserMemory = { lastUrl: {}, recent: [] };
  if (raw === null) return empty;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return empty;
    const { lastUrl, recent } = value as { lastUrl?: unknown; recent?: unknown };
    return {
      lastUrl: typeof lastUrl === "object" && lastUrl !== null
        ? Object.fromEntries(Object.entries(lastUrl).filter((entry): entry is [string, string] => typeof entry[1] === "string" && /^https?:/i.test(entry[1])))
        : {},
      recent: Array.isArray(recent) ? [...new Set(recent.filter((url): url is string => typeof url === "string" && /^https?:/i.test(url)))].slice(0, RECENT_LIMIT) : [],
    };
  } catch { return empty; }
}

/** @returns memory with `url` as `threadId`'s page and the newest recent entry */
export function rememberUrl(memory: BrowserMemory, threadId: string | null, url: string): BrowserMemory {
  if (!/^https?:/i.test(url)) return memory;
  const lastUrl = threadId === null ? memory.lastUrl : { ...memory.lastUrl, [threadId]: url };
  const keys = Object.keys(lastUrl);
  const trimmed = keys.length > THREAD_LIMIT ? Object.fromEntries(keys.slice(-THREAD_LIMIT).map((key) => [key, lastUrl[key]!])) : lastUrl;
  return { lastUrl: trimmed, recent: [url, ...memory.recent.filter((entry) => entry !== url)].slice(0, RECENT_LIMIT) };
}

/** @returns memory without `threadId`'s page, so the thread opens on the start page */
export function forgetThread(memory: BrowserMemory, threadId: string | null): BrowserMemory {
  if (threadId === null || !(threadId in memory.lastUrl)) return memory;
  const lastUrl = { ...memory.lastUrl };
  delete lastUrl[threadId];
  return { ...memory, lastUrl };
}

export function loadBrowserMemory(): BrowserMemory {
  try { return parseBrowserMemory(window.localStorage.getItem(KEY)); } catch { return parseBrowserMemory(null); }
}

export function saveBrowserMemory(memory: BrowserMemory): void {
  try { window.localStorage.setItem(KEY, JSON.stringify(memory)); } catch { /* storage unavailable */ }
}
