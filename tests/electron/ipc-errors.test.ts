import { describe, expect, it } from "vitest";
import { stripRemoteMethodPrefix } from "../../electron/ipc-errors";

describe("stripRemoteMethodPrefix", () => {
  it("removes Electron's remote-method prefix and the error class name", () => {
    expect(stripRemoteMethodPrefix("Error invoking remote method 'history:load': Error: ENOENT: no such file or directory")).toBe(
      "ENOENT: no such file or directory",
    );
    expect(stripRemoteMethodPrefix("Error invoking remote method 'omo:respond': TypeError: id must be a number or string")).toBe(
      "id must be a number or string",
    );
  });

  it("leaves messages without the prefix unchanged", () => {
    expect(stripRemoteMethodPrefix("sessionPath is outside the omo sessions directory")).toBe(
      "sessionPath is outside the omo sessions directory",
    );
  });
});
