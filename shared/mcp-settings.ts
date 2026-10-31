export type McpScope = "global" | "project";
export type McpServerType = "stdio" | "http";

export interface McpSummary {
  name: string;
  type: McpServerType;
  enabled: boolean;
}

export interface McpSnapshot {
  revision: string;
  servers: McpSummary[];
}

export interface McpSaveInput {
  revision: string;
  mode: "create" | "update";
  name: string;
  type: McpServerType;
  enabled: boolean;
  /** Omitted fields retain their existing values. */
  command?: string;
  args?: string[];
  url?: string;
  remove?: boolean;
}
