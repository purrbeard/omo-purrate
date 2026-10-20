import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { mediaUrl } from "../../shared/media";
import { mediaPathFromUrl, parseRange, serveMedia } from "../../electron/media-serve";

describe("parseRange", () => {
  it("parses closed, open and suffix ranges", () => {
    expect(parseRange("bytes=0-9", 100)).toEqual({ start: 0, end: 9 });
    expect(parseRange("bytes=50-", 100)).toEqual({ start: 50, end: 99 });
    expect(parseRange("bytes=-10", 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange("bytes=90-500", 100)).toEqual({ start: 90, end: 99 });
  });

  it("flags ranges outside the file and ignores malformed or multi ranges", () => {
    expect(parseRange("bytes=100-", 100)).toBe("unsatisfiable");
    expect(parseRange("bytes=-0", 100)).toBe("unsatisfiable");
    expect(parseRange(null, 100)).toBeNull();
    expect(parseRange("bytes=0-1,5-6", 100)).toBeNull();
    expect(parseRange("items=0-1", 100)).toBeNull();
    expect(parseRange("bytes=9-3", 100)).toBeNull();
  });
});

describe("mediaPathFromUrl", () => {
  it("round-trips the renderer URL and rejects anything else", () => {
    const file = path.join(tmpdir(), "a b", "x.png");
    expect(mediaPathFromUrl(mediaUrl(file))).toBe(path.normalize(file));
    expect(mediaPathFromUrl("omo-media://other/x")).toBeNull();
    expect(mediaPathFromUrl("https://local/x.png")).toBeNull();
    expect(mediaPathFromUrl("omo-media://local/relative.png")).toBeNull();
    expect(mediaPathFromUrl("omo-media://local/%E0%A4%A")).toBeNull();
  });
});

describe("serveMedia", () => {
  async function fixture(): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), "omo-media-"));
    await writeFile(path.join(dir, "a.png"), Buffer.from("0123456789"));
    await writeFile(path.join(dir, "clip.mp4"), Buffer.from("abcdefghijklmnopqrstuvwxyz"));
    await writeFile(path.join(dir, "secret.txt"), "secret");
    await writeFile(path.join(dir, "icon.svg"), "<svg xmlns='http://www.w3.org/2000/svg'/>");
    await mkdir(path.join(dir, "folder.png"));
    return dir;
  }
  const get = (file: string, headers: Record<string, string> = {}, method = "GET"): Promise<Response> =>
    serveMedia(new Request(mediaUrl(file), { method, headers }));

  it("serves allowlisted files with their content type", async () => {
    const dir = await fixture();
    const response = await get(path.join(dir, "a.png"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(response.headers.get("content-length")).toBe("10");
    expect(await response.text()).toBe("0123456789");
    expect((await get(path.join(dir, "icon.svg"))).headers.get("content-type")).toBe("image/svg+xml");
  });

  it("answers Range requests with a partial body", async () => {
    const dir = await fixture();
    const response = await get(path.join(dir, "clip.mp4"), { Range: "bytes=2-5" });
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 2-5/26");
    expect(await response.text()).toBe("cdef");
    expect((await get(path.join(dir, "clip.mp4"), { Range: "bytes=30-" })).status).toBe(416);
    expect((await get(path.join(dir, "clip.mp4"), {}, "HEAD")).headers.get("content-length")).toBe("26");
  });

  it("refuses everything outside the allowlist", async () => {
    const dir = await fixture();
    expect((await get(path.join(dir, "secret.txt"))).status).toBe(404);
    expect((await get(path.join(dir, "missing.png"))).status).toBe(404);
    expect((await get(path.join(dir, "folder.png"))).status).toBe(404);
    expect((await get(dir)).status).toBe(404);
    expect((await serveMedia(new Request(mediaUrl(path.join(dir, "a.png")), { method: "POST", body: "x" }))).status).toBe(405);
  });

  it("does not follow a media-named link to a non-media file", async () => {
    const dir = await fixture();
    const link = path.join(dir, "link.png");
    try {
      await symlink(path.join(dir, "secret.txt"), link);
    } catch (error) {
      // Creating symlinks needs a privilege on some Windows setups; the policy is still covered by the other cases.
      void error;
      return;
    }
    expect((await get(link)).status).toBe(404);
  });
});
