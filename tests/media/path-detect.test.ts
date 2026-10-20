import { describe, expect, it } from "vitest";
import { isDangerousPath, mediaKind, mediaMimeType, mediaUrl } from "../../shared/media";
import { collectParagraphMedia } from "../../src/ui/content/media/mdast-media";
import { absolutePathOf, findPathCandidates, inlineCodePath } from "../../src/ui/content/media/path-detect";
import type * as Md from "mdast";

const paths = (text: string): string[] => findPathCandidates(text).map((candidate) => candidate.path);

describe("findPathCandidates", () => {
  it("finds Windows paths with either separator", () => {
    expect(paths("see C:\\Users\\me\\shot.png and D:/work/a.txt now")).toEqual(["C:\\Users\\me\\shot.png", "D:/work/a.txt"]);
  });

  it("finds POSIX absolute and workspace-relative paths", () => {
    expect(paths("open /var/log/app.log, then ./src/index.ts and docs/readme.md")).toEqual(["/var/log/app.log", "./src/index.ts", "docs/readme.md"]);
    expect(paths("edit README.md")).toEqual(["README.md"]);
  });

  it("drops trailing punctuation and keeps balanced brackets", () => {
    expect(paths("(see C:\\a\\b.png).")).toEqual(["C:\\a\\b.png"]);
    expect(paths("is it C:\\a\\b.png?")).toEqual(["C:\\a\\b.png"]);
    expect(paths("file C:\\a\\report (1).png.")).toEqual(["C:\\a\\report"]);
    expect(paths("\"C:\\a b\\report (1).png\".")).toEqual(["C:\\a b\\report (1).png"]);
  });

  it("splits a line suffix off the path but keeps it in the shown text", () => {
    const [candidate] = findPathCandidates("at src/app.ts:42:7 it fails");
    expect(candidate).toMatchObject({ path: "src/app.ts", line: 42, text: "src/app.ts:42:7" });
    expect(findPathCandidates("C:\\x.txt")[0]?.line).toBeUndefined();
  });

  it("matches quoted paths with spaces", () => {
    const [candidate] = findPathCandidates("saved to 'C:\\My Pictures\\a b.png' ok");
    expect(candidate).toMatchObject({ path: "C:\\My Pictures\\a b.png", text: "C:\\My Pictures\\a b.png" });
  });

  it("does not match URLs, e-mail addresses or UNC paths", () => {
    expect(paths("go to https://example.com/a/b.png or www.example.com/x.png")).toEqual([]);
    expect(paths("mail me@example.com")).toEqual([]);
    expect(paths("share \\\\server\\share\\a.png and //host/x.png")).toEqual([]);
  });

  it("cuts a Korean particle glued to the extension", () => {
    expect(paths("파일은 C:\\폴더\\사진.png를 보세요")).toEqual(["C:\\폴더\\사진.png"]);
  });

  it("reports offsets of the shown text", () => {
    const text = "x C:\\a\\b.png!";
    const [candidate] = findPathCandidates(text);
    expect(text.slice(candidate?.start, candidate?.end)).toBe("C:\\a\\b.png");
  });
});

describe("inlineCodePath", () => {
  it("takes a whole inline-code token that is a path, spaces included", () => {
    expect(inlineCodePath("C:\\My Files\\a.png")?.path).toBe("C:\\My Files\\a.png");
    expect(inlineCodePath("src/my file.ts")?.path).toBe("src/my file.ts");
    expect(inlineCodePath("`README.md`".slice(1, -1))?.path).toBe("README.md");
    expect(inlineCodePath("src/a.ts:12")).toMatchObject({ path: "src/a.ts", line: 12 });
  });

  it("rejects URLs, commands and plain words", () => {
    expect(inlineCodePath("https://example.com/a.png")).toBeNull();
    expect(inlineCodePath("npm run build")).toBeNull();
    expect(inlineCodePath("cat a.txt | wc -l")).toBeNull();
    expect(inlineCodePath("useState")).toBeNull();
    expect(inlineCodePath("\\\\server\\share\\a.png")).toBeNull();
  });
});

describe("absolutePathOf", () => {
  it("keeps absolute paths and resolves relative ones against the workspace", () => {
    expect(absolutePathOf("C:\\a\\b.png", "D:\\ws")).toBe("C:\\a\\b.png");
    expect(absolutePathOf("/etc/hosts", undefined)).toBe("/etc/hosts");
    expect(absolutePathOf("./src/a.ts", "C:\\ws")).toBe("C:\\ws\\src\\a.ts");
    expect(absolutePathOf("src/a.ts", "/home/me/ws/")).toBe("/home/me/ws/src/a.ts");
    expect(absolutePathOf("src/a.ts", undefined)).toBeNull();
  });
});

describe("media vocabulary", () => {
  it("classifies media by extension", () => {
    expect(mediaKind("C:\\a\\Shot.PNG")).toBe("image");
    expect(mediaKind("/a/clip.mov")).toBe("video");
    expect(mediaKind("/a/doc.pdf")).toBeNull();
    expect(mediaMimeType("a.svg")).toBe("image/svg+xml");
    expect(mediaUrl("C:\\a b\\x.png")).toBe("omo-media://local/C%3A%5Ca%20b%5Cx.png");
  });

  it("flags programs and scripts as dangerous", () => {
    for (const name of ["a.exe", "a.BAT", "a.cmd", "a.ps1", "a.lnk", "a.msi", "a.vbs", "a.js"]) expect(isDangerousPath(name)).toBe(true);
    for (const name of ["a.png", "a.txt", "a.pdf", "Makefile"]) expect(isDangerousPath(name)).toBe(false);
  });
});

describe("collectParagraphMedia", () => {
  it("collects media from text, inline code and local links, not from image nodes", () => {
    const children: Md.PhrasingContent[] = [
      { type: "text", value: "Look at C:\\a\\one.png and " },
      { type: "inlineCode", value: "./two.mp4" },
      { type: "text", value: " or " },
      { type: "link", url: "C:/a/three.webp", children: [{ type: "text", value: "three" }] },
      { type: "image", url: "C:/a/four.png", alt: "four" },
      { type: "text", value: " nor C:\\a\\notes.txt" },
    ];
    expect(collectParagraphMedia(children)).toEqual(["C:\\a\\one.png", "./two.mp4", "C:/a/three.webp"]);
  });
});
