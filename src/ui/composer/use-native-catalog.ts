import { useEffect, useSyncExternalStore } from "react";
import type { NativeCatalog } from "../../../shared/workbench";
import { useAppStore } from "../../state";
import { nativeCatalogCache } from "../../state/native-catalog";

export function useNativeCatalog(cwd: string | null, enabled: boolean): NativeCatalog | null {
  const cache = nativeCatalogCache(useAppStore());
  const catalog = useSyncExternalStore(cache.subscribe, () => cwd === null ? null : cache.get(cwd));
  useEffect(() => {
    if (enabled && cwd !== null) void cache.load(cwd);
  }, [cache, cwd, enabled]);
  return catalog?.error === null ? catalog : null;
}
