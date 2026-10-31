export interface TeamSnapshot {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly members: readonly { readonly name: string; readonly sessionId: string | null; readonly status: string; readonly model: string | null }[];
}
export interface MonitorSnapshot {
  readonly activeCount: number;
  readonly monitors: readonly { readonly id: string; readonly description: string; readonly paused: boolean; readonly startedAtMs: number }[];
}
