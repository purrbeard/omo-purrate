import type { NativeCatalog } from "../../shared/workbench";
import type { AppStore } from "./store";

/** Catalog cache belongs to the app store, not to a composer or a thread. */
const caches = new WeakMap<AppStore, ReturnType<typeof createCatalogCache>>();

function createCatalogCache() {
  const entries = new Map<string, NativeCatalog>();
  const pending = new Map<string, Promise<void>>();
  const listeners = new Set<() => void>();
  return {
    get: (cwd: string): NativeCatalog | null => entries.get(cwd) ?? null,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    load(cwd: string): Promise<void> {
      if (entries.has(cwd)) return Promise.resolve();
      const existing = pending.get(cwd);
      if (existing !== undefined) return existing;
      const request = window.omo.loadNativeCatalog(cwd)
        .catch((error: unknown): NativeCatalog => ({ commands: [], contextWindows: {}, error: String(error) }))
        .then(catalog => {
          entries.set(cwd, catalog);
          pending.delete(cwd);
          for (const listener of listeners) listener();
        });
      pending.set(cwd, request);
      return request;
    },
  };
}

export function nativeCatalogCache(store: AppStore): ReturnType<typeof createCatalogCache> {
  let cache = caches.get(store);
  if (cache === undefined) {
    cache = createCatalogCache();
    caches.set(store, cache);
  }
  return cache;
}
