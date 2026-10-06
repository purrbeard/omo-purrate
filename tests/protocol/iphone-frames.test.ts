import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const bridge = readFileSync(new URL("../../electron/iphone/bridge.ts", import.meta.url), "utf8");
const model = readFileSync(new URL("../../ios/OmoKit/Sources/OmoKit/BridgeMessage.swift", import.meta.url), "utf8");
const doc = readFileSync(new URL("../../docs/iphone-bridge.md", import.meta.url), "utf8");

function strings(source: string, pattern: RegExp): string[] {
  return [...new Set([...source.matchAll(pattern)].flatMap((match) => match[1] === undefined ? [] : [match[1]]))].sort();
}

// Mac: outgoing object `type` literals and incoming frame["type"] equality/inequality
// checks (including the !== "rpc" guard). Swift: decoder string case labels and
// encoder "type": .string(...) entries. "unknown" is Swift's fallback sentinel,
// not a supported frame, so exclude only that encoder entry.
// Docs: JSON "type" literals in table rows under "Frames (both directions)",
// including multiple frames in one row; prose examples elsewhere do not count.
function frameTypes(document: string) {
  const frameSection = document.split("## Frames (both directions)")[1]?.split(/^## /m)[0] ?? "";
  const rows = frameSection.split("\n").filter((line) => /^\s*\|/.test(line)).join("\n");
  return {
    mac: strings(bridge, /(?:\btype\s*:|frame\["type"\]\s*(?:===|!==))\s*"([^"]+)"/g),
    decoded: strings(model, /\bcase\s+"([^"]+)"\s*:/g),
    encoded: strings(model, /"type"\s*:\s*\.string\("([^"]+)"\)/g).filter((type) => type !== "unknown"),
    documented: strings(rows, /"type"\s*:\s*"([^"]+)"/g),
  };
}

function expectAgreement(document: string): void {
  const types = frameTypes(document);
  expect(types.mac.length, "Mac frame extraction must not be empty").toBeGreaterThan(0);
  expect(types.decoded, "Swift decoder vs Mac frames").toEqual(types.mac);
  expect(types.encoded, "Swift encoder vs Mac frames").toEqual(types.mac);
  expect(types.documented, "Documented vs Mac frames").toEqual(types.mac);
}

describe("iPhone frame protocol", () => {
  it("keeps Mac, Swift decoding/encoding, and documented frame types equal", () => {
    expectAgreement(doc);
  });

  it("rejects a frame table missing serverAnswer without changing the real doc", () => {
    const mutated = doc.replace(/^\|[^\n]*"type"\s*:\s*"serverAnswer"[^\n]*(?:\n|$)/m, "");
    expect(mutated).not.toBe(doc);
    expect(frameTypes(doc).documented).toContain("serverAnswer");
    expect(frameTypes(mutated).documented).not.toContain("serverAnswer");
    expect(() => expectAgreement(mutated)).toThrowError("Documented vs Mac frames");
  });
});
