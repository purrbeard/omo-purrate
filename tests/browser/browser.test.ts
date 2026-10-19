import { describe, expect, it } from "vitest";
import { displayAddress, elementReference, resolveAddress, SEARCH_URL } from "../../src/ui/browser/address";
import { forgetThread, parseBrowserMemory, rememberUrl, RECENT_LIMIT } from "../../src/ui/browser/browser-memory";
import { appendToDraft } from "../../src/ui/composer/draft-insert";
import { isDevPort, parseLsof, parseNetstat } from "../../electron/browser/local-servers";

describe("resolveAddress", () => {
  it("keeps http(s) URLs and adds a scheme to hosts", () => {
    expect(resolveAddress("https://example.com/a?b=1")).toBe("https://example.com/a?b=1");
    expect(resolveAddress("localhost:5173")).toBe("http://localhost:5173/");
    expect(resolveAddress("127.0.0.1:8080/app")).toBe("http://127.0.0.1:8080/app");
    expect(resolveAddress("devbox:3000")).toBe("http://devbox:3000/");
    expect(resolveAddress("example.com")).toBe("https://example.com/");
  });
  it("searches for anything else and returns null for blank input", () => {
    expect(resolveAddress("react use effect")).toBe(SEARCH_URL + "react%20use%20effect");
    expect(resolveAddress("vitest")).toBe(SEARCH_URL + "vitest");
    expect(resolveAddress("   ")).toBeNull();
  });
  it("shows a bare origin without its trailing slash", () => {
    expect(displayAddress("http://localhost:5173/")).toBe("localhost:5173".replace(/^/, "http://"));
    expect(displayAddress("https://a.dev/x/")).toBe("https://a.dev/x/");
    expect(displayAddress("about:blank")).toBe("");
  });
  it("formats a picked element as a short reference", () => {
    expect(elementReference("main > h1", "Hello")).toBe("[element] main > h1 - Hello");
    expect(elementReference("#app", "")).toBe("[element] #app");
    expect(elementReference("p", "x".repeat(100))).toHaveLength("[element] p - ".length + 80);
  });
});

describe("browser memory", () => {
  it("keeps the last page per thread and the newest ten distinct recent pages", () => {
    let memory = parseBrowserMemory(null);
    for (let index = 0; index < 12; index++) memory = rememberUrl(memory, "t1", `http://localhost:${3000 + index}/`);
    memory = rememberUrl(memory, "t2", "http://localhost:3005/");
    expect(memory.lastUrl).toEqual({ t1: "http://localhost:3011/", t2: "http://localhost:3005/" });
    expect(memory.recent).toHaveLength(RECENT_LIMIT);
    expect(memory.recent[0]).toBe("http://localhost:3005/");
    expect(new Set(memory.recent).size).toBe(RECENT_LIMIT);
    expect(forgetThread(memory, "t1").lastUrl).toEqual({ t2: "http://localhost:3005/" });
  });
  it("drops stored entries that are not web pages", () => {
    expect(parseBrowserMemory(JSON.stringify({ lastUrl: { a: "file:///x", b: "https://ok.dev/" }, recent: ["javascript:1", "https://ok.dev/"] })))
      .toEqual({ lastUrl: { b: "https://ok.dev/" }, recent: ["https://ok.dev/"] });
    expect(parseBrowserMemory("{")).toEqual({ lastUrl: {}, recent: [] });
  });
});

describe("composer insert", () => {
  it("appends on its own line", () => {
    expect(appendToDraft("", "[element] a")).toBe("[element] a");
    expect(appendToDraft("look at", "[element] a")).toBe("look at\n[element] a");
    expect(appendToDraft("look at\n", "[element] a")).toBe("look at\n[element] a");
  });
});

describe("local servers", () => {
  it("lists loopback and wildcard listeners in dev ranges from netstat, whatever the state column says", () => {
    const text = [
      "Active Connections",
      "  Proto  Local Address          Foreign Address        State           PID",
      "  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1100",
      "  TCP    0.0.0.0:3000           0.0.0.0:0              LISTENING       4200",
      "  TCP    127.0.0.1:5173         0.0.0.0:0              수신 대기        5100",
      "  TCP    192.168.0.4:8080       0.0.0.0:0              LISTENING       6100",
      "  TCP    127.0.0.1:3000         127.0.0.1:50000        ESTABLISHED     4200",
      "  TCP    [::1]:6006             [::]:0                 LISTENING       7100",
      "  TCP    [::]:1420              [::]:0                 LISTENING       7200",
    ].join("\r\n");
    expect(parseNetstat(text)).toEqual([
      { port: 1420, pid: 7200, host: "::1" },
      { port: 3000, pid: 4200, host: "127.0.0.1" },
      { port: 5173, pid: 5100, host: "127.0.0.1" },
      { port: 6006, pid: 7100, host: "::1" },
    ]);
  });
  it("reads lsof output", () => {
    const text = [
      "COMMAND   PID USER   FD   TYPE DEVICE SIZE/OFF NODE NAME",
      "node    51234 me   23u  IPv4 0x1      0t0  TCP 127.0.0.1:5173 (LISTEN)",
      "node    51235 me   23u  IPv6 0x2      0t0  TCP *:8000 (LISTEN)",
      "rapport   500 me    4u  IPv4 0x3      0t0  TCP *:49152 (LISTEN)",
    ].join("\n");
    expect(parseLsof(text)).toEqual([{ port: 5173, pid: 51234, host: "127.0.0.1" }, { port: 8000, pid: 51235, host: "127.0.0.1" }]);
  });
  it("knows the dev ranges", () => {
    expect([2999, 3000, 5999, 6000, 6006, 1420, 8999, 9000].map(isDevPort)).toEqual([false, true, true, false, true, true, true, false]);
  });
});
