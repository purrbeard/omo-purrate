// Which local media a Markdown paragraph references, for the preview strip under it.

import type * as Md from "mdast";
import { mediaKind } from "../../../../shared/media";
import { parseFileLink } from "../markdown/file-link";
import { findPathCandidates, inlineCodePath } from "./path-detect";

/**
 * Raw paths of the images and videos a paragraph's inline content mentions: bare paths in text, inline code, and
 * local links. Image nodes are excluded because they already render in place.
 * @param children - The paragraph's phrasing content.
 * @returns distinct raw paths in document order.
 */
export function collectParagraphMedia(children: readonly Md.PhrasingContent[]): string[] {
  const found: string[] = [];
  const inline = new Set<string>();
  const walk = (nodes: readonly Md.PhrasingContent[]): void => {
    for (const node of nodes) {
      if (node.type === "image") {
        const local = parseFileLink(node.url)?.path;
        if (local !== undefined) inline.add(local);
      } else if (node.type === "text") {
        for (const candidate of findPathCandidates(node.value)) found.push(candidate.path);
      } else if (node.type === "inlineCode") {
        const candidate = inlineCodePath(node.value);
        if (candidate !== null) found.push(candidate.path);
      } else if (node.type === "link") {
        const local = parseFileLink(node.url)?.path;
        if (local !== undefined) found.push(local);
        else walk(node.children);
      } else if ("children" in node) {
        walk(node.children as Md.PhrasingContent[]);
      }
    }
  };
  walk(children);
  return [...new Set(found)].filter((path) => mediaKind(path) !== null && !inline.has(path));
}
