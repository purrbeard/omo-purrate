export type StorageCategory = "sessions" | "attachments" | "screenshots";

export interface StorageUsageRow {
  category: StorageCategory;
  state: "present" | "absent" | "unavailable";
  count: number;
  bytes: number;
  candidateCount: number;
  candidateBytes: number;
  skipped: number;
  errors: number;
  incomplete: boolean;
}

export interface StorageUsage {
  olderThanDays: number;
  rows: StorageUsageRow[];
  incomplete: boolean;
}
