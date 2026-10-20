/** Local media and path vocabulary shared by the renderer (previews, chips) and the main process (protocol, open). */

const IMAGE_MIME: Readonly<Record<string, string>> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", bmp: "image/bmp", svg: "image/svg+xml",
};
const VIDEO_MIME: Readonly<Record<string, string>> = {
  mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime", m4v: "video/x-m4v",
};

/** Executables and scripts that must never be launched from a chat click; they are revealed in the folder instead. */
const DANGEROUS_EXTENSIONS: ReadonlySet<string> = new Set([
  "exe", "bat", "cmd", "com", "ps1", "psm1", "psd1", "lnk", "msi", "msp", "vbs", "vbe", "js", "jse", "mjs", "cjs", "wsf", "wsh",
  "scr", "hta", "jar", "reg", "cpl", "pif", "gadget", "appref-ms", "url", "dll", "sh", "bash", "zsh", "command", "app", "py",
  "pyw", "pl", "rb", "php", "msc", "inf", "scf", "ws", "application", "deb", "rpm", "apk", "dmg", "pkg",
]);

/** The URL scheme the main process serves local media over. */
export const MEDIA_SCHEME = "omo-media";

/** Largest batch of paths one existence check may carry. */
export const MAX_STAT_PATHS = 200;

/** Kind of a path the existence check found. */
export type PathKind = "file" | "dir" | "missing";

/** One existence-check result, in request order. */
export interface PathInfo {
  kind: PathKind;
  size?: number;
}

/** What opening a path did: launched through the OS default app, or (for executables) only revealed in its folder. */
export type OpenPathOutcome = "opened" | "revealed";

/**
 * Lower-cased extension of the last path segment, without the dot.
 * @param target - Path in either separator spelling.
 * @returns the extension, or "" when the name has none.
 */
export function pathExtension(target: string): string {
  const name = target.slice(Math.max(target.lastIndexOf("/"), target.lastIndexOf("\\")) + 1);
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot + 1).toLowerCase();
}

/**
 * Classify a path as previewable media by extension.
 * @param target - Path in either separator spelling.
 * @returns "image" or "video" for allowlisted extensions, otherwise null.
 */
export function mediaKind(target: string): "image" | "video" | null {
  const extension = pathExtension(target);
  if (Object.hasOwn(IMAGE_MIME, extension)) return "image";
  if (Object.hasOwn(VIDEO_MIME, extension)) return "video";
  return null;
}

/**
 * Content type served for an allowlisted media path.
 * @param target - Path in either separator spelling.
 * @returns the MIME type, or null when the extension is not allowlisted.
 */
export function mediaMimeType(target: string): string | null {
  const extension = pathExtension(target);
  return IMAGE_MIME[extension] ?? VIDEO_MIME[extension] ?? null;
}

/**
 * Whether a click must not launch this path (executables and scripts).
 * @param target - Path in either separator spelling.
 */
export function isDangerousPath(target: string): boolean {
  return DANGEROUS_EXTENSIONS.has(pathExtension(target));
}

/**
 * The URL a renderer element loads a local media file from; the main process serves it (see electron/media-serve.ts).
 * @param absolutePath - Absolute path of an allowlisted media file.
 */
export function mediaUrl(absolutePath: string): string {
  return `${MEDIA_SCHEME}://local/${encodeURIComponent(absolutePath)}`;
}

/** Final path segment in either separator spelling. */
export function baseName(target: string): string {
  const trimmed = target.replace(/[\\/]+$/, "");
  return trimmed.slice(Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\")) + 1);
}
