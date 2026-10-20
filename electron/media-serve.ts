import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { MEDIA_SCHEME, mediaMimeType } from "../shared/media";

/** A satisfiable byte range, inclusive on both ends. */
export interface ByteRange {
  start: number;
  end: number;
}

/**
 * The absolute file path a media URL names.
 * @param url - A `omo-media://local/<encoded absolute path>` URL.
 * @returns the decoded path, or null for any other scheme, host, relative or malformed path.
 */
export function mediaPathFromUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch (error) {
    void error;
    return null;
  }
  if (parsed.protocol !== `${MEDIA_SCHEME}:` || parsed.hostname !== "local") return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(parsed.pathname.slice(1));
  } catch (error) {
    void error;
    return null;
  }
  if (decoded === "" || decoded.includes("\0") || !path.isAbsolute(decoded)) return null;
  return path.normalize(decoded);
}

/**
 * Parse an HTTP Range header against a file size. Only a single `bytes=` range is honored.
 * @returns the range, "unsatisfiable" when it lies outside the file, or null when absent, multi-range or malformed
 * (the caller then serves the whole file).
 */
export function parseRange(header: string | null, size: number): ByteRange | "unsatisfiable" | null {
  if (header === null) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (match === null || (match[1] === "" && match[2] === "")) return null;
  const first = match[1] ?? "";
  const last = match[2] ?? "";
  if (first === "") {
    const suffix = Number(last);
    if (suffix === 0 || size === 0) return "unsatisfiable";
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(first);
  if (start >= size) return "unsatisfiable";
  const end = last === "" ? size - 1 : Math.min(Number(last), size - 1);
  return end < start ? null : { start, end };
}

const NOT_FOUND = () => new Response(null, { status: 404 });

/**
 * Serve one allowlisted media file with Range support, streaming from disk.
 * Everything else (other extensions, directories, missing files, symlinks to non-media) is a 404.
 * @param request - The `omo-media://` request.
 */
export async function serveMedia(request: Request): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") return new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } });
  const requested = mediaPathFromUrl(request.url);
  if (requested === null || mediaMimeType(requested) === null) return NOT_FOUND();
  let target: string;
  let size: number;
  try {
    // The extension is checked again on the resolved path so a media-named link cannot expose other files.
    target = await realpath(requested);
    if (mediaMimeType(target) === null) return NOT_FOUND();
    const info = await stat(target);
    if (!info.isFile()) return NOT_FOUND();
    size = info.size;
  } catch (error) {
    void error;
    return NOT_FOUND();
  }
  const contentType = mediaMimeType(target) ?? "application/octet-stream";
  const headers: Record<string, string> = {
    "Content-Type": contentType,
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-cache",
    "X-Content-Type-Options": "nosniff",
  };
  // An SVG is only ever shown through <img>, where scripts do not run; the sandbox policy covers direct navigation too.
  if (contentType === "image/svg+xml") headers["Content-Security-Policy"] = "sandbox; default-src 'none'; style-src 'unsafe-inline'";
  const range = parseRange(request.headers.get("range"), size);
  if (range === "unsatisfiable") return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${size}` } });
  const start = range?.start ?? 0;
  const end = range?.end ?? size - 1;
  const length = size === 0 ? 0 : end - start + 1;
  headers["Content-Length"] = String(length);
  if (range !== null) headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
  const status = range === null ? 200 : 206;
  if (request.method === "HEAD" || length === 0) return new Response(null, { status, headers });
  const stream = createReadStream(target, { start, end });
  return new Response(Readable.toWeb(stream) as ReadableStream, { status, headers });
}
