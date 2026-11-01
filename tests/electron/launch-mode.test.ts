import { describe, expect, it } from "vitest";
import { INACTIVE_LAUNCH_ARG, launchesInactive } from "../../electron/launch-mode";

describe("launch activation", () => {
  it("activates an ordinary launch", () => {
    expect(launchesInactive(["C:/Programs/OmO UI Windows/OmO UI Windows.exe"], false)).toBe(false);
  });

  it("stays inactive for the inactive argument or a background test window", () => {
    expect(launchesInactive(["app.exe", INACTIVE_LAUNCH_ARG], false)).toBe(true);
    expect(launchesInactive(["app.exe"], true)).toBe(true);
  });
});
