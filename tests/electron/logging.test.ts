import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { initLogging } from "../../electron/logging";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "omo-ui-logging-"));
});

describe("initLogging", () => {
  it("appends timestamped lines and preserves logs across initializations", () => {
    const logger = initLogging(dir);
    expect(logger.dir).toBe(dir);
    logger.log("info", "first", { version: "1.0" });
    initLogging(dir).log("warn", "second");
    const lines = readFileSync(path.join(dir, "main.log"), "utf8").trimEnd().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z \[info\] first /);
    expect(JSON.parse(lines[0]!.split(" first ")[1]!)).toEqual({ version: "1.0" });
    expect(lines[1]).toMatch(/\[warn\] second$/);
  });

  it("rotates before the next append exceeds the byte limit and keeps one backup", () => {
    const logger = initLogging(dir, { maxBytes: 90 });
    logger.log("info", "first");
    logger.log("info", "second");
    const first = readFileSync(path.join(dir, "main.log"), "utf8");
    logger.log("info", "third");
    const rotated = readFileSync(path.join(dir, "main.1.log"), "utf8");
    expect(rotated).toBe(first);
    expect(rotated).toContain("[info] second");
    expect(readFileSync(path.join(dir, "main.log"), "utf8")).toContain("[info] third");
    logger.log("info", "fourth");
    logger.log("info", "fifth");
    expect(readFileSync(path.join(dir, "main.1.log"), "utf8")).toContain("[info] third");
    expect(readFileSync(path.join(dir, "main.1.log"), "utf8")).not.toContain("[info] first");
    expect(readdirSync(dir).sort()).toEqual(["main.1.log", "main.log"]);
  });

  it("counts UTF-8 bytes rather than characters when rotating", () => {
    const logger = initLogging(dir, { maxBytes: 100 });
    logger.log("info", "\u00e9".repeat(20));
    const first = readFileSync(path.join(dir, "main.log"), "utf8");
    logger.log("info", "next");
    expect(readFileSync(path.join(dir, "main.1.log"), "utf8")).toBe(first);
    expect(readFileSync(path.join(dir, "main.log"), "utf8")).toContain("[info] next");
  });

  it("records error stacks and escapes multiline messages into a single log line", () => {
    const logger = initLogging(dir);
    const error = new Error("failure");
    logger.log("error", "first\nsecond", error);
    const lines = readFileSync(path.join(dir, "main.log"), "utf8").trimEnd().split("\n");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("first\\nsecond");
    expect(JSON.parse(lines[0]!.split("first\\nsecond ")[1]!)).toMatchObject({ message: error.message, stack: error.stack });
  });

  it("does not throw when the destination cannot be written", () => {
    const blocked = path.join(dir, "blocked");
    writeFileSync(blocked, "not a directory");
    const logger = initLogging(blocked);
    expect(() => logger.log("error", "failure")).not.toThrow();
    const fileBlocked = path.join(dir, "main.log");
    const circular: { self?: unknown } = {};
    circular.self = circular;
    expect(() => initLogging(dir).log("error", "failure", circular)).not.toThrow();
    expect(() => initLogging(dir).log("info", "still logging")).not.toThrow();
    expect(readFileSync(fileBlocked, "utf8")).toContain("still logging");
  });
});
