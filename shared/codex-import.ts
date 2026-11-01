export type CodexUnsupportedReason =
  | "encrypted_reasoning"
  | "source_instructions"
  | "runtime_state"
  | "source_accounting"
  | "duplicate_event"
  | "unsupported_event"
  | "unsupported_record"
  | "unsupported_content"
  | "external_image"
  | "missing_model"
  | "unmatched_tool_call";

export interface CodexConvertedCounts {
  readonly userMessages: number;
  readonly assistantMessages: number;
  readonly toolCalls: number;
  readonly toolResults: number;
  readonly images: number;
  readonly reasoningBlocks: number;
}

export interface CodexRolloutPreview {
  readonly sourcePath: string;
  readonly sourceId: string;
  readonly cwd: string | null;
  readonly model: string | null;
  readonly provider: string | null;
  readonly timestamp: string;
  readonly bytes: number;
  readonly fingerprint: string;
  readonly converted: CodexConvertedCounts;
  readonly unsupported: readonly { readonly reason: CodexUnsupportedReason; readonly count: number }[];
}

export interface CodexSessionSummary {
  readonly sourcePath: string;
  readonly sourceId: string | null;
  readonly cwd: string | null;
  readonly project: string | null;
  readonly title: string | null;
  readonly titleSource: "codex" | "prompt" | "date";
  readonly startedAt: string | null;
  readonly updatedAtMs: number;
  readonly bytes: number;
  readonly imported: boolean;
}

export interface CodexSessionList {
  readonly root: string;
  readonly items: readonly CodexSessionSummary[];
  readonly omitted: number;
}

export interface CodexImportOptions {
  readonly cwd: string;
  readonly provider: string;
  readonly model: string;
  readonly previewFingerprint: string;
}

export interface CodexImportResult {
  readonly path: string;
  readonly threadId: string;
  readonly preview: CodexRolloutPreview;
}
