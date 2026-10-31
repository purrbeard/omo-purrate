// Scope that turns on path chips and media previews for settled chat content below it.

import { createContext, useContext, useMemo } from "react";
import type { ReactNode } from "react";

export interface PathPreview {
  readonly cwd: string | undefined;
}

const PathPreviewContext = createContext<PathPreview | null>(null);

/** Enables path previews for the local paths below this scope. */
export function PathPreviewProvider({ cwd, children }: { cwd: string | null | undefined; children: ReactNode }): ReactNode {
  const value = useMemo<PathPreview>(() => ({ cwd: cwd ?? undefined }), [cwd]);
  return <PathPreviewContext.Provider value={value}>{children}</PathPreviewContext.Provider>;
}

export function usePathPreview(): PathPreview | null {
  return useContext(PathPreviewContext);
}
