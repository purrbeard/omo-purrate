import type { SshHost, SshSpecs } from "../../../shared/servers";

/** `user@host:port`, leaving out the user ssh would default and port 22. */
export function hostAddress(host: SshHost): string {
  return `${host.user === null ? "" : `${host.user}@`}${host.hostName}${host.port === 22 ? "" : `:${host.port}`}`;
}

/** The short OS name for a row badge: Windows, macOS, or the Linux distribution's first word. */
export function osBadge(specs: SshSpecs | null): string | null {
  if (specs === null) return null;
  if (specs.family === "windows") return "Windows";
  if (specs.system === "Darwin") return "macOS";
  const first = specs.osName.trim().split(/\s+/)[0];
  return first === undefined || first === "" ? specs.system || null : first;
}

/** Megabytes as GB with one decimal under 100 GB, whole GB above, or TB from 1000 GB. */
export function sizeFromMb(mb: number | null): string | null {
  if (mb === null || !Number.isFinite(mb)) return null;
  const gb = mb / 1024;
  if (gb >= 1000) return `${(gb / 1024).toFixed(1)} TB`;
  return gb >= 100 ? `${Math.round(gb)} GB` : `${gb.toFixed(1)} GB`;
}

export function sizeFromGb(gb: number): string {
  return sizeFromMb(gb * 1024) ?? "";
}

/** Uptime as `3d 4h`, `5h 12m` or `7m`. */
export function uptime(seconds: number | null): string | null {
  if (seconds === null || !Number.isFinite(seconds)) return null;
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}
