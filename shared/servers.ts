/** The SSH servers dock surface: hosts from the user's OpenSSH config and their specs, read with non-interactive probes. */

/** A Host entry of the ssh config, with its effective connection settings. */
export interface SshHost {
  alias: string;
  hostName: string;
  /** null when the config names no user (ssh then uses the local user name). */
  user: string | null;
  port: number;
  identityFiles: string[];
}

export type SshStatus = "online" | "auth-failed" | "unreachable" | "unknown";

export interface SshGpu {
  name: string;
  /** null when the host does not report it. */
  memoryMb: number | null;
}

export interface SshDisk {
  /** Mount point (`/`) or drive (`C:`). */
  mount: string;
  totalGb: number;
  freeGb: number;
}

export interface SshSpecs {
  family: "posix" | "windows";
  /** `uname -s` (Linux, Darwin, FreeBSD) or "Windows". */
  system: string;
  hostname: string;
  osName: string;
  kernel: string;
  arch: string;
  cpuModel: string | null;
  /** Logical processors. */
  cores: number | null;
  ramTotalMb: number | null;
  ramAvailableMb: number | null;
  swapTotalMb: number | null;
  swapFreeMb: number | null;
  /** The root filesystem first, then (Windows) the other fixed drives. */
  disks: SshDisk[];
  /** POSIX load averages "1m 5m 15m", or the Windows CPU load percentage. */
  load: string | null;
  uptimeSeconds: number | null;
  gpus: SshGpu[];
}

export interface SshHostState {
  alias: string;
  status: SshStatus;
  /** Wall time of the last ssh round trip, connection included. */
  latencyMs: number | null;
  checkedAt: number | null;
  /** The ssh stderr line behind a failure. */
  message: string | null;
  specs: SshSpecs | null;
  specsAt: number | null;
  /** A probe for this host is queued or running. */
  probing: boolean;
}

export interface SshInventory {
  /** The config file read (OMO_UI_SSH_CONFIG or ~/.ssh/config). */
  configPath: string;
  hosts: SshHost[];
  /** Cached state per alias; hosts never checked are absent. */
  states: Record<string, SshHostState>;
  /** The config could not be read; hosts is empty. */
  error: string | null;
}

export const SERVERS_IPC = {
  list: "servers:list",
  test: "servers:test",
  refresh: "servers:refresh",
  state: "servers:state",
} as const;

export interface ServersBridgeApi {
  /** Reads the ssh config again and returns its hosts with their cached state. */
  listSshHosts(): Promise<SshInventory>;
  /** Connects once without running anything heavier than `echo`; updates status and latency. */
  testSshHost(alias: string): Promise<SshHostState>;
  /** Detects the OS and reads the host's specs in one non-interactive probe. */
  refreshSshSpecs(alias: string): Promise<SshHostState>;
  /** Pushes a host's state when a probe is queued, starts or finishes. */
  onSshHostState(listener: (state: SshHostState) => void): () => void;
}
