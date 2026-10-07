import { expect, it } from "vitest";
import { addContext, contextMessage, splitContext, CONTEXT_HEADER, CONTEXT_LIMIT } from "../../src/ui/composer/context-draft";

it("deduplicates references while preserving attachment kind and limiting the batch", () => {
  const first = { kind: "file" as const, value: "C:/work/readme.md" };
  expect(addContext([first], [first, { kind: "folder", value: first.value }])).toEqual([first, { kind: "folder", value: first.value }]);
  expect(addContext([], Array.from({ length: 15 }, (_, index) => ({ kind: "file", value: `C:/work/${index}` })))).toHaveLength(CONTEXT_LIMIT);
});

it("keeps context as parseable JSON including newlines and special characters", () => {
  const context = [{ kind: "terminal" as const, value: 'PS> echo "hello"\nline two' }];
  const result = contextMessage("inspect this", context);
  expect(JSON.parse(result.slice(result.indexOf(CONTEXT_HEADER) + CONTEXT_HEADER.length))).toEqual(context);
  expect(contextMessage("request", [])).toBe("request");
  expect(JSON.parse(contextMessage("", context).slice(CONTEXT_HEADER.length))).toEqual(context);
  expect(splitContext(result)).toEqual({ text: "inspect this", context });
  const terminalHeader = [{ kind: "terminal" as const, value: `PS> echo ${CONTEXT_HEADER}` }];
  expect(splitContext(contextMessage("inspect", terminalHeader))).toEqual({ text: "inspect", context: terminalHeader });
  const ordinary = `${CONTEXT_HEADER}\nnot JSON`;
  expect(splitContext(ordinary)).toEqual({ text: ordinary, context: [] });
});
