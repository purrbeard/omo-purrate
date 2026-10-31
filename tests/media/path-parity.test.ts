import { describe, expect, it } from "vitest";
import type * as Md from "mdast";
import { findPathCandidates, inlineCodePath } from "../../src/ui/content/media/path-detect";
import { parseGfm, parseGfmWithMath } from "../../src/ui/content/markdown/parse";
import { collectParagraphMedia } from "../../src/ui/content/media/mdast-media";

const windowsPath = String.raw`C:\My Files\[captures]\shot.png`;

function textOf(node: Md.Root | Md.RootContent): string {
  if ("value" in node) return node.value;
  return "children" in node ? node.children.map(textOf).join("") : "";
}

describe("Windows chat path parity", () => {
  it("recognizes backtick-delimited plaintext paths containing spaces without changing the source span", () => {
    const source = `open \`${windowsPath}\` now`;
    const candidates = findPathCandidates(source);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.path).toBe(windowsPath);
    expect(source.slice(candidates[0]?.start, candidates[0]?.end)).toBe(windowsPath);
  });

  it("retains the entire displayed inline-code value while resolving only its quoted path", () => {
    const source = `"${windowsPath}"`;
    const candidate = inlineCodePath(source);
    expect(candidate).toMatchObject({ path: windowsPath, text: source, start: 0, end: source.length });
  });

  for (const [name, parse] of [["streaming", parseGfm], ["settled", parseGfmWithMath]] as const) {
    it.each([windowsPath, String.raw`C:\[captures]\shot.png`, String.raw`C:\(captures)\clip.mp4`])(`${name} markdown preserves separators in %s`, (target) => {
      const root = parse(`open "${target}" now`);
      expect(textOf(root)).toBe(`open "${target}" now`);
      const paragraph = root.children[0];
      expect(paragraph?.type).toBe("paragraph");
      if (paragraph?.type !== "paragraph") throw new Error("expected paragraph");
      expect(collectParagraphMedia(paragraph.children)).toEqual([target]);
    });

    it(`${name} markdown still treats ordinary punctuation escapes normally and leaves code raw`, () => {
      expect(textOf(parse(String.raw`escaped \*literal\*`))).toBe("escaped *literal*");
      const code = parse(`\`\`\`text\n${windowsPath}\n\`\`\``).children[0];
      expect(code).toMatchObject({ type: "code", value: windowsPath });
    });
  }
});
