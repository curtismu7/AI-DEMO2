import { describe, expect, it } from "vitest";
import { getConfig } from "../index";
import { validateSteps } from "../stepDetail";

const IDS = ["UC-AIC-TX", "UC-LOGIN-AIC", "UC-LOGIN", "UC-MUSE1", "UC-MUSE2", "UC-NHI1", "UC-OBO", "UC-PRIVB", "UC-PRIVC", "UC-PRIVD"];
const JWT = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/;

describe.each(IDS)("pingBatch3 %s", (id) => {
  const cfg = getConfig(id);
  it("loads with pingStyle", () => {
    expect(cfg).toBeTruthy();
    expect(cfg.pingStyle).toBe(true);
  });
  it("steps validate and cover every beat exactly once", () => {
    expect(validateSteps(cfg)).toEqual([]);
    const beats = cfg.steps.flatMap((s) => s.beats).sort((a, b) => a - b);
    expect(beats).toEqual(cfg.walk.map((_, i) => i));
  });
  it("every step has form, tokens array and refs with kinds", () => {
    for (const s of cfg.steps) {
      expect(typeof s.detail.form).toBe("string");
      expect(Array.isArray(s.detail.tokens)).toBe(true);
      expect(s.detail.refs.length).toBeGreaterThan(0);
      for (const r of s.detail.refs) {
        expect(r.id && r.title).toBeTruthy();
        expect(["rfc", "spec", "emerging"]).toContain(r.kind);
      }
      for (const t of s.detail.tokens) expect(t.note).toMatch(/MOCK/);
    }
  });
  it("has no JWT literals", () => {
    expect(JWT.test(JSON.stringify(cfg.steps))).toBe(false);
  });
});
