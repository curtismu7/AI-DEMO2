import { describe, expect, it } from "vitest";
import { CONFIGS, getConfig } from "../index";

describe("getConfig", () => {
  it("finds every config by its own id, any input casing", () => {
    for (const config of CONFIGS) {
      // Callers pass the catalog's id verbatim (uc.id, e.g. "UC14b") — the
      // lookup must match the config's id regardless of letter case.
      expect(getConfig(config.id), `getConfig("${config.id}")`).toBe(config);
    }
  });

  it("is null for an unknown id", () => {
    expect(getConfig("NOPE")).toBeNull();
  });
});
