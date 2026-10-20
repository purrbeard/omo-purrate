// Scope that turns on path chips and media previews for settled chat content below it.

import { createContext, useContext, useMemo } from "react";
import type { ReactNode } from "react";

/** What a settled message needs to resolve and open the paths it mentions. */
export interface PathPreview {
  /** The thread's workspace root, used to resolve workspace-relative paths. */
  readonly cwd: string | undefined;
}

const PathPreviewContext = createContext<PathPreview | null>(null);

/** Enables path chips and media previews for descendants; content outside a provider renders exactly as before. */
export function PathPreviewProvider({ cwd, children }: { cwd: string | null | undefined; children: ReactNode }): ReactNode {
  const value = useMemo<PathPreview>(() => ({ cwd: cwd ?? undefined }), [cwd]);
  return <PathPreviewContext.Provider value={value}>{children}</PathPreviewContext.Provider>;
}

/** The nearest preview scope, or null when previews are not enabled here. */
export function usePathPreview(): PathPreview | null {
  return useContext(PathPreviewContext);
}
