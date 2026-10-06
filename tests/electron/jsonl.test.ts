import { describe, expect, it } from "vitest";
import { JsonlDecoder } from "../../electron/omo/jsonl";

function collect(): { frames: unknown[]; malformed: string[]; decoder: JsonlDecoder } {
  const frames: unknown[] = [];
  const malformed: string[] = [];
  const decoder = new JsonlDecoder({ onFrame: (value) => frames.push(value), onMalformed: (line) => malformed.push(line) });
  return { frames, malformed, decoder };
}

describe("JsonlDecoder", () => {
  it("reassembles a frame split across chunks", () => {
    const { frames, decoder } = collect();
    decoder.push('{"id":1,"res');
    decoder.push('ult":{"a":2}}\n{"method":"x"}\n');
    expect(frames).toEqual([{ id: 1, result: { a: 2 } }, { method: "x" }]);
  });

  it("keeps multi-byte UTF-8 intact across Buffer chunk boundaries", () => {
    const { frames, decoder } = collect();
    const bytes = Buffer.from('{"text":"한글"}\n', "utf8");
    decoder.push(bytes.subarray(0, 11));
    decoder.push(bytes.subarray(11));
    expect(frames).toEqual([{ text: "한글" }]);
  });

  it("tolerates CRLF line endings", () => {
    const { frames, malformed, decoder } = collect();
    decoder.push('{"a":1}\r\n{"b":2}\r\n');
    expect(frames).toEqual([{ a: 1 }, { b: 2 }]);
    expect(malformed).toEqual([]);
  });

  it("reports a non-JSON line and keeps decoding", () => {
    const { frames, malformed, decoder } = collect();
    decoder.push('not json\n{"ok":true}\n');
    expect(malformed).toEqual(["not json"]);
    expect(frames).toEqual([{ ok: true }]);
  });

  it("ignores blank lines", () => {
    const { frames, malformed, decoder } = collect();
    decoder.push('\n  \n\r\n{"a":1}\n\n');
    expect(frames).toEqual([{ a: 1 }]);
    expect(malformed).toEqual([]);
  });

  it("flushes an unterminated final line on end()", () => {
    const { frames, decoder } = collect();
    decoder.push('{"tail":1}');
    expect(frames).toEqual([]);
    decoder.end();
    expect(frames).toEqual([{ tail: 1 }]);
  });
});
