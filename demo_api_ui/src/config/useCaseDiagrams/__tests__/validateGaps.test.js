import { describe, expect, it } from "vitest";
import { validateConfig } from "../validate";
import UC6 from "../UC6";

const base = JSON.parse(JSON.stringify(UC6));

describe("validator requires what consumers dereference (findings 2+5)", () => {
  it("flags a walk step missing nodes", () => {
    const cfg = JSON.parse(JSON.stringify(base));
    delete cfg.walk[0].nodes;
    const res = validateConfig(cfg);
    expect(res.ok).toBe(false);
    expect(res.errors.join(" ")).toContain("walk 0: missing nodes");
  });

  it("flags a walk step missing tech", () => {
    const cfg = JSON.parse(JSON.stringify(base));
    delete cfg.walk[0].tech;
    const res = validateConfig(cfg);
    expect(res.ok).toBe(false);
    expect(res.errors.join(" ")).toContain("walk 0: missing tech");
  });

  it("flags a missing or malformed result", () => {
    const cfg = JSON.parse(JSON.stringify(base));
    delete cfg.result;
    expect(validateConfig(cfg).errors.join(" ")).toContain("missing result");
    const cfg2 = JSON.parse(JSON.stringify(base));
    cfg2.result = { label: "DENY", tone: "error" };
    expect(validateConfig(cfg2).errors.join(" ")).toContain("bad result tone");
  });
});
